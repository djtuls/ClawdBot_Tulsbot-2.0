import "dotenv/config";
/**
 * Email Backfill Manager — Deterministic edge screening, stateful backfill
 *
 * Goal:
 * - Manages phased backfill of Gmail inboxes using a state file.
 * - Processes one account for one day increment per run (designed for cron).
 * - Auto-label + archive deterministic non-action mail.
 * - Send only action/uncertain items to inbox capture queue.
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
const BACKFILL_STATE_PATH = join(WORKSPACE, "memory/inbox/backfill-state.json");
const LOCK_PATH = join(WORKSPACE, "memory/inbox/email-backfill.lock");

const ACCOUNTS_LIST = [
  "ferro.tulio@gmail.com",
  "tulio@weareliveengine.com",
  "tuliof@creativetoolsagency.com",
  "tulsbot@gmail.com",
];

const MAX_THREADS_PER_SCAN = "20"; // Keep this small for cron jobs
const RUN_MAX_MS = Number(process.env.EMAIL_BACKFILL_MAX_MS || 75_000);
const ACCOUNT_FAIL_BUDGET = Number(process.env.EMAIL_BACKFILL_ACCOUNT_FAIL_BUDGET || 20);
const LOCK_STALE_MS = Number(process.env.EMAIL_BACKFILL_LOCK_STALE_MS || 45 * 60_000);

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

interface BackfillState {
  currentAccountIndex: number;
  currentDay: number;
  maxDays: number;
  completedAccounts: string[];
  lastRun: string | null;
  isComplete: boolean;
}

type Decision =
  | { type: "keep-action"; label: string; rule: string }
  | { type: "keep-review"; label: string; rule: string }
  | { type: "archive"; label: string; rule: string };

function loadRules(): Rules {
  return JSON.parse(readFileSync(RULES_PATH, "utf-8")) as Rules;
}

function loadBackfillState(): BackfillState {
  if (!existsSync(BACKFILL_STATE_PATH)) {
    // Initialize default state if file doesn't exist
    const defaultState: BackfillState = {
      currentAccountIndex: 0,
      currentDay: 1,
      maxDays: 90,
      completedAccounts: [],
      lastRun: null,
      isComplete: false,
    };
    writeFileSync(BACKFILL_STATE_PATH, JSON.stringify(defaultState, null, 2));
    return defaultState;
  }
  return JSON.parse(readFileSync(BACKFILL_STATE_PATH, "utf-8")) as BackfillState;
}

function saveBackfillState(state: BackfillState): void {
  state.lastRun = new Date().toISOString();
  writeFileSync(BACKFILL_STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`[DEBUG] Backfill state saved: ${JSON.stringify(state)}`);
}

function scanAccount(account: string, lookbackDays: number): EmailMessage[] {
  const query = `in:inbox newer_than:${lookbackDays}d`;
  try {
    console.log(
      `[DEBUG] Scanning account: ${account} with query: ${query}, max: ${MAX_THREADS_PER_SCAN}`,
    );
    const result = execFileSync(
      GOG,
      ["gmail", "search", query, "--max", MAX_THREADS_PER_SCAN, "--account", account, "--json"],
      {
        timeout: 60_000, // 1 minute timeout for gog call
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
    console.error(
      `[DEBUG] Error scanning account ${account} for days ${lookbackDays}: ${err.message}`,
    );
    logEvent({
      source: "email-backfill",
      action: "scan-account-error",
      target: `${account}:${lookbackDays}d`,
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
      timeout: 20_000, // 20 seconds for thread modification
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

function acquireRunLock(): boolean {
  try {
    if (existsSync(LOCK_PATH)) {
      try {
        const lock = JSON.parse(readFileSync(LOCK_PATH, "utf-8")) as { ts?: string; pid?: number };
        const lockAge = Date.now() - new Date(lock.ts || 0).getTime();
        if (Number.isFinite(lockAge) && lockAge < LOCK_STALE_MS) {
          logEvent({
            source: "email-backfill",
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
      source: "email-backfill",
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
    console.log("[email-backfill-manager] skipped (existing active lock)");
    return;
  }

  const startedAt = Date.now();
  let backfillState = loadBackfillState();

  if (backfillState.isComplete) {
    console.log("[INFO] Email backfill is already complete. Exiting.");
    logEvent({ source: "email-backfill", action: "backfill-already-complete", result: "ok" });
    releaseRunLock();
    return;
  }

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

  const currentAccount = ACCOUNTS_LIST[backfillState.currentAccountIndex];

  // Ensure managed labels exist on the current account
  ensureLabel(currentAccount, rules.managedLabels.action);
  ensureLabel(currentAccount, rules.managedLabels.review);
  for (const v of Object.values(rules.managedLabels.archivePrefixes)) {
    ensureLabel(currentAccount, v);
  }

  if (Date.now() - startedAt > RUN_MAX_MS) {
    logEvent({
      source: "email-backfill",
      action: "runtime-cap-hit",
      result: "ok",
      detail: `runMaxMs=${RUN_MAX_MS} account=${currentAccount} day=${backfillState.currentDay}`,
    });
    releaseRunLock();
    return;
  }

  const messages = scanAccount(currentAccount, backfillState.currentDay);
  scanned += messages.length;
  let accountModifyFailures = 0;

  for (const msg of messages) {
    if (Date.now() - startedAt > RUN_MAX_MS) {
      logEvent({
        source: "email-backfill",
        action: "runtime-cap-hit",
        target: currentAccount,
        result: "ok",
        detail: `runMaxMs=${RUN_MAX_MS} day=${backfillState.currentDay}`,
      });
      break;
    }
    if (accountModifyFailures >= ACCOUNT_FAIL_BUDGET) {
      logEvent({
        source: "email-backfill",
        action: "failure-budget-hit",
        target: currentAccount,
        result: "error",
        detail: `accountFail=${accountModifyFailures}/${ACCOUNT_FAIL_BUDGET}`,
      });
      break;
    }
    const threadKey = buildThreadKey("gmail", msg.account, msg.threadId || msg.id);
    const messageKey = buildMessageKey("gmail", msg.account, msg.id);
    const hash = hashItem("email", messageKey);
    const messageAlreadySeen = isSeen(hash) || registerMessageKey(messageKey, threadKey).exists;
    registerThreadKey(threadKey);
    // For backfill, we want to re-process messages even if seen, if state changed or rules updated
    // However, to avoid duplicate entries in pending.jsonl for already-processed items, check if already in pending
    // For now, let's keep the dedup-skip for messages that were already explicitly processed
    if (messageAlreadySeen) {
      console.log(`[DEBUG] Dedup-skipping already seen message: ${msg.subject.slice(0, 50)}...`);
      continue;
    }

    const d = decide(msg, rules);
    console.log(
      `[DEBUG] Decision for ${msg.subject.slice(0, 50)}...: ${d.type} with label ${d.label}`,
    );

    if (d.type === "archive") {
      console.log(`[DEBUG] Attempting to archive: ${msg.subject.slice(0, 50)}...`);
      const ok = modifyThread(currentAccount, msg.id, [d.label], ["INBOX"]);
      if (ok) {
        archived++;
        logEvent({
          source: "email-backfill",
          action: "edge-archive",
          target: `${msg.account}:${msg.subject.slice(0, 70)}`,
          result: "ok",
          detail: `label=${d.label} rule=${d.rule}`,
          rollback: `gog gmail thread modify ${msg.id} --account ${msg.account} --add INBOX`,
        });
      } else {
        accountModifyFailures++;
      }
    } else if (d.type === "keep-action") {
      keptAction++;
      console.log(`[DEBUG] Attempting to keep-action: ${msg.subject.slice(0, 50)}...`);
      const ok = modifyThread(currentAccount, msg.id, [d.label], []);
      if (!ok) {
        accountModifyFailures++;
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
        }) + "\\n",
      );
      console.log(`[DEBUG] Appended to PENDING_PATH: ${PENDING_PATH}`);
    } else {
      keptReview++;
      reviewList.push(msg);
      console.log(`[DEBUG] Attempting to keep-review: ${msg.subject.slice(0, 50)}...`);
      const ok = modifyThread(currentAccount, msg.id, [d.label], []);
      if (!ok) {
        accountModifyFailures++;
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
        }) + "\\n",
      );
      console.log(`[DEBUG] Appended to PENDING_PATH: ${PENDING_PATH}`);
    }

    captureHabit(msg, managedLabels);
    markSeen(hash, "email", `${d.type}:${msg.subject.slice(0, 50)}`);
  }

  // Update backfill state
  backfillState.currentDay++;
  if (backfillState.currentDay > backfillState.maxDays) {
    backfillState.currentDay = 1;
    backfillState.currentAccountIndex++;
    if (backfillState.currentAccountIndex >= ACCOUNTS_LIST.length) {
      backfillState.isComplete = true;
      console.log("[INFO] Email backfill completed for all accounts and all days!");
      sendToTopic(
        "inbox_notifications",
        "✅ Email backfill completed for all accounts and all days!",
      );
    }
  }
  saveBackfillState(backfillState);

  logEvent({
    source: "email-backfill",
    action: "backfill-step-complete",
    result: "ok",
    detail: `account=${currentAccount} day=${backfillState.currentDay - 1} scanned=${scanned} archived=${archived} action=${keptAction} review=${keptReview} `,
  });

  if (reviewList.length > 0) {
    const summary = reviewList
      .slice(0, 10) // Limit summary to 10 for notification
      .map((e) => `• ${e.from}: ${e.subject}`)
      .join("\\n");
    sendToTopic(
      "inbox_review",
      truncateForTelegram(
        `🟨 <b>To be sorted</b>: ${reviewList.length} email(s) from ${currentAccount} (Day ${backfillState.currentDay - 1})\\n\\n${summary}\\n\\nReply with routing decisions and I will learn patterns from your labels.`,
      ),
    );
  }

  console.log(
    `[email-backfill-manager] done account=${currentAccount} day=${backfillState.currentDay - 1} scanned=${scanned} archived=${archived} action=${keptAction} review=${keptReview}`,
  );
  releaseRunLock();
}

main().catch((err) => {
  releaseRunLock();
  console.error("[email-backfill-manager] Fatal error:", err);
  logEvent({ source: "email-backfill", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
