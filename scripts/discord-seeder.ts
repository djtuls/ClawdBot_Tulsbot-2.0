#!/usr/bin/env bun
/**
 * Discord Seeder - Populate Discord with all existing content
 *
 * Seeds:
 * - PRDs from memory/PRD/
 * - Tasks from STATE.md
 * - Projects overview
 * - Channel contexts
 * - Current status
 *
 * Usage: pnpm tsx scripts/discord-seeder.ts
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const WORKSPACE = join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
loadEnv({ path: join(WORKSPACE, ".env") });
const MEMORY_DIR = join(WORKSPACE, "memory");

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";

const CHANNELS = {
  prd: "1476422032878076066",
  tasks: "1476422035210113055",
  requests: "1476422037747798116",
  backlog: "1476422040591274075",
  systemStatus: "1469735004459368562",
  builder: "1476394231726735431",
  tulsday: "1476394237590372412",
  dailyStandup: "1476394151300956250",
};

async function sendDiscord(channelId: string, content: string): Promise<void> {
  const { execSync } = await import("child_process");
  try {
    execSync(
      `curl -s -X POST -H "Authorization: Bot ${TOKEN}" -H "Content-Type: application/json" -d '{"content": "${content.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"}' "https://discord.com/api/v10/channels/${channelId}/messages"`,
      { stdio: "pipe" },
    );
  } catch (e) {
    console.log(`Failed to send to ${channelId}:`, e);
  }
}

function getPRDFiles(): string[] {
  const prdDir = join(MEMORY_DIR, "PRD");
  if (!existsSync(prdDir)) {
    return [];
  }
  return readdirSync(prdDir).filter((f) => f.endsWith(".md"));
}

function getActiveTasks(): string[] {
  const statePath = join(WORKSPACE, "STATE.md");
  if (!existsSync(statePath)) {
    return [];
  }

  const content = readFileSync(statePath, "utf-8");
  const tasks: string[] = [];

  // Extract tasks from STATE.md
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes("| 🟡") || line.includes("| 🔴")) {
      tasks.push(line);
    }
  }
  return tasks;
}

async function seedPRDs(): Promise<void> {
  console.log("📄 Seeding PRDs...\n");
  const prds = getPRDFiles();

  if (prds.length === 0) {
    await sendDiscord(
      CHANNELS.prd,
      "📭 No PRDs found yet. Create first PRD with `/builder` command.",
    );
    return;
  }

  let msg = `**📋 PRDs (${prds.length})**\n─────────────────────\n`;

  for (const prd of prds.slice(0, 10)) {
    const content = readFileSync(join(MEMORY_DIR, "PRD", prd), "utf-8");
    const title = content.split("\n")[0].replace("# ", "").slice(0, 50);
    msg += `• ${title}\n`;
  }

  if (prds.length > 10) {
    msg += `\n*...and ${prds.length - 10} more in memory/PRD/*`;
  }

  msg += "\n─────────────────────";
  await sendDiscord(CHANNELS.prd, msg);
}

async function seedTasks(): Promise<void> {
  console.log("✅ Seeding Tasks...");
  const tasks = getActiveTasks();

  if (tasks.length === 0) {
    await sendDiscord(CHANNELS.tasks, "📭 No active tasks. All clear!");
    return;
  }

  let msg = `**🎯 Active Tasks (${tasks.length})**\n─────────────────────\n`;

  for (const task of tasks.slice(0, 10)) {
    msg += `${task}\n`;
  }

  msg += "\n─────────────────────";
  await sendDiscord(CHANNELS.tasks, msg);
}

async function seedBacklog(): Promise<void> {
  console.log("📦 Seeding Backlog...");

  const msg = `**📦 Backlog**\n─────────────────────
• Discord bot token refresh needed
• QMD + PARA setup
• Fly.io deployment
• Subagent spawning enable
• Slack webhook configuration
─────────────────────`;

  await sendDiscord(CHANNELS.backlog, msg);
}

async function seedSystemStatus(): Promise<void> {
  console.log("📊 Seeding System Status...");

  // Read heartbeat state
  const hbPath = join(MEMORY_DIR, "heartbeat-state.json");
  let lastRun = "Never";
  let status = "Unknown";

  if (existsSync(hbPath)) {
    try {
      const hb = JSON.parse(readFileSync(hbPath, "utf-8"));
      lastRun = new Date(hb.lastRun).toLocaleString();
      status = "OK";
    } catch {}
  }

  const msg = `**🤖 Tulsbot System Status**
─────────────────────
**Last Heartbeat:** ${lastRun}
**Status:** ${status}
**OpenClaw:** 2026.2.24
**Supabase:** 1416 items indexed
**Context:** 0% (compacted)

**Active Agents:**
• builder (orchestrator)
• tulsday (context manager)
• system-monitor (hourly audit)

**Quick Links:**
• Daily Notes: \`memory/YYYY-MM-DD.md\`
• PRDs: #prd
• Tasks: #tasks
• Backlog: #backlog

─────────────────────
*Use /builder or /tulsday to switch modes*`;

  await sendDiscord(CHANNELS.systemStatus, msg);
}

async function seedTulsday(): Promise<void> {
  console.log("📅 Seeding Tulsday Channel...");

  const msg = `**📅 Tulsday - Context Manager**
─────────────────────
**Responsibilities:**
• Morning: Create day planner → #daily-standup
• Day: Inbox capture, HITL recording
• Evening: Daily report, archive processed items

**Today's Status:**
• Day Planner: Run \`morning\`
• Inbox: Checked hourly
• Daily Report: Run \`evening\`

**Commands:**
• \`pnpm tsx scripts/tulsday-planner.ts morning\`
• \`pnpm tsx scripts/tulsday-planner.ts day\`
• \`pnpm tsx scripts/tulsday-planner.ts evening\`

─────────────────────
*Part of heartbeat (Step 10)*`;

  await sendDiscord(CHANNELS.tulsday, msg);
}

async function seedDailyStandup(): Promise<void> {
  console.log("🌅 Seeding Daily Standup...");

  const today = new Date().toISOString().split("T")[0];
  const dailyNotePath = join(MEMORY_DIR, `${today}.md`);

  let content = "No notes yet";
  if (existsSync(dailyNotePath)) {
    content = readFileSync(dailyNotePath, "utf-8").slice(0, 500);
  }

  const msg = `**🌅 Daily Standup - ${today}**
─────────────────────
${content}

─────────────────────
*Managed by Tulsday*`;

  await sendDiscord(CHANNELS.dailyStandup, msg);
}

async function seedBuilder(): Promise<void> {
  console.log("🏗️ Seeding Builder Channel...");

  const msg = `**🏗️ Builder - Master Orchestrator**
─────────────────────
**Responsibilities:**
• Architecture decisions
• Spawning subagents
• Code review
• Repo integrity
• System design

**Current Projects:**
• SECRETS-VAULT (complete)
• Discord Workflow (in progress)
• Tulsday Workflow (in progress)
• PARA Organization (pending)

**Commands:**
• \`/builder\` - Switch to builder mode
• \`/tulsday\` - Switch to tulsday mode

─────────────────────
*Use /builder to activate*`;

  await sendDiscord(CHANNELS.builder, msg);
}

async function runSeeder(): Promise<void> {
  console.log("🌱 Discord Seeder - Starting...\n");

  await seedSystemStatus();
  await new Promise((r) => setTimeout(r, 500));

  await seedBuilder();
  await new Promise((r) => setTimeout(r, 500));

  await seedTulsday();
  await new Promise((r) => setTimeout(r, 500));

  await seedPRDs();
  await new Promise((r) => setTimeout(r, 500));

  await seedTasks();
  await new Promise((r) => setTimeout(r, 500));

  await seedBacklog();
  await new Promise((r) => setTimeout(r, 500));

  await seedDailyStandup();

  console.log("\n✅ Discord seeding complete!");
}

runSeeder().catch(console.error);
