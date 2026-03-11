import "dotenv/config";
/**
 * Email Scan — Deterministic edge screening
 *
 * Goal:
 * - Keep Inbox high-signal only (action-required, starred, uncertain)
 * - Auto-label + archive deterministic non-action mail
 * - Send only action/uncertain items to inbox capture queue
 */
import { execFileSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import {
  hashItem,
  isSeen,
  markSeen,
  buildThreadKey,
  buildMessageKey,
  registerThreadKey,
  registerMessageKey,
} from "../lib/inbox-dedup.js";
import { sendToTopic, truncateForTelegram } from "../lib/telegram-notify.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const GOG = process.env.GOG_BIN || "/opt/homebrew/bin/gog";
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");
const RULES_PATH = join(WORKSPACE, "memory/email-screen-rules.json");
const HABITS_PATH = join(WORKSPACE, "data/email-label-habits.json");

const ACCOUNTS = [
  "ferro.tulio@gmail.com",
  "tulio@weareliveengine.com",
  "tuliof@creativetoolsagency.com",
  "tulsbot@gmail.com",
];

const BACKFILL = process.argv.includes("--backfill");
const DAYS_ARG = process.argv.find((a) => a.startsWith("--days="));
const LOOKBACK_DAYS = DAYS_ARG ? Math.max(1, Number(DAYS_ARG.split("=")[1]) || 2) : 2;
const QUERY = BACKFILL ? "in:inbox" : `in:inbox is:unread newer_than:${LOOKBACK_DAYS}d`;
const MAX = BACKFILL ? "20" : "40"; // Reduced MAX for backfill to 20 for debugging

interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  account: string;
  labels: string[];
}

interface Rules {
  managedLabels: {
    action: string;
    review: string;
    archivePrefixes: Record<string, string>;
  };
  keepInInbox: {
    senderContains: string[];
    subjectContains: string[];
  };
  archiveRules: Array<{
    id: string;
    label: string;
    senderContains?: string[];
    subjectContains?: string[];
  }>;
}

type Decision =
  | { type: "keep-action"; label: string; rule: string }
  | { type: "keep-review"; label: string; rule: string }
  | { type: "archive"; label: string; rule: string };

function loadRules(): Rules {
  return JSON.parse(readFileSync(RULES_PATH, "utf-8")) as Rules;
}

function scanAccount(account: string): EmailMessage[] {
  try {
    console.log(`[DEBUG] Scanning account: ${account} with query: ${QUERY}, max: ${MAX}`);
    const result = execFileSync(
      GOG,
      ["gmail", "search", QUERY, "--max", MAX, "--account", account, "--json"],
      {
        timeout: 60_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );

    const data = JSON.parse(result);
    console.log(
      `[DEBUG] Received ${data.threads?.length || data.messages?.length || 0} threads from gog.`,
    );
    const threads = data.threads || data.messages || [];
    if (!Array.isArray(threads)) {
      return [];
    }

    return threads.map((m: any) => ({
      id: m.id || m.messageId || String(Math.random()),
      threadId: m.threadId || m.id || "",
      from: m.from || "unknown",
      subject: m.subject || "(no subject)",
      snippet: (m.snippet || "").slice(0, 300),
      date: m.date || new Date().toISOString(),
      account,
      labels: Array.isArray(m.labels) ? m.labels : [],
    }));
  } catch (err: any) {
    console.error(`[DEBUG] Error scanning account ${account}: ${err.message}`);
    logEvent({
      source: "email-scan",
      action: "scan-account",
      target: account,
      result: "error",
      detail: err.message,
    });
    return [];
  }
}

function containsAny(text: string, parts: string[] = []): boolean {
  const low = text.toLowerCase();
  return parts.some((p) => low.includes(p.toLowerCase()));
}

function decide(msg: EmailMessage, rules: Rules): Decision {
  console.log(`[DEBUG] Deciding for: ${msg.subject.slice(0, 50)}... from ${msg.from}`);
  const from = msg.from.toLowerCase();
  const subject = msg.subject.toLowerCase();

  // 0) always keep starred
  if (msg.labels.includes("STARRED")) {
    return { type: "keep-action", label: rules.managedLabels.action, rule: "starred-always-keep" };
  }

  // 1) deterministic action keep rules
  if (
    containsAny(from, rules.keepInInbox.senderContains) ||
    containsAny(subject, rules.keepInInbox.subjectContains)
  ) {
    return { type: "keep-action", label: rules.managedLabels.action, rule: "keepInInbox" };
  }

  // 2) deterministic archive rules
  for (const r of rules.archiveRules) {
    const senderHit = containsAny(from, r.senderContains || []);
    const subjectHit = containsAny(subject, r.subjectContains || []);
    if (senderHit || subjectHit) {
      const mapped = rules.managedLabels.archivePrefixes[r.label] || r.label;
      return { type: "archive", label: mapped, rule: r.id };
    }
  }

  // 3) uncertain
  return { type: "keep-review", label: rules.managedLabels.review, rule: "fallback-uncertain" };
}

function ensureLabel(account: string, label: string): void {
  if (!label || ["INBOX", "UNREAD", "IMPORTANT", "STARRED"].includes(label)) {
    return;
  }
  try {
    execFileSync(GOG, ["gmail", "labels", "get", label, "--account", account, "--json"], {
      timeout: 8_000,
      encoding: "utf-8",
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
    });
    return;
  } catch {}
  try {
    execFileSync(GOG, ["gmail", "labels", "create", label, "--account", account, "--json"], {
      timeout: 8_000,
      encoding: "utf-8",
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
    });
  } catch {}
}

function modifyThread(account: string, threadId: string, add: string[], remove: string[]): boolean {
  console.log(
    `[DEBUG] Modifying thread ${threadId} for account ${account}. Add: ${add.join(", ") || "None"}, Remove: ${remove.join(", ") || "None"}`,
  );
  try {
    const args = ["gmail", "thread", "modify", threadId, "--account", account];
    for (const a of add) {
      args.push("--add", a);
    }
    for (const r of remove) {
      args.push("--remove", r);
    }
    args.push("--force");
    execFileSync(GOG, args, {
      timeout: 20_000,
      encoding: "utf-8",
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
    });
    console.log(`[DEBUG] Successfully modified thread: ${threadId}`);
    return true;
  } catch (err: any) {
    console.error(`[DEBUG] Error modifying thread ${threadId}: ${err.message}`);
    return false;
  }
}

function captureHabit(msg: EmailMessage, managedLabels: Set<string>) {
  const labels = msg.labels.filter((l) => !managedLabels.has(l));
  if (labels.length === 0) {
    return;
  }
  const domain = (msg.from.match(/@[^>\s]+/)?.[0] || "unknown").toLowerCase();

  let state: any = { senders: {} };
  if (existsSync(HABITS_PATH)) {
    try {
      state = JSON.parse(readFileSync(HABITS_PATH, "utf-8"));
    } catch {}
  }
  if (!state.senders[domain]) {
    state.senders[domain] = {};
  }
  for (const label of labels) {
    state.senders[domain][label] = (state.senders[domain][label] || 0) + 1;
  }
  writeFileSync(HABITS_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  const rules = loadRules();
  const managedLabels = new Set([
    "INBOX",
    "UNREAD",
    "IMPORTANT",
    "STARRED",
    rules.managedLabels.action,
    rules.managedLabels.review,
    ...Object.values(rules.managedLabels.archivePrefixes),
  ]);

  const pendingDir = join(WORKSPACE, "memory/inbox");
  if (!existsSync(pendingDir)) {
    mkdirSync(pendingDir, { recursive: true });
  }

  let scanned = 0;
  let archived = 0;
  let keptAction = 0;
  let keptReview = 0;
  const reviewList: EmailMessage[] = [];

  for (const account of ACCOUNTS) {
    // Ensure managed labels exist on each account
    ensureLabel(account, rules.managedLabels.action);
    ensureLabel(account, rules.managedLabels.review);
    for (const v of Object.values(rules.managedLabels.archivePrefixes)) {
      ensureLabel(account, v);
    }

    const messages = scanAccount(account);
    scanned += messages.length;

    for (const msg of messages) {
      const threadKey = buildThreadKey("gmail", msg.account, msg.threadId || msg.id);
      const messageKey = buildMessageKey("gmail", msg.account, msg.id);
      const hash = hashItem("email", messageKey);
      const messageAlreadySeen = isSeen(hash) || registerMessageKey(messageKey, threadKey).exists;
      registerThreadKey(threadKey);
      if (messageAlreadySeen && !BACKFILL) {
        logEvent({
          source: "email-scan",
          action: "dedup-skip",
          target: `${msg.account}:${(msg.subject || "").slice(0, 70)}`,
          result: "ok",
          detail: `threadKey=${threadKey} messageKey=${messageKey}`,
        });
        continue;
      }

      const d = decide(msg, rules);
      console.log(
        `[DEBUG] Decision for ${msg.subject.slice(0, 50)}...: ${d.type} with label ${d.label}`,
      );

      if (d.type === "archive") {
        console.log(`[DEBUG] Attempting to archive: ${msg.subject.slice(0, 50)}...`);
        const ok = modifyThread(account, msg.id, [d.label], ["INBOX"]);
        if (ok) {
          archived++;
          logEvent({
            source: "email-scan",
            action: "edge-archive",
            target: `${msg.account}:${msg.subject.slice(0, 70)}`,
            result: "ok",
            detail: `label=${d.label} rule=${d.rule}`,
            rollback: `gog gmail thread modify ${msg.id} --account ${msg.account} --add INBOX`,
          });
        }
      } else if (d.type === "keep-action") {
        keptAction++;
        console.log(`[DEBUG] Attempting to keep-action: ${msg.subject.slice(0, 50)}...`);
        modifyThread(account, msg.id, [d.label], []);
        appendFileSync(
          PENDING_PATH,
          JSON.stringify({
            ...msg,
            threadKey,
            messageKey,
            category: "action-required",
            hash,
            addedAt: new Date().toISOString(),
            status: "pending",
          }) + "\\n",
        );
        console.log(`[DEBUG] Appended to PENDING_PATH: ${PENDING_PATH}`);
      } else {
        keptReview++;
        reviewList.push(msg);
        console.log(`[DEBUG] Attempting to keep-review: ${msg.subject.slice(0, 50)}...`);
        modifyThread(account, msg.id, [d.label], []);
        appendFileSync(
          PENDING_PATH,
          JSON.stringify({
            ...msg,
            threadKey,
            messageKey,
            category: "to-be-sorted",
            hash,
            addedAt: new Date().toISOString(),
            status: "pending",
          }) + "\\n",
        );
        console.log(`[DEBUG] Appended to PENDING_PATH: ${PENDING_PATH}`);
      }

      captureHabit(msg, managedLabels);
      markSeen(hash, "email", `${d.type}:${msg.subject.slice(0, 50)}`);
    }
  }

  logEvent({
    source: "email-scan",
    action: BACKFILL ? "backfill-complete" : "scan-complete",
    result: "ok",
    detail: `scanned=${scanned} archived=${archived} action=${keptAction} review=${keptReview}`,
  });

  if (reviewList.length > 0) {
    const summary = reviewList
      .slice(0, 30)
      .map((e) => `• ${e.from}: ${e.subject}`)
      .join("\\n");
    sendToTopic(
      "inbox_review",
      truncateForTelegram(
        `🟨 <b>To be sorted</b>: ${reviewList.length} email(s)\\n\\n${summary}\\n\\nReply with routing decisions and I will learn patterns from your labels.`,
      ),
    );
  }

  console.log(
    `[email-scan] done scanned=${scanned} archived=${archived} action=${keptAction} review=${keptReview} backfill=${BACKFILL}`,
  );
}

main().catch((err) => {
  console.error("[email-scan] Fatal error:", err);
  logEvent({ source: "email-scan", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
