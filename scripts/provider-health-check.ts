#!/usr/bin/env bun
/**
 * Provider Health Check
 *
 * Probes each configured LLM provider with minimal requests to detect
 * degradation before it impacts live sessions. Writes health data to JSON
 * and sends hourly Telegram digests.
 *
 * Usage: bun scripts/provider-health-check.ts [--digest]
 *        --digest: only send the hourly Telegram digest without probing
 *
 * Runs every 5 minutes via LaunchAgent, digest hourly.
 */

import fs from "fs";
import path from "path";
import { getSecret } from "./lib/secrets";

const HOME = process.env.HOME ?? "/Users/tulioferro";
const HEALTH_FILE = path.join(HOME, ".openclaw/workspace/memory/provider-health.json");
const ENV_FILE = path.join(HOME, ".openclaw/.env");
const CONFIG_FILE = path.join(HOME, ".openclaw/openclaw.json");
const PROBE_TIMEOUT_MS = 15_000;

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProbeResult {
  provider: string;
  model: string;
  status: "ok" | "error" | "timeout" | "rate_limited";
  latency_ms: number;
  error?: string;
  ts: string;
}

interface HealthState {
  last_updated: string;
  probes: ProbeResult[];
  hourly_stats: Array<{
    hour: string;
    providers: Record<
      string,
      { checks: number; ok: number; errors: number; rate_limits: number; p95_ms: number }
    >;
  }>;
}

// ─── Env Loading ────────────────────────────────────────────────────────────

const env: Record<string, string> = {};

function loadEnv(): void {
  try {
    for (const line of fs.readFileSync(ENV_FILE, "utf-8").split("\n")) {
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

// ─── Provider Probes ────────────────────────────────────────────────────────

async function probeOpenAICodex(): Promise<ProbeResult> {
  return probeOpenAICompat(
    "openai-codex",
    "gpt-5.3-codex",
    "https://api.openai.com/v1/chat/completions",
    env.OPENAI_CODEX_TOKEN ?? env.OPENAI_API_KEY ?? "",
  );
}

async function probeAnthropic(): Promise<ProbeResult> {
  const start = Date.now();
  const apiKey = getSecret("ANTHROPIC_API_KEY") ?? env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) {
    return result("anthropic", "claude-3-5-haiku-latest", "error", 0, "missing_api_key");
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latency = Date.now() - start;
    if (res.status === 429) {
      return result("anthropic", "claude-3-5-haiku-latest", "rate_limited", latency);
    }
    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const body = await res.text();
        if (body) {
          detail = `${res.status}:${body.slice(0, 180)}`;
        }
      } catch {}
      return result("anthropic", "claude-3-5-haiku-latest", "error", latency, detail);
    }
    return result("anthropic", "claude-3-5-haiku-latest", "ok", latency);
  } catch (e) {
    return result(
      "anthropic",
      "claude-3-5-haiku-latest",
      isTimeout(e) ? "timeout" : "error",
      Date.now() - start,
      String(e),
    );
  }
}

async function probeGoogle(): Promise<ProbeResult> {
  const start = Date.now();
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    const latency = Date.now() - start;
    if (res.status === 429) {
      return result("google", "gemini-2.0-flash", "rate_limited", latency);
    }
    if (!res.ok) {
      return result("google", "gemini-2.0-flash", "error", latency, `${res.status}`);
    }
    return result("google", "gemini-2.0-flash", "ok", latency);
  } catch (e) {
    return result(
      "google",
      "gemini-2.0-flash",
      isTimeout(e) ? "timeout" : "error",
      Date.now() - start,
      String(e),
    );
  }
}

async function probeOpenAIDirect(): Promise<ProbeResult> {
  return probeOpenAICompat(
    "openai",
    "gpt-4o-mini",
    "https://api.openai.com/v1/chat/completions",
    env.OPENAI_API_KEY ?? "",
  );
}

async function probeOpenAICompat(
  provider: string,
  model: string,
  url: string,
  apiKey: string,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latency = Date.now() - start;
    if (res.status === 429) {
      return result(provider, model, "rate_limited", latency);
    }
    if (!res.ok) {
      return result(provider, model, "error", latency, `${res.status}`);
    }
    return result(provider, model, "ok", latency);
  } catch (e) {
    return result(
      provider,
      model,
      isTimeout(e) ? "timeout" : "error",
      Date.now() - start,
      String(e),
    );
  }
}

function result(
  provider: string,
  model: string,
  status: ProbeResult["status"],
  latency_ms: number,
  error?: string,
): ProbeResult {
  return {
    provider,
    model,
    status,
    latency_ms,
    ts: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

function isTimeout(e: unknown): boolean {
  return String(e).includes("TimeoutError") || String(e).includes("AbortError");
}

// ─── Health State ───────────────────────────────────────────────────────────

function loadHealth(): HealthState {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_FILE, "utf-8"));
  } catch {
    return { last_updated: "", probes: [], hourly_stats: [] };
  }
}

function saveHealth(state: HealthState): void {
  const dir = path.dirname(HEALTH_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(HEALTH_FILE, JSON.stringify(state, null, 2));
}

function updateHourlyStats(state: HealthState, probes: ProbeResult[]): void {
  const hour = new Date().toISOString().slice(0, 13);
  let hourEntry = state.hourly_stats.find((s) => s.hour === hour);
  if (!hourEntry) {
    hourEntry = { hour, providers: {} };
    state.hourly_stats.push(hourEntry);
  }
  // Keep 48 hours of history
  while (state.hourly_stats.length > 48) {
    state.hourly_stats.shift();
  }

  for (const p of probes) {
    if (!hourEntry.providers[p.provider]) {
      hourEntry.providers[p.provider] = { checks: 0, ok: 0, errors: 0, rate_limits: 0, p95_ms: 0 };
    }
    const s = hourEntry.providers[p.provider];
    s.checks++;
    if (p.status === "ok") {
      s.ok++;
    } else if (p.status === "rate_limited") {
      s.rate_limits++;
    } else {
      s.errors++;
    }
    s.p95_ms = Math.max(s.p95_ms, p.latency_ms);
  }
}

// ─── Telegram ───────────────────────────────────────────────────────────────

async function sendAlert(message: string): Promise<void> {
  const token = getSecret("DJTULSBOT_TELEGRAM_TOKEN") ?? env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[health] Telegram not configured:", message.slice(0, 80));
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
  } catch (e) {
    console.error("[health] Telegram error:", e);
  }
}

// ─── Digest ─────────────────────────────────────────────────────────────────

async function sendDigest(state: HealthState): Promise<void> {
  const now = new Date();
  const thisHour = now.toISOString().slice(0, 13);
  const lastHour = new Date(now.getTime() - 3600_000).toISOString().slice(0, 13);

  const stats = state.hourly_stats.find((s) => s.hour === lastHour || s.hour === thisHour);
  if (!stats) {
    console.log("[health] No stats for digest");
    return;
  }

  const lines = ["📊 *Hourly Provider Health*"];
  for (const [name, s] of Object.entries(stats.providers)) {
    const successRate = s.checks > 0 ? Math.round((s.ok / s.checks) * 100) : 0;
    const emoji = s.rate_limits > 0 ? "⚠️" : successRate === 100 ? "✅" : "❌";
    lines.push(
      `${emoji} *${name}*: ${successRate}% ok, p95=${s.p95_ms}ms` +
        (s.rate_limits > 0 ? `, ${s.rate_limits} rate limits` : "") +
        (s.errors > 0 ? `, ${s.errors} errors` : ""),
    );
  }
  lines.push(`_${stats.hour}_`);
  await sendAlert(lines.join("\n"));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();
  const digestOnly = process.argv.includes("--digest");
  const state = loadHealth();

  if (digestOnly) {
    await sendDigest(state);
    return;
  }

  console.log("[health] Probing providers...");
  const probes = await Promise.all([probeAnthropic(), probeGoogle(), probeOpenAIDirect()]);

  for (const p of probes) {
    const icon = p.status === "ok" ? "✓" : p.status === "rate_limited" ? "⚠" : "✗";
    console.log(`  ${icon} ${p.provider}/${p.model}: ${p.status} (${p.latency_ms}ms)`);
  }

  // Immediate alert for rate limits or down providers
  // Temporary noise suppression: skip Anthropic-only degradation alerts unless explicitly enabled.
  const anthropicAlertsEnabled = process.env.ENABLE_ANTHROPIC_ALERTS === "1";
  const degraded = probes.filter((p) => p.status !== "ok");
  const degradedForAlert = degraded.filter(
    (p) => p.provider !== "anthropic" || anthropicAlertsEnabled,
  );

  if (degradedForAlert.length > 0) {
    const msg = degradedForAlert
      .map(
        (p) => `• ${p.provider}: ${p.status}${p.error ? ` (${p.error})` : ""} — ${p.latency_ms}ms`,
      )
      .join("\n");
    await sendAlert(`🏥 *Provider Health Alert*\n${msg}`);
  }

  state.probes = probes;
  updateHourlyStats(state, probes);
  saveHealth(state);

  // Send hourly digest at minute :00 (± 5 min tolerance)
  const minute = new Date().getMinutes();
  if (minute <= 5) {
    await sendDigest(state);
  }

  console.log("[health] Done");
}

main().catch(console.error);
