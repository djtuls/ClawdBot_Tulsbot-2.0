/**
 * monitor-api-cost.ts
 * Monitors OpenRouter monthly API usage and enforces model routing based on budget.
 *
 * Usage:
 *   npx tsx scripts/monitor-api-cost.ts [--mode=morning|evening|weekly|check|reset-baseline]
 *
 * Monthly budget: $120 (OpenRouter portion of $200/month total AI spend).
 * Routing tiers based on remaining monthly budget:
 *   > $80 remaining  → Normal   (Claude Sonnet orchestrator, Gemini Flash subagents)
 *   $40–80 remaining → Economy  (Claude Haiku orchestrator, Gemini Flash subagents)
 *   $20–40 remaining → Low      (Gemini Flash orchestrator + subagents)
 *   < $20 remaining  → Emergency (free tier only — Llama/Mistral via OpenRouter free)
 *
 * Enforcement: automatically updates agents.defaults and named agents in openclaw.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.join(__dirname, "..");
const OPENCLAW_JSON = path.join(WORKSPACE, "..", "openclaw.json");
const LOG_FILE = path.join(WORKSPACE, "memory", "api-cost-log.jsonl");
const BASELINE_FILE = path.join(WORKSPACE, "memory", "monthly-cost-baseline.json");

/** Monthly OpenRouter budget. Remaining $80 of the $200/month total goes to direct APIs. */
const MONTHLY_BUDGET = 120.0;

// ─── Auth ─────────────────────────────────────────────────────────────────

function getOpenRouterToken(): string {
  const profilePath = path.join(
    process.env.HOME ?? "",
    ".openclaw",
    "agents",
    "main",
    "agent",
    "auth-profiles.json",
  );
  try {
    const data = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    const token = data?.profiles?.["openrouter:manual"]?.token;
    if (!token) {
      throw new Error("token not found in auth-profiles.json");
    }
    return token;
  } catch (e: unknown) {
    throw new Error(`Failed to read OpenRouter token: ${(e as Error).message}`, { cause: e });
  }
}

// ─── OpenRouter API ────────────────────────────────────────────────────────

interface KeyInfo {
  data: {
    label?: string;
    usage: number; // lifetime usage in USD
    limit: number | null;
    is_free_tier: boolean;
    rate_limit: { requests: number; interval: string };
  };
}

async function fetchKeyInfo(token: string): Promise<KeyInfo> {
  const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as KeyInfo;
}

// ─── Monthly baseline ──────────────────────────────────────────────────────

interface MonthlyBaseline {
  month: string; // YYYY-MM
  baselineUsage: number;
  resetAt: string; // ISO timestamp
}

function getThisMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Returns the monthly baseline usage amount.
 * If no baseline exists or it's a new month, creates one at the current usage.
 */
function resolveMonthlyBaseline(currentLifetimeUsage: number): {
  baseline: number;
  isNewMonth: boolean;
} {
  const thisMonth = getThisMonth();
  try {
    const data = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8")) as MonthlyBaseline;
    if (data.month === thisMonth) {
      return { baseline: data.baselineUsage, isNewMonth: false };
    }
  } catch {
    // no file or parse error — create new baseline
  }

  // New month or first run: set baseline to current lifetime usage
  const baseline: MonthlyBaseline = {
    month: thisMonth,
    baselineUsage: currentLifetimeUsage,
    resetAt: new Date().toISOString(),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
  console.log(
    `[baseline] New monthly baseline set: $${currentLifetimeUsage.toFixed(4)} (month: ${thisMonth})`,
  );
  return { baseline: currentLifetimeUsage, isNewMonth: true };
}

function resetBaseline(currentLifetimeUsage: number): void {
  const thisMonth = getThisMonth();
  const baseline: MonthlyBaseline = {
    month: thisMonth,
    baselineUsage: currentLifetimeUsage,
    resetAt: new Date().toISOString(),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
  console.log(
    `[baseline] Baseline manually reset to $${currentLifetimeUsage.toFixed(4)} for ${thisMonth}`,
  );
}

// ─── Logging ───────────────────────────────────────────────────────────────

function appendLog(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

// ─── Telegram Alert ────────────────────────────────────────────────────────

async function sendTelegramAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // Fall back to first allowed user if chat ID not set
  const resolvedChatId =
    chatId ??
    (() => {
      const allowed = process.env.TELEGRAM_ALLOWED_USERS ?? "";
      const first = allowed.split(",")[0]?.trim();
      return first && first !== "comma" && first !== "your_telegram_id" ? first : undefined;
    })();

  if (!token || !resolvedChatId) {
    console.warn("[alert] Telegram not configured (need TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)");
    console.warn("[alert] Would have sent:", message.slice(0, 120));
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: resolvedChatId, text: message, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[alert] Telegram error: ${res.status} — ${body}`);
  } else {
    console.log(`[alert] Telegram message sent to ${resolvedChatId}`);
  }
}

// ─── Model Routing ─────────────────────────────────────────────────────────

type RoutingTier = "normal" | "economy" | "low" | "emergency";

/**
 * Model-per-activity assignment for each budget tier.
 *
 * Activity categories:
 *   orchestrator  → main Tulsbot agent, complex reasoning & planning
 *   subagent      → worker agents, research, coding assists
 *   background    → heartbeats, monitoring, cron tasks (cheapest possible)
 */
const ROUTING_CONFIG: Record<
  RoutingTier,
  {
    label: string;
    orchestrator: string;
    subagent: string;
    background: string;
    description: string;
  }
> = {
  normal: {
    label: "✅ Normal",
    orchestrator: "openrouter/anthropic/claude-sonnet-4.6",
    subagent: "google/gemini-2.5-flash",
    background: "google/gemini-2.5-flash-lite",
    description: "Sonnet orchestrator · Gemini Flash subagents · Flash Lite background",
  },
  economy: {
    label: "⚠️ Economy",
    orchestrator: "openrouter/anthropic/claude-haiku-4.5",
    subagent: "google/gemini-2.5-flash",
    background: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    description: "Haiku orchestrator · Gemini Flash subagents · free background",
  },
  low: {
    label: "🔶 Low budget",
    orchestrator: "google/gemini-2.5-flash",
    subagent: "google/gemini-2.5-flash-lite",
    background: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    description: "Gemini Flash orchestrator + subagents · free background",
  },
  emergency: {
    label: "🚨 EMERGENCY",
    orchestrator: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    subagent: "openrouter/mistralai/mistral-small-3.1-24b-instruct:free",
    background: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    description: "Free tier only — Llama 3.3 70B everywhere",
  },
};

function getRoutingTier(monthlyRemaining: number): RoutingTier {
  if (monthlyRemaining > 80) {
    return "normal";
  }
  if (monthlyRemaining > 40) {
    return "economy";
  }
  if (monthlyRemaining > 20) {
    return "low";
  }
  return "emergency";
}

// ─── openclaw.json Routing Enforcement ────────────────────────────────────

interface OpenClawModelConfig {
  primary: string;
  fallbacks?: string[];
}

interface OpenClawJson {
  agents?: {
    defaults?: {
      model?: OpenClawModelConfig;
      subagents?: { model?: OpenClawModelConfig };
    };
    list?: Array<{
      id?: string;
      model?: OpenClawModelConfig;
    }>;
  };
  [key: string]: unknown;
}

function applyRoutingToConfig(tier: RoutingTier): {
  changed: boolean;
  previousTier?: string;
} {
  if (!fs.existsSync(OPENCLAW_JSON)) {
    console.warn(`[routing] openclaw.json not found at ${OPENCLAW_JSON} — skipping enforcement`);
    return { changed: false };
  }

  let config: OpenClawJson;
  try {
    config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, "utf-8")) as OpenClawJson;
  } catch (e) {
    console.error(`[routing] Failed to parse openclaw.json: ${(e as Error).message}`);
    return { changed: false };
  }

  const routing = ROUTING_CONFIG[tier];
  const agents = (config.agents ??= {});
  const defaults = (agents.defaults ??= {});

  const prevOrchestrator = defaults.model?.primary ?? "unknown";
  const previousTier = Object.entries(ROUTING_CONFIG).find(
    ([, v]) => v.orchestrator === prevOrchestrator,
  )?.[0];

  // Only write if tier actually changed
  if (previousTier === tier) {
    return { changed: false, previousTier: tier };
  }

  // Update defaults.model (primary only — preserve fallback chain)
  defaults.model ??= { primary: routing.orchestrator };
  defaults.model.primary = routing.orchestrator;

  // Update defaults.subagents.model
  const subagents = (defaults.subagents ??= {});
  subagents.model ??= { primary: routing.subagent };
  subagents.model.primary = routing.subagent;

  // Update named agents: tulsbot → orchestrator, main → subagent, heartbeats → background
  for (const agent of agents.list ?? []) {
    if (agent.id === "tulsbot" && agent.model) {
      agent.model.primary = routing.orchestrator;
    }
    if (agent.id === "main" && agent.model) {
      agent.model.primary = routing.subagent;
    }
    // Heartbeat always uses background model regardless of agent
    const heartbeat = agent as unknown as { heartbeat?: { model?: string } };
    if (heartbeat.heartbeat) {
      heartbeat.heartbeat.model = routing.background;
    }
  }

  try {
    fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2) + "\n");
    console.log(
      `[routing] Applied tier ${routing.label}: orchestrator=${routing.orchestrator}, subagent=${routing.subagent}`,
    );
    return { changed: true, previousTier };
  } catch (e) {
    console.error(`[routing] Failed to write openclaw.json: ${(e as Error).message}`);
    return { changed: false };
  }
}

// ─── Previous usage tracking (for daily deltas) ────────────────────────────

function getLastLog(): Record<string, unknown> | null {
  if (!fs.existsSync(LOG_FILE)) {
    return null;
  }
  const lines = fs.readFileSync(LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  try {
    return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getWeeklyLogs(): Array<Record<string, unknown>> {
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return fs
    .readFileSync(LOG_FILE, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => {
      if (!e) {
        return false;
      }
      const ts = new Date(e.ts as string).getTime();
      return ts >= weekAgo;
    });
}

// ─── Main check ────────────────────────────────────────────────────────────

async function runCheck(mode: "morning" | "evening" | "check"): Promise<void> {
  console.log(`[monitor-api-cost] Running ${mode} check — ${new Date().toISOString()}`);

  const token = getOpenRouterToken();
  const keyInfo = await fetchKeyInfo(token);
  const { usage: lifetimeUsage } = keyInfo.data;

  const { baseline, isNewMonth } = resolveMonthlyBaseline(lifetimeUsage);
  const monthlySpend = lifetimeUsage - baseline;
  const monthlyRemaining = MONTHLY_BUDGET - monthlySpend;

  const lastLog = getLastLog();
  const lastUsage =
    typeof lastLog?.lifetime_usage === "number" ? lastLog.lifetime_usage : lifetimeUsage;
  const sinceLastCheck = lifetimeUsage - lastUsage;

  const tier = getRoutingTier(monthlyRemaining);
  const routing = ROUTING_CONFIG[tier];
  const { changed: routingChanged, previousTier } = applyRoutingToConfig(tier);

  console.log(`  Lifetime usage:      $${lifetimeUsage.toFixed(4)}`);
  console.log(`  Monthly baseline:    $${baseline.toFixed(4)} (${getThisMonth()})`);
  console.log(`  Monthly spend:       $${monthlySpend.toFixed(4)} / $${MONTHLY_BUDGET}`);
  console.log(`  Monthly remaining:   $${monthlyRemaining.toFixed(2)}`);
  console.log(`  Since last check:    $${sinceLastCheck.toFixed(4)}`);
  console.log(`  Routing tier:        ${routing.label} (${routing.description})`);
  if (routingChanged) {
    console.log(`  ⚡ Routing changed from ${previousTier ?? "unknown"} → ${tier}`);
  }

  appendLog({
    mode,
    lifetime_usage: lifetimeUsage,
    monthly_spend: monthlySpend,
    monthly_remaining: monthlyRemaining,
    since_last_check: sinceLastCheck,
    routing_tier: tier,
    routing_changed: routingChanged,
    new_month: isNewMonth,
  });

  const alerts: string[] = [];

  // High per-check spend alert (>$5 since last check)
  if (sinceLastCheck > 5.0) {
    alerts.push(`⚠️ *High spend since last check*: $${sinceLastCheck.toFixed(2)} used`);
  }

  // Monthly balance alerts
  if (monthlyRemaining < 20) {
    alerts.push(
      `🚨 *EMERGENCY: Monthly OpenRouter budget critical* — $${monthlyRemaining.toFixed(2)} left of $${MONTHLY_BUDGET}\n` +
        `All agents switched to free-tier models only.`,
    );
  } else if (monthlyRemaining < 40) {
    alerts.push(
      `🔶 *Low monthly budget* — $${monthlyRemaining.toFixed(2)} remaining ($${monthlySpend.toFixed(2)} spent this month)`,
    );
  } else if (monthlyRemaining < 80) {
    alerts.push(
      `⚠️ *Economy mode* — $${monthlyRemaining.toFixed(2)} remaining. Switched to Haiku orchestrator.`,
    );
  }

  if (routingChanged && tier !== "normal") {
    alerts.push(`🔄 *Routing updated*: ${previousTier ?? "?"} → ${tier}\n${routing.description}`);
  }

  for (const alert of alerts) {
    console.log(`[alert] ${alert.replace(/\*/g, "")}`);
    await sendTelegramAlert(alert);
  }

  if (alerts.length === 0) {
    console.log(`  No alerts triggered.`);
  }

  console.log(
    `\n📊 OpenRouter Budget (${mode}) — ${getThisMonth()}\n` +
      `  Monthly: $${monthlySpend.toFixed(2)} spent / $${MONTHLY_BUDGET} budget\n` +
      `  Remaining: ~$${monthlyRemaining.toFixed(2)}\n` +
      `  Since last check: $${sinceLastCheck.toFixed(4)}\n` +
      `  Routing: ${routing.label}`,
  );
}

// ─── Weekly digest ─────────────────────────────────────────────────────────

async function runWeeklyDigest(): Promise<void> {
  console.log(`[monitor-api-cost] Running weekly digest — ${new Date().toISOString()}`);

  const token = getOpenRouterToken();
  const keyInfo = await fetchKeyInfo(token);
  const { usage: lifetimeUsage } = keyInfo.data;

  const { baseline } = resolveMonthlyBaseline(lifetimeUsage);
  const monthlySpend = lifetimeUsage - baseline;
  const monthlyRemaining = MONTHLY_BUDGET - monthlySpend;

  const weekLogs = getWeeklyLogs();
  const weeklySpend =
    weekLogs.length >= 2
      ? lifetimeUsage -
        ((weekLogs[0].lifetime_usage as number) ?? (weekLogs[0].total_usage as number) ?? 0)
      : null;

  const projectedMonthlyBurn = weeklySpend != null ? (weeklySpend / 7) * 30 : null;
  const daysRemainingAtBurn =
    projectedMonthlyBurn != null && projectedMonthlyBurn > 0
      ? Math.floor(monthlyRemaining / (projectedMonthlyBurn / 30))
      : null;

  const tier = getRoutingTier(monthlyRemaining);
  const routing = ROUTING_CONFIG[tier];

  appendLog({
    mode: "weekly",
    lifetime_usage: lifetimeUsage,
    monthly_spend: monthlySpend,
    monthly_remaining: monthlyRemaining,
    weekly_spend: weeklySpend,
    projected_monthly_burn: projectedMonthlyBurn,
    routing_tier: tier,
  });

  const digest =
    `📊 *Weekly OpenRouter Cost Digest* — ${getThisMonth()}\n\n` +
    `💰 Monthly: $${monthlySpend.toFixed(2)} / $${MONTHLY_BUDGET}\n` +
    `💵 Remaining this month: ~$${monthlyRemaining.toFixed(2)}\n` +
    (weeklySpend != null ? `📅 This week: $${weeklySpend.toFixed(2)}\n` : "") +
    (projectedMonthlyBurn != null
      ? `📈 Projected monthly burn: $${projectedMonthlyBurn.toFixed(2)}\n`
      : "") +
    (daysRemainingAtBurn != null ? `⏱ Days left at current burn: ${daysRemainingAtBurn}d\n` : "") +
    `\n🤖 Routing: ${routing.label}\n${routing.description}`;

  console.log(digest);
  await sendTelegramAlert(digest);
}

// ─── Entry point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const modeArg = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "check";

  // Load .env from workspace root
  const envPath = path.join(WORKSPACE, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const [k, ...rest] = line.trim().split("=");
      if (k && !k.startsWith("#") && rest.length && !process.env[k]) {
        process.env[k] = rest.join("=");
      }
    }
  }

  if (modeArg === "reset-baseline") {
    const token = getOpenRouterToken();
    const keyInfo = await fetchKeyInfo(token);
    resetBaseline(keyInfo.data.usage);
  } else if (modeArg === "weekly") {
    await runWeeklyDigest();
  } else if (modeArg === "morning" || modeArg === "evening" || modeArg === "check") {
    await runCheck(modeArg);
  } else {
    console.error(
      `Unknown mode: ${modeArg}. Use --mode=morning|evening|weekly|check|reset-baseline`,
    );
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error("[monitor-api-cost] Fatal error:", err.message);
  process.exit(1);
});
