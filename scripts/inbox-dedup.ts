import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DB_PATH = join(WORKSPACE, "data/inbox-seen.db");

let db: any = null;

function getDb() {
  if (db) {
    return db;
  }
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const { DatabaseSync } = require("node:sqlite");
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS seen (
      hash TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      meta TEXT
    )
  `);
  return db;
}

export function hashItem(source: string, id: string): string {
  return createHash("sha256").update(`${source}:${id}`).digest("hex").slice(0, 16);
}

export function isSeen(hash: string): boolean {
  const row = getDb().prepare("SELECT 1 FROM seen WHERE hash = ?").get(hash);
  return !!row;
}

export function markSeen(hash: string, source: string, meta?: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO seen (hash, source, meta) VALUES (?, ?, ?)")
    .run(hash, source, meta || null);
}
