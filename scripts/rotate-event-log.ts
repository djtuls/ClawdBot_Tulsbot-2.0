/**
 * Rotate event log — archives entries older than 7 days.
 * Runs nightly at 2 AM BRT via cron.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logCron } from "./event-logger.js";

const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const EVENT_LOG = join(WORKSPACE, "memory/event-log.jsonl");
const ARCHIVE_DIR = join(WORKSPACE, "logs/archive");

function main() {
  if (!existsSync(EVENT_LOG)) {
    console.log("No event log to rotate");
    return;
  }

  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  const lines = readFileSync(EVENT_LOG, "utf-8").trim().split("\n").filter(Boolean);
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const keep: string[] = [];
  const archive: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.ts < cutoff) {
        archive.push(line);
      } else {
        keep.push(line);
      }
    } catch {
      keep.push(line);
    }
  }

  if (archive.length === 0) {
    console.log(`No entries older than 7 days (${lines.length} total)`);
    return;
  }

  const archiveFile = join(
    ARCHIVE_DIR,
    `event-log-${new Date().toISOString().split("T")[0]}.jsonl`,
  );
  appendFileSync(archiveFile, archive.join("\n") + "\n");
  writeFileSync(EVENT_LOG, keep.join("\n") + "\n");

  console.log(`Rotated: ${archive.length} archived, ${keep.length} kept`);
  logCron("rotate-event-log", "ok", { archived: archive.length, kept: keep.length });
}

main();
