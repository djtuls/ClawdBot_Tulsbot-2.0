#!/usr/bin/env tsx
/**
 * workspace-cleaner.ts — Periodic workspace maintenance
 *
 * Handles:
 *   1. Rotate heartbeat-history.log (keep last 500 lines)
 *   2. Archive memory snapshots older than 14 days to memory/archive/
 *   3. Delete duplicate *-md.md files in memory/
 *   4. Trim stale one-off reports older than 30 days
 *   5. Clean orphan lock files older than 1 hour
 *
 * Usage:
 *   npx tsx scripts/workspace-cleaner.ts            (execute cleanup)
 *   npx tsx scripts/workspace-cleaner.ts --dry-run   (preview only)
 *   npx tsx scripts/workspace-cleaner.ts --quiet      (suppress verbose output)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");
const MEMORY_DIR = path.join(WORKSPACE, "memory");
const REPORTS_DIR = path.join(WORKSPACE, "reports");
const ARCHIVE_DIR = path.join(MEMORY_DIR, "archive");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const QUIET = args.has("--quiet");

const LOG_ROTATE_KEEP = 500;
const MEMORY_ARCHIVE_DAYS = 14;
const REPORT_STALE_DAYS = 30;
const LOCK_STALE_MS = 60 * 60 * 1000;

interface CleanupResult {
  action: string;
  items: number;
  details: string;
}

const results: CleanupResult[] = [];

function log(...args: unknown[]) {
  if (!QUIET) {
    console.log(...args);
  }
}

function isOlderThan(mtimeMs: number, days: number): boolean {
  return Date.now() - mtimeMs > days * 24 * 60 * 60 * 1000;
}

// ─── 1. Rotate heartbeat-history.log ─────────────────────────────────────────

async function rotateHeartbeatLog() {
  const logPath = path.join(REPORTS_DIR, "heartbeat-history.log");
  try {
    const content = await fs.readFile(logPath, "utf8");
    const lines = content.split("\n");
    if (lines.length <= LOG_ROTATE_KEEP) {
      log(
        `  ✓ heartbeat-history.log: ${lines.length} lines (under ${LOG_ROTATE_KEEP}, no rotation needed)`,
      );
      results.push({
        action: "log-rotate",
        items: 0,
        details: `${lines.length} lines, under threshold`,
      });
      return;
    }

    const trimmed = lines.slice(-LOG_ROTATE_KEEP).join("\n");
    const removed = lines.length - LOG_ROTATE_KEEP;

    if (!DRY_RUN) {
      await fs.writeFile(logPath, trimmed);
    }
    log(
      `  ${DRY_RUN ? "DRY" : "✓"} heartbeat-history.log: trimmed ${removed} old lines (kept ${LOG_ROTATE_KEEP})`,
    );
    results.push({
      action: "log-rotate",
      items: removed,
      details: `trimmed ${removed} lines from heartbeat-history.log`,
    });
  } catch {
    log("  ⊘ heartbeat-history.log not found, skipping");
    results.push({ action: "log-rotate", items: 0, details: "file not found" });
  }
}

// ─── 2. Archive old memory snapshots ─────────────────────────────────────────

async function archiveOldMemorySnapshots() {
  const datePattern = /^\d{4}-\d{2}-\d{2}/;
  const protectedFiles = new Set(["CHANGELOG.md", "session-handoff.md"]);

  const entries = await fs.readdir(MEMORY_DIR, { withFileTypes: true });
  const candidates: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".md")) {
      continue;
    }
    if (protectedFiles.has(entry.name)) {
      continue;
    }
    if (!datePattern.test(entry.name)) {
      continue;
    }

    const stat = await fs.stat(path.join(MEMORY_DIR, entry.name));
    if (isOlderThan(stat.mtimeMs, MEMORY_ARCHIVE_DAYS)) {
      candidates.push(entry.name);
    }
  }

  if (candidates.length === 0) {
    log("  ✓ No memory snapshots older than 14 days");
    results.push({ action: "archive-memory", items: 0, details: "nothing to archive" });
    return;
  }

  if (!DRY_RUN) {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    for (const file of candidates) {
      await fs.rename(path.join(MEMORY_DIR, file), path.join(ARCHIVE_DIR, file));
    }
  }

  log(
    `  ${DRY_RUN ? "DRY" : "✓"} Archived ${candidates.length} memory snapshot(s) to memory/archive/`,
  );
  results.push({
    action: "archive-memory",
    items: candidates.length,
    details: candidates.join(", "),
  });
}

// ─── 3. Delete duplicate *-md.md files ───────────────────────────────────────

async function deleteDuplicateMdFiles() {
  const entries = await fs.readdir(MEMORY_DIR);
  const duplicates = entries.filter((f) => f.endsWith("-md.md"));

  const actualDupes: string[] = [];
  for (const dupe of duplicates) {
    const original = dupe.replace(/-md\.md$/, ".md");
    try {
      await fs.stat(path.join(MEMORY_DIR, original));
      actualDupes.push(dupe);
    } catch {
      // No matching original — this might be a standalone file with a weird name.
      // Still safe to flag since the -md.md suffix is always a crawl artifact.
      actualDupes.push(dupe);
    }
  }

  if (actualDupes.length === 0) {
    log("  ✓ No duplicate -md.md files");
    results.push({ action: "delete-dupes", items: 0, details: "clean" });
    return;
  }

  if (!DRY_RUN) {
    for (const file of actualDupes) {
      await fs.unlink(path.join(MEMORY_DIR, file));
    }
  }

  log(`  ${DRY_RUN ? "DRY" : "✓"} Deleted ${actualDupes.length} duplicate -md.md file(s)`);
  results.push({
    action: "delete-dupes",
    items: actualDupes.length,
    details: actualDupes.join(", "),
  });
}

// ─── 4. Trim stale one-off reports ───────────────────────────────────────────

async function trimStaleReports() {
  const protectedReports = new Set([
    "heartbeat-history.log",
    "context-window.json",
    "context-window.md",
  ]);

  const entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  const stale: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (protectedReports.has(entry.name)) {
      continue;
    }

    const stat = await fs.stat(path.join(REPORTS_DIR, entry.name));
    if (isOlderThan(stat.mtimeMs, REPORT_STALE_DAYS)) {
      stale.push(entry.name);
    }
  }

  if (stale.length === 0) {
    log("  ✓ No reports older than 30 days");
    results.push({ action: "trim-reports", items: 0, details: "nothing stale" });
    return;
  }

  if (!DRY_RUN) {
    const archiveReportsDir = path.join(REPORTS_DIR, "archive");
    await fs.mkdir(archiveReportsDir, { recursive: true });
    for (const file of stale) {
      await fs.rename(path.join(REPORTS_DIR, file), path.join(archiveReportsDir, file));
    }
  }

  log(`  ${DRY_RUN ? "DRY" : "✓"} Archived ${stale.length} stale report(s) to reports/archive/`);
  results.push({ action: "trim-reports", items: stale.length, details: stale.join(", ") });
}

// ─── 5. Clean orphan lock files ──────────────────────────────────────────────

async function cleanOrphanLocks() {
  const lockPatterns = [".heartbeat.lock", ".cleaner.lock"];
  let cleaned = 0;

  for (const lockFile of lockPatterns) {
    const lockPath = path.join(MEMORY_DIR, lockFile);
    try {
      const stat = await fs.stat(lockPath);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        if (!DRY_RUN) {
          await fs.unlink(lockPath);
        }
        cleaned++;
        log(`  ${DRY_RUN ? "DRY" : "✓"} Removed stale lock: ${lockFile}`);
      }
    } catch {
      // Lock doesn't exist — good
    }
  }

  if (cleaned === 0) {
    log("  ✓ No orphan lock files");
  }
  results.push({
    action: "clean-locks",
    items: cleaned,
    details: cleaned > 0 ? `${cleaned} stale lock(s) removed` : "clean",
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const mode = DRY_RUN ? "DRY RUN" : "EXECUTE";
  log(`🧹 Workspace cleaner [${mode}]\n`);

  log("1/5 Rotating heartbeat-history.log...");
  await rotateHeartbeatLog();

  log("\n2/5 Archiving old memory snapshots (>14 days)...");
  await archiveOldMemorySnapshots();

  log("\n3/5 Deleting duplicate -md.md files...");
  await deleteDuplicateMdFiles();

  log("\n4/5 Trimming stale reports (>30 days)...");
  await trimStaleReports();

  log("\n5/5 Cleaning orphan lock files...");
  await cleanOrphanLocks();

  // Summary
  const totalItems = results.reduce((sum, r) => sum + r.items, 0);
  log(`\n${"─".repeat(50)}`);
  log(`✅ Cleanup complete: ${totalItems} item(s) processed`);
  for (const r of results) {
    log(`   ${r.action}: ${r.items} — ${r.details}`);
  }

  // Write result for cron delivery
  if (!DRY_RUN) {
    const summaryPath = path.join(MEMORY_DIR, "cleaner-last-run.json");
    await fs.writeFile(
      summaryPath,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          dryRun: false,
          totalItems,
          results,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((err) => {
  console.error("⚠️  workspace-cleaner failed:", err.message);
  process.exit(QUIET ? 0 : 1);
});
