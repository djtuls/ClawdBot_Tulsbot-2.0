#!/usr/bin/env bun
/**
 * Discord Indexer
 * Polls Discord channels and indexes messages to memory
 *
 * Every message: Idea → Planning → PRD → Tasks → Done OR Log Only
 *
 * Usage: pnpm tsx scripts/discord-indexer.ts
 */

import { config as loadEnv } from "dotenv";
import { writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const WORKSPACE = join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
loadEnv({ path: join(WORKSPACE, ".env") });
const MEMORY_DISCORD = join(WORKSPACE, "memory", "Discord");

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";

// Channels to monitor
const CHANNELS = [
  { id: "1476394151300956250", name: "daily-standup" },
  { id: "1476394231726735431", name: "builder" },
  { id: "1476394237590372412", name: "tulsday" },
  { id: "1476394239679267018", name: "researcher" },
  { id: "1476394148033597480", name: "bugs" },
  { id: "1476394064659349557", name: "research" },
];

// Action item keywords
const ACTION_KEYWORDS = [
  "todo",
  "task",
  "bug",
  "feature",
  "request",
  "fix",
  "create",
  "add",
  "implement",
  "build",
  "deploy",
  "need to",
  "should",
  "must",
  "urgent",
  "priority",
  "blocked",
  "waiting on",
  "review",
  "prd",
  "spec",
];

// Workflow channels
const WORKFLOW_CHANNELS = {
  prd: "1476422032878076066",
  tasks: "1476422035210113055",
  backlog: "1476422040591274075",
  requests: "1476422037747798116",
};

interface Message {
  id: string;
  channel_id: string;
  author: { username: string; bot: boolean };
  content: string;
  timestamp: string;
}

function isActionItem(content: string): boolean {
  const lower = content.toLowerCase();
  return ACTION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function fetchMessages(channelId: string, limit = 10): Promise<Message[]> {
  const { execSync } = await import("child_process");
  try {
    const result = execSync(
      `curl -s -H "Authorization: Bot ${TOKEN}" "https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}"`,
      { encoding: "utf-8" },
    );
    return JSON.parse(result);
  } catch {
    return [];
  }
}

async function sendToChannel(channelId: string, content: string): Promise<void> {
  const { execSync } = await import("child_process");
  try {
    execSync(
      `curl -s -X POST -H "Authorization: Bot ${TOKEN}" -H "Content-Type: application/json" -d '{"content": "${content.replace(/"/g, '\\"')}"}' "https://discord.com/api/v10/channels/${channelId}/messages"`,
      { stdio: "pipe" },
    );
  } catch {
    console.log("Failed to send to channel:", channelId);
  }
}

function classifyMessage(msg: Message): "action" | "log" {
  if (msg.author.bot) {
    return "log";
  }
  if (isActionItem(msg.content)) {
    return "action";
  }
  return "log";
}

async function processChannel(channel: {
  id: string;
  name: string;
}): Promise<{ action: number; log: number }> {
  const messages = await fetchMessages(channel.id);
  let action = 0,
    log = 0;

  for (const msg of messages) {
    const type = classifyMessage(msg);

    // Save to daily note
    const today = new Date().toISOString().split("T")[0];
    const dailyPath = join(MEMORY_DISCORD, `${today}.md`);

    if (!existsSync(join(MEMORY_DISCORD, today))) {
      mkdirSync(join(MEMORY_DISCORD, today), { recursive: true });
    }

    const entry = `[${msg.timestamp}] #${channel.name} (${type}): ${msg.author.username}: ${msg.content.slice(0, 200)}\n`;

    if (existsSync(dailyPath)) {
      appendFileSync(dailyPath, entry);
    } else {
      writeFileSync(dailyPath, `# Discord - ${today}\n\n${entry}`);
    }

    if (type === "action") {
      action++;
      // Forward to requests channel for triage
      await sendToChannel(
        WORKFLOW_CHANNELS.requests,
        `**Action Item from #${channel.name}:**\n${msg.content.slice(0, 500)}`,
      );
    } else {
      log++;
    }
  }

  return { action, log };
}

async function runIndexer(): Promise<void> {
  console.log("🔍 Running Discord Indexer...\n");

  let totalAction = 0,
    totalLog = 0;

  for (const channel of CHANNELS) {
    const result = await processChannel(channel);
    console.log(`  #${channel.name}: ${result.action} action, ${result.log} log`);
    totalAction += result.action;
    totalLog += result.log;
  }

  console.log(`\n✅ Indexed: ${totalAction} action items, ${totalLog} log entries`);

  // Report to system-status
  await sendToChannel(
    "1469735004459368562",
    `**📥 Discord Indexer**\nChannels: ${CHANNELS.length}\nAction items: ${totalAction}\nLog entries: ${totalLog}\n${new Date().toLocaleString()}`,
  );
}

runIndexer().catch(console.error);
