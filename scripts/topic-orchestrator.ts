#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

type TopicCfg = {
  threadId: number;
  name: string;
  critical?: boolean;
  priorityScore: number;
  defaultOwner?: string;
};

type Config = {
  groupId: string;
  groupName?: string;
  dailyTokenBudget: number;
  crossTopicReservePct: number;
  maxTopicsPerPool: number;
  idleRetireHours: number;
  thresholds: {
    tierA: { scoreMin: number; messages24hMin: number };
    tierB: { scoreMin: number; messages24hMin: number };
  };
  topics: TopicCfg[];
};

type Metrics = {
  [threadId: string]: {
    messages24h?: number;
    blockerOpen?: boolean;
    dueInHours?: number;
    lastActiveHoursAgo?: number;
    tokensUsedToday?: number;
  };
};

const cwd = process.cwd();
const date = new Date().toISOString().slice(0, 10);

function getArg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function tierForTopic(cfg: Config, topic: TopicCfg, m: Metrics[string]) {
  const score = topic.priorityScore;
  const msgs = m?.messages24h ?? 0;
  const critical = topic.critical === true;
  const deadlineHot = typeof m?.dueInHours === "number" && m.dueInHours <= 48;
  const blocked = m?.blockerOpen === true;

  if (
    critical ||
    score >= cfg.thresholds.tierA.scoreMin ||
    msgs >= cfg.thresholds.tierA.messages24hMin ||
    blocked ||
    deadlineHot
  ) {
    return "A" as const;
  }

  if (score >= cfg.thresholds.tierB.scoreMin || msgs >= cfg.thresholds.tierB.messages24hMin) {
    return "B" as const;
  }

  return "C" as const;
}

function budgetCapByTier(tier: "A" | "B" | "C") {
  if (tier === "A") {
    return 20000;
  }
  if (tier === "B") {
    return 8000;
  }
  return 2000;
}

function main() {
  const command = process.argv[2] ?? "plan";
  if (command !== "plan") {
    console.error("Usage: pnpm tsx scripts/topic-orchestrator.ts plan --config <file>");
    process.exit(1);
  }

  const configPath = path.resolve(
    cwd,
    getArg("--config", "config/topic-orchestration.topics-group.json")!,
  );
  const metricsPath = path.resolve(cwd, "data/topic-orchestrator/topic-metrics.json");
  const statePath = path.resolve(cwd, "data/topic-orchestrator/state.json");
  const reportPath = path.resolve(cwd, "reports/topic-orchestration-plan.md");
  const memoryDailyPath = path.resolve(cwd, `memory/topics/${date}.md`);

  const cfg = readJson<Config>(configPath, {} as Config);
  const metrics = readJson<Metrics>(metricsPath, {});

  ensureDir(path.dirname(statePath));
  ensureDir(path.dirname(reportPath));
  ensureDir(path.dirname(memoryDailyPath));

  const rows = cfg.topics.map((t) => {
    const m = metrics[String(t.threadId)] ?? {};
    const tier = tierForTopic(cfg, t, m);
    const cap = budgetCapByTier(tier);
    const used = m.tokensUsedToday ?? 0;
    const budgetState = used >= cap ? "OVER_CAP" : used >= cap * 0.8 ? "NEAR_CAP" : "OK";

    let action = "KEEP";
    if (tier === "A") {
      action = "DEDICATED_STEWARD";
    }
    if (tier === "B") {
      action = "POOLED_COVERAGE";
    }
    if (tier === "C") {
      action = "ON_DEMAND";
    }
    if ((m.lastActiveHoursAgo ?? 0) >= cfg.idleRetireHours && tier !== "A") {
      action = "RETIRE_IF_RUNNING";
    }

    return {
      threadId: t.threadId,
      name: t.name,
      tier,
      action,
      critical: t.critical ?? false,
      messages24h: m.messages24h ?? 0,
      blockerOpen: m.blockerOpen ?? false,
      dueInHours: m.dueInHours ?? null,
      tokensUsedToday: used,
      tokenCap: cap,
      budgetState,
      lastActiveHoursAgo: m.lastActiveHoursAgo ?? null,
    };
  });

  const poolTopics = rows.filter((r) => r.tier === "B").length;
  const poolWorkersNeeded = Math.max(1, Math.ceil(poolTopics / Math.max(1, cfg.maxTopicsPerPool)));

  const groupUsed = rows.reduce((acc, r) => acc + r.tokensUsedToday, 0);
  const reserve = Math.floor(cfg.dailyTokenBudget * cfg.crossTopicReservePct);
  const spendable = cfg.dailyTokenBudget - reserve;

  const state = {
    generatedAt: new Date().toISOString(),
    groupId: cfg.groupId,
    groupName: cfg.groupName ?? "Topics",
    budget: {
      daily: cfg.dailyTokenBudget,
      reserve,
      spendable,
      used: groupUsed,
      usedPct: Number(((groupUsed / Math.max(1, cfg.dailyTokenBudget)) * 100).toFixed(1)),
    },
    poolWorkersNeeded,
    topics: rows,
  };

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const lines: string[] = [];
  lines.push(`# Topic Orchestration Plan (${date})`);
  lines.push("");
  lines.push(`- Group: ${state.groupName} (${state.groupId})`);
  lines.push(
    `- Budget used: ${state.budget.used}/${state.budget.daily} (${state.budget.usedPct}%)`,
  );
  lines.push(`- Cross-topic reserve: ${state.budget.reserve}`);
  lines.push(`- Pooled workers needed: ${state.poolWorkersNeeded}`);
  lines.push("");
  lines.push("## Topic Actions");
  lines.push("");

  for (const r of rows) {
    lines.push(
      `- [T${r.threadId}] ${r.name} -> Tier ${r.tier} | Action: ${r.action} | msgs24h=${r.messages24h} | budget=${r.tokensUsedToday}/${r.tokenCap} (${r.budgetState})`,
    );
  }

  lines.push("");
  lines.push("## Execution Notes");
  lines.push("");
  lines.push("- Week 1: execute spawn/retire actions with human approval.");
  lines.push("- Auto-apply allowed for summaries and non-critical C-tier retirements.");

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`);

  const memoryLines = [
    `# Topics Daily Digest — ${date}`,
    "",
    `Group: ${state.groupName} (${state.groupId})`,
    `Budget used: ${state.budget.usedPct}%`,
    "",
    "## Tier Snapshot",
    ...rows.map(
      (r) =>
        `- T${r.threadId} ${r.name}: Tier ${r.tier}, action=${r.action}, msgs24h=${r.messages24h}`,
    ),
    "",
    "## Escalations",
    "- (none auto-detected in planner; add manually if needed)",
    "",
    "## Cross-topic deltas",
    "- (fill during sync pass)",
  ];
  fs.writeFileSync(memoryDailyPath, `${memoryLines.join("\n")}\n`);

  console.log(`Wrote ${statePath}`);
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${memoryDailyPath}`);
}

main();
