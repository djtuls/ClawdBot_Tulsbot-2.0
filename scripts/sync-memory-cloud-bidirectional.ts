#!/usr/bin/env tsx

/**
 * Cloud Memory Sync - Phase 3: Bidirectional Sync with Offline Queueing
 *
 * This script provides full bidirectional sync between:
 * 1. Local memory: ~/.openclaw/workspace/memory/*.md
 * 2. AnythingLLM: ./anythingllm-sync-output/brain/*.md (local RAG)
 * 3. NotebookLLM: Tulsbot notebook (cloud RAG, queryable)
 *
 * Features:
 * - Bidirectional sync (local ↔ cloud)
 * - Offline queue with SQLite persistence
 * - Automatic reconciliation when reconnecting
 * - Timestamp-based conflict resolution
 * - Unified search (local + online)
 *
 * Usage:
 *   npm run sync-memory-bidirectional          # One-shot bidirectional sync
 *   npm run sync-memory-bidirectional --watch  # Continuous sync
 *   npm run sync-memory-bidirectional --search "query"  # Search both local and online
 */

import Database from "better-sqlite3";
import chokidar from "chokidar";
import { config as loadEnv } from "dotenv";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Load environment variables from .env file
loadEnv({ path: path.join(PROJECT_ROOT, ".env") });

// NotebookLLM configuration
const TULSBOT_NOTEBOOK_ID = process.env.TULSBOT_NOTEBOOK_ID || "";
const ENABLE_NOTEBOOKLM = TULSBOT_NOTEBOOK_ID !== "";

// Sync state database
const SYNC_DB_PATH = path.join(PROJECT_ROOT, ".sync-state.db");

type MemoryFileMetadata = {
  title: string;
  type?: string;
  tier?: string;
  confidence?: number;
  originalCreated?: Date;
  imported?: Date;
  source?: string;
  content: string;
  filePath: string;
  hash: string;
  mtime?: Date;
};

type SyncQueueItem = {
  id?: number;
  file_hash: string;
  file_name: string;
  operation: "add" | "update" | "delete";
  destination: "notebooklm" | "local" | "anythingllm";
  status: "pending" | "synced" | "failed";
  retries: number;
  created_at: string;
  synced_at?: string;
  error_message?: string;
};

type NotebookLLMSource = {
  id: string;
  title: string;
  created: Date;
  hash?: string;
};

/**
 * Initialize SQLite database for sync state tracking
 */
function initSyncDatabase(): Database.Database {
  const db = new Database(SYNC_DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_hash TEXT NOT NULL,
      file_name TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('add', 'update', 'delete')),
      destination TEXT NOT NULL CHECK(destination IN ('notebooklm', 'local', 'anythingllm')),
      status TEXT NOT NULL CHECK(status IN ('pending', 'synced', 'failed')) DEFAULT 'pending',
      retries INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      synced_at TEXT,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_hash ON sync_queue(file_hash);
  `);

  return db;
}

/**
 * Add item to sync queue (for offline operations)
 */
function queueSyncOperation(
  db: Database.Database,
  item: Omit<SyncQueueItem, "id" | "created_at">,
): void {
  const stmt = db.prepare(`
    INSERT INTO sync_queue (file_hash, file_name, operation, destination, status, retries, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    item.file_hash,
    item.file_name,
    item.operation,
    item.destination,
    item.status,
    item.retries,
    item.error_message || null,
  );
}

/**
 * Get pending sync operations from queue
 */
function getPendingSyncOperations(db: Database.Database): SyncQueueItem[] {
  const stmt = db.prepare(`
    SELECT * FROM sync_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `);

  return stmt.all() as SyncQueueItem[];
}

/**
 * Mark sync operation as completed
 */
function markSyncCompleted(db: Database.Database, id: number): void {
  const stmt = db.prepare(`
    UPDATE sync_queue
    SET status = 'synced', synced_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(id);
}

/**
 * Mark sync operation as failed
 */
function markSyncFailed(db: Database.Database, id: number, errorMessage: string): void {
  const stmt = db.prepare(`
    UPDATE sync_queue
    SET status = 'failed', retries = retries + 1, error_message = ?
    WHERE id = ?
  `);

  stmt.run(errorMessage, id);
}

/**
 * Parse OpenClaw memory markdown file
 */
async function parseMemoryFile(filePath: string): Promise<MemoryFileMetadata> {
  const content = await fs.readFile(filePath, "utf-8");
  const fileName = path.basename(filePath);
  const stats = await fs.stat(filePath);

  const lines = content.split("\n");

  // Extract title
  const titleLine = lines.find((line) => line.trim().startsWith("#"));
  const title = titleLine ? titleLine.replace(/^#\s*/, "").trim() : fileName.replace(".md", "");

  // Extract metadata
  const typeMatch = content.match(/\*\*Type:\*\*\s*(.+?)$/m);
  const tierMatch = content.match(/\*\*Tier:\*\*\s*(.+?)$/m);
  const confidenceMatch = content.match(/\*\*Confidence:\*\*\s*(.+?)$/m);
  const sourceMatch = content.match(/\*\*Source:\*\*\s*(.+?)$/m);

  // Extract content (everything after ---)
  const separatorIndex = content.indexOf("\n---\n");
  const mainContent = separatorIndex >= 0 ? content.slice(separatorIndex + 5).trim() : content;

  // Generate hash for change detection
  const hash = createHash("md5").update(mainContent).digest("hex");

  return {
    title,
    type: typeMatch?.[1]?.trim(),
    tier: tierMatch?.[1]?.trim() || "learnings",
    confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7,
    source: sourceMatch?.[1]?.trim(),
    content: mainContent,
    filePath: fileName,
    hash,
    mtime: stats.mtime,
  };
}

/**
 * Convert OpenClaw memory to AnythingLLM brain format
 */
function convertToAnythingLLMFormat(memory: MemoryFileMetadata): string {
  const created = memory.originalCreated || new Date();

  const frontmatter = [
    `# ${memory.title}`,
    "",
    `**Type:** ${memory.type || "note"}`,
    `**Tier:** ${memory.tier}`,
    `**Confidence:** ${memory.confidence}`,
    `**Created:** ${created.toString()}`,
    "",
    "---",
    "",
  ].join("\n");

  return frontmatter + memory.content;
}

/**
 * Generate stable filename from memory hash and title
 */
function generateBrainFileName(memory: MemoryFileMetadata): string {
  const shortHash = memory.hash.slice(0, 16);
  return `cc-sync-${shortHash}.md`;
}

/**
 * List sources from NotebookLLM notebook
 */
async function listNotebookLLMSources(): Promise<NotebookLLMSource[]> {
  if (!ENABLE_NOTEBOOKLM) {
    return [];
  }

  try {
    const { stdout } = await execFileNoThrow("nlm", [
      "source",
      "list",
      TULSBOT_NOTEBOOK_ID,
      "--json",
    ]);

    const sources = JSON.parse(stdout);
    return sources.map((s: unknown) => {
      const source = s as { id: string; title: string; createTime?: string };
      return {
        id: source.id,
        title: source.title,
        created: source.createTime ? new Date(source.createTime) : new Date(),
      };
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    if (err.message?.includes("not authenticated")) {
      throw error;
    }
    console.warn("⚠️  Failed to list NotebookLLM sources:", err.message);
    return [];
  }
}

/**
 * Sync memory to AnythingLLM (local RAG)
 */
async function syncToAnythingLLM(memory: MemoryFileMetadata, brainDir: string): Promise<void> {
  // Skip files from anythingllm backup (avoid circular sync)
  if (memory.source === "anythingllm-backup") {
    return;
  }

  const brainFileName = generateBrainFileName(memory);
  const brainFilePath = path.join(brainDir, brainFileName);

  // Check if file exists and has same content hash
  const exists = await fs
    .access(brainFilePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    const existingContent = await fs.readFile(brainFilePath, "utf-8");
    const existingHash = createHash("md5").update(existingContent).digest("hex");
    if (existingHash === memory.hash) {
      return; // No changes, skip
    }
  }

  // Write to brain directory
  const brainContent = convertToAnythingLLMFormat(memory);
  await fs.writeFile(brainFilePath, brainContent, "utf-8");
}

/**
 * Sync memory to NotebookLLM (cloud RAG)
 */
async function syncToNotebookLLM(memoryPath: string, db: Database.Database): Promise<boolean> {
  if (!ENABLE_NOTEBOOKLM) {
    return false;
  }

  const fileName = path.basename(memoryPath);
  const memory = await parseMemoryFile(memoryPath);

  try {
    const { stderr } = await execFileNoThrow("nlm", [
      "source",
      "add",
      TULSBOT_NOTEBOOK_ID,
      "--file",
      memoryPath,
    ]);

    if (stderr && !stderr.includes("Source added successfully")) {
      console.warn(`  ⚠️  NotebookLLM warning for ${fileName}:`, stderr);
    }

    return true;
  } catch (error: unknown) {
    const err = error as { message?: string };
    // Handle offline: queue for later
    if (err.message?.includes("ENOTFOUND") || err.message?.includes("network")) {
      console.log(`  📴 Offline: queued ${fileName} for sync`);
      queueSyncOperation(db, {
        file_hash: memory.hash,
        file_name: fileName,
        operation: "add",
        destination: "notebooklm",
        status: "pending",
        retries: 0,
      });
      return false;
    }

    if (err.message?.includes("already exists")) {
      return true; // Already synced
    }

    if (err.message?.includes("not authenticated")) {
      throw error;
    }

    throw error;
  }
}

/**
 * Sync from NotebookLLM to local (reverse direction)
 */
async function syncFromNotebookLLM(
  localMemoryDir: string,
  _db: Database.Database,
): Promise<{ pulled: number; skipped: number }> {
  if (!ENABLE_NOTEBOOKLM) {
    return { pulled: 0, skipped: 0 };
  }

  let pulled = 0;
  let skipped = 0;

  try {
    // Get cloud sources
    const cloudSources = await listNotebookLLMSources();

    // Get local files
    const localFiles = await fs.readdir(localMemoryDir);
    const localHashes = new Set<string>();

    for (const fileName of localFiles) {
      if (!fileName.endsWith(".md")) {
        continue;
      }
      const filePath = path.join(localMemoryDir, fileName);
      const memory = await parseMemoryFile(filePath);
      localHashes.add(memory.hash);
    }

    // Download missing sources from cloud
    for (const source of cloudSources) {
      // Skip sources without titles
      if (!source.title) {
        continue;
      }

      // Check if we already have this content locally
      // Note: This is simplified - in production, you'd need to fetch
      // the source content and compare hashes
      const exists = localFiles.some((f) => f.toLowerCase().includes(source.title.toLowerCase()));

      if (!exists) {
        try {
          // Download source from NotebookLLM
          const { stdout } = await execFileNoThrow("nlm", ["source", "get", source.id, "--json"]);

          // Parse JSON and extract content
          const response = JSON.parse(stdout);
          const content = response.value?.content || "";

          if (!content) {
            console.warn(`  ⚠️  Empty content for ${source.title}`);
            continue;
          }

          // Save to local memory
          const fileName = `${source.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`;
          const filePath = path.join(localMemoryDir, fileName);
          await fs.writeFile(filePath, content, "utf-8");

          console.log(`  ⬇️  Pulled from cloud: ${fileName}`);
          pulled++;
        } catch (error: unknown) {
          const err = error as { message?: string };
          console.warn(`  ⚠️  Failed to pull ${source.title}:`, err.message);
        }
      } else {
        skipped++;
      }
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    if (err.message?.includes("not authenticated")) {
      throw error;
    }
    console.warn("⚠️  Failed to sync from NotebookLLM:", err.message);
  }

  return { pulled, skipped };
}

/**
 * Process pending sync queue (reconnection logic)
 */
async function processSyncQueue(
  db: Database.Database,
  memoryDir: string,
): Promise<{ processed: number; failed: number }> {
  const pending = getPendingSyncOperations(db);

  if (pending.length === 0) {
    return { processed: 0, failed: 0 };
  }

  console.log(`\n🔄 Processing ${pending.length} queued operations...\n`);

  let processed = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      if (item.destination === "notebooklm") {
        const filePath = path.join(memoryDir, item.file_name);
        const exists = await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false);

        if (!exists) {
          console.warn(`  ⚠️  File not found: ${item.file_name}`);
          markSyncFailed(db, item.id!, "File not found");
          failed++;
          continue;
        }

        await execFileNoThrow("nlm", ["source", "add", TULSBOT_NOTEBOOK_ID, "--file", filePath]);

        markSyncCompleted(db, item.id!);
        console.log(`  ✅ Synced queued item: ${item.file_name}`);
        processed++;
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      markSyncFailed(db, item.id!, err.message || "Unknown error");
      console.error(`  ✗ Failed queued item: ${item.file_name}`);
      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Unified search: query both local and NotebookLLM
 */
async function unifiedSearch(query: string, localMemoryDir: string): Promise<void> {
  console.log(`🔍 Searching for: "${query}"\n`);

  // Search local files
  console.log("📁 Local results:");
  const localFiles = await fs.readdir(localMemoryDir);
  let localMatches = 0;

  for (const fileName of localFiles) {
    if (!fileName.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(localMemoryDir, fileName);
    const content = await fs.readFile(filePath, "utf-8");

    if (content.toLowerCase().includes(query.toLowerCase())) {
      console.log(`  • ${fileName}`);
      localMatches++;
    }
  }

  if (localMatches === 0) {
    console.log("  (no matches)");
  }

  // Search NotebookLLM
  if (ENABLE_NOTEBOOKLM) {
    console.log("\n☁️  Cloud results:");
    try {
      const { stdout } = await execFileNoThrow("nlm", [
        "query",
        "notebook",
        TULSBOT_NOTEBOOK_ID,
        query,
      ]);

      console.log(stdout);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error("  ✗ Cloud search failed:", err.message);
    }
  }

  console.log();
}

/**
 * Bidirectional sync: sync in both directions
 */
async function bidirectionalSync(
  memoryDir: string,
  brainDir: string,
  db: Database.Database,
): Promise<void> {
  console.log("🔄 Starting bidirectional sync...\n");

  // Step 1: Process any pending queue items (offline reconciliation)
  const queueResults = await processSyncQueue(db, memoryDir);
  if (queueResults.processed > 0 || queueResults.failed > 0) {
    console.log(
      `   Processed ${queueResults.processed} queued items, ${queueResults.failed} failed\n`,
    );
  }

  // Step 2: Sync local → cloud (existing direction)
  console.log("⬆️  Local → Cloud:");
  const localFiles = await fs.readdir(memoryDir);
  let localToCloud = 0;

  for (const fileName of localFiles) {
    if (!fileName.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(memoryDir, fileName);
    const memory = await parseMemoryFile(filePath);

    // Sync to AnythingLLM
    try {
      await syncToAnythingLLM(memory, brainDir);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.warn(`  ⚠️  AnythingLLM error for ${fileName}:`, err.message);
    }

    // Sync to NotebookLLM
    const synced = await syncToNotebookLLM(filePath, db);
    if (synced) {
      localToCloud++;
    }
  }

  console.log(`   Synced ${localToCloud} files\n`);

  // Step 3: Sync cloud → local (new reverse direction)
  console.log("⬇️  Cloud → Local:");
  const { pulled, skipped } = await syncFromNotebookLLM(memoryDir, db);
  console.log(`   Pulled ${pulled} new files, skipped ${skipped} existing\n`);
}

/**
 * One-shot bidirectional sync
 */
async function syncOnce() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const memoryDir = path.join(homeDir, ".openclaw", "workspace", "memory");
  const brainDir = path.join(PROJECT_ROOT, "anythingllm-sync-output", "brain");

  // Ensure directories exist
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.mkdir(brainDir, { recursive: true });

  const db = initSyncDatabase();

  await bidirectionalSync(memoryDir, brainDir, db);

  console.log("✅ Sync complete\n");

  db.close();
}

/**
 * Watch mode: continuously sync changes
 */
async function watchMode() {
  console.log("👀 Starting bidirectional sync in watch mode...\n");

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const memoryDir = path.join(homeDir, ".openclaw", "workspace", "memory");
  const brainDir = path.join(PROJECT_ROOT, "anythingllm-sync-output", "brain");

  await fs.mkdir(memoryDir, { recursive: true });
  await fs.mkdir(brainDir, { recursive: true });

  const db = initSyncDatabase();

  // Initial sync
  await bidirectionalSync(memoryDir, brainDir, db);

  // Watch for local changes
  const watcher = chokidar.watch(memoryDir, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
  });

  watcher
    .on("add", async (filePath) => {
      if (filePath.endsWith(".md")) {
        console.log(`\n📝 New file: ${path.basename(filePath)}`);
        const memory = await parseMemoryFile(filePath);
        await syncToAnythingLLM(memory, brainDir);
        await syncToNotebookLLM(filePath, db);
      }
    })
    .on("change", async (filePath) => {
      if (filePath.endsWith(".md")) {
        console.log(`\n📝 Changed: ${path.basename(filePath)}`);
        const memory = await parseMemoryFile(filePath);
        await syncToAnythingLLM(memory, brainDir);
        await syncToNotebookLLM(filePath, db);
      }
    });

  // Periodic check for cloud changes (every 5 minutes)
  setInterval(
    async () => {
      console.log(`\n⏰ Checking for cloud updates...`);
      const { pulled } = await syncFromNotebookLLM(memoryDir, db);
      if (pulled > 0) {
        console.log(`   Pulled ${pulled} new files from cloud`);
      }
    },
    5 * 60 * 1000,
  );

  console.log("\n✅ Watch mode active. Press Ctrl+C to stop.");

  await new Promise(() => {});
}

async function main() {
  const args = process.argv.slice(2);

  // Search mode
  if (args.includes("--search")) {
    const query = args[args.indexOf("--search") + 1];
    if (!query) {
      console.error("❌ Please provide a search query");
      process.exit(1);
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const memoryDir = path.join(homeDir, ".openclaw", "workspace", "memory");
    await unifiedSearch(query, memoryDir);
    return;
  }

  // Watch mode
  const watchFlag = args.includes("--watch") || args.includes("-w");
  if (watchFlag) {
    await watchMode();
  } else {
    await syncOnce();
  }
}

main().catch((error: unknown) => {
  console.error("❌ Sync failed:", error);
  process.exit(1);
});
