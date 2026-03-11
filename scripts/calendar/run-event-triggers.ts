#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { fetchUpcomingEvents } from "../lib/calendar-events.js";
import { logEvent } from "../lib/event-logger.js";
import { sendToTopic } from "../lib/telegram-notify.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR ||
  path.join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const STATE_PATH = path.join(WORKSPACE, "state/upcoming-triggers.json");

interface TriggerState {
  sent: Record<string, string>; // key -> iso sent
}

function readState(): TriggerState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { sent: {} };
  }
}

function saveState(s: TriggerState) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(s, null, 2)}\n`);
}

function minutesUntil(iso: string): number {
  return Math.floor((Date.parse(iso) - Date.now()) / 60000);
}

function bucket(mins: number): "24h" | "2h" | "30m" | null {
  if (mins <= 24 * 60 && mins > 24 * 60 - 30) {
    return "24h";
  }
  if (mins <= 120 && mins > 90) {
    return "2h";
  }
  if (mins <= 30 && mins > 10) {
    return "30m";
  }
  return null;
}

function main() {
  const state = readState();
  const events = fetchUpcomingEvents(3);

  let sent = 0;
  for (const e of events) {
    const mins = minutesUntil(e.start);
    const b = bucket(mins);
    if (!b) {
      continue;
    }

    const key = `${e.account}|${e.id}|${b}`;
    if (state.sent[key]) {
      continue;
    }

    const ok = sendToTopic(
      "general",
      `⏰ <b>Calendar reminder (${b})</b>\n• ${e.summary}\n• ${e.start}\n• ${e.account}`,
      "HTML",
    );
    if (ok) {
      state.sent[key] = new Date().toISOString();
      sent++;
    }
  }

  saveState(state);
  logEvent({
    source: "calendar-triggers",
    action: "run",
    result: "ok",
    detail: `events=${events.length} reminders_sent=${sent}`,
  });

  console.log(JSON.stringify({ events: events.length, sent }, null, 2));
}

main();
