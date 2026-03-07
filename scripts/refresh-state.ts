#!/usr/bin/env tsx
/**
 * refresh-state.ts — Rebuild STATE.md from authoritative sources
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");
const OPENCLAW_HOME = path.resolve(WORKSPACE, "..", "agents");

const DRY_RUN = process.argv.includes("--dry-run");
const QUIET = process.argv.includes("--quiet");

function log(...args: unknown[]) {
  if (!QUIET) {
    console.log(...args);
  }
}

async function readJson(filePath: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

interface HeartbeatHealth {
  lastRun: string;
  passCount: number;
  failCount: number;
  failures: string[];
}

async function getHeartbeatHealth(): Promise<HeartbeatHealth> {
  const hb = await readJson(path.join(WORKSPACE, "memory", "heartbeat-state.json"));
  if (!hb) {
    return { lastRun: "unknown", passCount: 0, failCount: 0, failures: [] };
  }

  const tasks = hb.tasks || {};
  const failures: string[] = [];
  let pass = 0;
  let fail = 0;

  for (const [key, val] of Object.entries(tasks)) {
    if ((val as Record<string, unknown>).status === "SUCCEEDED") {
      pass++;
    } else {
      fail++;
      failures.push(key);
    }
  }

  return { lastRun: hb.lastRun || "unknown", passCount: pass, failCount: fail, failures };
}

async function getPriorities(): Promise<{ focus: string[]; blockers: string[] }> {
  const todo = await readText(path.join(WORKSPACE, "TODO.md"));
  const lines = todo.split("\n");
  const focus: string[] = [];
  const blockers: string[] = [];

  let currentSection = "";
  for (const line of lines) {
    if (line.startsWith("## ")) {
      currentSection = line;
    }
    const match = line.match(/^- \[ \]\s+(.+)/);
    if (!match) {
      continue;
    }

    const item = match[1].replace(/\s*\(.*?\)\s*$/, "").trim();
    if (currentSection.includes("High") && focus.length < 3) {
      focus.push(item);
    }
    if (/block(er|ed|ing)/i.test(line)) {
      blockers.push(item);
    }
  }

  if (focus.length === 0) {
    for (const line of lines) {
      const match = line.match(/^- \[ \]\s+(.+)/);
      if (match && focus.length < 3) {
        focus.push(match[1].replace(/\s*\(.*?\)\s*$/, "").trim());
      }
    }
  }

  return { focus, blockers };
}

async function getActiveThreads(): Promise<Array<{ id: string; task: string }>> {
  const todo = await readText(path.join(WORKSPACE, "TODO.md"));
  const threads: Array<{ id: string; task: string }> = [];

  for (const line of todo.split("\n")) {
    const match = line.match(/^- \[ \]\s+(.+)/);
    if (!match) {
      continue;
    }
    threads.push({
      id: `T${threads.length + 1}`,
      task: match[1].replace(/\s*\(.*?\)\s*$/, "").trim(),
    });
    if (threads.length >= 5) {
      break;
    }
  }

  return threads;
}

async function getShiftInfo(): Promise<{ mode: string; strategy: string }> {
  const config = await readJson(path.join(WORKSPACE, "memory", "shift-config.json"));
  return { mode: config?.mode || "Builder", strategy: config?.strategy || "Continuous State" };
}

interface SessionTopology {
  totalRecent: number;
  builderRecent: number;
  mainRecent: number;
  channels: string[];
  splitBrainRisk: "LOW" | "HIGH";
}

async function getSessionTopology(): Promise<SessionTopology> {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  let totalRecent = 0;
  let builderRecent = 0;
  let mainRecent = 0;
  const channels = new Set<string>();

  try {
    const agentDirs = await fs.readdir(OPENCLAW_HOME, { withFileTypes: true });
    for (const agentDir of agentDirs) {
      if (!agentDir.isDirectory()) {
        continue;
      }
      const agentName = agentDir.name;
      const sessionsDir = path.join(OPENCLAW_HOME, agentName, "sessions");
      let files: string[] = [];
      try {
        files = await fs.readdir(sessionsDir);
      } catch {
        continue;
      }

      for (const f of files) {
        if (!f.endsWith(".jsonl")) {
          continue;
        }
        const fullPath = path.join(sessionsDir, f);
        let stat;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          continue;
        }
        if (stat.mtimeMs < cutoff) {
          continue;
        }

        totalRecent++;
        if (agentName === "builder") {
          builderRecent++;
        }
        if (agentName === "main") {
          mainRecent++;
        }

        const channelGuess = f.includes("discord")
          ? "discord"
          : f.includes("telegram")
            ? "telegram"
            : "other";
        channels.add(channelGuess);
      }
    }
  } catch {
    // ignore and return safe fallback
  }

  const splitBrainRisk = builderRecent > 0 && mainRecent > 0 ? "HIGH" : "LOW";
  return {
    totalRecent,
    builderRecent,
    mainRecent,
    channels: Array.from(channels.values()),
    splitBrainRisk,
  };
}

function buildReconciliationSnapshot(topology: SessionTopology) {
  return {
    generatedAt: new Date().toISOString(),
    objective: "Single-brain context across all sessions/channels",
    canonicalBrain: "builder",
    status: topology.splitBrainRisk === "HIGH" ? "PARTIAL" : "UNIFIED",
    metrics: {
      recentSessions48h: topology.totalRecent,
      builderRecentSessions48h: topology.builderRecent,
      mainRecentSessions48h: topology.mainRecent,
      channelsSeen: topology.channels,
    },
    actions: [
      "Use STATE.md as canonical cross-session summary",
      "Write task/status changes to TODO.md + STATE.md in same run",
      "Escalate split-brain risk whenever both main and builder are active within 48h",
    ],
  };
}

async function buildState(): Promise<string> {
  const [hb, priorities, threads, shift, topology] = await Promise.all([
    getHeartbeatHealth(),
    getPriorities(),
    getActiveThreads(),
    getShiftInfo(),
    getSessionTopology(),
  ]);

  const snapshot = buildReconciliationSnapshot(topology);
  await fs.mkdir(path.join(WORKSPACE, "state"), { recursive: true });
  await fs.writeFile(
    path.join(WORKSPACE, "state", "session-reconciliation.json"),
    JSON.stringify(snapshot, null, 2),
  );

  const now = new Date();
  const timestamp = now.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const hbAge =
    hb.lastRun !== "unknown"
      ? Math.round((now.getTime() - new Date(hb.lastRun).getTime()) / 60000)
      : -1;
  const hbStatus =
    hb.failCount === 0
      ? `${hb.passCount}/${hb.passCount} passed`
      : `${hb.passCount}/${hb.passCount + hb.failCount} passed (failed: ${hb.failures.join(", ")})`;
  const hbFresh = hbAge >= 0 && hbAge < 120 ? "fresh" : hbAge >= 0 ? `${hbAge}min ago` : "unknown";

  const lines: string[] = [
    "# STATE.md",
    "",
    `**Updated:** ${timestamp} AEDT (auto-generated by refresh-state.ts)`,
    `**Mode:** ${shift.mode}`,
    `**Memory:** ${shift.strategy}`,
    "**Status:** RUNNING",
    "",
    "---",
    "",
    "## Current Focus",
    "",
  ];

  if (priorities.focus.length) {
    priorities.focus.forEach((f) => lines.push(`1. ${f}`));
  } else {
    lines.push("No active priorities detected. Check TODO.md.");
  }

  lines.push("", "## Blockers", "");
  if (priorities.blockers.length) {
    priorities.blockers.forEach((b) => lines.push(`- ${b}`));
  } else {
    lines.push("None.");
  }

  lines.push("", "## Active Threads", "");
  if (threads.length) {
    threads.forEach((t) => lines.push(`- **${t.id}:** ${t.task}`));
  } else {
    lines.push("No open threads.");
  }

  lines.push("", "## Session Reconciliation", "");
  lines.push(`- Canonical brain: **${snapshot.canonicalBrain}**`);
  lines.push(
    `- Recent sessions (48h): ${topology.totalRecent} | builder: ${topology.builderRecent} | main: ${topology.mainRecent}`,
  );
  lines.push(`- Channels seen: ${topology.channels.join(", ") || "none"}`);
  lines.push(`- Split-brain risk: **${topology.splitBrainRisk}**`);
  lines.push(`- Snapshot: state/session-reconciliation.json`);

  lines.push("", "## System Health", "");
  lines.push(`- Heartbeat: ${hbStatus} (${hbFresh})`);
  lines.push("- Master Index: see Notion Dashboard");
  lines.push("- Cron: 12 jobs active (Australia/Sydney)");

  lines.push(
    "",
    "---",
    "",
    "*Auto-generated. Do not edit manually. Source: `scripts/refresh-state.ts`*",
    "*Detailed tracking: TODO.md | Dashboard: Notion | History: CHANGELOG.md*",
    "",
  );

  return lines.join("\n");
}

async function main() {
  log("Refreshing STATE.md...");
  const content = await buildState();

  if (DRY_RUN) {
    console.log(content);
    log("\n[DRY RUN — not written]");
  } else {
    await fs.writeFile(path.join(WORKSPACE, "STATE.md"), content);
    log(`Written STATE.md (${content.split("\n").length} lines)`);
  }
}

main().catch((err) => {
  console.error("refresh-state failed:", err.message);
  process.exit(1);
});
