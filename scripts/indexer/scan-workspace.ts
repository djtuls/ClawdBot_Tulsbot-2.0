/**
 * scan-workspace.ts
 * Walks the workspace directory and indexes:
 *   - .md files → doc
 *   - memory/ files → memory
 *   - openclaw.json, package.json, tsconfig.json → config
 * Detects deprecated content via header markers or file path conventions.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { IndexItem, ScanResult } from "./types.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_REPO = ".openclaw";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".turbo",
  "sessions",
  "logs",
  "media",
  "browser",
  "canvas",
]);

const CONFIG_FILES = new Set([
  "openclaw.json",
  "package.json",
  "tsconfig.json",
  "fly.toml",
  "docker-compose.yml",
  "render.yaml",
  "pnpm-workspace.yaml",
]);

/** Detect deprecated status from frontmatter or header keywords */
function detectStatus(content: string, filePath: string): IndexItem["status"] {
  const lower = content.slice(0, 2000).toLowerCase();
  if (
    lower.includes("deprecated") ||
    lower.includes("status: deprecated") ||
    filePath.includes("deprecated") ||
    filePath.includes("legacy") ||
    filePath.includes("archive")
  ) {
    return "deprecated";
  }
  // If content is very short (stub) or placeholder, mark as needs_context
  if (content.trim().length < 80 || lower.includes("todo: fill") || lower.includes("wip")) {
    return "needs_context";
  }
  return "current";
}

/** Extract a one-line summary from markdown content */
function extractSummary(content: string): string {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Skip leading heading lines; return first substantial paragraph line
  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("---") || line.startsWith("```")) {
      continue;
    }
    if (line.length > 20) {
      return line.slice(0, 200);
    }
  }
  return lines[0]?.slice(0, 200) ?? "";
}

/** Derive tags from file path segments and content keywords */
function deriveTags(filePath: string, content: string): string[] {
  const tags: string[] = [];
  const rel = path.relative(REPO_ROOT, filePath);
  const parts = rel.split(path.sep);

  // Top-level dir as tag
  if (parts.length > 1) {
    tags.push(parts[0]);
  }

  // Known keyword tags
  const lc = content.slice(0, 3000).toLowerCase();
  if (lc.includes("heartbeat")) {
    tags.push("heartbeat");
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
  if (lc.includes("sync")) {
    tags.push("sync");
  }
  if (lc.includes("agent")) {
    tags.push("agent");
  }
  if (lc.includes("blueprint")) {
    tags.push("blueprint");
  }
  if (lc.includes("todo")) {
    tags.push("todo");
  }

  return [...new Set(tags)];
}

async function* walkDir(dir: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export async function scanWorkspace(): Promise<ScanResult> {
  const items: IndexItem[] = [];
  const errors: string[] = [];

  for await (const filePath of walkDir(REPO_ROOT)) {
    const rel = path.relative(REPO_ROOT, filePath);
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath);

    try {
      // --- docs: markdown files ---
      if (ext === ".md" && !rel.startsWith("scripts/indexer/")) {
        const content = await fs.readFile(filePath, "utf8");
        const status = detectStatus(content, filePath);
        const item_key = `doc:${SOURCE_REPO}:${rel}`;
        items.push({
          item_key,
          name: base.replace(/\.md$/, ""),
          source_type: "doc",
          status,
          path: rel,
          content_summary: extractSummary(content),
          tags: deriveTags(filePath, content),
          source_repo: SOURCE_REPO,
          metadata: { size_bytes: content.length },
        });
        continue;
      }

      // --- memory files ---
      if (rel.startsWith("memory/") && (ext === ".json" || ext === ".md" || ext === ".txt")) {
        const content = await fs.readFile(filePath, "utf8");
        const item_key = `memory:${SOURCE_REPO}:${rel}`;
        items.push({
          item_key,
          name: base,
          source_type: "memory",
          status: shouldDeprecate(filePath) ? "deprecated" : "current",
          path: rel,
          content_summary: `Memory file: ${rel}`,
          tags: deriveTags(filePath, content),
          source_repo: SOURCE_REPO,
          metadata: { size_bytes: content.length },
        });
        continue;
      }

      // --- config files ---
      if (CONFIG_FILES.has(base)) {
        const content = await fs.readFile(filePath, "utf8");
        const item_key = `config:${SOURCE_REPO}:${rel}`;
        items.push({
          item_key,
          name: base,
          source_type: "config",
          status: shouldDeprecate(filePath) ? "deprecated" : "current",
          path: rel,
          content_summary: `Config: ${rel}`,
          tags: [
            "config",
            path.dirname(rel) !== "." ? path.dirname(rel).split(path.sep)[0] : "root",
          ],
          source_repo: SOURCE_REPO,
          metadata: { size_bytes: content.length },
        });
      }
    } catch (err) {
      errors.push(`scan-workspace: ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { scanner: "scan-workspace", items, errors };
}

// DEPRECATION RULES - Files that should be marked deprecated
const DEPRECATION_PATTERNS = [
  // Old cloud memory sync docs (superseded by 3-layer system)
  /CLOUD-MEMORY-SYNC-/i,
  /TULSBOT-CLOUD-MEMORY/i,
  /TULSBOT-KNOWLEDGE-MIGRATION/i,
  /PEER-REVIEW-REPORT/i,

  // Old migrations (superseded by master_index)
  /20260220_.*\.sql/,
  /20260221_.*\.sql/,
  /remote_schema.*\.sql/,

  // Old bootstrap (should be deleted)
  /BOOTSTRAP/i,

  // Pre-blueprint docs
  /CLAWDBOT-OLD/i,
  /old-.*system/i,
];

export function shouldDeprecate(path: string, content?: string): boolean {
  for (const pattern of DEPRECATION_PATTERNS) {
    if (pattern.test(path)) {
      return true;
    }
  }
  // Check content for deprecated markers
  if (content) {
    if (content.includes("[DEPRECATED]")) {
      return true;
    }
    if (content.includes("{{DEPRECATED}}")) {
      return true;
    }
  }
  return false;
}

// DEPRECATION CHECK - Apply to scanner
export function getDeprecationStatus(filePath: string, content?: string): "current" | "deprecated" {
  return shouldDeprecate(filePath, content) ? "deprecated" : "current";
}
