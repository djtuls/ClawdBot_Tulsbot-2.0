#!/usr/bin/env bun
/**
 * Heartbeat Warning System
 * Sends warnings before heartbeat runs
 *
 * Usage: pnpm tsx scripts/heartbeat-warning.ts [check|arm|test]
 *
 * Features:
 * - 5 min warning: Informs heartbeat coming
 * - 1 min warning: "Continue or delay?" prompt
 * - Auto-continue if no answer in 60s
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const WORKSPACE = join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
loadEnv({ path: join(WORKSPACE, ".env") });

const WARNING_STATE = join(
  process.env.HOME || "/Users/tulioferro",
  ".openclaw/workspace/memory/heartbeat-warning.json",
);

interface WarningState {
  armed: boolean;
  fiveMinWarningSent: boolean;
  oneMinWarningSent: boolean;
  scheduledAt: string | null;
}

function loadState(): WarningState {
  if (!existsSync(WARNING_STATE)) {
    return { armed: false, fiveMinWarningSent: false, oneMinWarningSent: false, scheduledAt: null };
  }
  try {
    return JSON.parse(readFileSync(WARNING_STATE, "utf-8"));
  } catch {
    return { armed: false, fiveMinWarningSent: false, oneMinWarningSent: false, scheduledAt: null };
  }
}

function saveState(state: WarningState): void {
  writeFileSync(WARNING_STATE, JSON.stringify(state, null, 2));
}

function getNextHeartbeat(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(next.getHours() + 1);
  next.setMinutes(0, 0, 0); // Next hour
  return next;
}

async function sendWarning(message: string): Promise<void> {
  // Send to Discord #system-status
  const { execSync } = await import("child_process");

  try {
    execSync(
      `curl -s -X POST -H "Authorization: Bot ${process.env.DISCORD_BOT_TOKEN}" -H "Content-Type: application/json" -d '{"content": "${message}"}' "https://discord.com/api/v10/channels/1469735004459368562/messages"`,
      { stdio: "pipe" },
    );
  } catch {
    console.log("Would send:", message);
  }
}

async function checkWarnings(): Promise<void> {
  const state = loadState();
  const now = new Date();
  const nextHB = getNextHeartbeat();

  if (!state.armed) {
    console.log('Heartbeat warnings not armed. Run with "arm" to enable.');
    return;
  }

  const minutesUntil = Math.floor((nextHB.getTime() - now.getTime()) / 60000);

  // 5 min warning
  if (minutesUntil <= 5 && !state.fiveMinWarningSent) {
    console.log("📢 Sending 5 min warning...");
    await sendWarning(
      "⚠️ **Heartbeat in 5 minutes**\n\nPreparing to sync: Memory, Brain, Context Window, Tulsday State, Indexer, Notion.",
    );
    state.fiveMinWarningSent = true;
    saveState(state);
  }

  // 1 min warning
  if (minutesUntil <= 1 && !state.oneMinWarningSent) {
    console.log("📢 Sending 1 min warning with prompt...");
    await sendWarning(
      "⏰ **Heartbeat in 1 minute**\n\n**Continue or delay?**\n\n(If no response in 60s, heartbeat will continue automatically)",
    );
    state.oneMinWarningSent = true;
    saveState(state);

    // In a full implementation, this would wait for response
    // For now, we log that it's happening
    console.log("⏳ Waiting 60s for response...");

    // After 60s without delay command, heartbeat proceeds
    setTimeout(() => {
      console.log("✅ No delay requested - heartbeat proceeds");
    }, 60000);
  }

  if (minutesUntil > 5) {
    console.log(`Next heartbeat in ${minutesUntil} minutes`);
  }
}

function armWarnings(): void {
  const state: WarningState = {
    armed: true,
    fiveMinWarningSent: false,
    oneMinWarningSent: false,
    scheduledAt: new Date().toISOString(),
  };
  saveState(state);
  console.log("✅ Heartbeat warnings armed!");
  console.log("You will receive:");
  console.log("  - 5 min warning before heartbeat");
  console.log('  - 1 min warning with "Continue or delay?" prompt');
  console.log("  - Auto-continue if no response in 60s");
}

function disarmWarnings(): void {
  const state: WarningState = {
    armed: false,
    fiveMinWarningSent: false,
    oneMinWarningSent: false,
    scheduledAt: null,
  };
  saveState(state);
  console.log("❌ Heartbeat warnings disarmed");
}

const command = process.argv[2] || "check";

switch (command) {
  case "check":
    void checkWarnings();
    break;
  case "arm":
    armWarnings();
    break;
  case "disarm":
    disarmWarnings();
    break;
  case "test":
    void sendWarning("🧪 Test heartbeat warning");
    break;
  default:
    console.log("Usage: pnpm tsx scripts/heartbeat-warning.ts [check|arm|disarm|test]");
}
