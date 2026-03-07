import "dotenv/config";
/**
 * WhatsApp Scan — intent-driven commitments + pending replies
 *
 * Bootstrap: last 7 days (first successful run)
 * Steady state: last 48 hours with dedup
 */
import { execFileSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { hashItem, isSeen, markSeen } from "../lib/inbox-dedup.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const OPENCLAW = process.env.OPENCLAW_BIN || "/opt/homebrew/bin/openclaw";
const WACLI = process.env.WACLI_BIN || "/opt/homebrew/bin/wacli";
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");
const STATE_PATH = join(WORKSPACE, "data/whatsapp-monitor-state.json");
const SLA_PATH = join(WORKSPACE, "data/whatsapp-sla.json");

const FORCE_DAYS_ARG = process.argv.find((a) => a.startsWith("--days="));
const FORCE_DAYS = FORCE_DAYS_ARG ? Number(FORCE_DAYS_ARG.split("=")[1]) : undefined;

interface MonitorState {
  bootstrapDone: boolean;
  lastRunAt?: string;
}

interface ExtractedItem {
  type: "commitment" | "pending-reply";
  title: string;
  from?: string;
  to?: string;
  deadline?: string;
  context?: string;
  chat?: string;
  timestamp?: string;
  confidence?: "high" | "medium" | "low";
}

interface SlaConfig {
  defaultReplySlaHours: number;
  vipReplySlaHours: number;
  vipMatchers: string[];
  urgentMatchers: string[];
}

function loadState(): MonitorState {
  if (!existsSync(STATE_PATH)) {
    return { bootstrapDone: false };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8")) as MonitorState;
  } catch {
    return { bootstrapDone: false };
  }
}

function saveState(state: MonitorState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function loadSla(): SlaConfig {
  const fallback: SlaConfig = {
    defaultReplySlaHours: 24,
    vipReplySlaHours: 2,
    vipMatchers: [],
    urgentMatchers: ["urgent", "asap", "today", "now"],
  };
  if (!existsSync(SLA_PATH)) {
    return fallback;
  }
  try {
    const cfg = JSON.parse(readFileSync(SLA_PATH, "utf-8")) as SlaConfig;
    return { ...fallback, ...cfg };
  } catch {
    return fallback;
  }
}

function includesAny(text: string, patterns: string[]): boolean {
  const low = (text || "").toLowerCase();
  return patterns.some((p) => low.includes((p || "").toLowerCase()));
}

function computeReplySlaHours(item: ExtractedItem, sla: SlaConfig): number {
  const hay =
    `${item.from || ""} ${item.chat || ""} ${item.context || ""} ${item.title || ""}`.toLowerCase();
  if (includesAny(hay, sla.urgentMatchers || [])) {
    return Math.min(2, sla.vipReplySlaHours);
  }
  if (includesAny(hay, sla.vipMatchers || [])) {
    return sla.vipReplySlaHours;
  }
  return sla.defaultReplySlaHours;
}

function extractJsonArray(text: string): ExtractedItem[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) {
    return [];
  }
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? (arr as ExtractedItem[]) : [];
  } catch {
    return [];
  }
}

function syncWhatsAppOnce(): void {
  try {
    execFileSync(WACLI, ["sync", "--once", "--refresh-contacts", "--refresh-groups", "--json"], {
      timeout: 180_000,
      encoding: "utf-8",
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
    });
    logEvent({
      source: "whatsapp-scan",
      action: "wacli-sync",
      result: "ok",
      detail: "sync --once before extraction",
    });
  } catch (err: any) {
    logEvent({
      source: "whatsapp-scan",
      action: "wacli-sync",
      result: "error",
      detail: err?.message || String(err),
    });
  }
}

async function main() {
  const pendingDir = join(WORKSPACE, "memory/inbox");
  if (!existsSync(pendingDir)) {
    mkdirSync(pendingDir, { recursive: true });
  }

  const state = loadState();
  const sla = loadSla();
  const lookbackDays =
    Number.isFinite(FORCE_DAYS) && FORCE_DAYS ? FORCE_DAYS : state.bootstrapDone ? 2 : 7;

  // Ensure local WA store is fresh before extracting commitments/replies
  syncWhatsAppOnce();

  const historyPrompt = [
    `Use the wacli skill to gather WhatsApp message history from the last ${lookbackDays} days.`,
    "Focus on business-relevant chats and include both sides of the conversation.",
    "Return plain text transcript chunks with: chat name, sender, timestamp, message.",
    "If little data is available, return what is available.",
  ].join(" ");

  let transcript = "";
  try {
    const result = execFileSync(
      OPENCLAW,
      ["agent", "--agent", "main", "--json", "--message", historyPrompt],
      {
        timeout: 240_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON from OpenClaw agent");
    }
    const data = JSON.parse(jsonMatch[0]);
    transcript = data?.payloads?.[0]?.text || data?.result?.payloads?.[0]?.text || "";
  } catch (err: any) {
    logEvent({
      source: "whatsapp-scan",
      action: "history-fetch",
      result: "error",
      detail: err?.message || String(err),
    });
    throw err;
  }

  if (!transcript || transcript.length < 40) {
    logEvent({
      source: "whatsapp-scan",
      action: "scan-complete",
      result: "ok",
      detail: `lookback=${lookbackDays}d no_transcript=true`,
    });
    return;
  }

  const extractionPrompt = `You are extracting operational follow-ups from WhatsApp transcripts.
Return ONLY a JSON array. No prose.

Extract two kinds of items:
1) commitment = promises made by Tulio (or likely Tulio) to do something.
2) pending-reply = explicit requests/questions sent to Tulio where there is no clear reply yet.

Rules:
- Be conservative. If uncertain, set confidence to "low".
- Keep title concise and actionable.
- Include chat, from, to, timestamp when present.
- For pending-reply, title should start with "Reply:".

Schema:
[
  {
    "type": "commitment" | "pending-reply",
    "title": "string",
    "from": "string",
    "to": "string",
    "deadline": "string",
    "context": "string",
    "chat": "string",
    "timestamp": "ISO-like or empty",
    "confidence": "high" | "medium" | "low"
  }
]

Transcript:
${transcript.slice(0, 120000)}
`;

  let extracted: ExtractedItem[] = [];
  try {
    const res = execFileSync(
      OPENCLAW,
      ["agent", "--agent", "main", "--json", "--message", extractionPrompt],
      {
        timeout: 180_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );
    const jm = res.match(/\{[\s\S]*\}/);
    if (jm) {
      const data = JSON.parse(jm[0]);
      const text = data?.payloads?.[0]?.text || data?.result?.payloads?.[0]?.text || "[]";
      extracted = extractJsonArray(text);
    }
  } catch (err: any) {
    logEvent({
      source: "whatsapp-scan",
      action: "extract",
      result: "error",
      detail: err?.message || String(err),
    });
  }

  let added = 0;
  for (const item of extracted) {
    const title = (item.title || "").trim();
    if (!title) {
      continue;
    }
    const key = `${item.type}|${item.chat || ""}|${item.from || ""}|${title}`.slice(0, 280);
    const hash = hashItem("whatsapp", key);
    if (isSeen(hash)) {
      continue;
    }

    const category = item.type === "commitment" ? "action-required" : "to-be-sorted";
    const replySlaHours =
      item.type === "pending-reply" ? computeReplySlaHours(item, sla) : undefined;
    const priority =
      item.type === "pending-reply" && replySlaHours && replySlaHours <= 2 ? "high" : "normal";
    const snippet = [
      item.chat ? `Chat: ${item.chat}` : "",
      item.from ? `From: ${item.from}` : "",
      item.to ? `To: ${item.to}` : "",
      item.deadline ? `Deadline: ${item.deadline}` : "",
      item.context || "",
      item.confidence ? `Confidence: ${item.confidence}` : "",
      replySlaHours ? `Reply-SLA: ${replySlaHours}h` : "",
      priority ? `Priority: ${priority}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 400);

    appendFileSync(
      PENDING_PATH,
      JSON.stringify({
        hash,
        source: "whatsapp",
        category,
        commitment: item.type === "commitment" ? title : undefined,
        subject: title,
        from: item.from || "unknown",
        snippet,
        addedAt: new Date().toISOString(),
        status: "pending",
        deadline: item.deadline || "",
        chat: item.chat || "",
        itemType: item.type,
        confidence: item.confidence || "medium",
        replySlaHours: replySlaHours || null,
        priority,
        lookbackDays,
      }) + "\n",
    );

    markSeen(hash, "whatsapp", `${item.type}:${title.slice(0, 80)}`);
    added++;
  }

  state.bootstrapDone = true;
  state.lastRunAt = new Date().toISOString();
  saveState(state);

  logEvent({
    source: "whatsapp-scan",
    action: "scan-complete",
    result: "ok",
    detail: `lookback=${lookbackDays}d extracted=${extracted.length} new=${added}`,
    rationale: "Bootstrap 7d once, then 48h steady-state with dedup",
  });

  console.log(
    `[whatsapp-scan] lookback=${lookbackDays}d extracted=${extracted.length} new=${added}`,
  );
}

main().catch((err) => {
  console.error("[whatsapp-scan] Fatal:", err);
  process.exit(1);
});
