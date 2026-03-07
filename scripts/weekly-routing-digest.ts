#!/usr/bin/env bun
/**
 * Weekly Routing Digest
 *
 * Parses model-switch-events.jsonl and provider-health.json to produce
 * a weekly Telegram summary of routing stability and provider reliability.
 *
 * Runs every Monday 9am AEST via cron or manually.
 *
 * Usage: bun scripts/weekly-routing-digest.ts
 */

import fs from "fs";
import path from "path";

const HOME = process.env.HOME ?? "/Users/tulioferro";
const EVENTS_FILE = path.join(HOME, ".openclaw/workspace/memory/model-switch-events.jsonl");
const HEALTH_FILE = path.join(HOME, ".openclaw/workspace/memory/provider-health.json");
const CONTEXT_EVENTS_FILE = path.join(HOME, ".openclaw/workspace/memory/context-events.jsonl");
const ENV_FILE = path.join(HOME, ".openclaw/.env");

// ─── Env & Telegram ─────────────────────────────────────────────────────────

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

async function sendAlert(message: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log(message);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
  } catch (e) {
    console.error("[digest] Telegram error:", e);
  }
}

// ─── Data Loading ───────────────────────────────────────────────────────────

interface SwitchEvent {
  ts: string;
  from_model: string;
  to_model: string;
  from_tier: string;
  to_tier: string;
  reason: string;
}

function loadWeekEvents(): SwitchEvent[] {
  if (!fs.existsSync(EVENTS_FILE)) {
    return [];
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return fs
    .readFileSync(EVENTS_FILE, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SwitchEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is SwitchEvent => e !== null && e.ts >= cutoff);
}

function loadContextEvents(): Array<{ ts: string; type: string; percent: number }> {
  if (!fs.existsSync(CONTEXT_EVENTS_FILE)) {
    return [];
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return fs
    .readFileSync(CONTEXT_EVENTS_FILE, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e !== null && e.ts >= cutoff);
}

interface HealthState {
  hourly_stats: Array<{
    hour: string;
    providers: Record<
      string,
      { checks: number; ok: number; errors: number; rate_limits: number; p95_ms: number }
    >;
  }>;
}

function loadHealthStats(): HealthState {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_FILE, "utf-8"));
  } catch {
    return { hourly_stats: [] };
  }
}

// ─── Digest Builder ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  const events = loadWeekEvents();
  const contextEvents = loadContextEvents();
  const health = loadHealthStats();

  // Switch analysis
  const tierDrops: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  const providerFailures: Record<string, number> = {};

  for (const e of events) {
    const dropKey = `${e.from_tier}→${e.to_tier}`;
    tierDrops[dropKey] = (tierDrops[dropKey] ?? 0) + 1;
    reasonCounts[e.reason] = (reasonCounts[e.reason] ?? 0) + 1;

    if (e.reason === "rate_limit" || e.reason === "provider_error") {
      providerFailures[e.from_model] = (providerFailures[e.from_model] ?? 0) + 1;
    }
  }

  // Health summary (last 48h from hourly stats)
  const providerSummary: Record<
    string,
    { checks: number; ok: number; rate_limits: number; errors: number; maxP95: number }
  > = {};
  for (const hourEntry of health.hourly_stats) {
    for (const [provider, stats] of Object.entries(hourEntry.providers)) {
      if (!providerSummary[provider]) {
        providerSummary[provider] = { checks: 0, ok: 0, rate_limits: 0, errors: 0, maxP95: 0 };
      }
      const s = providerSummary[provider];
      s.checks += stats.checks;
      s.ok += stats.ok;
      s.rate_limits += stats.rate_limits;
      s.errors += stats.errors;
      s.maxP95 = Math.max(s.maxP95, stats.p95_ms);
    }
  }

  // Build digest
  const lines: string[] = [
    `📊 *Weekly Routing Digest*`,
    `_${new Date().toISOString().slice(0, 10)}_`,
    ``,
  ];

  // Model switches
  lines.push(`*Model Switches (7d):* ${events.length}`);
  if (events.length > 0) {
    const sorted = Object.entries(tierDrops).toSorted((a, b) => b[1] - a[1]);
    for (const [drop, count] of sorted.slice(0, 5)) {
      lines.push(`  • ${drop}: ${count}x`);
    }
    lines.push(``);
    lines.push(`*Reasons:*`);
    for (const [reason, count] of Object.entries(reasonCounts)) {
      lines.push(`  • ${reason}: ${count}x`);
    }
  } else {
    lines.push(`  (no switches recorded)`);
  }

  // Provider failures
  if (Object.keys(providerFailures).length > 0) {
    lines.push(``, `*Top Failing Providers:*`);
    const sorted = Object.entries(providerFailures).toSorted((a, b) => b[1] - a[1]);
    for (const [model, count] of sorted.slice(0, 5)) {
      lines.push(`  ⚠️ ${model}: ${count} failures`);
    }
  }

  // Health probes
  if (Object.keys(providerSummary).length > 0) {
    lines.push(``, `*Provider Health (48h probes):*`);
    for (const [provider, s] of Object.entries(providerSummary)) {
      const pct = s.checks > 0 ? Math.round((s.ok / s.checks) * 100) : 0;
      const icon = s.rate_limits > 0 ? "⚠️" : pct === 100 ? "✅" : "❌";
      lines.push(
        `  ${icon} ${provider}: ${pct}% ok, p95=${s.maxP95}ms` +
          (s.rate_limits > 0 ? `, ${s.rate_limits} rate limits` : ""),
      );
    }
  }

  // Context events
  const warnings = contextEvents.filter((e) => e.type === "context_warning").length;
  const criticals = contextEvents.filter((e) => e.type === "context_critical").length;
  if (warnings > 0 || criticals > 0) {
    lines.push(``, `*Context Threshold Events (7d):*`);
    if (warnings > 0) {
      lines.push(`  🟡 Warnings (70%): ${warnings}x`);
    }
    if (criticals > 0) {
      lines.push(`  🔴 Critical (85%): ${criticals}x`);
    }
  }

  // Recommendations
  lines.push(``, `*Recommendations:*`);
  if (events.length === 0 && Object.keys(providerFailures).length === 0) {
    lines.push(`  ✅ Routing stable. No action needed.`);
  } else {
    if (Object.keys(providerFailures).length > 0) {
      const worst = Object.entries(providerFailures).toSorted((a, b) => b[1] - a[1])[0];
      lines.push(`  • ${worst[0]} hit ${worst[1]} failures — consider reordering fallback chain`);
    }
    if (events.length > 10) {
      lines.push(`  • ${events.length} switches is high — investigate root cause`);
    }
  }

  const digest = lines.join("\n");
  console.log(digest);
  await sendAlert(digest);
}

main().catch(console.error);
