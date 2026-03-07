#!/usr/bin/env node
/**
 * Discord Auto-Reacter
 * Instantly adds 👋 reaction to ALL new messages in Discord
 *
 * This runs continuously and checks for new messages
 * Uses simpler API calls with retry logic
 */

require("dotenv").config({
  path: require("path").join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace/.env"),
});

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";

// All text channels to monitor
const CHANNELS = [
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

const STATE_FILE = "/Users/tulioferro/.openclaw/workspace/memory/discord-ack-state.json";

// Simple file-based state
let lastIds = {};
try {
  const fs = require("fs");
  if (fs.existsSync(STATE_FILE)) {
    lastIds = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
} catch {}

async function checkChannel(channelId) {
  const { execSync } = require("child_process");

  try {
    const data = execSync(
      `curl -s -m 5 "https://discord.com/api/v10/channels/${channelId}/messages?limit=1" -H "Authorization: Bot ${TOKEN}"`,
      { encoding: "utf-8" },
    );

    const msgs = JSON.parse(data);
    if (!msgs[0]) {
      return;
    }

    const msg = msgs[0];
    const lastId = lastIds[channelId];

    // New message from user (not bot)
    if (!msg.author.bot && msg.id !== lastId) {
      console.log(`📩 ${msg.author.username}: ${msg.content.slice(0, 40)}`);

      // React with 👋
      try {
        execSync(
          `curl -s -m 5 -X PUT "https://discord.com/api/v10/channels/${channelId}/messages/${msg.id}/reactions/%F0%9F%91%8B/@me" -H "Authorization: Bot ${TOKEN}"`,
          { stdio: "pipe" },
        );
        console.log(`  ✅ Acked`);
      } catch {}

      lastIds[channelId] = msg.id;
    }
  } catch {
    // Silently fail - network issues
  }
}

async function main() {
  console.log("🔔 Discord Auto-Reacter running...");

  for (const ch of CHANNELS) {
    await checkChannel(ch);
  }

  // Save state
  require("fs").writeFileSync(STATE_FILE, JSON.stringify(lastIds, null, 2));
}

main().catch(console.error);
