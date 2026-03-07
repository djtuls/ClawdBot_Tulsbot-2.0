#!/usr/bin/env node
/**
 * drive-sync.ts — Google Drive → Vault Inbox
 *
 * Watches configured Google Drive folders, downloads new/changed files,
 * converts to markdown with frontmatter, writes to vault 00_inbox/sources/google-drive/.
 *
 * Config: tuls-vault/08_system/sync-config.json
 * State:  ~/.openclaw/state/drive-sync-state.json
 *
 * Usage:
 *   bun scripts/drive-sync.ts              # sync all configured folders
 *   bun scripts/drive-sync.ts --dry-run    # show what would be synced
 *   bun scripts/drive-sync.ts --force      # re-sync already processed files
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, extname, basename } from "path";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";
import { logCron, logError } from "./event-logger.js";

const VAULT = join(
  process.env.HOME!,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault",
);
const SYNC_CONFIG_PATH = join(VAULT, "08_system/sync-config.json");
const STATE_PATH = join(process.env.HOME!, ".openclaw/state/drive-sync-state.json");

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

// --- Types ---

interface DriveFolder {
  id: string;
  name: string;
  type: string;
  output: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
}

interface SyncState {
  folders: Record<string, { lastSyncAt: string; processedIds: string[] }>;
}

interface SyncResult {
  folder: string;
  newFiles: number;
  written: string[];
  skipped: number;
  errors: string[];
}

interface SyncConfig {
  "google-drive": {
    enabled: boolean;
    account?: string;
    folders: DriveFolder[];
  };
}

// --- gog CLI helpers ---

async function findGog(): Promise<string> {
  const candidates = [
    "/opt/homebrew/bin/gog",
    "/usr/local/bin/gog",
    join(process.env.HOME!, ".local/bin/gog"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }
  const result = await execFileNoThrow("which", ["gog"]);
  if (!result.error && result.stdout.trim()) {
    return result.stdout.trim();
  }
  throw new Error("gog CLI not found. Install with: brew install pat-s/gog/gog");
}

async function gogListFolder(gog: string, folderId: string, account: string): Promise<DriveFile[]> {
  const result = await execFileNoThrow(gog, [
    "drive",
    "ls",
    "--parent",
    folderId,
    "--max",
    "200",
    "--json",
    "--results-only",
    "--account",
    account,
  ]);
  if (result.error) {
    throw new Error(`gog ls failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout || "[]");
}

async function gogDownload(
  gog: string,
  fileId: string,
  outPath: string,
  account: string,
): Promise<void> {
  const result = await execFileNoThrow(gog, [
    "drive",
    "download",
    fileId,
    "--account",
    account,
    "--out",
    outPath,
  ]);
  if (result.error) {
    throw new Error(`gog download failed: ${result.stderr}`);
  }
}

// --- State ---

function loadState(): SyncState {
  if (!existsSync(STATE_PATH)) {
    return { folders: {} };
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

// --- Conversion ---

function inferDomain(folderName: string, fileName: string, content: string): string {
  const blob = `${folderName} ${fileName} ${content}`.toLowerCase();
  if (/2603|wac26|women.*asian|inft/.test(blob)) {
    return "inft";
  }
  if (/live.?engine/.test(blob)) {
    return "live-engine";
  }
  if (/creative.?tool/.test(blob)) {
    return "creative-tools";
  }
  return "openclaw";
}

function inferType(mimeType: string, fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if ([".txt", ".md"].includes(ext) || /text\/plain|text\/markdown/.test(mimeType)) {
    return "note";
  }
  return "reference";
}

function buildSlug(folderName: string, fileName: string): string {
  const base = basename(fileName, extname(fileName));
  return `${folderName}-${base}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function buildMarkdown(
  file: DriveFile,
  folder: DriveFolder,
  content: string,
  mimeLabel: string,
): { slug: string; markdown: string } {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const domain = inferDomain(folder.name, file.name, content);
  const type = inferType(file.mimeType, file.name);
  const slug = buildSlug(folder.name, file.name);
  const link = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
  const title = basename(file.name, extname(file.name));
  const tags = JSON.stringify(["google-drive", folder.name.toLowerCase().replace(/\s+/g, "-")]);

  const frontmatter = `---
title: "${title.replace(/"/g, "'")}"
source: google-drive
origin: "${link}"
captured: ${now}
modified: ${file.modifiedTime}
type: ${type}
domain: ${domain}
tags: ${tags}
drive_folder: "${folder.name}"
drive_id: "${file.id}"
status: inbox
---`;

  const body = content.trim()
    ? `# ${title}\n\n**Source:** [Google Drive](${link})\n**Folder:** ${folder.name}\n**Modified:** ${file.modifiedTime}\n\n## Content\n\n${content.trim()}\n\n## Connections\n\n- \n`
    : `# ${title}\n\n**Source:** [Google Drive](${link})\n**Folder:** ${folder.name}\n**Modified:** ${file.modifiedTime}\n**Format:** ${mimeLabel}\n\n*Binary file — content not available as text. See original in Drive.*\n\n## Connections\n\n- \n`;

  return { slug, markdown: `${frontmatter}\n\n${body}` };
}

async function convertToText(
  gog: string,
  file: DriveFile,
  account: string,
  tmpDir: string,
): Promise<{ content: string; mimeLabel: string }> {
  const ext = extname(file.name).toLowerCase() || ".bin";
  const tmpPath = join(tmpDir, `drive_${file.id}${ext}`);
  const mime = file.mimeType;

  try {
    await gogDownload(gog, file.id, tmpPath, account);
  } catch {
    return { content: "", mimeLabel: mime };
  }

  // Plain text / markdown
  if (/text\/plain|text\/markdown/.test(mime) || [".txt", ".md"].includes(ext)) {
    const text = readFileSync(tmpPath, "utf-8");
    try {
      unlinkSync(tmpPath);
    } catch {}
    return { content: text, mimeLabel: "text" };
  }

  // Try pandoc for docx
  if (/wordprocessing|document/.test(mime) || [".docx", ".odt"].includes(ext)) {
    const pandoc = await execFileNoThrow("pandoc", [tmpPath, "-t", "markdown"]);
    try {
      unlinkSync(tmpPath);
    } catch {}
    if (!pandoc.error) {
      return { content: pandoc.stdout, mimeLabel: "document" };
    }
  }

  try {
    unlinkSync(tmpPath);
  } catch {}
  return { content: "", mimeLabel: mime };
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

async function syncFolder(
  gog: string,
  folder: DriveFolder,
  account: string,
  state: SyncState,
  dryRun: boolean,
  force: boolean,
): Promise<SyncResult> {
  const result: SyncResult = {
    folder: folder.name,
    newFiles: 0,
    written: [],
    skipped: 0,
    errors: [],
  };
  const folderState = state.folders[folder.id] || { lastSyncAt: "", processedIds: [] };
  const processed = new Set(force ? [] : folderState.processedIds);

  let files: DriveFile[];
  try {
    files = await gogListFolder(gog, folder.id, account);
  } catch (e) {
    result.errors.push(`list failed: ${e}`);
    return result;
  }

  const newFiles = files.filter((f) => !processed.has(f.id));
  result.newFiles = newFiles.length;

  if (dryRun) {
    console.log(`[dry-run] ${folder.name}: ${newFiles.length} new files`);
    newFiles.forEach((f) => console.log(`  + ${f.name} (${f.mimeType})`));
    return result;
  }

  const outputDir = join(
    VAULT,
    folder.output ||
      `00_inbox/sources/google-drive/${folder.name.toLowerCase().replace(/\s+/g, "-")}`,
  );

  for (const file of newFiles) {
    try {
      const { content, mimeLabel } = await convertToText(gog, file, account, "/tmp");
      const { slug, markdown } = buildMarkdown(file, folder, content, mimeLabel);
      const outPath = writeToInbox(outputDir, slug, markdown);
      result.written.push(outPath);
      processed.add(file.id);
    } catch (e) {
      result.errors.push(`${file.name}: ${e}`);
      processed.add(file.id);
    }
  }

  state.folders[folder.id] = {
    lastSyncAt: new Date().toISOString(),
    processedIds: [...processed],
  };

  return result;
}

async function main() {
  const config = loadConfig();
  const driveConfig = config["google-drive"];

  if (!driveConfig.enabled && !FORCE) {
    console.log(
      "Google Drive sync disabled in sync-config.json (enabled: false). Use --force to override.",
    );
    return;
  }

  if (!driveConfig.folders?.length) {
    console.log("No folders configured in google-drive.folders[].");
    return;
  }

  let gog: string;
  try {
    gog = await findGog();
  } catch (e) {
    console.error(`Error: ${e}`);
    logError("drive-sync", String(e));
    process.exit(1);
  }

  const account = driveConfig.account || "tulio@weareliveengine.com";
  const state = loadState();
  const results: SyncResult[] = [];

  for (const folder of driveConfig.folders) {
    console.log(`Syncing: ${folder.name} (${folder.id})`);
    const result = await syncFolder(gog, folder, account, state, DRY_RUN, FORCE);
    results.push(result);

    if (result.written.length) {
      console.log(`  ✓ ${result.written.length} files written to vault inbox`);
    }
    if (result.errors.length) {
      console.log(`  ✗ ${result.errors.length} errors:`);
      result.errors.forEach((e) => console.log(`    - ${e}`));
    }
    if (!result.newFiles) {
      console.log(`  — no new files`);
    }
  }

  if (!DRY_RUN) {
    saveState(state);
  }

  const totalWritten = results.reduce((n, r) => n + r.written.length, 0);
  const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);

  logCron("drive-sync", totalErrors > 0 ? "warn" : "ok", {
    folders: driveConfig.folders.length,
    written: totalWritten,
    errors: totalErrors,
  });

  console.log(`\nDone: ${totalWritten} files written, ${totalErrors} errors`);
}

main().catch((e) => {
  logError("drive-sync", String(e));
  console.error(e);
  process.exit(1);
});
