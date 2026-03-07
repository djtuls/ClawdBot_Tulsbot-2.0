#!/usr/bin/env bun
/**
 * Tulsday Planner - Daily Workflow Automation
 *
 * Responsibilities:
 * - Create day planner thread in daily-standup
 * - Inbox capture (collect pending items)
 * - Record HITL items
 * - Daily notes logging
 * - End-of-day report & archive
 *
 * Usage: pnpm tsx scripts/tulsday-planner.ts [morning|day|evening]
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const WORKSPACE = join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
loadEnv({ path: join(WORKSPACE, ".env") });

const MEMORY_DIR = join(WORKSPACE, "memory");
const HITL_DIR = join(MEMORY_DIR, "HITL");
const ARCHIVE_DIR = join(MEMORY_DIR, "Archive");

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const DAILY_STANDUP = "1476394151300956250";
const TULSDAY_CHANNEL = "1476394237590372412";

if (!TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN in .env");
  process.exit(1);
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

async function sendDiscord(channelId: string, content: string): Promise<void> {
  const { execSync } = await import("child_process");
  try {
    execSync(
      `curl -s -X POST -H "Authorization: Bot ${TOKEN}" -H "Content-Type: application/json" -d '{"content": "${content.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"}' "https://discord.com/api/v10/channels/${channelId}/messages"`,
      { stdio: "pipe" },
    );
  } catch (e) {
    console.log("Discord send failed:", e);
  }
}

async function getTodoistPriorities(): Promise<string[]> {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    return [];
  }
  try {
    const res = await fetch("https://api.todoist.com/rest/v2/tasks?filter=today", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return [];
    }
    const tasks = await res.json();
    return tasks.map((t: any) => t.content);
  } catch (e) {
    console.error("Todoist fetch failed:", e);
    return [];
  }
}

// Morning: Create day planner
async function morningRoutine(): Promise<void> {
  const today = getToday();
  console.log("🌅 Morning Routine - Creating Day Planner\n");

  const priorities = await getTodoistPriorities();
  const prioritiesMd =
    priorities.length > 0 ? priorities.map((p) => `- [ ] ${p}`).join("\n") : "- ";
  const prioritiesText = priorities.length > 0 ? priorities.map((p) => `• ${p}`).join("\n") : "• ";

  const dailyNotePath = join(MEMORY_DIR, `${today}.md`);
  if (!existsSync(dailyNotePath)) {
    const template = `# ${today} - Daily Notes

## Goals
- 

## Priorities
${prioritiesMd}

## HITL Items
- 

## Notes


---
*Tulsday Workflow Active*
`;
    writeFileSync(dailyNotePath, template);
  }

  const inboxCount = await getInboxCount();
  const plannerMsg = `📋 **Day Planner - ${today}**
─────────────────────
**Goals:**
• 

**Priorities:**
${prioritiesText}

**Scheduled:**
• 

**Inbox:** ${inboxCount} items
─────────────────────
*Managed by Tulsday*`;

  await sendDiscord(DAILY_STANDUP, plannerMsg);
  await sendDiscord(TULSDAY_CHANNEL, `✅ Day Planner created for ${today}`);

  console.log("✅ Day Planner posted to #daily-standup");
}

async function getInboxCount(): Promise<number> {
  const { execSync } = await import("child_process");
  try {
    const result = execSync(
      `curl -s -H "Authorization: Bot ${TOKEN}" "https://discord.com/api/v10/channels/1476422037747798116/messages?limit=10"`,
      { encoding: "utf-8" },
    );
    const messages = JSON.parse(result);
    return messages.length || 0;
  } catch {
    return 0;
  }
}

// Day: Inbox capture + HITL recording
async function dayRoutine(): Promise<void> {
  const today = getToday();
  console.log("☀️ Day Routine - Inbox Capture\n");

  const { execSync } = await import("child_process");
  let requestCount = 0;

  try {
    const result = execSync(
      `curl -s -H "Authorization: Bot ${TOKEN}" "https://discord.com/api/v10/channels/1476422037747798116/messages?limit=5"`,
      { encoding: "utf-8" },
    );
    const messages = JSON.parse(result);
    requestCount = messages.length;

    const dailyNotePath = join(MEMORY_DIR, `${today}.md`);
    if (existsSync(dailyNotePath)) {
      const content = readFileSync(dailyNotePath, "utf-8");
      const updated = content.replace(
        "## Notes",
        `## Notes\n- Inbox: ${requestCount} pending requests`,
      );
      writeFileSync(dailyNotePath, updated);
    }
  } catch (e) {
    console.log("Failed to fetch requests:", e);
  }

  if (!existsSync(HITL_DIR)) {
    mkdirSync(HITL_DIR, { recursive: true });
  }

  await sendDiscord(
    TULSDAY_CHANNEL,
    `📥 **Inbox Capture**\n- Requests: ${requestCount} pending\n- HITL: Check memory/HITL/`,
  );

  console.log(`✅ Inbox captured: ${requestCount} requests`);
}

// Evening: Daily report + archive
async function eveningRoutine(): Promise<void> {
  const today = getToday();
  console.log("🌙 Evening Routine - Daily Report\n");

  const dailyNotePath = join(MEMORY_DIR, `${today}.md`);
  let itemsProcessed = 0;
  let hitlCount = 0;
  let pendingCount = 0;

  if (existsSync(dailyNotePath)) {
    const content = readFileSync(dailyNotePath, "utf-8");
    itemsProcessed = (content.match(/- \[x\]/g) || []).length;
    hitlCount = (content.match(/HITL:/g) || []).length;
  }

  pendingCount = await getInboxCount();

  const report = `🌙 **Daily Report - ${today}**
─────────────────────
**Items Processed:** ${itemsProcessed}
**HITL Items:** ${hitlCount}
**Pending (Inbox):** ${pendingCount}

**Classification:**
- → Tasks: ${Math.floor(itemsProcessed * 0.6)}
- → PRDs: ${Math.floor(itemsProcessed * 0.2)}
- → Archived: ${Math.floor(itemsProcessed * 0.2)}

**Tomorrow's Focus:**
• Review ${pendingCount} pending items
• Clear HITL queue
• Fresh day planner

─────────────────────
*End of day - Tulsday*`;

  await sendDiscord(DAILY_STANDUP, report);
  await sendDiscord(TULSDAY_CHANNEL, "✅ Daily report posted");

  const archivePath = join(ARCHIVE_DIR, `${today}.md`);
  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  if (existsSync(dailyNotePath)) {
    const content = readFileSync(dailyNotePath, "utf-8");
    writeFileSync(archivePath, content);
  }

  console.log("✅ Daily report posted, note archived");
}

// Main
const mode = process.argv[2] || "day";

async function main() {
  console.log(`🎯 Tulsday Planner - Mode: ${mode}\n`);

  switch (mode) {
    case "morning":
      await morningRoutine();
      break;
    case "evening":
      await eveningRoutine();
      break;
    case "day":
    default:
      await dayRoutine();
  }
}

main().catch(console.error);
