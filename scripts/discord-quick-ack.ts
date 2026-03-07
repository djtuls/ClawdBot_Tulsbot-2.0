#!/usr/bin/env bun
/**
 * Discord Quick Ack
 * Instantly acknowledges new messages in monitored channels
 *
 * Run as: pnpm tsx scripts/discord-quick-ack.ts
 * Or continuous: while true; do pnpm tsx scripts/discord-quick-ack.ts; sleep 5; done
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const WORKSPACE = join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
loadEnv({ path: join(WORKSPACE, ".env") });

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";

const MONITORED_CHANNELS = [
  "1476394151300956250", // daily-standup
  "1476422037747798116", // requests
  "1476394231726735431", // builder
  "1476394237590372412", // tulsday
  "1476394148033597480", // bugs
  "1476394064659349557", // research
  "1476407521068580937", // inft-general
  "1476407525816668311", // personal-general
  "1476407532086886481", // live-general
  "1476407538776932403", // cta-general
];

const STATE_FILE = join(WORKSPACE, "memory/discord-ack-state.json");

interface AckState {
  lastMessageId: { [channel: string]: string };
}

function loadState(): AckState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    } catch {}
  }
  return { lastMessageId: {} };
}

function saveState(state: AckState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getLatestMessage(
  channelId: string,
): Promise<{ id: string; author: { username: string; bot: boolean }; content: string } | null> {
  const { execSync } = await import("child_process");
  try {
    const result = execSync(
      `curl -s -H "Authorization: Bot ${TOKEN}" "https://discord.com/api/v10/channels/${channelId}/messages?limit=1"`,
      { encoding: "utf-8" },
    );
    const msgs = JSON.parse(result);
    if (!msgs[0]) {
      return null;
    }
    return msgs[0];
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message.slice(0, 30) : "unknown";
    // Only surface errors — not routine per-channel fetches
    console.error(`\u{274C} ${channelId.slice(-4)}: ${message}`);
    return null;
  }
}

async function sendAck(channelId: string, _content: string): Promise<void> {
  const { execSync } = await import("child_process");
  try {
    execSync(
      `curl -s -X POST -H "Authorization: Bot ${TOKEN}" -H "Content-Type: application/json" -d '{"content": "\u{1F44D} Received"}' "https://discord.com/api/v10/channels/${channelId}/messages"`,
      { stdio: "pipe", timeout: 10 },
    );
  } catch {}
}

async function processChannel(channelId: string, state: AckState): Promise<boolean> {
  const msg = await getLatestMessage(channelId);
  if (!msg) {
    return false;
  }

  const isNew = state.lastMessageId[channelId] !== msg.id;
  state.lastMessageId[channelId] = msg.id;

  if (!isNew || msg.author.bot) {
    return false;
  }

  console.log(
    `\u{1F4E9} New message in ${channelId.slice(-4)}: ${msg.author.username} — ${msg.content.slice(0, 60)}`,
  );
  await sendAck(channelId, "\u{1F44D} Received");

  return true;
}

async function runQuickAck(): Promise<void> {
  const verbose = process.argv.includes("--verbose");
  if (verbose) {
    console.log("\u{1F514} Quick Ack checking...");
  }

  const state = loadState();
  let newMessages = false;

  for (const channelId of MONITORED_CHANNELS) {
    const changed = await processChannel(channelId, state);
    if (changed) {
      newMessages = true;
    }
  }

  saveState(state);
  if (newMessages) {
    console.log("\u{2705} Acknowledged new messages");
  } else if (verbose) {
    console.log("\u{1F634} No new messages");
  }
}

runQuickAck().catch(() => {});
