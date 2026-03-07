/**
 * Nightly Maintenance — 10 PM BRT daily
 * Memory pruning, stale file cleanup, vault inbox processing, QMD re-index,
 * Tier 3 memory promotion.
 */
import { readdirSync, statSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";
import { logCron } from "./event-logger.js";

const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");

function cleanTmpFiles(): number {
  const tmpDir = join(WORKSPACE, "tmp");
  if (!existsSync(tmpDir)) {
    return 0;
  }

  let cleaned = 0;
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days
  try {
    for (const file of readdirSync(tmpDir)) {
      const fullPath = join(tmpDir, file);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          unlinkSync(fullPath);
          cleaned++;
        }
      } catch {}
    }
  } catch {}
  return cleaned;
}

function cleanSessionArchives(): number {
  const sessDir = join(WORKSPACE, "sessions");
  if (!existsSync(sessDir)) {
    return 0;
  }

  let cleaned = 0;
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // 14 days
  try {
    for (const file of readdirSync(sessDir)) {
      const fullPath = join(sessDir, file);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          unlinkSync(fullPath);
          cleaned++;
        }
      } catch {}
    }
  } catch {}
  return cleaned;
}

async function runVaultMaintenance(): Promise<{
  synced: boolean;
  inboxProcessed: boolean;
  qmdUpdated: boolean;
}> {
  const vaultPath = join(
    process.env.HOME!,
    "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault",
  );
  if (!existsSync(vaultPath)) {
    return { synced: false, inboxProcessed: false, qmdUpdated: false };
  }

  const tsx = ["/opt/homebrew/bin/npx", "tsx"];

  // Run ingestion pipelines — each checks its own enabled flag
  const driveSync = await execFileNoThrow(
    tsx[0],
    [...tsx.slice(1), join(WORKSPACE, "scripts/drive-sync.ts")],
    {
      cwd: WORKSPACE,
      timeout: 120_000,
    },
  );
  const notionSync = await execFileNoThrow(
    tsx[0],
    [...tsx.slice(1), join(WORKSPACE, "scripts/notion-sync.ts")],
    {
      cwd: WORKSPACE,
      timeout: 180_000,
    },
  );
  // Music indexer runs incrementally (only new/changed files)
  const musicIndex = await execFileNoThrow(
    tsx[0],
    [...tsx.slice(1), join(WORKSPACE, "scripts/music-indexer.ts")],
    {
      cwd: WORKSPACE,
      timeout: 300_000,
    },
  );
  const synced = !driveSync.error && !notionSync.error;
  if (driveSync.stdout?.trim()) {
    console.log(`Drive sync: ${driveSync.stdout.trim().split("\n").at(-1)}`);
  }
  if (notionSync.stdout?.trim()) {
    console.log(`Notion sync: ${notionSync.stdout.trim().split("\n").at(-1)}`);
  }
  if (musicIndex.stdout?.trim()) {
    console.log(`Music index: ${musicIndex.stdout.trim().split("\n").at(-1)}`);
  }

  // Process vault inbox (auto-move + link)
  const inbox = await execFileNoThrow(
    tsx[0],
    [...tsx.slice(1), join(WORKSPACE, "scripts/process-inbox.ts"), "--auto"],
    {
      cwd: WORKSPACE,
      timeout: 120_000,
    },
  );
  const inboxProcessed = !inbox.error;
  if (inbox.stdout?.trim()) {
    console.log(`Vault inbox: ${inbox.stdout.trim().split("\n").at(-1)}`);
  }

  // Tier 3: Promote daily notes to vault
  const vaultPromote = await execFileNoThrow(
    tsx[0],
    [...tsx.slice(1), join(WORKSPACE, "scripts/vault-promote.ts")],
    {
      cwd: WORKSPACE,
      timeout: 120_000,
    },
  );
  if (vaultPromote.stdout?.trim()) {
    console.log(`Vault promote: ${vaultPromote.stdout.trim().split("\n").at(-1)}`);
  }

  // Re-embed QMD vault collection
  const qmdUpdate = await execFileNoThrow("/opt/homebrew/bin/qmd", [
    "update",
    "--collection",
    "vault",
  ]);
  const qmdEmbed = await execFileNoThrow("/opt/homebrew/bin/qmd", [
    "embed",
    "--collection",
    "vault",
  ]);
  const qmdUpdated = !qmdUpdate.error && !qmdEmbed.error;
  if (qmdUpdated) {
    console.log("QMD vault collection re-indexed");
  }

  return { synced, inboxProcessed, qmdUpdated };
}

async function main() {
  const tmpCleaned = cleanTmpFiles();
  const sessionsCleaned = cleanSessionArchives();
  const { synced, inboxProcessed, qmdUpdated } = await runVaultMaintenance();

  console.log(
    `Nightly maintenance: ${tmpCleaned} tmp files, ${sessionsCleaned} old sessions cleaned`,
  );
  logCron("nightly-maintenance", "ok", {
    tmpCleaned,
    sessionsCleaned,
    synced,
    inboxProcessed,
    qmdUpdated,
  });
}

main();
