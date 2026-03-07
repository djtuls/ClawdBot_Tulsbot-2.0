#!/usr/bin/env tsx
/**
 * memory-vacuum.ts — Monthly memory index health maintenance
 *
 * Runs a safe cleanup cycle:
 *   1. Log pre-vacuum DB sizes
 *   2. Force full memory reindex (removes stale entries for deleted files)
 *   3. VACUUM both memory SQLite files to reclaim disk space
 *   4. Log post-vacuum DB sizes and savings
 *
 * Usage:
 *   npx tsx scripts/memory-vacuum.ts            (execute)
 *   npx tsx scripts/memory-vacuum.ts --dry-run   (preview sizes only, no changes)
 *   npx tsx scripts/memory-vacuum.ts --quiet      (suppress verbose output)
 *
 * Cron: runs monthly (first Monday of month, 3AM Sydney)
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const QUIET = args.has("--quiet");

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw-cli");
const GATEWAY_STATE_DIR = path.join(os.homedir(), ".openclaw");

const SQLITE_PATHS = [
  path.join(STATE_DIR, "memory", "main.sqlite"),
  path.join(STATE_DIR, "memory", "tulsbot.sqlite"),
  path.join(GATEWAY_STATE_DIR, "memory", "main.sqlite"),
  path.join(GATEWAY_STATE_DIR, "memory", "tulsbot.sqlite"),
];

function log(...args: unknown[]) {
  if (!QUIET) {
    console.log(...args);
  }
}

function getFileSizeBytes(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return -1;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 0) {
    return "N/A";
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface VacuumResult {
  path: string;
  label: string;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  skipped: boolean;
  error?: string;
}

function vacuumSqlite(filePath: string): VacuumResult {
  const label = `${path.basename(path.dirname(filePath))}/${path.basename(filePath)}`;
  const beforeBytes = getFileSizeBytes(filePath);

  if (beforeBytes < 0) {
    return { path: filePath, label, beforeBytes, afterBytes: -1, savedBytes: 0, skipped: true };
  }

  if (DRY_RUN) {
    log(`  [dry-run] Would VACUUM ${label} (${formatBytes(beforeBytes)})`);
    return {
      path: filePath,
      label,
      beforeBytes,
      afterBytes: beforeBytes,
      savedBytes: 0,
      skipped: true,
    };
  }

  try {
    // Use node:sqlite directly — no subprocess, no injection risk
    const db = new DatabaseSync(filePath);
    db.exec("VACUUM");
    db.close();
    const afterBytes = getFileSizeBytes(filePath);
    const savedBytes = beforeBytes - afterBytes;
    return { path: filePath, label, beforeBytes, afterBytes, savedBytes, skipped: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      path: filePath,
      label,
      beforeBytes,
      afterBytes: beforeBytes,
      savedBytes: 0,
      skipped: false,
      error,
    };
  }
}

async function main() {
  log("🧠 Memory Vacuum — Starting maintenance cycle");
  log(`   Mode: ${DRY_RUN ? "dry-run (no changes)" : "live"}`);
  log(`   Time: ${new Date().toISOString()}\n`);

  // Step 1: Log pre-vacuum sizes
  log("📊 Pre-vacuum sizes:");
  for (const p of SQLITE_PATHS) {
    const bytes = getFileSizeBytes(p);
    if (bytes >= 0) {
      log(`   ${p.replace(os.homedir(), "~")}: ${formatBytes(bytes)}`);
    }
  }

  // Step 2: Force memory reindex (removes stale entries for deleted files)
  if (!DRY_RUN) {
    log("\n🔄 Force reindexing memory (removes stale entries)...");
    const reindex = spawnSync("openclaw", ["memory", "index", "--force"], {
      stdio: "pipe",
      cwd: WORKSPACE,
    });
    if (reindex.status === 0) {
      log("   ✅ Reindex complete");
    } else {
      const stderr = reindex.stderr?.toString() || "";
      log(`   ⚠️  Reindex warning (non-fatal): ${stderr.slice(0, 200)}`);
    }
  } else {
    log("\n[dry-run] Would run: openclaw memory index --force");
  }

  // Step 3: VACUUM all SQLite files using node:sqlite (safe, no shell injection)
  log("\n🗜️  VACUUMing SQLite files...");
  const results: VacuumResult[] = [];
  for (const p of SQLITE_PATHS) {
    const result = vacuumSqlite(p);
    results.push(result);
    if (!result.skipped && !result.error) {
      const delta =
        result.savedBytes > 0 ? ` (saved ${formatBytes(result.savedBytes)})` : " (no change)";
      log(`   ✅ ${result.label}: ${formatBytes(result.afterBytes)}${delta}`);
    } else if (result.error) {
      log(`   ❌ ${result.label}: VACUUM failed — ${result.error}`);
    }
  }

  // Step 4: Summary
  const validResults = results.filter((r) => r.beforeBytes >= 0);
  const totalBefore = validResults.reduce((s, r) => s + r.beforeBytes, 0);
  const totalAfter = results
    .filter((r) => r.afterBytes >= 0 && !r.error)
    .reduce((s, r) => s + r.afterBytes, 0);
  const totalSaved = results.reduce((s, r) => s + r.savedBytes, 0);

  log("\n📈 Summary:");
  log(`   Before: ${formatBytes(totalBefore)}`);
  log(`   After:  ${formatBytes(totalAfter)}`);
  log(`   Saved:  ${formatBytes(totalSaved)}`);

  // Write machine-readable report for monitoring
  const report = {
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    totalBeforeBytes: totalBefore,
    totalAfterBytes: totalAfter,
    totalSavedBytes: totalSaved,
    files: results.map((r) => ({
      path: r.path.replace(os.homedir(), "~"),
      beforeMB: +(r.beforeBytes / (1024 * 1024)).toFixed(2),
      afterMB: +(r.afterBytes / (1024 * 1024)).toFixed(2),
      savedMB: +(r.savedBytes / (1024 * 1024)).toFixed(2),
      skipped: r.skipped,
      error: r.error,
    })),
  };

  if (!DRY_RUN) {
    try {
      const reportsDir = path.join(WORKSPACE, "reports");
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportsDir, "memory-vacuum-latest.json"),
        JSON.stringify(report, null, 2),
      );
      log("\n💾 Report written to reports/memory-vacuum-latest.json");
    } catch {
      // non-fatal — don't fail the job over report write
    }
  }

  log("\n✅ Memory vacuum complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ memory-vacuum failed:", (err as Error).message || err);
  process.exit(1);
});
