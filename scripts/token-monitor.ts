#!/usr/bin/env bun
/**
 * Context Token Monitor
 *
 * Tracks context usage and alerts at thresholds via Telegram.
 * Can run as one-shot CLI or as persistent watcher (--watch).
 *
 * Usage:
 *   bun scripts/token-monitor.ts           # one-shot check
 *   bun scripts/token-monitor.ts --watch   # persistent file watcher
 */

import { execFileSync } from "child_process";
import { readFileSync, existsSync, watchFile, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { getSecret } from "./lib/secrets";

const HOME = process.env.HOME || "/Users/tulioferro";
const CONTEXT_PATH = join(HOME, ".openclaw/workspace/reports/context-window.json");
const ENV_FILE = join(HOME, ".openclaw/.env");
const EVENTS_LOG = join(HOME, ".openclaw/workspace/memory/context-events.jsonl");

const WARNING_THRESHOLD = 0.7;
const COMPACT_THRESHOLD = 0.85;

// ─── Env & Telegram ─────────────────────────────────────────────────────────

const env: Record<string, string> = {};

function loadEnv(): void {
  try {
    for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) {
        continue;
      }
      const eq = t.indexOf("=");
      if (eq < 0) {
        continue;
      }
      env[t.slice(0, eq).trim()] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no env */
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (v && !env[k]) {
      env[k] = v;
    }
  }
}

async function sendAlert(message: string): Promise<void> {
  const token = getSecret("DJTULSBOT_TELEGRAM_TOKEN") ?? env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[token-monitor] Telegram not configured:", message.slice(0, 80));
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
    if (!res.ok) {
      console.error(`[token-monitor] Telegram ${res.status}`);
    }
  } catch (e) {
    console.error("[token-monitor] Telegram error:", e);
  }
}

// ─── Token Estimation ───────────────────────────────────────────────────────

function estimateTokens(): number {
  try {
    const data = JSON.parse(readFileSync(CONTEXT_PATH, "utf-8"));
    const messages = data.messages || [];
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += (msg.content || "").length + (msg.role || "").length;
    }
    totalChars += 2000; // system prompt estimate
    return Math.floor(totalChars / 4);
  } catch {
    return 0;
  }
}

function getContextLimit(): number {
  return 200000; // GPT-5.3 Codex default
}

function getStatus(): { tokens: number; percent: number; status: string; action: string } {
  const tokens = estimateTokens();
  const limit = getContextLimit();
  const percent = tokens / limit;

  let status: string;
  let action: string;

  if (percent >= COMPACT_THRESHOLD) {
    status = "CRITICAL";
    action = "FORCE COMPACT before continuing";
  } else if (percent >= WARNING_THRESHOLD) {
    status = "WARNING";
    action = "Approaching limit — consider compaction";
  } else {
    status = "OK";
    action = "Normal operation";
  }

  return { tokens, percent: Math.round(percent * 100), status, action };
}

// ─── Event Logging ──────────────────────────────────────────────────────────

function logEvent(event: Record<string, unknown>): void {
  const dir = dirname(EVENTS_LOG);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(EVENTS_LOG, JSON.stringify({ ...event, ts: new Date().toISOString() }) + "\n");
}

// ─── Alert Throttle ─────────────────────────────────────────────────────────

let lastWarningAlert = 0;
let lastCriticalAlert = 0;
const WARNING_COOLDOWN_MS = 30 * 60 * 1000;
const CRITICAL_COOLDOWN_MS = 10 * 60 * 1000;

async function checkAndAlert(): Promise<void> {
  const { tokens, percent, status } = getStatus();
  const now = Date.now();

  if (status === "CRITICAL" && now - lastCriticalAlert > CRITICAL_COOLDOWN_MS) {
    lastCriticalAlert = now;
    logEvent({ type: "context_critical", percent, tokens });
    await sendAlert(
      `🔴 *Context at ${percent}%* (${tokens.toLocaleString()} tokens)\n` +
        `Limit: ${getContextLimit().toLocaleString()}\n` +
        `Action: Auto-compaction triggered`,
    );
    try {
      const openclawBin = join(HOME, ".openclaw/bin/openclaw");
      const fallbackBin = "/opt/homebrew/bin/openclaw";
      const bin = existsSync(openclawBin) ? openclawBin : fallbackBin;
      execFileSync(
        bin,
        [
          "agent",
          "--agent",
          "main",
          "--message",
          `COMPACT: context at ${percent}% — auto-triggered by token monitor`,
        ],
        { timeout: 15_000, cwd: join(HOME, ".openclaw") },
      );
    } catch {
      console.warn("[token-monitor] Compaction trigger failed");
    }
  } else if (status === "WARNING" && now - lastWarningAlert > WARNING_COOLDOWN_MS) {
    lastWarningAlert = now;
    logEvent({ type: "context_warning", percent, tokens });
    await sendAlert(
      `🟡 *Context at ${percent}%* (${tokens.toLocaleString()} tokens)\n` +
        `Limit: ${getContextLimit().toLocaleString()}\n` +
        `Consider running /compact`,
    );
  }
}

// ─── Watch Mode ─────────────────────────────────────────────────────────────

function startWatch(): void {
  console.log(`[token-monitor] Watching ${CONTEXT_PATH}`);
  console.log(
    `[token-monitor] Thresholds: warning=${WARNING_THRESHOLD * 100}%, critical=${COMPACT_THRESHOLD * 100}%`,
  );

  if (!existsSync(CONTEXT_PATH)) {
    console.warn("[token-monitor] Context file not found, will check when created");
  }

  watchFile(CONTEXT_PATH, { interval: 5000 }, () => {
    checkAndAlert().catch(console.error);
  });

  checkAndAlert().catch(console.error);

  setInterval(() => {
    checkAndAlert().catch(console.error);
  }, 120_000);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

loadEnv();

const isWatch = process.argv.includes("--watch");

if (isWatch) {
  startWatch();
} else {
  const { tokens, percent, status, action } = getStatus();
  console.log(`
📊 Context Token Monitor
─────────────────────────
Estimated tokens: ${tokens.toLocaleString()}
Context limit:    ${getContextLimit().toLocaleString()}
Usage:            ${percent}%
Status:           ${status === "CRITICAL" ? "🔴 CRITICAL" : status === "WARNING" ? "🟡 WARNING" : "🟢 OK"}
Action:           ${action}
`);
}

export { getStatus, estimateTokens, getContextLimit };
