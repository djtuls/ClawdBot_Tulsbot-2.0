#!/usr/bin/env tsx
/**
 * Supabase Memory Sync — bidirectional cloud mirror for local memory
 *
 * Replaces NotebookLM as the online knowledge layer. Syncs all memory
 * files into Supabase knowledge_documents + knowledge_chunks tables so
 * both the local and cloud instances of Tulsbot share the same brain.
 *
 * Offline resilience: changes are queued in SQLite and flushed when
 * Supabase is reachable again.
 *
 * Usage:
 *   npx tsx scripts/sync-memory-supabase.ts           # one-shot sync
 *   npx tsx scripts/sync-memory-supabase.ts --watch   # continuous daemon
 *   npx tsx scripts/sync-memory-supabase.ts --status  # show sync state
 *   npx tsx scripts/sync-memory-supabase.ts --query "how does X work"  # search
 */

import Database from "better-sqlite3";
import chokidar from "chokidar";
import { config as loadEnv } from "dotenv";
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

loadEnv({ path: path.join(PROJECT_ROOT, ".env"), override: true });

// dotenvx doesn't override vars already in the host environment in ESM mode —
// parse .env files directly for critical secrets that may be missing or shadowed.
function _readEnvVar(envPath: string, key: string): string | undefined {
  try {
    const content = fsSync.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(new RegExp(`^${key}=(.+)$`));
      if (match) {
        return match[1].trim();
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
// Try both workspace .env and parent .openclaw/.env (where OPENAI_API_KEY lives)
const PARENT_ENV_PATH = path.join(PROJECT_ROOT, "..", ".env");
function _ensureEnvVar(key: string): void {
  if (process.env[key]) {
    return;
  }
  const v = _readEnvVar(path.join(PROJECT_ROOT, ".env"), key) ?? _readEnvVar(PARENT_ENV_PATH, key);
  if (v) {
    process.env[key] = v;
  }
}
_ensureEnvVar("OPENAI_API_KEY");
_ensureEnvVar("SUPABASE_URL");
_ensureEnvVar("SUPABASE_SERVICE_ROLE_KEY");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OFFLINE_QUEUE_DB = path.join(PROJECT_ROOT, ".supabase-sync-queue.db");

const WATCH_MODE = process.argv.includes("--watch");
const STATUS_MODE = process.argv.includes("--status");
const QUERY_IDX = process.argv.indexOf("--query");
const QUERY = QUERY_IDX !== -1 ? process.argv[QUERY_IDX + 1] : undefined;

// Directories to watch and sync
const SYNC_SOURCES = [
  { dir: path.join(PROJECT_ROOT, "memory"), label: "memory", exts: [".md", ".txt"] },
  { dir: path.join(PROJECT_ROOT, "docs"), label: "docs", exts: [".md", ".txt"] },
  { dir: path.join(PROJECT_ROOT, "reports"), label: "reports", exts: [".md", ".txt"] },
  { dir: path.join(PROJECT_ROOT, "sessions"), label: "sessions", exts: [".md", ".txt"] },
  { dir: path.join(PROJECT_ROOT, "knowledge-slices"), label: "knowledge", exts: [".md"] },
  { dir: path.join(PROJECT_ROOT, "archive"), label: "archive", exts: [".md"] },
];

const CORE_FILES = [
  "RUNBOOK.md",
  "STATE.md",
  "ROADMAP.md",
  "TODO.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "AGENTS.md",
  "CHANGELOG.md",
].map((f) => ({ filePath: path.join(PROJECT_ROOT, f), label: "core" }));

// ─── Offline queue (SQLite) ────────────────────────────────────────────────

type QueueItem = {
  id?: number;
  file_path: string;
  content_hash: string;
  operation: "upsert" | "delete";
  status: "pending" | "synced" | "failed";
  retries: number;
  error?: string;
  created_at: string;
  synced_at?: string;
};

function initQueue(): Database.Database {
  const db = new Database(OFFLINE_QUEUE_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert',
      status TEXT NOT NULL DEFAULT 'pending',
      retries INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      file_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      doc_id TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status);
  `);
  return db;
}

// ─── Supabase REST helpers ─────────────────────────────────────────────────

function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation,resolution=merge-duplicates",
    ...extra,
  };
}

async function sbRequest<T>(
  method: string,
  reqPath: string,
  body?: unknown,
): Promise<{ ok: boolean; data: T; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${reqPath}`, {
      method,
      headers: sbHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ([] as T);
    if (!res.ok) {
      return { ok: false, data: [] as T, error: `${res.status}: ${text.substring(0, 200)}` };
    }
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, data: [] as T, error: msg };
  }
}

async function isSupabaseReachable(): Promise<boolean> {
  const { ok } = await sbRequest("GET", "knowledge_documents?limit=0");
  return ok;
}

// ─── Voyage Embeddings ─────────────────────────────────────────────────────

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || "";

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY not set");
  }
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "voyage-3",
      input: texts,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage embeddings error ${res.status}: ${err.substring(0, 200)}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
  // Sort by index to ensure order matches input
  return json.data.toSorted((a, b) => a.index - b.index).map((d) => d.embedding);
}

// ─── Document chunking ─────────────────────────────────────────────────────

function chunkText(text: string, maxTokenEstimate = 400): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const estimate = Math.ceil(para.split(/\s+/).length * 1.3);
    const currentEstimate = Math.ceil(current.split(/\s+/).length * 1.3);

    if (current && currentEstimate + estimate > maxTokenEstimate) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks.filter((c) => c.length > 20);
}

// ─── Push a file to Supabase ───────────────────────────────────────────────

async function pushToSupabase(
  filePath: string,
  content: string,
  hash: string,
  label: string,
  db: Database.Database,
): Promise<"synced" | "failed"> {
  const uri = `file://${filePath}`;
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  const title = `[${label}] ${relativePath}`;
  const chunks = chunkText(content);

  const {
    ok: docOk,
    data: docData,
    error: docErr,
  } = await sbRequest<Array<{ id: string }>>("POST", "knowledge_documents?on_conflict=uri", {
    uri,
    source_type: label,
    title,
    content_hash: hash,
    chunk_count: chunks.length,
    status: "indexed",
    last_indexed_at: new Date().toISOString(),
    mime_type: "text/markdown",
    metadata: { filePath, relativePath, label },
  });

  if (!docOk || !docData?.[0]?.id) {
    console.warn(`  ⚠️  Doc upsert failed [${relativePath}]: ${docErr}`);
    return "failed";
  }

  const docId = docData[0].id;

  await sbRequest("DELETE", `knowledge_chunks?document_id=eq.${docId}`);

  if (chunks.length > 0) {
    const chunkRecords = chunks.map((text, i) => ({
      document_id: docId,
      chunk_index: i,
      content: text,
      content_hash: createHash("md5").update(text).digest("hex"),
      token_count: Math.ceil(text.split(/\s+/).length * 1.3),
    }));

    const {
      ok: chunkOk,
      data: chunkData,
      error: chunkErr,
    } = await sbRequest<Array<{ id: string; content: string; chunk_index: number }>>(
      "POST",
      "knowledge_chunks",
      chunkRecords,
    );
    if (!chunkOk) {
      console.warn(`  ⚠️  Chunk insert failed [${relativePath}]: ${chunkErr}`);
    } else if (Array.isArray(chunkData) && chunkData.length > 0 && OPENAI_API_KEY) {
      // Generate embeddings in batches of 100
      const BATCH = 100;
      for (let i = 0; i < chunkData.length; i += BATCH) {
        const batch = chunkData.slice(i, i + BATCH);
        try {
          const embeddings = await generateEmbeddings(batch.map((c) => c.content));
          for (let j = 0; j < batch.length; j++) {
            const { ok: embOk, error: embErr } = await sbRequest(
              "PATCH",
              `knowledge_chunks?id=eq.${batch[j].id}`,
              { embedding: embeddings[j] },
            );
            if (!embOk) {
              console.warn(`  ⚠️  Embedding update failed for chunk ${batch[j].id}: ${embErr}`);
            }
          }
        } catch (embGenErr) {
          const msg = embGenErr instanceof Error ? embGenErr.message : String(embGenErr);
          console.warn(
            `  ⚠️  Embedding generation failed for batch ${i}-${i + batch.length} [${relativePath}]: ${msg}`,
          );
        }
      }
    }
  }

  db.prepare(`
    INSERT INTO sync_state (file_path, content_hash, doc_id, synced_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(file_path) DO UPDATE SET
      content_hash=excluded.content_hash,
      doc_id=excluded.doc_id,
      synced_at=excluded.synced_at
  `).run(filePath, hash, docId);

  // Also update the legacy claude_memory_sync_state table
  await sbRequest("POST", "claude_memory_sync_state?on_conflict=file_name", {
    file_name: path.basename(filePath),
    file_path: filePath,
    content_hash: hash,
    last_synced_at: new Date().toISOString(),
    sections_extracted: chunks.length,
    nodes_created: chunks.length,
    nodes_updated: 0,
    vectors_stored: 0,
  });

  return "synced";
}

// ─── Sync one file ─────────────────────────────────────────────────────────

async function syncFile(
  filePath: string,
  label: string,
  db: Database.Database,
  force = false,
): Promise<"synced" | "skipped" | "queued" | "failed"> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return "failed";
  }

  const hash = createHash("md5").update(content).digest("hex");

  if (!force) {
    const existing = db
      .prepare("SELECT content_hash FROM sync_state WHERE file_path = ?")
      .get(filePath) as { content_hash: string } | undefined;
    if (existing?.content_hash === hash) {
      return "skipped";
    }
  }

  const online = await isSupabaseReachable();

  if (!online) {
    db.prepare(`
      INSERT OR REPLACE INTO sync_queue (file_path, content_hash, operation, status, retries, created_at)
      VALUES (?, ?, 'upsert', 'pending', 0, datetime('now'))
    `).run(filePath, hash);
    return "queued";
  }

  return pushToSupabase(filePath, content, hash, label, db);
}

// ─── Flush offline queue ───────────────────────────────────────────────────

async function flushQueue(db: Database.Database) {
  const pending = db
    .prepare(
      "SELECT * FROM sync_queue WHERE status='pending' AND retries < 5 ORDER BY created_at LIMIT 50",
    )
    .all() as QueueItem[];

  if (pending.length === 0) {
    return;
  }
  console.log(`\n🔄 Flushing offline queue: ${pending.length} items...`);
  let flushed = 0;

  for (const item of pending) {
    let content: string;
    try {
      content = await fs.readFile(item.file_path, "utf-8");
    } catch {
      db.prepare("UPDATE sync_queue SET status='failed', error='file not found' WHERE id=?").run(
        item.id,
      );
      continue;
    }

    const label = SYNC_SOURCES.find((s) => item.file_path.startsWith(s.dir))?.label ?? "core";
    const result = await pushToSupabase(item.file_path, content, item.content_hash, label, db);

    if (result === "synced") {
      db.prepare("UPDATE sync_queue SET status='synced', synced_at=datetime('now') WHERE id=?").run(
        item.id,
      );
      flushed++;
    } else {
      db.prepare("UPDATE sync_queue SET retries=retries+1, error='push failed' WHERE id=?").run(
        item.id,
      );
    }
  }
  console.log(`   Flushed ${flushed}/${pending.length} ✅`);
}

// ─── Full scan ─────────────────────────────────────────────────────────────

async function fullSync(db: Database.Database) {
  console.log("🔍 Scanning all sources...");
  let synced = 0,
    skipped = 0,
    queued = 0,
    failed = 0;

  const allFiles: { filePath: string; label: string }[] = [...CORE_FILES];

  for (const { dir, label, exts } of SYNC_SOURCES) {
    try {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        if (!exts.some((e) => entry.name.endsWith(e))) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (stat && stat.size > 1.5 * 1024 * 1024) {
          continue;
        }
        allFiles.push({ filePath: fullPath, label });
      }
    } catch {
      /* dir missing */
    }
  }

  console.log(`   ${allFiles.length} files to check\n`);

  for (const { filePath, label } of allFiles) {
    const result = await syncFile(filePath, label, db);
    if (result === "synced") {
      synced++;
      process.stdout.write("✅");
    } else if (result === "skipped") {
      skipped++;
      process.stdout.write(".");
    } else if (result === "queued") {
      queued++;
      process.stdout.write("⏳");
    } else {
      failed++;
      process.stdout.write("❌");
    }
    if ((synced + skipped + queued + failed) % 60 === 0) {
      process.stdout.write("\n   ");
    }
  }

  console.log(
    `\n\n📊 Complete: ${synced} synced, ${skipped} unchanged, ${queued} queued offline, ${failed} failed`,
  );
}

// ─── Watch mode ────────────────────────────────────────────────────────────

function startWatcher(db: Database.Database) {
  const watchPaths = SYNC_SOURCES.map((s) => s.dir).concat(CORE_FILES.map((f) => f.filePath));
  console.log("\n👁  Watch mode — monitoring for changes...\n");

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    ignored: /(node_modules|\.git|\.anythingllm)/,
    persistent: true,
  });

  const handle = async (filePath: string) => {
    const ext = path.extname(filePath);
    if (![".md", ".txt"].includes(ext)) {
      return;
    }
    const label = SYNC_SOURCES.find((s) => filePath.startsWith(s.dir))?.label ?? "core";
    process.stdout.write(`  📝 ${path.basename(filePath)} → `);
    const result = await syncFile(filePath, label, db);
    console.log(result === "synced" ? "✅" : result === "queued" ? "⏳ queued" : result);

    const row = db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status='pending'").get() as {
      c: number;
    };
    if (result === "synced" && row.c > 0) {
      await flushQueue(db);
    }
  };

  watcher.on("add", handle).on("change", handle);
  setInterval(() => flushQueue(db), 5 * 60 * 1000);
}

// ─── Status ────────────────────────────────────────────────────────────────

function showStatus(db: Database.Database) {
  const total = (db.prepare("SELECT COUNT(*) as c FROM sync_state").get() as { c: number }).c;
  const pending = (
    db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status='pending'").get() as { c: number }
  ).c;
  const failed = (
    db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status='failed'").get() as { c: number }
  ).c;
  const lastSync = (db.prepare("SELECT MAX(synced_at) as t FROM sync_state").get() as { t: string })
    ?.t;

  console.log("\n📊 Supabase Sync Status");
  console.log(`   Synced files : ${total}`);
  console.log(`   Queue pending: ${pending}`);
  console.log(`   Queue failed : ${failed}`);
  console.log(`   Last sync    : ${lastSync ?? "never"}`);
  isSupabaseReachable().then((online) => {
    console.log(`   Supabase     : ${online ? "✅ online" : "❌ offline"}`);
  });
}

// ─── Search ────────────────────────────────────────────────────────────────

async function search(query: string) {
  console.log(`\n🔍 Searching: "${query}"\n`);
  const encoded = encodeURIComponent(query);
  const { ok, data, error } = await sbRequest<Array<{ content: string; document_id: string }>>(
    "GET",
    `knowledge_chunks?content=fts.${encoded}&limit=10&select=content,document_id`,
  );

  if (!ok) {
    console.error("Search failed:", error);
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.log("No results found.");
    return;
  }

  for (const [i, chunk] of data.entries()) {
    console.log(`\n[${i + 1}] ${chunk.content.substring(0, 300)}...`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
    process.exit(1);
  }

  const db = initQueue();

  if (STATUS_MODE) {
    showStatus(db);
    return;
  }
  if (QUERY) {
    await search(QUERY);
    return;
  }

  console.log("☁️  Supabase Memory Sync\n");
  console.log(`   ${SUPABASE_URL}`);

  const online = await isSupabaseReachable();
  console.log(`   Online: ${online ? "✅" : "❌ (queueing for later)"}\n`);

  if (online) {
    await flushQueue(db);
  }

  await fullSync(db);

  if (WATCH_MODE) {
    startWatcher(db);
  } else {
    db.close();
    console.log("\n💡 Run with --watch to keep in sync continuously");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
