#!/usr/bin/env tsx
/**
 * scriber-hourly.ts
 *
 * Hourly memory scribe:
 * - snapshots current system context
 * - writes human-readable hourly markdown log
 * - persists structured row to SQLite (memory/scriber.db)
 * - rotates 24h state session pointer
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { getOperatorTimeZone } from "./timezone.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");
const MEMORY_DIR = path.join(WORKSPACE, "memory");
const LOG_DIR = path.join(MEMORY_DIR, "hourly");
const DB_PATH = path.join(MEMORY_DIR, "scriber.db");
const SESSION_PATH = path.join(MEMORY_DIR, "state-session.json");

async function readTextSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function ensureDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS hourly_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      session_id TEXT NOT NULL,
      state_snapshot TEXT,
      todo_open_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL,
      log_path TEXT NOT NULL
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_hourly_logs_run_at ON hourly_logs(run_at);");
  return db;
}

function countOpenTodos(todo: string): number {
  return (todo.match(/^- \[ \]/gm) || []).length;
}

function getTopOpenTodos(todo: string, limit = 5): string[] {
  const lines = todo
    .split("\n")
    .filter((line) => line.startsWith("- [ ]"))
    .map((line) => line.replace(/^- \[ \]\s*/, "").trim());
  return lines.slice(0, limit);
}

async function getSessionId(nowIso: string): Promise<string> {
  let session = {
    sessionId: `state-${nowIso.slice(0, 13).replace(/[:T]/g, "-")}`,
    startedAt: nowIso,
  };

  try {
    const raw = await fs.readFile(SESSION_PATH, "utf8");
    const parsed = JSON.parse(raw) as { sessionId?: string; startedAt?: string };
    if (parsed.sessionId && parsed.startedAt) {
      const ageMs = Date.now() - new Date(parsed.startedAt).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) {
        session = { sessionId: parsed.sessionId, startedAt: parsed.startedAt };
      }
    }
  } catch {
    // first run
  }

  await fs.writeFile(SESSION_PATH, JSON.stringify(session, null, 2));
  return session.sessionId;
}

async function main() {
  const now = new Date();
  const runAt = now.toISOString();
  const timezone = await getOperatorTimeZone();
  const stamp = now.toISOString().replace(/[:]/g, "-");

  const [stateMd, todoMd, shortMemory, eventLog] = await Promise.all([
    readTextSafe(path.join(WORKSPACE, "STATE.md")),
    readTextSafe(path.join(WORKSPACE, "TODO.md")),
    readTextSafe(path.join(MEMORY_DIR, "short-memory.jsonl")),
    readTextSafe(path.join(MEMORY_DIR, "event-log.jsonl")),
  ]);

  const openTodos = countOpenTodos(todoMd);
  const topTodos = getTopOpenTodos(todoMd, 5);
  const shortMemoryLines = shortMemory.trim() ? shortMemory.trim().split("\n").slice(-30) : [];
  const eventLines = eventLog.trim() ? eventLog.trim().split("\n").slice(-80) : [];

  const sessionId = await getSessionId(runAt);

  const dateBucket = runAt.slice(0, 10);
  const outDir = path.join(LOG_DIR, dateBucket);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${stamp}.md`);

  const summary = `Hourly scribe captured ${openTodos} open TODOs, ${shortMemoryLines.length} short-memory rows, ${eventLines.length} recent events.`;

  const content = [
    `# Hourly Scribe Log`,
    ``,
    `- Run at: ${runAt}`,
    `- Timezone: ${timezone}`,
    `- Session: ${sessionId}`,
    `- Open TODOs: ${openTodos}`,
    ``,
    `## Top Open TODOs`,
    ...(topTodos.length ? topTodos.map((t) => `- ${t}`) : ["- none"]),
    ``,
    `## STATE Snapshot`,
    "```md",
    stateMd.slice(0, 6000),
    "```",
    ``,
    `## Last 30 short-memory rows`,
    "```jsonl",
    shortMemoryLines.join("\n"),
    "```",
    ``,
    `## Last 80 event-log rows`,
    "```jsonl",
    eventLines.join("\n"),
    "```",
    ``,
    `Summary: ${summary}`,
    ``,
  ].join("\n");

  await fs.writeFile(outPath, content);

  const db = await ensureDb();
  db.prepare(
    `INSERT INTO hourly_logs (run_at, timezone, session_id, state_snapshot, todo_open_count, summary, log_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runAt,
    timezone,
    sessionId,
    stateMd.slice(0, 6000),
    openTodos,
    summary,
    path.relative(WORKSPACE, outPath),
  );
  db.close();

  console.log(`✅ scriber-hourly complete: ${path.relative(WORKSPACE, outPath)}`);
}

main().catch((err) => {
  console.error("scriber-hourly failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
