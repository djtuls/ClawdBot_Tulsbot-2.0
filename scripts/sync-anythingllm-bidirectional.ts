#!/usr/bin/env tsx

/**
 * Bidirectional sync between OpenClaw and AnythingLLM
 *
 * This script ensures anythingllm-sync-output is ALWAYS in sync with OpenClaw's memory:
 * 1. Watches OpenClaw workspace directory for changes
 * 2. Exports new/modified memories to anythingllm-sync-output/brain/
 * 3. Maintains the AnythingLLM markdown format with metadata headers
 * 4. Preserves existing backup files (doesn't delete)
 * 5. Can run as a daemon or one-shot sync
 */

import chokidar from "chokidar";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

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

  // Extract metadata (if present from previous import)
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
    tier: tierMatch?.[1]?.trim() || "learnings", // Default to learnings tier
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
 * Format: cc-sync-{hash}.md (matches AnythingLLM convention)
 */
function generateBrainFileName(memory: MemoryFileMetadata): string {
  const shortHash = memory.hash.slice(0, 16);
  return `cc-sync-${shortHash}.md`;
}

/**
 * Sync a single memory file to anythingllm-sync-output
 */
async function syncMemoryToAnythingLLM(
  memoryPath: string,
  workspaceDir: string,
  brainDir: string,
): Promise<void> {
  const content = await fs.readFile(memoryPath, "utf-8");
  const fileName = path.basename(memoryPath);
  const memory = parseMemoryFile(content, fileName);

  // Skip files that came from anythingllm backup (avoid circular sync)
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
  console.log(`  ✓ Synced: ${fileName} → ${brainFileName}`);
}

/**
 * One-shot sync: sync all current memory files
 */
async function syncOnce() {
  console.log("🔄 Starting one-shot bidirectional sync...\n");

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const workspaceDir = path.join(homeDir, ".openclaw", "workspace", "memory");
  const brainDir = path.join(PROJECT_ROOT, "anythingllm-sync-output", "brain");

  // Ensure directories exist
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(brainDir, { recursive: true });

  // Read all memory files
  const memoryFiles = await fs.readdir(workspaceDir);
  const mdFiles = memoryFiles.filter((f) => f.endsWith(".md"));

  console.log(`📚 Found ${mdFiles.length} memory files in workspace`);
  console.log(`📁 Syncing to: ${brainDir}\n`);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const fileName of mdFiles) {
    try {
      const memoryPath = path.join(workspaceDir, fileName);
      await syncMemoryToAnythingLLM(memoryPath, workspaceDir, brainDir);
      synced++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("anythingllm-backup")) {
        skipped++;
      } else {
        console.error(`  ✗ Error syncing ${fileName}:`, error);
        errors++;
      }
    }
  }

  console.log(`\n✅ Sync complete:`);
  console.log(`   - Synced: ${synced} files`);
  console.log(`   - Skipped: ${skipped} files (from backup)`);
  console.log(`   - Errors: ${errors} files`);
}

/**
 * Watch mode: continuously sync changes
 */
async function watchMode() {
  console.log("👀 Starting bidirectional sync in watch mode...\n");

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const workspaceDir = path.join(homeDir, ".openclaw", "workspace", "memory");
  const brainDir = path.join(PROJECT_ROOT, "anythingllm-sync-output", "brain");

  // Ensure directories exist
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(brainDir, { recursive: true });

  console.log(`📁 Watching: ${workspaceDir}`);
  console.log(`📁 Syncing to: ${brainDir}\n`);

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
          await syncMemoryToAnythingLLM(filePath, workspaceDir, brainDir);
        } catch (error) {
          console.error(`  ✗ Sync error:`, error);
        }
      }
    })
    .on("change", async (filePath) => {
      if (filePath.endsWith(".md")) {
        console.log(`\n📝 Changed: ${path.basename(filePath)}`);
        try {
          await syncMemoryToAnythingLLM(filePath, workspaceDir, brainDir);
        } catch (error) {
          console.error(`  ✗ Sync error:`, error);
        }
      }
    })
    .on("unlink", (filePath) => {
      if (filePath.endsWith(".md")) {
        console.log(`\n🗑️  Deleted: ${path.basename(filePath)}`);
        console.log("   (Brain file preserved in anythingllm-sync-output)");
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
