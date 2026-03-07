/**
 * process-inbox.ts — Vault Inbox Processor
 *
 * Reads files from vault 00_inbox/, finds related notes via QMD search,
 * adds [[wiki links]], suggests/applies placement, updates _index.md.
 *
 * Usage:
 *   bun scripts/process-inbox.ts --suggest    # add link suggestions to frontmatter only
 *   bun scripts/process-inbox.ts --auto       # move + link automatically
 *   bun scripts/process-inbox.ts --dry-run    # preview only
 *   bun scripts/process-inbox.ts --limit=10   # process max N files
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  renameSync,
} from "fs";
import { join, relative, dirname, basename, extname } from "path";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";
import { logCron, logError } from "./event-logger.js";

const VAULT = join(
  process.env.HOME!,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault",
);
const INBOX = join(VAULT, "00_inbox");
const INDEX_PATH = join(VAULT, "_index.md");

const MODE = process.argv.includes("--auto")
  ? "auto"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "suggest";

const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : Infinity;

// --- Types ---

interface FrontmatterData {
  title?: string;
  source?: string;
  type?: string;
  domain?: string;
  tags?: string[];
  status?: string;
  [key: string]: unknown;
}

interface QmdResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
}

interface ProcessResult {
  file: string;
  action: "moved" | "suggested" | "skipped" | "error";
  destination?: string;
  connections?: string[];
  error?: string;
}

// --- Frontmatter parsing ---

function parseFrontmatter(content: string): { data: FrontmatterData; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: content };
  }

  const data: FrontmatterData = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (!key) {
      continue;
    }
    // Simple type coercion
    if (val.startsWith("[") || val.startsWith("{")) {
      try {
        data[key] = JSON.parse(val);
      } catch {
        data[key] = val;
      }
    } else if (val.startsWith('"') || val.startsWith("'")) {
      data[key] = val.slice(1, -1);
    } else {
      data[key] = val;
    }
  }

  return { data, body: match[2] };
}

function serializeFrontmatter(data: FrontmatterData): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) {
      continue;
    }
    if (typeof v === "string") {
      lines.push(`${k}: "${v.replace(/"/g, "'")}"`);
    } else if (Array.isArray(v)) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

// --- QMD search ---

async function qmdSearch(query: string, limit = 5): Promise<QmdResult[]> {
  const result = await execFileNoThrow("qmd", [
    "search",
    "--collection",
    "vault",
    "--limit",
    String(limit),
    "--json",
    query,
  ]);

  if (result.error || !result.stdout.trim()) {
    return [];
  }

  try {
    const raw = JSON.parse(result.stdout);
    // qmd json output: array of { path, title, score, snippet } or similar
    if (Array.isArray(raw)) {
      return raw.map((r: Record<string, unknown>) => ({
        path: String(r.path || r.file || ""),
        title: String(r.title || r.path || ""),
        score: Number(r.score || 0),
        snippet: String(r.snippet || r.content || "").slice(0, 200),
      }));
    }
  } catch {}

  return [];
}

// --- Placement logic ---

type PlacementSection =
  | "01_thinking/notes"
  | "02_reference/tools"
  | "02_reference/approaches"
  | "02_reference/sources"
  | "04_projects/live-engine"
  | "04_projects/creative-tools"
  | "04_projects/inft"
  | "05_djtuls/tracks"
  | "05_djtuls/sets"
  | "05_djtuls/genres"
  | "07_personal";

function inferPlacement(data: FrontmatterData): PlacementSection {
  const type = String(data.type || "");
  const domain = String(data.domain || "");
  const tags = data.tags || [];
  const source = String(data.source || "");

  // Music domain
  if (domain === "djtuls" || tags.includes("djtuls")) {
    if (type === "track") {
      return "05_djtuls/tracks";
    }
    if (type === "set") {
      return "05_djtuls/sets";
    }
    return "05_djtuls/genres";
  }

  // Project domains
  if (domain === "live-engine") {
    return "04_projects/live-engine";
  }
  if (domain === "creative-tools") {
    return "04_projects/creative-tools";
  }
  if (domain === "inft" || tags.some((t) => ["inft", "2603", "2612"].includes(t))) {
    return "04_projects/inft";
  }

  // Reference types
  if (type === "reference" || source === "google-drive") {
    return "02_reference/sources";
  }
  if (tags.includes("tool") || tags.includes("docs")) {
    return "02_reference/tools";
  }
  if (tags.includes("approach") || tags.includes("method")) {
    return "02_reference/approaches";
  }

  // Meetings and transcripts → thinking
  if (type === "meeting" || type === "transcript" || source === "plaud") {
    return "01_thinking/notes";
  }

  // Personal
  if (domain === "personal") {
    return "07_personal";
  }

  // Default: thinking notes
  return "01_thinking/notes";
}

// --- Wiki link injection ---

function buildWikiLinks(results: QmdResult[], currentPath: string): string[] {
  return results
    .filter((r) => r.score > 0.5 && r.path && r.path !== currentPath)
    .slice(0, 5)
    .map((r) => {
      // Convert absolute path to vault-relative wiki link
      const vaultRel = relative(VAULT, r.path).replace(/\.md$/, "");
      const label = r.title || basename(vaultRel);
      return `[[${vaultRel}|${label}]]`;
    });
}

function injectConnectionsIntoBody(body: string, links: string[]): string {
  if (!links.length) {
    return body;
  }

  const linkLines = links.map((l) => `- ${l}`).join("\n");

  // If body already has a ## Connections section, append to it
  if (/^## Connections/m.test(body)) {
    return body.replace(/(## Connections\n)([\s\S]*?)(\n##|$)/, (match, header, existing, next) => {
      const existingLinks = existing.trim();
      const newContent =
        existingLinks && existingLinks !== "-"
          ? `${header}${existingLinks}\n${linkLines}\n${next}`
          : `${header}${linkLines}\n${next}`;
      return newContent;
    });
  }

  // Otherwise append a Connections section
  return `${body.trimEnd()}\n\n## Connections\n\n${linkLines}\n`;
}

// --- _index.md update ---

function updateIndex(movedFiles: Array<{ from: string; to: string; title: string }>): void {
  if (!movedFiles.length || !existsSync(INDEX_PATH)) {
    return;
  }

  let index = readFileSync(INDEX_PATH, "utf-8");

  // Update the quick stats line
  const processedCount = movedFiles.length;
  index = index.replace(
    /> \*\*Quick stats:.*?\*\*/,
    `> **Quick stats (last processed: ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}):** ${processedCount} items processed`,
  );

  // Update the inbox section to show pending count
  const inboxPattern = /(\| `00_inbox\/unprocessed\/`[^\n]*\|[^\n]*\|)/;
  index = index.replace(inboxPattern, `| \`00_inbox/unprocessed/\` | Manual drops | Empty |`);

  writeFileSync(INDEX_PATH, index, "utf-8");
}

// --- File collection ---

function collectInboxFiles(inboxDir: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) {
        continue;
      }
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (extname(entry) === ".md") {
        files.push(full);
      }
    }
  }

  walk(inboxDir);
  return files;
}

// --- Main processing ---

async function processFile(filePath: string): Promise<ProcessResult> {
  const content = readFileSync(filePath, "utf-8");
  const { data, body } = parseFrontmatter(content);

  // Build search query from title + tags + type
  const queryParts = [
    data.title || basename(filePath, ".md"),
    ...((data.tags as string[]) || []).slice(0, 3),
    data.type || "",
  ].filter(Boolean);
  const query = queryParts.join(" ").slice(0, 200);

  // QMD search for related notes
  const results = await qmdSearch(query, 8);
  const links = buildWikiLinks(results, filePath);

  if (MODE === "dry-run") {
    console.log(`  [dry-run] ${basename(filePath)}`);
    console.log(`    → placement: ${inferPlacement(data)}`);
    console.log(`    → connections: ${links.length > 0 ? links.join(", ") : "none"}`);
    return { file: filePath, action: "skipped" };
  }

  if (MODE === "suggest") {
    // Add suggestions to frontmatter without moving
    const updatedData = {
      ...data,
      suggested_placement: inferPlacement(data),
      suggested_connections: links,
      status: "inbox",
    };
    const updatedBody = injectConnectionsIntoBody(body, links);
    const updated = `${serializeFrontmatter(updatedData)}\n\n${updatedBody}`;
    writeFileSync(filePath, updated, "utf-8");
    return { file: filePath, action: "suggested", connections: links };
  }

  // AUTO mode: move + link
  const placement = inferPlacement(data);
  const destDir = join(VAULT, placement);
  mkdirSync(destDir, { recursive: true });

  const fileName = basename(filePath);
  let destPath = join(destDir, fileName);
  let n = 1;
  while (existsSync(destPath) && destPath !== filePath) {
    const base = basename(fileName, ".md");
    destPath = join(destDir, `${base}-${n++}.md`);
  }

  // Update content with links + status change
  const updatedData = { ...data, status: "active" };
  delete updatedData.suggested_placement;
  delete updatedData.suggested_connections;
  const updatedBody = injectConnectionsIntoBody(body, links);
  const updated = `${serializeFrontmatter(updatedData)}\n\n${updatedBody}`;

  writeFileSync(filePath, updated, "utf-8");

  if (destPath !== filePath) {
    renameSync(filePath, destPath);
  }

  return {
    file: filePath,
    action: "moved",
    destination: destPath,
    connections: links,
  };
}

async function main() {
  const inboxFiles = collectInboxFiles(INBOX);

  if (!inboxFiles.length) {
    console.log("Inbox is empty. Nothing to process.");
    logCron("process-inbox", "ok", { processed: 0, mode: MODE });
    return;
  }

  const toProcess = inboxFiles.slice(0, LIMIT);
  console.log(`Processing ${toProcess.length} inbox files (mode: ${MODE})...`);

  const results: ProcessResult[] = [];
  const moved: Array<{ from: string; to: string; title: string }> = [];

  for (const file of toProcess) {
    process.stdout.write(`  ${basename(file)}... `);
    try {
      const result = await processFile(file);
      results.push(result);

      if (result.action === "moved") {
        console.log(
          `→ ${relative(VAULT, result.destination!)} (${result.connections?.length || 0} links)`,
        );
        moved.push({
          from: file,
          to: result.destination!,
          title: basename(file, ".md"),
        });
      } else if (result.action === "suggested") {
        console.log(`suggested (${result.connections?.length || 0} links)`);
      } else {
        console.log(result.action);
      }
    } catch (e) {
      console.log(`error: ${e}`);
      results.push({ file, action: "error", error: String(e) });
    }
  }

  if (moved.length) {
    updateIndex(moved);
    // Re-index QMD after moving files
    console.log("\nUpdating QMD index...");
    await execFileNoThrow("qmd", ["update", "--collection", "vault"]);
  }

  const movedCount = results.filter((r) => r.action === "moved").length;
  const suggestedCount = results.filter((r) => r.action === "suggested").length;
  const errorCount = results.filter((r) => r.action === "error").length;

  console.log(`\nDone: ${movedCount} moved, ${suggestedCount} suggested, ${errorCount} errors`);

  logCron("process-inbox", errorCount > 0 ? "warn" : "ok", {
    mode: MODE,
    processed: results.length,
    moved: movedCount,
    suggested: suggestedCount,
    errors: errorCount,
  });
}

main().catch((e) => {
  logError("process-inbox", String(e));
  console.error(e);
  process.exit(1);
});
