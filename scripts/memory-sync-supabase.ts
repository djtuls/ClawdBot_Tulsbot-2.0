#!/usr/bin/env bun
/**
 * memory-sync-supabase.ts
 * Incrementally syncs workspace/memory/*.md files to Supabase via Gemini embeddings.
 *
 * Usage:
 *   bun memory-sync-supabase.ts           # watch mode (continuous)
 *   bun memory-sync-supabase.ts --once    # one-time full sync and exit
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_API_KEY
 * Optional env:
 *   MEMORY_AGENT_ID  (default: "tulsbot")
 *   MEMORY_DIR       (default: ~/.openclaw/workspace/memory)
 *   CHUNK_SIZE       (default: 40)
 *   CHUNK_OVERLAP    (default: 5)
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import chokidar from "chokidar";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://zjdsdzndyobixzboegvz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const MEMORY_AGENT_ID = process.env.MEMORY_AGENT_ID ?? "tulsbot";
const MEMORY_DIR = process.env.MEMORY_DIR
  ? path.resolve(process.env.MEMORY_DIR.replace(/^~/, os.homedir()))
  : path.join(os.homedir(), ".openclaw", "workspace", "memory");
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE ?? "40", 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP ?? "5", 10);

const GEMINI_EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GOOGLE_API_KEY}`;

const EMBED_CONCURRENCY = 5; // max parallel embedding requests
const EMBED_BATCH_DELAY = 100; // ms between batches to avoid quota limits

const ONCE_MODE = process.argv.includes("--once");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Chunk {
  file_path: string; // relative to MEMORY_DIR
  start_line: number;
  end_line: number;
  content: string;
  content_hash: string;
}

interface ChunkWithEmbedding extends Chunk {
  embedding: number[];
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

function buildClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[sync] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

const supabase = buildClient();

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function chunkFile(relPath: string, fileContent: string): Chunk[] {
  const lines = fileContent.split("\n");
  const chunks: Chunk[] = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + CHUNK_SIZE - 1, lines.length - 1);
    const content = lines
      .slice(start, end + 1)
      .join("\n")
      .trim();

    // Skip empty or whitespace-only chunks
    if (!content) {
      if (end >= lines.length - 1) {
        break;
      }
      continue;
    }

    const content_hash = crypto.createHash("sha256").update(content).digest("hex");

    chunks.push({
      file_path: relPath,
      start_line: start + 1, // 1-indexed
      end_line: end + 1,
      content,
      content_hash,
    });

    if (end >= lines.length - 1) {
      break;
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

async function embedText(text: string): Promise<number[]> {
  const response = await fetch(GEMINI_EMBED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      outputDimensionality: 768,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini embed failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
}

async function embedChunks(chunks: Chunk[]): Promise<ChunkWithEmbedding[]> {
  const results: ChunkWithEmbedding[] = [];

  // Process in batches of EMBED_CONCURRENCY
  for (let i = 0; i < chunks.length; i += EMBED_CONCURRENCY) {
    const batch = chunks.slice(i, i + EMBED_CONCURRENCY);

    const embeddings = await Promise.all(
      batch.map(async (chunk) => {
        const embedding = await embedText(chunk.content);
        return { ...chunk, embedding };
      }),
    );

    results.push(...embeddings);

    // Rate limiting: delay between batches (skip after last batch)
    if (i + EMBED_CONCURRENCY < chunks.length) {
      await sleep(EMBED_BATCH_DELAY);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Supabase sync helpers
// ---------------------------------------------------------------------------

async function fetchExistingHashes(relPath: string): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from("openclaw_memory_chunks")
    .select("start_line, content_hash")
    .eq("agent_id", MEMORY_AGENT_ID)
    .eq("file_path", relPath);

  if (error) {
    throw new Error(`fetchExistingHashes: ${error.message}`);
  }

  const map = new Map<number, string>();
  for (const row of data ?? []) {
    map.set(row.start_line, row.content_hash);
  }
  return map;
}

async function upsertChunks(chunks: ChunkWithEmbedding[]): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const rows = chunks.map((c) => ({
    agent_id: MEMORY_AGENT_ID,
    file_path: c.file_path,
    start_line: c.start_line,
    end_line: c.end_line,
    content: c.content,
    embedding: JSON.stringify(c.embedding), // Supabase JS expects JSON string for vector
    content_hash: c.content_hash,
    source: "memory",
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("openclaw_memory_chunks")
    .upsert(rows, { onConflict: "agent_id,file_path,start_line" });

  if (error) {
    throw new Error(`upsertChunks: ${error.message}`);
  }
}

async function deleteStaleChunks(relPath: string, validStartLines: number[]): Promise<void> {
  if (validStartLines.length === 0) {
    // Delete all chunks for the file
    const { error } = await supabase
      .from("openclaw_memory_chunks")
      .delete()
      .eq("agent_id", MEMORY_AGENT_ID)
      .eq("file_path", relPath);
    if (error) {
      throw new Error(`deleteStaleChunks(all): ${error.message}`);
    }
    return;
  }

  // Delete rows whose start_line is no longer present
  const { error } = await supabase
    .from("openclaw_memory_chunks")
    .delete()
    .eq("agent_id", MEMORY_AGENT_ID)
    .eq("file_path", relPath)
    .not("start_line", "in", `(${validStartLines.join(",")})`);

  if (error) {
    throw new Error(`deleteStaleChunks: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// File sync
// ---------------------------------------------------------------------------

async function syncFile(absPath: string): Promise<void> {
  const relPath = path.relative(MEMORY_DIR, absPath);

  let fileContent: string;
  try {
    fileContent = await fs.readFile(absPath, "utf8");
  } catch {
    // File may have been deleted between watcher event and read; treat as delete
    await deleteFile(absPath);
    return;
  }

  const chunks = chunkFile(relPath, fileContent);

  if (chunks.length === 0) {
    // Empty file — remove any existing rows
    await deleteStaleChunks(relPath, []);
    return;
  }

  // Incremental: only embed chunks whose hash changed
  const existingHashes = await fetchExistingHashes(relPath);

  const staleChunks = chunks.filter((c) => existingHashes.get(c.start_line) !== c.content_hash);

  let updatedCount = 0;
  if (staleChunks.length > 0) {
    const embedded = await embedChunks(staleChunks);
    await upsertChunks(embedded);
    updatedCount = embedded.length;
  }

  // Remove chunks for lines that no longer exist in the file
  const validStartLines = chunks.map((c) => c.start_line);
  await deleteStaleChunks(relPath, validStartLines);

  const skipped = chunks.length - staleChunks.length;
  const parts: string[] = [`${chunks.length} chunks`];
  if (updatedCount > 0) {
    parts.push(`${updatedCount} updated`);
  }
  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }
  console.log(`[sync] ✓ ${relPath} (${parts.join(", ")})`);
}

async function deleteFile(absPath: string): Promise<void> {
  const relPath = path.relative(MEMORY_DIR, absPath);

  const { error } = await supabase
    .from("openclaw_memory_chunks")
    .delete()
    .eq("agent_id", MEMORY_AGENT_ID)
    .eq("file_path", relPath);

  if (error) {
    throw new Error(`deleteFile: ${error.message}`);
  }
  console.log(`[sync] 🗑  Deleted chunks for ${relPath}`);
}

// ---------------------------------------------------------------------------
// Initial sync
// ---------------------------------------------------------------------------

async function collectMdFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMdFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function initialSync(): Promise<void> {
  let files: string[];
  try {
    files = await collectMdFiles(MEMORY_DIR);
  } catch (err) {
    console.error(`[sync] FATAL: Cannot read MEMORY_DIR ${MEMORY_DIR}: ${err}`);
    process.exit(1);
  }

  console.log(`[sync] Syncing ${files.length} files from ${MEMORY_DIR} ...`);

  let succeeded = 0;
  let failed = 0;

  for (const absPath of files) {
    try {
      await syncFile(absPath);
      succeeded++;
    } catch (err) {
      failed++;
      const relPath = path.relative(MEMORY_DIR, absPath);
      console.error(`[sync] ✗ ${relPath}: ${(err as Error).message}`);
    }
  }

  console.log(`[sync] Initial sync complete: ${succeeded} succeeded, ${failed} failed.`);
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

function startWatcher(): void {
  console.log(`[watch] Watching ${MEMORY_DIR}/**/*.md`);

  const watcher = chokidar.watch(`${MEMORY_DIR}/**/*.md`, {
    persistent: true,
    ignoreInitial: true, // initial sync already done
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("add", async (absPath) => {
    const relPath = path.relative(MEMORY_DIR, absPath);
    console.log(`[watch] Added: ${relPath}`);
    try {
      await syncFile(absPath);
    } catch (err) {
      console.error(`[watch] ✗ ${relPath}: ${(err as Error).message}`);
    }
  });

  watcher.on("change", async (absPath) => {
    const relPath = path.relative(MEMORY_DIR, absPath);
    console.log(`[watch] Changed: ${relPath}`);
    try {
      await syncFile(absPath);
    } catch (err) {
      console.error(`[watch] ✗ ${relPath}: ${(err as Error).message}`);
    }
  });

  watcher.on("unlink", async (absPath) => {
    const relPath = path.relative(MEMORY_DIR, absPath);
    console.log(`[watch] Deleted: ${relPath}`);
    try {
      await deleteFile(absPath);
    } catch (err) {
      console.error(`[watch] ✗ delete ${relPath}: ${(err as Error).message}`);
    }
  });

  watcher.on("error", (err) => {
    console.error(`[watch] Watcher error: ${err}`);
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateEnv(): void {
  const missing: string[] = [];
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!GOOGLE_API_KEY) {
    missing.push("GOOGLE_API_KEY");
  }
  if (missing.length > 0) {
    console.error(`[sync] FATAL: Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateEnv();

  console.log(`[sync] Agent: ${MEMORY_AGENT_ID} | Mode: ${ONCE_MODE ? "once" : "watch"}`);
  console.log(`[sync] Memory dir: ${MEMORY_DIR}`);
  console.log(`[sync] Chunk size: ${CHUNK_SIZE} lines (+${CHUNK_OVERLAP} overlap)`);

  await initialSync();

  if (!ONCE_MODE) {
    startWatcher();
  } else {
    console.log("[sync] --once mode: exiting.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("[sync] Unhandled error:", err);
  process.exit(1);
});
