#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { logEvent } from "../lib/event-logger.js";
import { sendToTopic } from "../lib/telegram-notify.js";
import { linkSignalFromPending } from "../vault/link-signal.js";
import { listRecentRecordings, getTranscriptRaw } from "./plaud-client.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR ||
  path.join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const STATE_PATH = path.join(WORKSPACE, "state", "plaud-last-scan.json");

interface PlaudState {
  lastStartTime: number;
  seenIds: string[];
}

function readState(): PlaudState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastStartTime: 0, seenIds: [] };
  }
}

function writeState(state: PlaudState) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

async function main() {
  const state = readState();
  const recs = await listRecentRecordings(30);

  const fresh = recs.filter(
    (r) => r.start_time > state.lastStartTime && !state.seenIds.includes(r.id),
  );
  let linked = 0;

  for (const r of fresh) {
    const transcript = await getTranscriptRaw(r.id);
    const snippet = transcript
      ? transcript.slice(0, 1200)
      : `Plaud recording detected. Transcript endpoint still pending discovery. duration=${Math.round(r.duration / 1000)}s is_trans=${r.is_trans}`;

    linkSignalFromPending({
      id: `plaud:${r.id}`,
      source: "plaud",
      subject: `Plaud recording ${r.filename}`,
      snippet,
      from: "Plaud Recorder",
      addedAt: new Date(r.start_time || Date.now()).toISOString(),
      category: "context-only",
    });
    linked++;

    state.seenIds.push(r.id);
    if (state.seenIds.length > 500) {
      state.seenIds = state.seenIds.slice(-500);
    }
    state.lastStartTime = Math.max(state.lastStartTime, r.start_time);
  }

  writeState(state);

  if (fresh.length > 0) {
    sendToTopic(
      "general",
      `🎙️ <b>Plaud scan</b>\n• New recordings: ${fresh.length}\n• Linked signals: ${linked}\n• Transcript pull: pending endpoint mapping`,
      "HTML",
    );
  }

  logEvent({
    source: "plaud-scan",
    action: "scan",
    result: "ok",
    detail: `checked=${recs.length} new=${fresh.length} linked=${linked}`,
  });

  console.log(JSON.stringify({ checked: recs.length, new: fresh.length, linked }, null, 2));
}

main().catch((err) => {
  logEvent({ source: "plaud-scan", action: "scan", result: "error", detail: String(err) });
  console.error(err);
  process.exit(1);
});
