#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * WhatsApp Daily Scan — Capture Inbox Pipeline
 *
 * Scans recent WhatsApp messages via wacli skill,
 * extracts commitments and action items, creates Todoist tasks.
 *
 * Cron: daily 9 AM BRT (12:00 UTC)
 */
import { execFileSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { hashItem, isSeen, markSeen } from "../lib/inbox-dedup.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const OPENCLAW = process.env.OPENCLAW_BIN || "/opt/homebrew/bin/openclaw";
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");

const EXTRACTION_PROMPT = `Analyze these WhatsApp messages and extract any commitments, promises, action items, or decisions.

For each item found, output a JSON array where each element has:
- "commitment": the specific promise or action item
- "from": who made it
- "to": who it was made to
- "deadline": any mentioned deadline (or "unspecified")
- "context": brief context

If no commitments found, return an empty array: []

Messages:
{messages}

JSON array:`;

async function main() {
  console.log("[whatsapp-scan] Starting WhatsApp scan...");

  const pendingDir = join(WORKSPACE, "memory/inbox");
  if (!existsSync(pendingDir)) {
    mkdirSync(pendingDir, { recursive: true });
  }

  // Use openclaw agent with wacli skill to read recent messages
  try {
    const result = execFileSync(
      OPENCLAW,
      [
        "agent",
        "--agent",
        "main",
        "--json",
        "--message",
        "Use the wacli skill to read the last 24 hours of WhatsApp messages from my key business conversations. Return the messages as a plain text list with sender, time, and message content. Focus on conversations with clients and team members.",
      ],
      {
        timeout: 120_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("[whatsapp-scan] No response from agent");
      return;
    }

    const data = JSON.parse(jsonMatch[0]);
    const messagesText = data?.payloads?.[0]?.text || data?.result?.payloads?.[0]?.text || "";

    if (!messagesText || messagesText.includes("no messages") || messagesText.length < 50) {
      console.log("[whatsapp-scan] No significant messages found");
      logEvent({ source: "whatsapp-scan", action: "scan", result: "ok", detail: "No messages" });
      return;
    }

    // Extract commitments
    const extractionPrompt = EXTRACTION_PROMPT.replace("{messages}", messagesText.slice(0, 3000));
    const extractResult = execFileSync(
      OPENCLAW,
      ["agent", "--agent", "main", "--json", "--message", extractionPrompt],
      {
        timeout: 60_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );

    const extractJson = extractResult.match(/\{[\s\S]*\}/);
    if (!extractJson) {
      return;
    }

    const extractData = JSON.parse(extractJson[0]);
    const extractText =
      extractData?.payloads?.[0]?.text || extractData?.result?.payloads?.[0]?.text || "[]";

    const arrayMatch = extractText.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      return;
    }

    const commitments = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(commitments) || commitments.length === 0) {
      console.log("[whatsapp-scan] No commitments extracted");
      return;
    }

    let added = 0;
    for (const c of commitments) {
      const hash = hashItem("whatsapp", `${c.from}:${c.commitment}`.slice(0, 100));
      if (isSeen(hash)) {
        continue;
      }

      markSeen(hash, "whatsapp", c.commitment?.slice(0, 50));
      appendFileSync(
        PENDING_PATH,
        JSON.stringify({
          hash,
          source: "whatsapp",
          category: "action-required",
          commitment: c.commitment,
          from: c.from,
          subject: `WhatsApp: ${c.commitment?.slice(0, 60)}`,
          snippet: `${c.from} → ${c.to}: ${c.context || ""}`.slice(0, 200),
          addedAt: new Date().toISOString(),
          status: "pending",
          deadline: c.deadline,
        }) + "\n",
      );
      added++;
    }

    console.log(`[whatsapp-scan] Done. Extracted ${commitments.length} commitments, ${added} new`);
    logEvent({
      source: "whatsapp-scan",
      action: "scan-complete",
      result: "ok",
      detail: `commitments=${commitments.length} new=${added}`,
    });
  } catch (err: any) {
    console.error("[whatsapp-scan] Error:", err.message);
    logEvent({ source: "whatsapp-scan", action: "scan", result: "error", detail: err.message });
  }
}

main().catch((err) => {
  console.error("[whatsapp-scan] Fatal:", err);
  process.exit(1);
});
