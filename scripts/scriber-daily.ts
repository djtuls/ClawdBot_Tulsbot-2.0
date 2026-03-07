#!/usr/bin/env tsx
/**
 * scriber-daily.ts
 *
 * Daily consolidation:
 * - reads last 24h hourly logs from SQLite
 * - writes memory/daily/<date>.md summary appendix
 * - stores daily summary in SQLite
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { getOperatorTimeZone } from "./timezone.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");
const MEMORY_DIR = path.join(WORKSPACE, "memory");
const DAILY_DIR = path.join(MEMORY_DIR, "daily");
const DB_PATH = path.join(MEMORY_DIR, "scriber.db");

async function ensureDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL UNIQUE,
      timezone TEXT NOT NULL,
      hours_count INTEGER NOT NULL,
      open_todos_peak INTEGER NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

async function readDailyFile(day: string): Promise<string> {
  const file = path.join(DAILY_DIR, `${day}.md`);
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return `# Daily Memory — ${day}\n\n`;
  }
}

async function writeDailyFile(day: string, content: string) {
  await fs.mkdir(DAILY_DIR, { recursive: true });
  await fs.writeFile(path.join(DAILY_DIR, `${day}.md`), content);
}

async function main() {
  const now = new Date();
  const timezone = await getOperatorTimeZone();
  const day = now.toISOString().slice(0, 10);
  const sinceIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const db = await ensureDb();
  const rows = db
    .prepare(
      `SELECT run_at, session_id, todo_open_count, summary, log_path
       FROM hourly_logs
       WHERE run_at >= ?
       ORDER BY run_at ASC`,
    )
    .all(sinceIso) as Array<{
    run_at: string;
    session_id: string;
    todo_open_count: number;
    summary: string;
    log_path: string;
  }>;

  const count = rows.length;
  const peakTodos = rows.reduce((max, r) => Math.max(max, r.todo_open_count), 0);

  const summary =
    count === 0
      ? "No hourly logs found in the last 24h."
      : `Captured ${count} hourly logs in the last 24h. Peak open TODOs: ${peakTodos}.`;

  const appendix = [
    `## Scriber Daily Consolidation`,
    ``,
    `- Generated at: ${now.toISOString()} (${timezone})`,
    `- Hourly logs scanned: ${count}`,
    `- Peak open TODOs: ${peakTodos}`,
    ``,
    `### Hourly rollup`,
    ...(rows.length
      ? rows.map(
          (r) => `- ${r.run_at} | ${r.session_id} | todos=${r.todo_open_count} | ${r.log_path}`,
        )
      : ["- none"]),
    ``,
    `Summary: ${summary}`,
    ``,
  ].join("\n");

  const existing = await readDailyFile(day);
  const separator = existing.includes("## Scriber Daily Consolidation") ? "\n\n---\n\n" : "\n";
  await writeDailyFile(day, `${existing.trimEnd()}${separator}${appendix}`);

  db.prepare(
    `INSERT INTO daily_logs (day, timezone, hours_count, open_todos_peak, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       timezone=excluded.timezone,
       hours_count=excluded.hours_count,
       open_todos_peak=excluded.open_todos_peak,
       summary=excluded.summary,
       created_at=excluded.created_at`,
  ).run(day, timezone, count, peakTodos, summary, now.toISOString());

  db.close();
  console.log(`✅ scriber-daily complete for ${day}`);
}

main().catch((err) => {
  console.error("scriber-daily failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
