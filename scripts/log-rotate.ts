#!/usr/bin/env tsx
/**
 * log-rotate.ts — Weekly log rotation for gateway and workspace logs
 *
 * Rotates large log files by archiving them with a date suffix and truncating
 * the live file. Keeps the last 4 archives per log file.
 *
 * Usage: npx tsx scripts/log-rotate.ts [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const HOME = process.env.HOME ?? "/Users/tulioferro";
const DRY_RUN = process.argv.includes("--dry-run");

const MAX_ARCHIVES = 4;

// Log files to rotate and their size thresholds (in bytes)
const ROTATE_TARGETS: { file: string; minSizeBytes: number }[] = [
  {
    file: path.join(HOME, ".openclaw/logs/gateway.err.log"),
    minSizeBytes: 5 * 1024 * 1024, // 5MB
  },
  {
    file: path.join(HOME, ".openclaw/logs/gateway.log"),
    minSizeBytes: 10 * 1024 * 1024, // 10MB
  },
  {
    file: path.join(PROJECT_ROOT, "logs/discord-ack.log"),
    minSizeBytes: 500 * 1024, // 500KB
  },
  {
    file: path.join(PROJECT_ROOT, "logs/discord-ack.error.log"),
    minSizeBytes: 100 * 1024, // 100KB
  },
  {
    file: path.join(HOME, ".openclaw/logs/heartbeat-loop-stderr.log"),
    minSizeBytes: 1 * 1024 * 1024, // 1MB
  },
  {
    file: path.join(HOME, ".openclaw/logs/memory-full-flush-stderr.log"),
    minSizeBytes: 1 * 1024 * 1024, // 1MB
  },
];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

interface RotateResult {
  file: string;
  rotated: boolean;
  sizeBefore?: number;
  archive?: string;
  reason?: string;
}

function rotateLog(filePath: string, minSizeBytes: number): RotateResult {
  if (!fs.existsSync(filePath)) {
    return { file: filePath, rotated: false, reason: "not found" };
  }

  const stat = fs.statSync(filePath);
  if (stat.size < minSizeBytes) {
    return {
      file: filePath,
      rotated: false,
      reason: `${formatBytes(stat.size)} < threshold ${formatBytes(minSizeBytes)}`,
    };
  }

  const dateStr = new Date().toISOString().split("T")[0];
  const archivePath = `${filePath}.${dateStr}.bak`;

  if (!DRY_RUN) {
    // Copy current log to archive
    fs.copyFileSync(filePath, archivePath);
    // Truncate live log file (keeps file handle open for the running gateway)
    fs.writeFileSync(filePath, "");

    // Prune old archives: keep only MAX_ARCHIVES most recent
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const archives = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base + ".") && f.endsWith(".bak"))
      .toSorted()
      .toReversed();
    for (const old of archives.slice(MAX_ARCHIVES)) {
      fs.unlinkSync(path.join(dir, old));
    }
  }

  return {
    file: filePath,
    rotated: true,
    sizeBefore: stat.size,
    archive: archivePath,
  };
}

function main() {
  console.log(`🔄 Log rotation started${DRY_RUN ? " (dry run)" : ""}`);

  let rotatedCount = 0;
  let freedBytes = 0;

  for (const target of ROTATE_TARGETS) {
    const result = rotateLog(target.file, target.minSizeBytes);
    const shortName = path.relative(HOME, result.file);

    if (result.rotated && result.sizeBefore !== undefined) {
      console.log(`  ✅ ~/${shortName}: ${formatBytes(result.sizeBefore)} → archived`);
      rotatedCount++;
      freedBytes += result.sizeBefore;
    } else {
      console.log(`  ⏭️  ~/${shortName}: skipped (${result.reason})`);
    }
  }

  console.log(
    `\n✅ Log rotation complete: ${rotatedCount} file(s) rotated, ~${formatBytes(freedBytes)} freed`,
  );
}

main();
