#!/usr/bin/env tsx

/**
 * Context Report Generator
 *
 * Generates morning and evening context reports with:
 * - Vision/Goal
 * - Code State (health, recent changes)
 * - Recap of work
 * - Master TODO tracking
 *
 * Usage:
 *   bun scripts/context-report.ts morning
 *   bun scripts/context-report.ts evening
 */

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

async function readFile(file: string): Promise<string> {
  try {
    return await fs.readFile(path.join(PROJECT_ROOT, file), "utf-8");
  } catch {
    return "";
  }
}

async function getGitStatus(): Promise<string> {
  try {
    const branch = execSync("git branch --show-current", { cwd: PROJECT_ROOT }).toString().trim();
    const ahead = execSync("git rev-list --count @{u}..HEAD 2>/dev/null || echo 0", {
      cwd: PROJECT_ROOT,
    })
      .toString()
      .trim();
    const behind = execSync("git rev-list HEAD..@{u} 2>/dev/null || echo 0", { cwd: PROJECT_ROOT })
      .toString()
      .trim();
    return `${branch} (↑${ahead} ↓${behind})`;
  } catch {
    return "unknown";
  }
}

async function getRecentCommits(days: number = 1): Promise<string[]> {
  try {
    const out = execSync(
      `git log --since="${days} days ago" --oneline --format="%h %s" | head -10`,
      { cwd: PROJECT_ROOT },
    ).toString();
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function getSystemHealth(): Promise<Record<string, string>> {
  const health: Record<string, string> = {};

  try {
    const status = execSync("openclaw gateway status 2>&1", { encoding: "utf-8" });
    health.gateway = status.includes("running") || status.includes("online") ? "✅" : "❌";
  } catch {
    health.gateway = "❌";
  }

  try {
    const hbState = await fs.readFile(
      path.join(PROJECT_ROOT, "memory", "heartbeat-state.json"),
      "utf-8",
    );
    const hb = JSON.parse(hbState);
    const lastRun = new Date(hb.lastRun);
    const age = Date.now() - lastRun.getTime();
    health.heartbeat = age < 7200000 ? "✅" : "⚠️";
  } catch {
    health.heartbeat = "❓";
  }

  return health;
}

async function generateReport(type: "morning" | "evening"): Promise<string> {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const vision = await readFile("VISION_GOALS.md");
  const state = await readFile("STATE.md");
  const gitStatus = await getGitStatus();
  const commits = await getRecentCommits(1);
  const health = await getSystemHealth();

  // Extract key sections from STATE.md
  const currentFocusMatch = state.match(/## 🎯 Current Focus\n([\s\S]*?)##/);
  const masterTodoMatch = state.match(/## 📋 MASTER TODO LIST[\s\S]*?(?=##|$)/);

  const report = `
═══════════════════════════════════════════════════════════════
📊 TULSBOT CONTEXT REPORT — ${type.toUpperCase()}
${date} @ ${time}
═══════════════════════════════════════════════════════════════

🎯 VISION & GOAL
───────────────────────────────────────────────────────────────
${vision.slice(0, 800) || "See VISION_GOALS.md"}

🏗️ CODE STATE
───────────────────────────────────────────────────────────────
Branch: ${gitStatus}
Health: Gateway ${health.gateway} | Heartbeat ${health.heartbeat}

📝 TODAY'S COMMITS
───────────────────────────────────────────────────────────────
${commits.length > 0 ? commits.map((c) => `• ${c}`).join("\n") : "No commits today"}

📋 MASTER TODO
───────────────────────────────────────────────────────────────
${masterTodoMatch ? masterTodoMatch[0].slice(0, 1000) : "See MASTER_BACKLOG.md"}

🎯 CURRENT FOCUS
───────────────────────────────────────────────────────────────
${currentFocusMatch ? currentFocusMatch[1].trim() : "See STATE.md"}

═══════════════════════════════════════════════════════════════
`;

  return report;
}

// CLI
const type = (process.argv[2] as "morning" | "evening") || "morning";
const report = await generateReport(type);
console.log(report);

// Optionally send to user (via Telegram if configured)
console.log(
  '\n📤 To send via Telegram, use: message action=send target=ferro.tulio@gmail.com message="<report>"',
);
