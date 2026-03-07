/**
 * scan-databases.ts
 * Catalogs all known databases:
 *   - Supabase tables: parsed from migration .sql files
 *   - Notion databases: parsed from sync registry or AGENTS.md / docs
 *   - SQLite: any .db/.sqlite files in repo
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { IndexItem, ScanResult } from "./types.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_REPO = ".openclaw";

/** Extract CREATE TABLE statements from SQL migration files */
async function scanSupabaseMigrations(): Promise<IndexItem[]> {
  const migrationsDir = path.join(REPO_ROOT, "supabase", "migrations");
  const items: IndexItem[] = [];

  let files: string[];
  try {
    files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).toSorted();
  } catch {
    return [];
  }

  // Track which tables we've already seen (last migration wins for status)
  const tableMap = new Map<string, { status: ItemStatus; migration: string; summary: string }>();

  type ItemStatus = "current" | "deprecated" | "needs_context";

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    let sql: string;
    try {
      sql = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    // CREATE TABLE statements
    const createMatches = sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?[\w]+"?\.)?"?([\w]+)"?\s*\(/gi,
    );
    for (const match of createMatches) {
      const tableName = match[1];
      if (!tableName) {
        continue;
      }
      tableMap.set(tableName, {
        status: "current",
        migration: file,
        summary: `Supabase table defined in migration ${file}`,
      });
    }

    // DROP TABLE statements — mark as deprecated
    const dropMatches = sql.matchAll(
      /drop\s+table\s+(?:if\s+exists\s+)?(?:"?[\w]+"?\.)?"?([\w]+)"?/gi,
    );
    for (const match of dropMatches) {
      const tableName = match[1];
      if (!tableName) {
        continue;
      }
      const existing = tableMap.get(tableName);
      if (existing) {
        existing.status = "deprecated";
        existing.summary = `Dropped in migration ${file}`;
      }
    }
  }

  for (const [tableName, meta] of tableMap) {
    items.push({
      item_key: `database:${SOURCE_REPO}:supabase:${tableName}`,
      name: tableName,
      source_type: "database",
      status: meta.status,
      path: `supabase/migrations/${meta.migration}`,
      content_summary: meta.summary,
      tags: ["supabase", "table", meta.status === "deprecated" ? "deprecated" : "current"],
      source_repo: SOURCE_REPO,
      metadata: {
        db_engine: "supabase-postgres",
        migration_file: meta.migration,
      },
    });
  }

  return items;
}

/** Scan for SQLite files in repo */
async function scanSqliteFiles(): Promise<IndexItem[]> {
  const items: IndexItem[] = [];
  const memoryDir = path.join(REPO_ROOT, "memory");

  let files: string[];
  try {
    files = await fs.readdir(memoryDir);
  } catch {
    return [];
  }

  for (const file of files) {
    if (!file.endsWith(".db") && !file.endsWith(".sqlite") && !file.endsWith(".sqlite3")) {
      continue;
    }
    const rel = `memory/${file}`;
    items.push({
      item_key: `database:${SOURCE_REPO}:sqlite:${rel}`,
      name: file,
      source_type: "database",
      status: "current",
      path: rel,
      content_summary: `SQLite database at ${rel}`,
      tags: ["sqlite", "local", "memory"],
      source_repo: SOURCE_REPO,
      metadata: { db_engine: "sqlite" },
    });
  }

  return items;
}

/** Parse Notion database references from AGENTS.md or docs */
async function scanNotionDatabases(): Promise<IndexItem[]> {
  const items: IndexItem[] = [];
  const candidateFiles = ["AGENTS.md", "TOOLS.md", "docs/tulsbot-ecosystem/blueprint.md"];

  for (const relPath of candidateFiles) {
    const filePath = path.join(REPO_ROOT, relPath);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    // Match Notion DB IDs (32 hex chars, with or without dashes)
    const notionDbRegex =
      /(?:database[_-]?id|notion[_-]db|notion_database)[^\n]*?([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})/gi;
    const seen = new Set<string>();

    for (const match of content.matchAll(notionDbRegex)) {
      const rawId = match[1].replace(/-/g, "");
      if (seen.has(rawId)) {
        continue;
      }
      seen.add(rawId);

      // Get surrounding context as summary
      const idx = match.index ?? 0;
      const context = content
        .slice(Math.max(0, idx - 60), idx + 80)
        .replace(/\n/g, " ")
        .trim();

      items.push({
        item_key: `database:${SOURCE_REPO}:notion:${rawId}`,
        name: `notion-db-${rawId.slice(0, 8)}`,
        source_type: "database",
        status: "needs_context",
        path: relPath,
        content_summary: context.slice(0, 200),
        tags: ["notion", "database", "needs-context"],
        source_repo: SOURCE_REPO,
        metadata: {
          db_engine: "notion",
          notion_db_id: rawId,
          found_in: relPath,
        },
      });
    }
  }

  return items;
}

export async function scanDatabases(): Promise<ScanResult> {
  const items: IndexItem[] = [];
  const errors: string[] = [];

  try {
    items.push(...(await scanSupabaseMigrations()));
  } catch (err) {
    errors.push(`scan-databases/supabase: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    items.push(...(await scanSqliteFiles()));
  } catch (err) {
    errors.push(`scan-databases/sqlite: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    items.push(...(await scanNotionDatabases()));
  } catch (err) {
    errors.push(`scan-databases/notion: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { scanner: "scan-databases", items, errors };
}

// DEPRECATION RULE: Databases older than Feb 20, 2026
const DEPRECATION_CUTOFF = new Date("2026-02-20T00:00:00Z");

export function shouldDeprecateDatabase(lastEdited: string): boolean {
  const edited = new Date(lastEdited);
  return edited < DEPRECATION_CUTOFF;
}
