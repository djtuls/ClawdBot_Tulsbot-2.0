#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
/**
 * notion-sync.ts — Notion Databases → Vault Inbox
 *
 * Pulls pages from configured Notion databases, converts to markdown
 * with frontmatter, writes to vault 00_inbox/sources/notion/.
 *
 * Config: tuls-vault/08_system/sync-config.json
 * State:  ~/.openclaw/state/notion-sync-state.json
 *
 * Usage:
 *   npx tsx scripts/notion-sync.ts              # sync all configured databases
 *   npx tsx scripts/notion-sync.ts --dry-run    # show what would be synced
 *   npx tsx scripts/notion-sync.ts --force      # re-sync already processed pages
 *   npx tsx scripts/notion-sync.ts --db=<id>    # sync a specific database only
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { logCron, logError } from "./event-logger.js";

loadEnv({ path: join(process.env.HOME!, ".openclaw/workspace/.env") });

const VAULT = join(
  process.env.HOME!,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault",
);
const SYNC_CONFIG_PATH = join(VAULT, "08_system/sync-config.json");
const STATE_PATH = join(process.env.HOME!, ".openclaw/state/notion-sync-state.json");

const NOTION_TOKEN =
  process.env.NOTION_TOKEN_OPENCLAW_2 || process.env.NOTION_API_KEY || process.env.NOTION_KEY || "";
const NOTION_VERSION = "2022-06-28";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const DB_FILTER = process.argv.find((a) => a.startsWith("--db="))?.split("=")[1];

// --- Types ---

interface NotionDbConfig {
  id: string;
  name: string;
  domain?: string;
  output?: string;
  /** Only sync pages modified after this ISO date (overridden by state) */
  since?: string;
}

interface SyncConfig {
  notion: {
    enabled: boolean;
    databases: NotionDbConfig[];
  };
}

interface SyncState {
  databases: Record<string, { lastSyncAt: string; processedIds: string[] }>;
}

interface SyncResult {
  database: string;
  newPages: number;
  written: string[];
  errors: string[];
}

// --- Notion API helpers ---

async function notionFetch(endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
  if (!NOTION_TOKEN) {
    throw new Error("No Notion token found. Set NOTION_TOKEN_OPENCLAW_2 in .env");
  }

  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${method} ${endpoint} → ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function queryDatabase(dbId: string, lastSyncAt?: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  const filter = lastSyncAt
    ? { filter: { timestamp: "last_edited_time", last_edited_time: { after: lastSyncAt } } }
    : {};

  do {
    const body: Record<string, unknown> = { page_size: 100, ...filter };
    if (cursor) {
      body.start_cursor = cursor;
    }

    const result = (await notionFetch(`/databases/${dbId}/query`, "POST", body)) as QueryResult;
    pages.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return pages;
}

async function getBlocks(pageId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const url = `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const result = (await notionFetch(url)) as BlocksResult;
    blocks.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

// Minimal Notion type definitions
interface NotionPage {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionProperty>;
  parent: { type: string; database_id?: string; page_id?: string };
}

interface NotionProperty {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  select?: { name: string } | null;
  multi_select?: Array<{ name: string }>;
  status?: { name: string } | null;
  date?: { start: string; end?: string } | null;
  checkbox?: boolean;
  number?: number | null;
  url?: string | null;
  email?: string | null;
  people?: Array<{ name?: string }>;
  relation?: Array<{ id: string }>;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface QueryResult {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string;
}

interface BlocksResult {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor?: string;
}

// --- Property extraction ---

function getTitle(props: Record<string, NotionProperty>): string {
  for (const prop of Object.values(props)) {
    if (prop.type === "title" && prop.title?.length) {
      return prop.title
        .map((t) => t.plain_text)
        .join("")
        .trim();
    }
  }
  return "Untitled";
}

function getText(prop: NotionProperty | undefined): string {
  if (!prop) {
    return "";
  }
  if (prop.type === "rich_text") {
    return (
      prop.rich_text
        ?.map((t) => t.plain_text)
        .join("")
        .trim() || ""
    );
  }
  if (prop.type === "title") {
    return (
      prop.title
        ?.map((t) => t.plain_text)
        .join("")
        .trim() || ""
    );
  }
  if (prop.type === "select") {
    return prop.select?.name || "";
  }
  if (prop.type === "multi_select") {
    return (prop.multi_select || []).map((s) => s.name).join(", ");
  }
  if (prop.type === "status") {
    return prop.status?.name || "";
  }
  if (prop.type === "date") {
    return prop.date?.start || "";
  }
  if (prop.type === "checkbox") {
    return String(prop.checkbox || false);
  }
  if (prop.type === "number") {
    return String(prop.number ?? "");
  }
  if (prop.type === "url") {
    return prop.url || "";
  }
  if (prop.type === "email") {
    return prop.email || "";
  }
  if (prop.type === "people") {
    return (prop.people || [])
      .map((p) => p.name || "")
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

// --- Block to Markdown conversion ---

function richTextToMd(
  richText: Array<{
    plain_text: string;
    href?: string | null;
    annotations?: Record<string, boolean>;
  }>,
): string {
  return (richText || [])
    .map((t) => {
      let text = t.plain_text;
      if (!text) {
        return "";
      }
      if (t.href) {
        text = `[${text}](${t.href})`;
      }
      if (t.annotations?.bold) {
        text = `**${text}**`;
      }
      if (t.annotations?.italic) {
        text = `*${text}*`;
      }
      if (t.annotations?.code) {
        text = `\`${text}\``;
      }
      if (t.annotations?.strikethrough) {
        text = `~~${text}~~`;
      }
      return text;
    })
    .join("");
}

function blockToMd(block: NotionBlock, depth = 0): string {
  const indent = "  ".repeat(depth);
  const type = block.type;
  const data = (block[type] || {}) as Record<string, unknown>;
  const rt = (data.rich_text || []) as Array<{
    plain_text: string;
    href?: string | null;
    annotations?: Record<string, boolean>;
  }>;
  const text = richTextToMd(rt);

  switch (type) {
    case "paragraph":
      return text ? `${indent}${text}\n` : "\n";
    case "heading_1":
      return `\n# ${text}\n`;
    case "heading_2":
      return `\n## ${text}\n`;
    case "heading_3":
      return `\n### ${text}\n`;
    case "bulleted_list_item":
      return `${indent}- ${text}\n`;
    case "numbered_list_item":
      return `${indent}1. ${text}\n`;
    case "to_do": {
      const checked = Boolean(data.checked);
      return `${indent}- [${checked ? "x" : " "}] ${text}\n`;
    }
    case "toggle":
      return `${indent}<details><summary>${text}</summary>\n</details>\n`;
    case "quote":
      return `${indent}> ${text}\n`;
    case "callout":
      return `${indent}> **Note:** ${text}\n`;
    case "code": {
      const lang = String((data.language as string) || "");
      return `\n\`\`\`${lang}\n${rt.map((t) => t.plain_text).join("")}\n\`\`\`\n`;
    }
    case "divider":
      return "\n---\n";
    case "image": {
      const imgData = data;
      const src =
        (imgData.external as Record<string, string> | undefined)?.url ||
        (imgData.file as Record<string, string> | undefined)?.url ||
        "";
      const caption = richTextToMd((imgData.caption || []) as Array<{ plain_text: string }>);
      return src ? `\n![${caption || "image"}](${src})\n` : "";
    }
    case "bookmark": {
      const url = String((data.url as string) || "");
      const caption = richTextToMd((data.caption || []) as Array<{ plain_text: string }>);
      return url ? `\n[${caption || url}](${url})\n` : "";
    }
    case "table_row": {
      const cells = ((data.cells || []) as Array<Array<{ plain_text: string }>>).map((cell) =>
        cell.map((t) => t.plain_text).join(""),
      );
      return `| ${cells.join(" | ")} |\n`;
    }
    case "child_database":
    case "child_page": {
      const title = String((data.title as string) || type);
      return `\n*[${title}]*\n`;
    }
    case "embed":
    case "video":
    case "file":
    case "pdf": {
      const url = String(
        (data as Record<string, string>).url ||
          (data.external as Record<string, string> | undefined)?.url ||
          "",
      );
      return url ? `\n[Embedded: ${type}](${url})\n` : "";
    }
    case "unsupported":
      return "";
    default:
      return text ? `${indent}${text}\n` : "";
  }
}

async function blocksToMarkdown(blocks: NotionBlock[], depth = 0): Promise<string> {
  const parts: string[] = [];

  for (const block of blocks) {
    parts.push(blockToMd(block, depth));

    // Recurse into children for toggles/lists
    if (block.has_children && depth < 3) {
      try {
        const children = await getBlocks(block.id);
        parts.push(await blocksToMarkdown(children, depth + 1));
      } catch {
        // ignore block fetch failures
      }
    }
  }

  return parts.join("");
}

// --- Page → Markdown ---

function inferDomainFromPage(page: NotionPage, dbConfig: NotionDbConfig): string {
  if (dbConfig.domain) {
    return dbConfig.domain;
  }

  // Try to infer from the database name
  const name = dbConfig.name.toLowerCase();
  if (/live.?engine/.test(name)) {
    return "live-engine";
  }
  if (/creative.?tool/.test(name)) {
    return "creative-tools";
  }
  if (/inft|2603/.test(name)) {
    return "inft";
  }
  if (/inbox|capture/.test(name)) {
    return "openclaw";
  }
  return "openclaw";
}

function inferTypeFromPage(page: NotionPage, dbConfig: NotionDbConfig): string {
  const props = page.properties;

  // Check for common type indicators
  const typeVal = getText(props["Type"] || props["type"] || props["Kind"]).toLowerCase();
  if (typeVal) {
    if (/meeting|call/.test(typeVal)) {
      return "meeting";
    }
    if (/decision/.test(typeVal)) {
      return "decision";
    }
    if (/reference|doc/.test(typeVal)) {
      return "reference";
    }
    if (/task|todo/.test(typeVal)) {
      return "note";
    }
  }

  // Check database name
  const name = dbConfig.name.toLowerCase();
  if (/inbox|capture/.test(name)) {
    return "note";
  }
  if (/project/.test(name)) {
    return "project";
  }

  return "note";
}

function buildSlug(title: string, pageId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
  const shortId = pageId.replace(/-/g, "").slice(0, 8);
  return `${base}-${shortId}` || `notion-page-${shortId}`;
}

async function pageToMarkdown(
  page: NotionPage,
  dbConfig: NotionDbConfig,
): Promise<{ slug: string; markdown: string }> {
  const title = getTitle(page.properties);
  const slug = buildSlug(title, page.id);
  const domain = inferDomainFromPage(page, dbConfig);
  const type = inferTypeFromPage(page, dbConfig);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const notionUrl = page.url;

  // Extract key properties as metadata
  const propLines: string[] = [];
  const tags: string[] = ["notion", dbConfig.name.toLowerCase().replace(/\s+/g, "-")];

  for (const [key, prop] of Object.entries(page.properties)) {
    if (prop.type === "title") {
      continue;
    } // already captured as title
    const val = getText(prop);
    if (!val || val === "false") {
      continue;
    }

    const keyLower = key.toLowerCase();

    // Collect tags from relevant fields
    if (["tags", "labels", "category"].includes(keyLower) && prop.type === "multi_select") {
      tags.push(...(prop.multi_select || []).map((s) => s.name.toLowerCase().replace(/\s+/g, "-")));
    }

    // Build property summary for body
    propLines.push(`| ${key} | ${val} |`);
  }

  // Fetch page blocks (content)
  let bodyContent = "";
  try {
    const blocks = await getBlocks(page.id);
    bodyContent = await blocksToMarkdown(blocks);
  } catch (e) {
    bodyContent = `*Could not fetch page content: ${e}*`;
  }

  const statusVal = getText(page.properties["Status"] || page.properties["status"]);

  const frontmatter = [
    "---",
    `title: "${title.replace(/"/g, "'")}"`,
    `source: notion`,
    `origin: "${notionUrl}"`,
    `notion_id: "${page.id}"`,
    `notion_db: "${dbConfig.name}"`,
    `captured: ${now}`,
    `modified: ${page.last_edited_time}`,
    `type: ${type}`,
    `domain: ${domain}`,
    `tags: ${JSON.stringify([...new Set(tags)])}`,
    statusVal ? `notion_status: "${statusVal}"` : null,
    `status: inbox`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const propTable = propLines.length
    ? `## Properties\n\n| Field | Value |\n|-------|-------|\n${propLines.join("\n")}\n`
    : "";

  const body = [
    `# ${title}`,
    "",
    `**Source:** [Notion](${notionUrl})`,
    `**Database:** ${dbConfig.name}`,
    `**Last edited:** ${page.last_edited_time.split("T")[0]}`,
    "",
    propTable,
    bodyContent.trim() ? "## Content\n" : "",
    bodyContent.trim(),
    "",
    "## Connections",
    "",
    "- ",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { slug, markdown: `${frontmatter}\n\n${body}` };
}

// --- State ---

function loadState(): SyncState {
  if (!existsSync(STATE_PATH)) {
    return { databases: {} };
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
}

function saveState(state: SyncState): void {
  mkdirSync(join(STATE_PATH, ".."), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// --- Config ---

function loadConfig(): SyncConfig {
  if (!existsSync(SYNC_CONFIG_PATH)) {
    throw new Error(`sync-config.json not found at ${SYNC_CONFIG_PATH}`);
  }
  return JSON.parse(readFileSync(SYNC_CONFIG_PATH, "utf-8"));
}

function writeToInbox(outputDir: string, slug: string, markdown: string): string {
  mkdirSync(outputDir, { recursive: true });
  let outPath = join(outputDir, `${slug}.md`);
  let n = 1;
  while (existsSync(outPath)) {
    outPath = join(outputDir, `${slug}-${n++}.md`);
  }
  writeFileSync(outPath, markdown, "utf-8");
  return outPath;
}

// --- Main ---

async function syncDatabase(
  dbConfig: NotionDbConfig,
  state: SyncState,
  dryRun: boolean,
  force: boolean,
): Promise<SyncResult> {
  const result: SyncResult = { database: dbConfig.name, newPages: 0, written: [], errors: [] };
  const dbState = state.databases[dbConfig.id] || { lastSyncAt: "", processedIds: [] };
  const processed = new Set(force ? [] : dbState.processedIds);

  // Use last sync time for incremental queries (unless forced)
  const since = force ? undefined : dbState.lastSyncAt || dbConfig.since;

  let pages: NotionPage[];
  try {
    pages = await queryDatabase(dbConfig.id, since);
  } catch (e) {
    result.errors.push(`query failed: ${e}`);
    return result;
  }

  const newPages = pages.filter((p) => !processed.has(p.id));
  result.newPages = newPages.length;

  if (dryRun) {
    console.log(`[dry-run] ${dbConfig.name}: ${newPages.length} new pages`);
    newPages.slice(0, 5).forEach((p) => console.log(`  + ${getTitle(p.properties)}`));
    if (newPages.length > 5) {
      console.log(`  ... and ${newPages.length - 5} more`);
    }
    return result;
  }

  const outputDir = join(
    VAULT,
    dbConfig.output ||
      `00_inbox/sources/notion/${dbConfig.name.toLowerCase().replace(/\s+/g, "-")}`,
  );

  for (const page of newPages) {
    const pageTitle = getTitle(page.properties);
    try {
      const { slug, markdown } = await pageToMarkdown(page, dbConfig);
      const outPath = writeToInbox(outputDir, slug, markdown);
      result.written.push(outPath);
      processed.add(page.id);
    } catch (e) {
      result.errors.push(`"${pageTitle}": ${e}`);
      processed.add(page.id); // mark to avoid retry storms
    }
  }

  state.databases[dbConfig.id] = {
    lastSyncAt: new Date().toISOString(),
    processedIds: [...processed],
  };

  return result;
}

async function main() {
  if (!NOTION_TOKEN) {
    console.error("Error: No Notion token. Set NOTION_TOKEN_OPENCLAW_2 in workspace/.env");
    process.exit(1);
  }

  const config = loadConfig();
  const notionConfig = config.notion;

  if (!notionConfig.enabled && !FORCE) {
    console.log(
      "Notion sync disabled in sync-config.json (enabled: false). Set enabled: true to activate.",
    );
    return;
  }

  if (!notionConfig.databases?.length) {
    console.log("No databases configured in notion.databases[].");
    return;
  }

  const databases = DB_FILTER
    ? notionConfig.databases.filter((db) => db.id === DB_FILTER || db.name === DB_FILTER)
    : notionConfig.databases;

  if (!databases.length) {
    console.log(`No database found matching --db=${DB_FILTER}`);
    return;
  }

  const state = loadState();
  const results: SyncResult[] = [];

  for (const db of databases) {
    console.log(`Syncing: ${db.name} (${db.id})`);
    const result = await syncDatabase(db, state, DRY_RUN, FORCE);
    results.push(result);

    if (result.written.length) {
      console.log(`  ✓ ${result.written.length} pages written to vault inbox`);
    }
    if (result.errors.length) {
      console.log(`  ✗ ${result.errors.length} errors:`);
      result.errors.forEach((e) => console.log(`    - ${e}`));
    }
    if (!result.newPages) {
      console.log(`  — no new pages`);
    }
  }

  if (!DRY_RUN) {
    saveState(state);
  }

  const totalWritten = results.reduce((n, r) => n + r.written.length, 0);
  const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);

  logCron("notion-sync", totalErrors > 0 ? "warn" : "ok", {
    databases: databases.length,
    written: totalWritten,
    errors: totalErrors,
  });

  console.log(`\nDone: ${totalWritten} pages written, ${totalErrors} errors`);
}

main().catch((e) => {
  logError("notion-sync", String(e));
  console.error(e);
  process.exit(1);
});
