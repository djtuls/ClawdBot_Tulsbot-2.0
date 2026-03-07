#!/usr/bin/env bun
/**
 * Model Switch Watchdog
 *
 * Tails gateway.log in real-time, detects model switches, rate limits (429),
 * provider errors, and tier drops. Sends Telegram alerts for significant events.
 *
 * Usage: bun scripts/model-switch-watchdog.ts
 * Runs as persistent background daemon via LaunchAgent.
 */

import fs from "fs";
import path from "path";

const HOME = process.env.HOME ?? "/Users/tulioferro";
const GATEWAY_LOG = path.join(HOME, ".openclaw/logs/gateway.log");
const EVENTS_LOG = path.join(HOME, ".openclaw/workspace/memory/model-switch-events.jsonl");
const ENV_FILE = path.join(HOME, ".openclaw/.env");

// ─── Quality Tiers ──────────────────────────────────────────────────────────

type Tier = "A" | "B" | "C" | "D" | "E" | "F";

const MODEL_TIERS: Record<string, Tier> = {
  "openai-codex/gpt-5.3-codex": "A",
  "anthropic/claude-sonnet-4-6": "B",
  "anthropic/claude-sonnet-4-5": "B",
  "google/gemini-3.1-pro-preview": "C",
  "google/gemini-2.5-pro": "C",
  "anthropic/claude-haiku-4-5": "D",
  "anthropic/claude-3-5-haiku-latest": "D",
  "openai/gpt-4o-mini": "D",
  "openrouter/anthropic/claude-sonnet-4.6": "E",
  "openrouter/openai/gpt-4.1": "E",
  "openrouter/openai/gpt-4.1-mini": "E",
  "ollama/tulsbot:latest": "F",
  "ollama/qwen3:8b": "F",
};

const TIER_RANK: Record<Tier, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
const TIER_LABEL: Record<Tier, string> = {
  A: "Frontier",
  B: "Premium",
  C: "Pro",
  D: "Buffer",
  E: "Emergency (OpenRouter)",
  F: "Offline (Local)",
};

function getTier(model: string): Tier {
  if (MODEL_TIERS[model]) {
    return MODEL_TIERS[model];
  }
  if (model.startsWith("openrouter/")) {
    return "E";
  }
  if (model.startsWith("ollama/")) {
    return "F";
  }
  if (model.startsWith("anthropic/")) {
    return "B";
  }
  if (model.startsWith("google/")) {
    return "C";
  }
  if (model.startsWith("openai-codex/")) {
    return "A";
  }
  if (model.startsWith("openai/")) {
    return "D";
  }
  return "E";
}

function isTierDrop(from: Tier, to: Tier): boolean {
  return TIER_RANK[to] > TIER_RANK[from];
}

// ─── Telegram Alerts ────────────────────────────────────────────────────────

let telegramToken: string | undefined;
let telegramChatId: string | undefined;

function loadEnv(): void {
  try {
    const raw = fs.readFileSync(ENV_FILE, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq < 0) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key === "TELEGRAM_BOT_TOKEN") {
        telegramToken = val;
      }
      if (key === "TELEGRAM_CHAT_ID") {
        telegramChatId = val;
      }
    }
  } catch {
    /* env file not found */
  }
  telegramToken ??= process.env.TELEGRAM_BOT_TOKEN;
  telegramChatId ??= process.env.TELEGRAM_CHAT_ID;
}

async function sendAlert(message: string): Promise<void> {
  if (!telegramToken || !telegramChatId) {
    console.warn("[watchdog] Telegram not configured:", message.slice(0, 120));
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramChatId, text: message, parse_mode: "Markdown" }),
    });
    if (!res.ok) {
      console.error(`[watchdog] Telegram ${res.status}`);
    }
  } catch (e) {
    console.error("[watchdog] Telegram send failed:", e);
  }
}

// ─── Event Logging ──────────────────────────────────────────────────────────

interface SwitchEvent {
  ts: string;
  from_model: string;
  to_model: string;
  from_tier: Tier;
  to_tier: Tier;
  reason: string;
  session?: string;
  alerted: boolean;
}

function logEvent(event: SwitchEvent): void {
  const dir = path.dirname(EVENTS_LOG);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(EVENTS_LOG, JSON.stringify(event) + "\n");
}

// ─── Flap Detection ─────────────────────────────────────────────────────────

const recentSwitches: number[] = [];
const FLAP_WINDOW_MS = 15 * 60 * 1000; // 15 min
const FLAP_THRESHOLD = 3;
let lastFlapAlert = 0;

function checkFlap(): boolean {
  const now = Date.now();
  while (recentSwitches.length > 0 && now - recentSwitches[0] > FLAP_WINDOW_MS) {
    recentSwitches.shift();
  }
  return recentSwitches.length >= FLAP_THRESHOLD;
}

// ─── Rate Limit Tracking ────────────────────────────────────────────────────

const recentRateLimits: Array<{ ts: number; provider: string }> = [];
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
let lastRateLimitAlert = 0;

function trackRateLimit(provider: string): void {
  const now = Date.now();
  recentRateLimits.push({ ts: now, provider });
  while (recentRateLimits.length > 0 && now - recentRateLimits[0].ts > RATE_LIMIT_WINDOW_MS) {
    recentRateLimits.shift();
  }
}

// ─── Log Line Parsing ───────────────────────────────────────────────────────

const FALLBACK_RE = /fallback.*?from\s+["']?([^\s"']+)["']?\s+to\s+["']?([^\s"']+)["']?/i;
const MODEL_SWITCH_RE =
  /model[_\s-]?switch.*?["']?([^\s"']+)["']?\s*(?:->|=>|to)\s*["']?([^\s"']+)["']?/i;
const RATE_LIMIT_RE = /(?:429|rate[_\s-]?limit|too many requests)/i;
const PROVIDER_ERROR_RE = /(?:5\d{2}|timeout|ECONNREFUSED|provider[_\s-]?error)/i;
const SESSION_RE = /session[=:]?\s*["']?([a-f0-9-]+)["']?/i;

let lastModel: string | undefined;

function processLine(line: string): void {
  const now = new Date().toISOString();

  // Rate limit detection
  if (RATE_LIMIT_RE.test(line)) {
    const providerMatch = line.match(/(?:provider|model)[=:]?\s*["']?([^\s"',]+)/i);
    const provider = providerMatch?.[1] ?? "unknown";
    trackRateLimit(provider);

    const timeSinceAlert = Date.now() - lastRateLimitAlert;
    if (timeSinceAlert > 60_000) {
      lastRateLimitAlert = Date.now();
      const count = recentRateLimits.filter((r) => r.provider === provider).length;
      sendAlert(
        `⚠️ *Rate Limit Hit*\nProvider: \`${provider}\`\nCount in 10min: ${count}\nTime: ${now}`,
      );
    }
  }

  // Model switch / fallback detection
  let fromModel: string | undefined;
  let toModel: string | undefined;

  const fallbackMatch = line.match(FALLBACK_RE);
  if (fallbackMatch) {
    fromModel = fallbackMatch[1];
    toModel = fallbackMatch[2];
  }

  if (!fromModel) {
    const switchMatch = line.match(MODEL_SWITCH_RE);
    if (switchMatch) {
      fromModel = switchMatch[1];
      toModel = switchMatch[2];
    }
  }

  if (fromModel && toModel) {
    const fromTier = getTier(fromModel);
    const toTier = getTier(toModel);
    const sessionMatch = line.match(SESSION_RE);
    const session = sessionMatch?.[1];
    const dropped = isTierDrop(fromTier, toTier);

    recentSwitches.push(Date.now());

    const event: SwitchEvent = {
      ts: now,
      from_model: fromModel,
      to_model: toModel,
      from_tier: fromTier,
      to_tier: toTier,
      reason: RATE_LIMIT_RE.test(line)
        ? "rate_limit"
        : PROVIDER_ERROR_RE.test(line)
          ? "provider_error"
          : "fallback",
      session,
      alerted: false,
    };

    if (dropped) {
      const dropSize = TIER_RANK[toTier] - TIER_RANK[fromTier];
      const severity = dropSize >= 3 ? "🚨" : dropSize >= 2 ? "⚠️" : "ℹ️";
      event.alerted = true;
      sendAlert(
        `${severity} *Model Tier Drop*\n` +
          `From: \`${fromModel}\` (Tier ${fromTier} — ${TIER_LABEL[fromTier]})\n` +
          `To: \`${toModel}\` (Tier ${toTier} — ${TIER_LABEL[toTier]})\n` +
          `Reason: ${event.reason}\n` +
          (session ? `Session: \`${session.slice(0, 8)}…\`\n` : "") +
          `Time: ${now}`,
      );
    }

    logEvent(event);
    lastModel = toModel;

    // Flap check
    if (checkFlap() && Date.now() - lastFlapAlert > 5 * 60_000) {
      lastFlapAlert = Date.now();
      sendAlert(
        `🔄 *Model Instability*\n${recentSwitches.length} switches in 15 min.\nCheck provider health.`,
      );
    }
  }

  // Provider errors (non-429)
  if (PROVIDER_ERROR_RE.test(line) && !RATE_LIMIT_RE.test(line)) {
    const providerMatch = line.match(/(?:provider|model)[=:]?\s*["']?([^\s"',]+)/i);
    if (providerMatch) {
      console.log(`[watchdog] Provider error: ${providerMatch[1]} — ${line.slice(0, 100)}`);
    }
  }
}

// ─── Log Tailing ────────────────────────────────────────────────────────────

function tailLog(): void {
  if (!fs.existsSync(GATEWAY_LOG)) {
    console.warn(`[watchdog] ${GATEWAY_LOG} not found, waiting...`);
    setTimeout(tailLog, 5000);
    return;
  }

  const stat = fs.statSync(GATEWAY_LOG);
  let position = stat.size; // start from end

  console.log(`[watchdog] Tailing ${GATEWAY_LOG} from byte ${position}`);

  const poll = (): void => {
    try {
      const currentStat = fs.statSync(GATEWAY_LOG);

      // Log rotation detection
      if (currentStat.size < position) {
        console.log("[watchdog] Log rotated, resetting position");
        position = 0;
      }

      if (currentStat.size > position) {
        const stream = fs.createReadStream(GATEWAY_LOG, {
          start: position,
          end: currentStat.size - 1,
          encoding: "utf-8",
        });

        let buffer = "";
        stream.on("data", (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              processLine(line);
            }
          }
        });

        stream.on("end", () => {
          if (buffer.trim()) {
            processLine(buffer);
          }
          position = currentStat.size;
        });
      }
    } catch (e) {
      console.error("[watchdog] Read error:", e);
    }

    setTimeout(poll, 2000);
  };

  poll();
}

// ─── Main ───────────────────────────────────────────────────────────────────

loadEnv();
console.log(`[watchdog] Model Switch Watchdog started at ${new Date().toISOString()}`);
console.log(`[watchdog] Telegram configured: ${!!telegramToken && !!telegramChatId}`);
tailLog();
