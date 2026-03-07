#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Email Scan — Capture Inbox Pipeline
 *
 * Scans 4 Gmail accounts via gog CLI, classifies emails using OpenClaw agent,
 * and routes them to the appropriate system.
 *
 * Cron: every 30 min, 7 AM - 8 PM BRT (10:00-23:00 UTC)
 */
import { execFileSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { hashItem, isSeen, markSeen } from "../lib/inbox-dedup.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const GOG = process.env.GOG_BIN || "/opt/homebrew/bin/gog";
const OPENCLAW = process.env.OPENCLAW_BIN || "/opt/homebrew/bin/openclaw";
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");

const ACCOUNTS = [
  "ferro.tulio@gmail.com",
  "tulio@weareliveengine.com",
  "tuliof@creativetoolsagency.com",
  "tulsbot@gmail.com",
];

const CLASSIFICATION_PROMPT = `Classify this email into exactly ONE category. Respond with ONLY the category name, nothing else.

Categories:
- action-required (needs response or creates a task)
- client-communication (client/business partner comms — update CRM)
- inft-ops (INFT_Hub operations — route to Notion)
- receipt-transactional (receipts, confirmations, shipping — auto-archive)
- newsletter (newsletters, marketing — auto-archive)
- system-build (OpenClaw/Tulsbot build emails, GitHub notifications — auto-archive)
- spam-noise (spam, irrelevant — auto-archive)

Email:
From: {from}
Subject: {subject}
Snippet: {snippet}

Category:`;

interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  account: string;
}

interface ClassifiedEmail extends EmailMessage {
  category: string;
  hash: string;
}

function scanAccount(account: string): EmailMessage[] {
  try {
    const result = execFileSync(
      GOG,
      [
        "gmail",
        "messages",
        "search",
        "in:inbox is:unread newer_than:1d",
        "--max",
        "20",
        "--account",
        account,
        "--format",
        "json",
      ],
      {
        timeout: 30_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );

    const messages = JSON.parse(result);
    if (!Array.isArray(messages)) {
      return [];
    }

    return messages.map((m: any) => ({
      id: m.id || m.messageId || String(Math.random()),
      threadId: m.threadId || "",
      from: m.from || m.sender || "unknown",
      subject: m.subject || "(no subject)",
      snippet: (m.snippet || m.body || "").slice(0, 300),
      date: m.date || m.internalDate || new Date().toISOString(),
      account,
    }));
  } catch (err: any) {
    console.error(`[email-scan] Failed to scan ${account}:`, err.message);
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

function classifyEmail(email: EmailMessage): string {
  const prompt = CLASSIFICATION_PROMPT.replace("{from}", email.from)
    .replace("{subject}", email.subject)
    .replace("{snippet}", email.snippet);

  try {
    const result = execFileSync(
      OPENCLAW,
      ["agent", "--agent", "main", "--json", "--message", prompt],
      {
        timeout: 30_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      const text = data?.payloads?.[0]?.text || data?.result?.payloads?.[0]?.text || "";
      const category = text
        .trim()
        .toLowerCase()
        .replace(/[^a-z-]/g, "");
      const valid = [
        "action-required",
        "client-communication",
        "inft-ops",
        "receipt-transactional",
        "newsletter",
        "system-build",
        "spam-noise",
      ];
      return valid.includes(category) ? category : "action-required";
    }
  } catch (err: any) {
    console.error(`[email-scan] Classification failed:`, err.message);
  }
  return "action-required"; // default to requiring attention
}

function archiveEmail(email: EmailMessage, label: string): void {
  try {
    execFileSync(
      GOG,
      [
        "gmail",
        "modify",
        email.id,
        "--account",
        email.account,
        "--add-labels",
        label,
        "--remove-labels",
        "INBOX",
      ],
      {
        timeout: 15_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );
  } catch {
    // label/archive is best-effort
  }
}

async function main() {
  console.log("[email-scan] Starting email scan...");
  const pendingDir = join(WORKSPACE, "memory/inbox");
  if (!existsSync(pendingDir)) {
    mkdirSync(pendingDir, { recursive: true });
  }

  let totalScanned = 0;
  let totalNew = 0;
  let totalArchived = 0;
  const needsReview: ClassifiedEmail[] = [];

  for (const account of ACCOUNTS) {
    const messages = scanAccount(account);
    totalScanned += messages.length;
    console.log(`[email-scan] ${account}: ${messages.length} unread`);

    for (const msg of messages) {
      const hash = hashItem("email", `${msg.account}:${msg.id}`);
      if (isSeen(hash)) {
        continue;
      }

      totalNew++;
      const category = classifyEmail(msg);
      const classified: ClassifiedEmail = { ...msg, category, hash };

      markSeen(hash, "email", `${category}:${msg.subject.slice(0, 50)}`);

      const autoArchive = ["receipt-transactional", "newsletter", "system-build", "spam-noise"];
      if (autoArchive.includes(category)) {
        const labelMap: Record<string, string> = {
          "receipt-transactional": "receipts",
          newsletter: "newsletters",
          "system-build": "system/tulsbot-build",
          "spam-noise": "spam-noise",
        };
        archiveEmail(msg, labelMap[category] || category);
        totalArchived++;
        logEvent({
          source: "email-scan",
          action: "auto-archive",
          target: `${msg.account}:${msg.subject.slice(0, 60)}`,
          result: "ok",
          detail: `category=${category}`,
          rationale: "Matched auto-archive classification rubric",
          rollback: `gog gmail modify ${msg.id} --account ${msg.account} --add-labels INBOX`,
        });
      } else {
        needsReview.push(classified);
        appendFileSync(
          PENDING_PATH,
          JSON.stringify({
            ...classified,
            addedAt: new Date().toISOString(),
            status: "pending",
          }) + "\n",
        );
      }
    }
  }

  console.log(
    `[email-scan] Done. Scanned: ${totalScanned}, New: ${totalNew}, Auto-archived: ${totalArchived}, Needs review: ${needsReview.length}`,
  );

  logEvent({
    source: "email-scan",
    action: "scan-complete",
    result: "ok",
    detail: `scanned=${totalScanned} new=${totalNew} archived=${totalArchived} review=${needsReview.length}`,
  });

  if (needsReview.length > 0) {
    const summary = needsReview.map((e) => `• [${e.category}] ${e.from}: ${e.subject}`).join("\n");
    console.log(`\n📬 Items needing review:\n${summary}`);
  }
}

main().catch((err) => {
  console.error("[email-scan] Fatal error:", err);
  logEvent({ source: "email-scan", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
