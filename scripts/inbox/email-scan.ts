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
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
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
const LOCK_PATH = join(WORKSPACE, "memory/inbox/email-scan.lock");

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
const MAX = BACKFILL ? "500" : "40";
const RUN_MAX_MS = Number(process.env.EMAIL_SCAN_MAX_MS || (BACKFILL ? 90_000 : 60_000));
const ACCOUNT_FAIL_BUDGET = Number(process.env.EMAIL_SCAN_ACCOUNT_FAIL_BUDGET || 25);
const MODIFY_FAIL_BUDGET = Number(process.env.EMAIL_SCAN_MODIFY_FAIL_BUDGET || 40);
const LOCK_STALE_MS = Number(process.env.EMAIL_SCAN_LOCK_STALE_MS || 30 * 60_000);

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
    return true;
  } catch {
    return false;
  }
}

function acquireRunLock(): boolean {
  try {
    if (existsSync(LOCK_PATH)) {
      try {
        const lock = JSON.parse(readFileSync(LOCK_PATH, "utf-8")) as { ts?: string; pid?: number };
        const lockAge = Date.now() - new Date(lock.ts || 0).getTime();
        if (Number.isFinite(lockAge) && lockAge < LOCK_STALE_MS) {
          logEvent({
            source: "email-scan",
            action: "lock-skip",
            result: "ok",
            detail: `existing lock pid=${lock.pid ?? "unknown"} ageMs=${lockAge}`,
          });
          return false;
        }
      } catch {
        // stale/corrupt lock file; overwrite below
      }
    }
    writeFileSync(
      LOCK_PATH,
      JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }, null, 2),
    );
    return true;
  } catch (err: any) {
    logEvent({
      source: "email-scan",
      action: "lock-error",
      result: "error",
      detail: String(err?.message || err),
    });
    return false;
  }
}

function releaseRunLock(): void {
  try {
    if (existsSync(LOCK_PATH)) {
      unlinkSync(LOCK_PATH);
    }
  } catch {}
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
  if (!acquireRunLock()) {
    console.log("[email-scan] skipped (existing active lock)");
    return;
  }

  const startedAt = Date.now();
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

  const accountFilter = process.env.GOG_ACCOUNT?.trim();
  const accounts = accountFilter ? ACCOUNTS.filter((a) => a === accountFilter) : ACCOUNTS;
  if (accounts.length === 0) {
    logEvent({
      source: "email-scan",
      action: "account-filter-empty",
      result: "error",
      detail: `GOG_ACCOUNT=${accountFilter}`,
    });
    releaseRunLock();
    return;
  }

  let totalModifyFailures = 0;
  for (const account of accounts) {
    if (Date.now() - startedAt > RUN_MAX_MS) {
      logEvent({
        source: "email-scan",
        action: "runtime-cap-hit",
        result: "ok",
        detail: `runMaxMs=${RUN_MAX_MS} scanned=${scanned} archived=${archived} action=${keptAction} review=${keptReview}`,
      });
      break;
    }

    // Ensure managed labels exist on each account
    ensureLabel(account, rules.managedLabels.action);
    ensureLabel(account, rules.managedLabels.review);
    for (const v of Object.values(rules.managedLabels.archivePrefixes)) {
      ensureLabel(account, v);
    }

    const messages = scanAccount(account);
    scanned += messages.length;
    let accountModifyFailures = 0;

    for (const msg of messages) {
      if (Date.now() - startedAt > RUN_MAX_MS) {
        break;
      }
      if (
        accountModifyFailures >= ACCOUNT_FAIL_BUDGET ||
        totalModifyFailures >= MODIFY_FAIL_BUDGET
      ) {
        logEvent({
          source: "email-scan",
          action: "failure-budget-hit",
          target: account,
          result: "error",
          detail: `accountFail=${accountModifyFailures}/${ACCOUNT_FAIL_BUDGET} totalFail=${totalModifyFailures}/${MODIFY_FAIL_BUDGET}`,
        });
        break;
      }
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

      if (d.type === "archive") {
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
        } else {
          accountModifyFailures++;
          totalModifyFailures++;
        }
      } else if (d.type === "keep-action") {
        keptAction++;
        const ok = modifyThread(account, msg.id, [d.label], []);
        if (!ok) {
          accountModifyFailures++;
          totalModifyFailures++;
        }
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
          }) + "\n",
        );
      } else {
        keptReview++;
        reviewList.push(msg);
        const ok = modifyThread(account, msg.id, [d.label], []);
        if (!ok) {
          accountModifyFailures++;
          totalModifyFailures++;
        }
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
          }) + "\n",
        );
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
      .join("\n");
    sendToTopic(
      "inbox_review",
      truncateForTelegram(
        `🟨 <b>To be sorted</b>: ${reviewList.length} email(s)\n\n${summary}\n\nReply with routing decisions and I will learn patterns from your labels.`,
      ),
    );
  }

  console.log(
    `[email-scan] done scanned=${scanned} archived=${archived} action=${keptAction} review=${keptReview} backfill=${BACKFILL}`,
  );
  releaseRunLock();
}

main().catch((err) => {
  releaseRunLock();
  console.error("[email-scan] Fatal error:", err);
  logEvent({ source: "email-scan", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
