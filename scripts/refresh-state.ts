#!/usr/bin/env tsx
/**
 * refresh-state.ts — Rebuild STATE.md from authoritative sources
 *
 * Reads live data from:
 *   - memory/heartbeat-state.json (system health)
 *   - memory/tulsday-processed-context.json (priorities, blockers)
 *   - TODO.md (open items)
 *   - memory/shift-config.json (shift info)
 *   - Notion Dashboard (agent count via sync-notion-dashboard output)
 *
 * Writes a clean, minimal STATE.md per Tulsbot's directive:
 *   - Identity & mode (~5 lines)
 *   - Current focus (top 3 priorities)
 *   - Critical blockers
 *   - Active threads (high-level, max 5)
 *   - System health (1-line heartbeat status)
 *
 * Target: <60 lines. Fast to read on every agent boot.
 *
 * Usage:
 *   npx tsx scripts/refresh-state.ts
 *   npx tsx scripts/refresh-state.ts --dry-run   (prints to stdout, no write)
 *   npx tsx scripts/refresh-state.ts --quiet
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");

const DRY_RUN = process.argv.includes("--dry-run");
const QUIET = process.argv.includes("--quiet");

function log(...args: unknown[]) {
  if (!QUIET) {
    console.log(...args);
  }
}

// ─── Readers ─────────────────────────────────────────────────────────────────

async function readJson(filePath: string): Promise<unknown> {
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

interface Priorities {
  focus: string[];
  blockers: string[];
}

async function getPriorities(): Promise<Priorities> {
  const todo = await readText(path.join(WORKSPACE, "TODO.md"));
  const focus: string[] = [];
  const blockers: string[] = [];

  // Extract open items from TODO.md grouped by priority section
  const lines = todo.split("\n");
  let currentSection = "";
  for (const line of lines) {
    if (line.startsWith("## ")) {
      currentSection = line;
    }
    const match = line.match(/^- \[ \]\s+(.+)/);
    if (match) {
      const item = match[1].replace(/\s*\(.*?\)\s*$/, "").trim();
      if (currentSection.includes("High") && focus.length < 3) {
        focus.push(item);
      }
    }
  }

  // If no high-priority items, take first 3 open items from anywhere
  if (focus.length === 0) {
    for (const line of lines) {
      const match = line.match(/^- \[ \]\s+(.+)/);
      if (match && focus.length < 3) {
        focus.push(match[1].replace(/\s*\(.*?\)\s*$/, "").trim());
      }
    }
  }

  // Blockers: only trust explicit "BLOCKER" or "blocked" mentions in TODO
  for (const line of lines) {
    if (/block(er|ed|ing)/i.test(line) && line.match(/^- \[ \]/)) {
      blockers.push(line.replace(/^- \[ \]\s*/, "").trim());
    }
  }

  return { focus, blockers };
}

interface ActiveThread {
  id: string;
  task: string;
  status: string;
}

async function getActiveThreads(): Promise<ActiveThread[]> {
  const todo = await readText(path.join(WORKSPACE, "TODO.md"));
  const threads: ActiveThread[] = [];

  const lines = todo.split("\n");
  for (const line of lines) {
    const match = line.match(/^- \[ \]\s+(.+)/);
    if (match && threads.length < 5) {
      const task = match[1].replace(/\s*\(.*?\)\s*$/, "").trim();
      threads.push({ id: `T${threads.length + 1}`, task, status: "open" });
    }
  }

  return threads;
}

async function getShiftInfo(): Promise<{ mode: string; strategy: string }> {
  const config = await readJson(path.join(WORKSPACE, "memory", "shift-config.json"));
  return {
    mode: config?.mode || "Builder",
    strategy: config?.strategy || "Continuous State",
  };
}

// ─── Builder ─────────────────────────────────────────────────────────────────

async function buildState(): Promise<string> {
  log("Reading sources...");

  const [hb, priorities, threads, shift] = await Promise.all([
    getHeartbeatHealth(),
    getPriorities(),
    getActiveThreads(),
    getShiftInfo(),
  ]);

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
    `**Status:** RUNNING`,
    "",
    "---",
    "",
    "## Current Focus",
    "",
  ];

  if (priorities.focus.length > 0) {
    for (const f of priorities.focus) {
      lines.push(`1. ${f}`);
    }
  } else {
    lines.push("No active priorities detected. Check TODO.md.");
  }

  lines.push("");
  lines.push("## Blockers");
  lines.push("");

  if (priorities.blockers.length > 0) {
    for (const b of priorities.blockers) {
      lines.push(`- ${b}`);
    }
  } else {
    lines.push("None.");
  }

  lines.push("");
  lines.push("## Active Threads");
  lines.push("");

  if (threads.length > 0) {
    for (const t of threads) {
      lines.push(`- **${t.id}:** ${t.task}`);
    }
  } else {
    lines.push("No open threads.");
  }

  lines.push("");
  lines.push("## System Health");
  lines.push("");
  lines.push(`- Heartbeat: ${hbStatus} (${hbFresh})`);
  lines.push(`- Master Index: see Notion Dashboard`);
  lines.push(`- Cron: 12 jobs active (Australia/Sydney)`);

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("*Auto-generated. Do not edit manually. Source: `scripts/refresh-state.ts`*");
  lines.push("*Detailed tracking: TODO.md | Dashboard: Notion | History: CHANGELOG.md*");
  lines.push("");

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

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
