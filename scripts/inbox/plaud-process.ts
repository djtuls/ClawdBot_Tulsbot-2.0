import "dotenv/config";
/**
 * Plaud Transcript Processing — Capture Inbox Pipeline
 *
 * Scans Plaud export directory for new transcripts,
 * extracts action items and summaries, routes to appropriate systems.
 *
 * Cron: daily 10 PM BRT (01:00 UTC)
 */
import { execFileSync } from "child_process";
import { readdirSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { hashItem, isSeen, markSeen } from "../lib/inbox-dedup.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const OPENCLAW = process.env.OPENCLAW_BIN || "/opt/homebrew/bin/openclaw";
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");

// Plaud exports to iCloud or a local directory — adjust path as needed
const PLAUD_DIR =
  process.env.PLAUD_DIR ||
  join(
    process.env.HOME || "/Users/tulioferro",
    "Library/Mobile Documents/com~apple~CloudDocs/Plaud",
  );

const EXTRACTION_PROMPT = `Analyze this call transcript and extract:
1. A 2-3 sentence summary
2. Action items (who needs to do what)
3. Key decisions made
4. Whether this was a client call (and if so, which client/company)

Respond in JSON format:
{
  "summary": "...",
  "actionItems": [{"task": "...", "owner": "...", "deadline": "..."}],
  "decisions": ["..."],
  "isClientCall": true/false,
  "client": "company name or null",
  "participants": ["..."]
}

Transcript:
{transcript}`;

async function main() {
  console.log("[plaud-process] Starting Plaud transcript processing...");

  if (!existsSync(PLAUD_DIR)) {
    console.log(`[plaud-process] Plaud directory not found: ${PLAUD_DIR}`);
    logEvent({
      source: "plaud-process",
      action: "scan",
      result: "skipped",
      detail: "Directory not found",
    });
    return;
  }

  const pendingDir = join(WORKSPACE, "memory/inbox");
  if (!existsSync(pendingDir)) {
    mkdirSync(pendingDir, { recursive: true });
  }

  const files = readdirSync(PLAUD_DIR).filter(
    (f) => f.endsWith(".txt") || f.endsWith(".md") || f.endsWith(".json"),
  );

  let processed = 0;
  for (const file of files) {
    const hash = hashItem("plaud", file);
    if (isSeen(hash)) {
      continue;
    }

    const filePath = join(PLAUD_DIR, file);
    const content = readFileSync(filePath, "utf-8");
    if (content.length < 100) {
      continue;
    } // skip empty/tiny files

    console.log(`[plaud-process] Processing: ${file}`);

    try {
      const prompt = EXTRACTION_PROMPT.replace("{transcript}", content.slice(0, 4000));
      const result = execFileSync(
        OPENCLAW,
        ["agent", "--agent", "main", "--json", "--message", prompt],
        {
          timeout: 60_000,
          encoding: "utf-8",
          env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
        },
      );

      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        continue;
      }

      const agentData = JSON.parse(jsonMatch[0]);
      const text = agentData?.payloads?.[0]?.text || agentData?.result?.payloads?.[0]?.text || "";

      const dataMatch = text.match(/\{[\s\S]*\}/);
      if (!dataMatch) {
        continue;
      }

      const data = JSON.parse(dataMatch[0]);

      // Route action items to pending inbox
      if (data.actionItems && Array.isArray(data.actionItems)) {
        for (const item of data.actionItems) {
          appendFileSync(
            PENDING_PATH,
            JSON.stringify({
              hash: hashItem("plaud-action", `${file}:${item.task}`),
              source: "plaud",
              category: "action-required",
              subject: `Call: ${item.task}`,
              from: item.owner || "call participant",
              snippet: data.summary?.slice(0, 200) || "",
              commitment: item.task,
              deadline: item.deadline || "unspecified",
              addedAt: new Date().toISOString(),
              status: "pending",
            }) + "\n",
          );
        }
      }

      markSeen(hash, "plaud", `${file}: ${data.summary?.slice(0, 50) || "processed"}`);
      processed++;

      logEvent({
        source: "plaud-process",
        action: "process-transcript",
        target: file,
        result: "ok",
        detail: `actions=${data.actionItems?.length || 0} client=${data.isClientCall ? data.client : "no"}`,
      });
    } catch (err: any) {
      console.error(`[plaud-process] Failed to process ${file}:`, err.message);
      logEvent({
        source: "plaud-process",
        action: "process-transcript",
        target: file,
        result: "error",
        detail: err.message,
      });
    }
  }

  console.log(
    `[plaud-process] Done. Processed ${processed} new transcripts from ${files.length} total files`,
  );
}

main().catch((err) => {
  console.error("[plaud-process] Fatal:", err);
  process.exit(1);
});
