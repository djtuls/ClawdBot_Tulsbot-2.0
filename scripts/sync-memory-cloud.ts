#!/usr/bin/env tsx

/**
 * Cloud Memory Sync - Extends bidirectional sync to include NotebookLLM
 *
 * This script syncs OpenClaw memory to:
 * 1. AnythingLLM (local RAG) - file sync only
 * 2. NotebookLLM (cloud RAG) - online queryable brain
 *
 * Architecture:
 * - Local memory: ~/.openclaw/workspace/memory/*.md
 * - AnythingLLM: ./anythingllm-sync-output/brain/*.md (local RAG)
 * - NotebookLLM: Tulsbot notebook (cloud RAG, queryable via nlm CLI)
 *
 * Usage:
 *   npm run sync-memory-cloud          # One-shot sync
 *   npm run sync-memory-cloud --watch  # Continuous sync
 */

import chokidar from "chokidar";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// NotebookLLM configuration
const TULSBOT_NOTEBOOK_ID = process.env.TULSBOT_NOTEBOOK_ID || "";
const ENABLE_NOTEBOOKLM = TULSBOT_NOTEBOOK_ID !== "";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (!ENABLE_NOTEBOOKLM) {
  console.warn("⚠️  TULSBOT_NOTEBOOK_ID not set. NotebookLLM sync disabled.");
  console.warn("   Set it in your environment to enable cloud memory:\n");
  console.warn("   export TULSBOT_NOTEBOOK_ID=<your-notebook-id>\n");
}

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
};

/**
 * Parse OpenClaw memory markdown file
 */
function parseMemoryFile(fileContent: string, fileName: string): MemoryFileMetadata {
  const lines = fileContent.split("\n");

  // Extract title
  const titleLine = lines.find((line) => line.trim().startsWith("#"));
  const title = titleLine ? titleLine.replace(/^#\s*/, "").trim() : fileName.replace(".md", "");

  // Extract metadata
  const typeMatch = fileContent.match(/\*\*Type:\*\*\s*(.+?)$/m);
  const tierMatch = fileContent.match(/\*\*Tier:\*\*\s*(.+?)$/m);
  const confidenceMatch = fileContent.match(/\*\*Confidence:\*\*\s*(.+?)$/m);
  const sourceMatch = fileContent.match(/\*\*Source:\*\*\s*(.+?)$/m);
  const importedMatch = fileContent.match(/\*\*Imported:\*\*\s*(.+?)$/m);
  const originalCreatedMatch = fileContent.match(/\*\*Original Created:\*\*\s*(.+?)$/m);

  // Extract content (everything after ---)
  const separatorIndex = fileContent.indexOf("\n---\n");
  const content = separatorIndex >= 0 ? fileContent.slice(separatorIndex + 5).trim() : fileContent;

  // Generate hash for change detection
  const hash = createHash("md5").update(content).digest("hex");

  return {
    title,
    type: typeMatch?.[1]?.trim(),
    tier: tierMatch?.[1]?.trim() || "learnings",
    confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7,
    source: sourceMatch?.[1]?.trim(),
    imported: importedMatch ? new Date(importedMatch[1].trim()) : undefined,
    originalCreated: originalCreatedMatch ? new Date(originalCreatedMatch[1].trim()) : undefined,
    content,
    filePath: fileName,
    hash,
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
 * Sync memory to AnythingLLM (local RAG)
 */
async function syncToAnythingLLM(memoryPath: string, brainDir: string): Promise<void> {
  const content = await fs.readFile(memoryPath, "utf-8");
  const fileName = path.basename(memoryPath);
  const memory = parseMemoryFile(content, fileName);

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
  console.log(`  ✓ AnythingLLM: ${fileName} → ${brainFileName}`);
}

/**
 * Sync memory to NotebookLLM (cloud RAG)
 * Uses nlm CLI to upload file to the Tulsbot notebook
 */
async function syncToNotebookLLM(memoryPath: string): Promise<void> {
  if (!ENABLE_NOTEBOOKLM) {
    return; // NotebookLLM disabled
  }

  const fileName = path.basename(memoryPath);

  try {
    // Use execFileNoThrow for safe command execution (prevents command injection)
    const { stderr } = await execFileNoThrow("nlm", [
      "source",
      "add",
      TULSBOT_NOTEBOOK_ID,
      "--file",
      memoryPath,
    ]);

    if (stderr && !stderr.includes("Source added successfully")) {
      console.warn(`  ⚠️  NotebookLLM warning for ${fileName}:`, stderr);
    } else {
      console.log(`  ✓ NotebookLLM: ${fileName} uploaded`);
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes("already exists")) {
      console.log(`  ℹ️  NotebookLLM: ${fileName} already exists (skipped)`);
    } else if (message.includes("not authenticated")) {
      console.error(`  ✗ NotebookLLM auth error. Run: nlm login`);
      throw error;
    } else {
      console.error(`  ✗ NotebookLLM error for ${fileName}:`, message);
      throw error;
    }
  }
}

/**
 * Sync a single memory file to all destinations
 */
async function syncMemoryFile(
  memoryPath: string,
  brainDir: string,
): Promise<{ anythingllm: boolean; notebooklm: boolean }> {
  const results = { anythingllm: false, notebooklm: false };

  // Sync to AnythingLLM
  try {
    await syncToAnythingLLM(memoryPath, brainDir);
    results.anythingllm = true;
  } catch (error: unknown) {
    console.error(
      `  ✗ AnythingLLM error for ${path.basename(memoryPath)}:`,
      getErrorMessage(error),
    );
  }

  // Sync to NotebookLLM (independent of AnythingLLM success)
  if (ENABLE_NOTEBOOKLM) {
    try {
      await syncToNotebookLLM(memoryPath);
      results.notebooklm = true;
    } catch (error: unknown) {
      if (getErrorMessage(error).includes("not authenticated")) {
        throw error;
      }
    }
  }

  return results;
}

/**
 * One-shot sync: sync all current memory files
 */
async function syncOnce() {
  console.log("🔄 Starting cloud memory sync...\n");

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const workspaceDir = path.join(homeDir, ".openclaw", "workspace", "memory");
  const brainDir = path.join(PROJECT_ROOT, "anythingllm-sync-output", "brain");

  // Ensure directories exist
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(brainDir, { recursive: true });

  // Read all memory files
  const memoryFiles = await fs.readdir(workspaceDir);
  const mdFiles = memoryFiles.filter((f) => f.endsWith(".md"));

  console.log(`📚 Found ${mdFiles.length} memory files`);
  console.log(`📁 Local: ${workspaceDir}`);
  console.log(`📁 AnythingLLM: ${brainDir}`);
  if (ENABLE_NOTEBOOKLM) {
    console.log(`☁️  NotebookLLM: ${TULSBOT_NOTEBOOK_ID}\n`);
  } else {
    console.log(`☁️  NotebookLLM: disabled\n`);
  }

  let anyLLMSynced = 0;
  let notebookLLMSynced = 0;
  let skipped = 0;
  let errors = 0;

  for (const fileName of mdFiles) {
    try {
      const memoryPath = path.join(workspaceDir, fileName);
      const results = await syncMemoryFile(memoryPath, brainDir);

      if (results.anythingllm) {
        anyLLMSynced++;
      }
      if (results.notebooklm) {
        notebookLLMSynced++;
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (message.includes("anythingllm-backup") || message.includes("already exists")) {
        skipped++;
      } else if (message.includes("not authenticated")) {
        console.error("\n❌ NotebookLLM authentication required. Stopping.");
        console.error("   Run: nlm login\n");
        process.exit(1);
      } else {
        errors++;
      }
    }
  }

  console.log(`\n✅ Sync complete:`);
  console.log(`   - AnythingLLM: ${anyLLMSynced} files`);
  if (ENABLE_NOTEBOOKLM) {
    console.log(`   - NotebookLLM: ${notebookLLMSynced} files`);
  }
  console.log(`   - Skipped: ${skipped} files`);
  console.log(`   - Errors: ${errors} files\n`);

  if (ENABLE_NOTEBOOKLM && notebookLLMSynced > 0) {
    console.log(`🌐 Your memory is now queryable online via:`);
    console.log(`   nlm query notebook ${TULSBOT_NOTEBOOK_ID} "your question"\n`);
  }
}

/**
 * Watch mode: continuously sync changes
 */
async function watchMode() {
  console.log("👀 Starting cloud memory sync in watch mode...\n");

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const workspaceDir = path.join(homeDir, ".openclaw", "workspace", "memory");
  const brainDir = path.join(PROJECT_ROOT, "anythingllm-sync-output", "brain");

  // Ensure directories exist
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(brainDir, { recursive: true });

  console.log(`📁 Watching: ${workspaceDir}`);
  console.log(`📁 AnythingLLM: ${brainDir}`);
  if (ENABLE_NOTEBOOKLM) {
    console.log(`☁️  NotebookLLM: ${TULSBOT_NOTEBOOK_ID}\n`);
  } else {
    console.log(`☁️  NotebookLLM: disabled\n`);
  }

  // Do initial sync
  await syncOnce();

  // Watch for changes
  const watcher = chokidar.watch(workspaceDir, {
    ignored: /(^|[/\\])\../, // Ignore dotfiles
    persistent: true,
    ignoreInitial: true,
  });

  watcher
    .on("add", async (filePath) => {
      if (filePath.endsWith(".md")) {
        console.log(`\n📝 New file: ${path.basename(filePath)}`);
        try {
          await syncMemoryFile(filePath, brainDir);
        } catch (error: unknown) {
          if (getErrorMessage(error).includes("not authenticated")) {
            console.error("\n❌ NotebookLLM auth lost. Stopping watch mode.");
            console.error("   Run: nlm login\n");
            process.exit(1);
          }
        }
      }
    })
    .on("change", async (filePath) => {
      if (filePath.endsWith(".md")) {
        console.log(`\n📝 Changed: ${path.basename(filePath)}`);
        try {
          await syncMemoryFile(filePath, brainDir);
        } catch (error: unknown) {
          if (getErrorMessage(error).includes("not authenticated")) {
            console.error("\n❌ NotebookLLM auth lost. Stopping watch mode.");
            console.error("   Run: nlm login\n");
            process.exit(1);
          }
        }
      }
    })
    .on("unlink", (filePath) => {
      if (filePath.endsWith(".md")) {
        console.log(`\n🗑️  Deleted: ${path.basename(filePath)}`);
        console.log("   (Preserved in AnythingLLM & NotebookLLM)");
      }
    });

  console.log("\n✅ Watch mode active. Press Ctrl+C to stop.");

  // Keep process alive
  await new Promise(() => {});
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const watchFlag = args.has("--watch") || args.has("-w");

  if (watchFlag) {
    await watchMode();
  } else {
    await syncOnce();
  }
}

main().catch((error) => {
  console.error("❌ Sync failed:", error);
  process.exit(1);
});
