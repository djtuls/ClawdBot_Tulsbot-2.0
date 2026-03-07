/**
 * scan-tools.ts
 * Indexes:
 *   - Skills: all SKILL.md files under workspace/skills/
 *   - Scripts: all .ts and .sh files under workspace/scripts/
 *   - Tools listed in TOOLS.md
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { IndexItem, ScanResult } from "./types.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_REPO = ".openclaw";

function extractSkillName(content: string, filePath: string): string {
  // First H1 heading
  const match = content.match(/^#\s+(.+)/m);
  if (match) {
    return match[1].trim();
  }
  // Fallback to parent directory name
  return path.basename(path.dirname(filePath));
}

function extractSkillSummary(content: string): string {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }
    if (line.length > 30) {
      return line.slice(0, 200);
    }
  }
  return lines[0]?.slice(0, 200) ?? "";
}

function skillStatus(content: string, filePath: string): IndexItem["status"] {
  const lc = content.slice(0, 1500).toLowerCase();
  if (lc.includes("deprecated") || filePath.includes("deprecated")) {
    return "deprecated";
  }
  if (content.trim().length < 100) {
    return "needs_context";
  }
  return "current";
}

async function* walkSkills(dir: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSkills(full);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      yield full;
    }
  }
}

/** Parse TOOLS.md for tool entries (lines starting with `- **`) */
async function parseToolsMd(): Promise<IndexItem[]> {
  const toolsMdPath = path.join(REPO_ROOT, "TOOLS.md");
  let content: string;
  try {
    content = await fs.readFile(toolsMdPath, "utf8");
  } catch {
    return [];
  }

  const items: IndexItem[] = [];
  const lines = content.split("\n");
  let currentSection = "";

  for (const line of lines) {
    const headingMatch = line.match(/^#+\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      continue;
    }

    // Match "- **tool-name**" or "- `tool-name`"
    const toolMatch = line.match(
      /^[-*]\s+[`*]{1,2}([a-zA-Z0-9_\-.]+)[`*]{0,2}(?:\s*[—:-]\s*(.+))?/,
    );
    if (!toolMatch) {
      continue;
    }

    const name = toolMatch[1].trim();
    const summary = toolMatch[2]?.trim() ?? "";
    const lc = line.toLowerCase();
    const status: IndexItem["status"] = lc.includes("deprecated")
      ? "deprecated"
      : lc.includes("wip") || summary.length < 5
        ? "needs_context"
        : "current";

    items.push({
      item_key: `tool:${SOURCE_REPO}:tools-md:${name}`,
      name,
      source_type: "tool",
      status,
      path: "TOOLS.md",
      content_summary: summary || `Tool: ${name}`,
      tags: ["tools-md", currentSection.toLowerCase().replace(/\s+/g, "-")].filter(Boolean),
      source_repo: SOURCE_REPO,
      metadata: { section: currentSection },
    });
  }

  return items;
}

/** Index all scripts/*.ts and scripts/*.sh (excluding indexer itself) */
async function scanScripts(): Promise<IndexItem[]> {
  const scriptsDir = path.join(REPO_ROOT, "scripts");
  const items: IndexItem[] = [];
  let entries: string[];

  try {
    entries = (await fs.readdir(scriptsDir)).filter(
      (f) => (f.endsWith(".ts") || f.endsWith(".sh")) && !f.startsWith("indexer/"),
    );
  } catch {
    return [];
  }

  for (const filename of entries) {
    const full = path.join(scriptsDir, filename);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) {
        continue;
      }

      const content = await fs.readFile(full, "utf8");
      const firstComment =
        content
          .split("\n")
          .find((l) => l.trim().startsWith("//") || l.trim().startsWith("#"))
          ?.replace(/^[/#\s*]+/, "")
          .slice(0, 200) ?? "";

      const lc = content.slice(0, 1000).toLowerCase();
      const status: IndexItem["status"] = lc.includes("deprecated") ? "deprecated" : "current";

      const tags: string[] = ["script"];
      if (lc.includes("heartbeat")) {
        tags.push("heartbeat");
      }
      if (lc.includes("sync")) {
        tags.push("sync");
      }
      if (lc.includes("memory")) {
        tags.push("memory");
      }
      if (lc.includes("notion")) {
        tags.push("notion");
      }
      if (lc.includes("supabase")) {
        tags.push("supabase");
      }

      items.push({
        item_key: `script:${SOURCE_REPO}:scripts/${filename}`,
        name: filename,
        source_type: "script",
        status,
        path: `scripts/${filename}`,
        content_summary: firstComment || `Script: ${filename}`,
        tags: [...new Set(tags)],
        source_repo: SOURCE_REPO,
        metadata: { size_bytes: content.length, ext: path.extname(filename) },
      });
    } catch {
      // skip unreadable
    }
  }

  return items;
}

export async function scanTools(): Promise<ScanResult> {
  const items: IndexItem[] = [];
  const errors: string[] = [];

  // 1. Skills from skills/ dir
  const skillsDir = path.join(REPO_ROOT, "skills");
  for await (const skillPath of walkSkills(skillsDir)) {
    try {
      const content = await fs.readFile(skillPath, "utf8");
      const rel = path.relative(REPO_ROOT, skillPath);
      const name = extractSkillName(content, skillPath);
      items.push({
        item_key: `skill:${SOURCE_REPO}:${rel}`,
        name,
        source_type: "skill",
        status: skillStatus(content, skillPath),
        path: rel,
        content_summary: extractSkillSummary(content),
        tags: ["skill", path.dirname(rel).split(path.sep)[1] ?? ""].filter(Boolean),
        source_repo: SOURCE_REPO,
        metadata: { size_bytes: content.length },
      });
    } catch (err) {
      errors.push(
        `scan-tools/skills: ${skillPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. TOOLS.md entries
  try {
    const toolItems = await parseToolsMd();
    items.push(...toolItems);
  } catch (err) {
    errors.push(`scan-tools/TOOLS.md: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Scripts
  try {
    const scriptItems = await scanScripts();
    items.push(...scriptItems);
  } catch (err) {
    errors.push(`scan-tools/scripts: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { scanner: "scan-tools", items, errors };
}
