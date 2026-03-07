#!/usr/bin/env bun
/**
 * Multi-Provider Cost Digest
 *
 * Aggregates spend across OpenRouter, Anthropic (direct), OpenAI (direct),
 * and Google (direct) into a unified budget view. Sends Telegram digest.
 *
 * Complements monitor-api-cost.ts (OpenRouter-focused) with cross-provider visibility.
 *
 * Usage: bun scripts/multi-provider-cost-digest.ts [--mode=check|digest]
 */

import fs from "fs";
import path from "path";

const HOME = process.env.HOME ?? "/Users/tulioferro";
const ENV_FILE = path.join(HOME, ".openclaw/.env");
const LOG_FILE = path.join(HOME, ".openclaw/workspace/memory/multi-provider-cost.jsonl");
const HEALTH_FILE = path.join(HOME, ".openclaw/workspace/memory/provider-health.json");

const TOTAL_BUDGET = 200;
const PROVIDER_BUDGETS: Record<string, number> = {
  anthropic: 90,
  google: 70,
  openai: 30,
  openrouter: 10,
};

// ─── Env ────────────────────────────────────────────────────────────────────

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

// ─── Telegram ───────────────────────────────────────────────────────────────

async function sendAlert(message: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[cost] Telegram not configured:", message.slice(0, 80));
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
  } catch (e) {
    console.error("[cost] Telegram error:", e);
  }
}

// ─── Provider Usage Fetchers ────────────────────────────────────────────────

interface ProviderUsage {
  provider: string;
  monthly_spend: number | null;
  budget: number;
  status: "ok" | "unavailable" | "over_budget" | "credits_low";
  error?: string;
}

async function fetchOpenRouterUsage(): Promise<ProviderUsage> {
  try {
    const profilePath = path.join(HOME, ".openclaw/agents/main/agent/auth-profiles.json");
    const profiles = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    const token = profiles?.profiles?.["openrouter:manual"]?.token;
    if (!token) {
      return {
        provider: "openrouter",
        monthly_spend: null,
        budget: PROVIDER_BUDGETS.openrouter,
        status: "unavailable",
        error: "no token",
      };
    }

    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        provider: "openrouter",
        monthly_spend: null,
        budget: PROVIDER_BUDGETS.openrouter,
        status: "unavailable",
        error: `${res.status}`,
      };
    }

    const data = (await res.json()) as { data: { usage: number } };
    // Usage is lifetime — we'd need the baseline from monitor-api-cost for monthly
    // For now, read from existing baseline
    const baselinePath = path.join(HOME, ".openclaw/workspace/memory/monthly-cost-baseline.json");
    let baseline = 0;
    try {
      const b = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
      const thisMonth = new Date().toISOString().slice(0, 7);
      if (b.month === thisMonth) {
        baseline = b.baselineUsage;
      }
    } catch {
      /* no baseline */
    }

    const monthly = data.data.usage - baseline;
    const status = monthly > PROVIDER_BUDGETS.openrouter ? "over_budget" : "ok";
    return {
      provider: "openrouter",
      monthly_spend: monthly,
      budget: PROVIDER_BUDGETS.openrouter,
      status,
    };
  } catch (e) {
    return {
      provider: "openrouter",
      monthly_spend: null,
      budget: PROVIDER_BUDGETS.openrouter,
      status: "unavailable",
      error: String(e),
    };
  }
}

async function fetchAnthropicStatus(): Promise<ProviderUsage> {
  // Anthropic doesn't expose a usage endpoint via API key; check credit status via probe
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 400) {
      const body = await res.text();
      if (body.includes("credit balance is too low")) {
        return {
          provider: "anthropic",
          monthly_spend: null,
          budget: PROVIDER_BUDGETS.anthropic,
          status: "credits_low",
          error: "credits depleted",
        };
      }
    }
    if (res.status === 429) {
      return {
        provider: "anthropic",
        monthly_spend: null,
        budget: PROVIDER_BUDGETS.anthropic,
        status: "ok",
        error: "rate limited but active",
      };
    }
    if (res.ok) {
      return {
        provider: "anthropic",
        monthly_spend: null,
        budget: PROVIDER_BUDGETS.anthropic,
        status: "ok",
      };
    }
    return {
      provider: "anthropic",
      monthly_spend: null,
      budget: PROVIDER_BUDGETS.anthropic,
      status: "unavailable",
      error: `${res.status}`,
    };
  } catch (e) {
    return {
      provider: "anthropic",
      monthly_spend: null,
      budget: PROVIDER_BUDGETS.anthropic,
      status: "unavailable",
      error: String(e),
    };
  }
}

async function fetchGoogleStatus(): Promise<ProviderUsage> {
  // Google doesn't have a usage API; probe to check if key is working
  try {
    const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "." }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 429) {
      return {
        provider: "google",
        monthly_spend: null,
        budget: PROVIDER_BUDGETS.google,
        status: "ok",
        error: "rate limited but active",
      };
    }
    if (res.ok) {
      return {
        provider: "google",
        monthly_spend: null,
        budget: PROVIDER_BUDGETS.google,
        status: "ok",
      };
    }
    return {
      provider: "google",
      monthly_spend: null,
      budget: PROVIDER_BUDGETS.google,
      status: "unavailable",
      error: `${res.status}`,
    };
  } catch (e) {
    return {
      provider: "google",
      monthly_spend: null,
      budget: PROVIDER_BUDGETS.google,
      status: "unavailable",
      error: String(e),
    };
  }
}

async function fetchOpenAIStatus(): Promise<ProviderUsage> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "." }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      return {
        provider: "openai",
        monthly_spend: null,
        budget: PROVIDER_BUDGETS.openai,
        status: "ok",
        error: "rate limited but active",
      };
    }
    if (res.ok) {
      return {
        provider: "openai",
        monthly_spend: null,
        budget: PROVIDER_BUDGETS.openai,
        status: "ok",
      };
    }
    return {
      provider: "openai",
      monthly_spend: null,
      budget: PROVIDER_BUDGETS.openai,
      status: "unavailable",
      error: `${res.status}`,
    };
  } catch (e) {
    return {
      provider: "openai",
      monthly_spend: null,
      budget: PROVIDER_BUDGETS.openai,
      status: "unavailable",
      error: String(e),
    };
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();
  const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "check";

  console.log("[cost] Multi-provider cost check...");
  const results = await Promise.all([
    fetchOpenRouterUsage(),
    fetchAnthropicStatus(),
    fetchGoogleStatus(),
    fetchOpenAIStatus(),
  ]);

  // Log
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), results }) + "\n");

  // Console output
  for (const r of results) {
    const icon =
      r.status === "ok"
        ? "✓"
        : r.status === "credits_low"
          ? "💀"
          : r.status === "over_budget"
            ? "🔴"
            : "?";
    const spend = r.monthly_spend != null ? `$${r.monthly_spend.toFixed(2)}` : "n/a";
    console.log(
      `  ${icon} ${r.provider}: ${r.status} | spend=${spend} / $${r.budget} budget${r.error ? ` (${r.error})` : ""}`,
    );
  }

  // Alerts for critical issues
  const alerts: string[] = [];
  for (const r of results) {
    if (r.status === "credits_low") {
      alerts.push(`💀 *${r.provider}*: credits depleted — ${r.error}`);
    }
    if (r.status === "over_budget" && r.monthly_spend != null) {
      alerts.push(
        `🔴 *${r.provider}*: over budget ($${r.monthly_spend.toFixed(2)} / $${r.budget})`,
      );
    }
  }

  if (alerts.length > 0 || mode === "digest") {
    const lines = [`💰 *Multi-Provider Cost Check*`, ``];
    for (const r of results) {
      const icon = r.status === "ok" ? "✅" : r.status === "credits_low" ? "💀" : "⚠️";
      const spend = r.monthly_spend != null ? `$${r.monthly_spend.toFixed(2)}` : "status only";
      lines.push(
        `${icon} *${r.provider}*: ${spend} / $${r.budget}${r.error ? ` — ${r.error}` : ""}`,
      );
    }
    lines.push(``, `Total budget: $${TOTAL_BUDGET}/month`);
    if (alerts.length > 0) {
      lines.push(``, `*Issues:*`, ...alerts);
    }
    await sendAlert(lines.join("\n"));
  }

  console.log("[cost] Done");
}

main().catch(console.error);
