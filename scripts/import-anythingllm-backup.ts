#!/usr/bin/env tsx

/**
 * Import AnythingLLM backup into OpenClaw memory system
 *
 * This script:
 * 1. Parses markdown files from anythingllm-sync-output/brain/
 * 2. Extracts metadata (Type, Tier, Confidence, Created)
 * 3. Writes to OpenClaw workspace memory directory
 * 4. Preserves original timestamps for chronological ordering
 * 5. Optionally imports conversation history
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

type BrainFileMetadata = {
  title: string;
  type: string;
  tier: string;
  confidence: number;
  created: Date;
  content: string;
};

/**
 * Parse AnythingLLM brain markdown file
 * Format:
 * # Title
 * **Type:** fact
 * **Tier:** permanent
 * **Confidence:** 0.95
 * **Created:** Mon Feb 09 2026 15:00:25 GMT-0300 (Brasilia Standard Time)
 * ---
 * Content here...
 */
function parseBrainFile(fileContent: string, fileName: string): BrainFileMetadata {
  const lines = fileContent.split("\n");

  // Extract title (first line starting with #)
  const titleLine = lines.find((line) => line.trim().startsWith("#"));
  const title = titleLine ? titleLine.replace(/^#\s*/, "").trim() : fileName.replace(".md", "");

  // Extract metadata
  const typeMatch = fileContent.match(/\*\*Type:\*\*\s*(.+?)$/m);
  const tierMatch = fileContent.match(/\*\*Tier:\*\*\s*(.+?)$/m);
  const confidenceMatch = fileContent.match(/\*\*Confidence:\*\*\s*(.+?)$/m);
  const createdMatch = fileContent.match(/\*\*Created:\*\*\s*(.+?)$/m);

  // Extract content (everything after ---)
  const separatorIndex = fileContent.indexOf("\n---\n");
  const content = separatorIndex >= 0 ? fileContent.slice(separatorIndex + 5).trim() : fileContent;

  return {
    title,
    type: typeMatch?.[1]?.trim() || "unknown",
    tier: tierMatch?.[1]?.trim() || "temporary",
    confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
    created: createdMatch ? new Date(createdMatch[1].trim()) : new Date(),
    content,
  };
}

/**
 * Convert brain file to OpenClaw memory markdown format
 */
function convertToMemoryFormat(brain: BrainFileMetadata): string {
  const frontmatter = [
    `# ${brain.title}`,
    "",
    `**Type:** ${brain.type}`,
    `**Tier:** ${brain.tier}`,
    `**Confidence:** ${brain.confidence}`,
    `**Source:** anythingllm-backup`,
    `**Imported:** ${new Date().toISOString()}`,
    `**Original Created:** ${brain.created.toISOString()}`,
    "",
    "---",
    "",
  ].join("\n");

  return frontmatter + brain.content;
}

/**
 * Generate filename from brain metadata
 * Format: YYYY-MM-DD-{title-slug}.md
 */
function generateMemoryFileName(brain: BrainFileMetadata): string {
  const dateStr = brain.created.toISOString().split("T")[0]; // YYYY-MM-DD
  const slug = brain.title
    .replace(/\.md$/i, "") // strip .md extension to prevent -md.md filenames
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return `${dateStr}-${slug}.md`;
}

async function main() {
  console.log("🔄 Starting AnythingLLM backup import...\n");

  const backupDir = path.join(PROJECT_ROOT, "anythingllm-sync-output");
  const brainDir = path.join(backupDir, "brain");

  // Determine workspace directory (use ~/.openclaw/workspace or create local test dir)
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const workspaceDir = path.join(homeDir, ".openclaw", "workspace", "memory");

  // Ensure workspace directory exists
  await fs.mkdir(workspaceDir, { recursive: true });
  console.log(`📁 Workspace directory: ${workspaceDir}\n`);

  // Import brain files
  console.log("📚 Importing brain files...");
  const brainFiles = await fs.readdir(brainDir);
  const mdFiles = brainFiles.filter((f) => f.endsWith(".md"));

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const fileName of mdFiles) {
    try {
      const filePath = path.join(brainDir, fileName);
      const content = await fs.readFile(filePath, "utf-8");
      const brain = parseBrainFile(content, fileName);

      const memoryFileName = generateMemoryFileName(brain);
      const memoryFilePath = path.join(workspaceDir, memoryFileName);

      // Check if file already exists (avoid duplicates)
      const exists = await fs
        .access(memoryFilePath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        skipped++;
        continue;
      }

      const memoryContent = convertToMemoryFormat(brain);
      await fs.writeFile(memoryFilePath, memoryContent, "utf-8");
      imported++;

      if (imported % 50 === 0) {
        console.log(`  Imported ${imported}/${mdFiles.length} brain files...`);
      }
    } catch (error) {
      console.error(`  Error importing ${fileName}:`, error);
      errors++;
    }
  }

  console.log(`\n✅ Brain import complete:`);
  console.log(`   - Imported: ${imported} files`);
  console.log(`   - Skipped: ${skipped} files (already exist)`);
  console.log(`   - Errors: ${errors} files\n`);

  // TODO: Import conversations (optional)
  console.log("💬 Conversation import: Not implemented yet");
  console.log("   (Conversations are stored separately in AnythingLLM format)\n");

  console.log("🎯 Next steps:");
  console.log("   1. Run OpenClaw to trigger memory sync");
  console.log("   2. SQLite index will be automatically rebuilt");
  console.log("   3. Test memory restoration: openclaw agent --message 'What do you remember?'");
  console.log("\n🔄 To enable bidirectional sync, see: scripts/sync-anythingllm-bidirectional.ts");
}

main().catch((error) => {
  console.error("❌ Import failed:", error);
  process.exit(1);
});
