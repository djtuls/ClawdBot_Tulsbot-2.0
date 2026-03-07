/**
 * Backup to Drive — 3 AM BRT daily
 * Backs up critical workspace files to a local archive.
 * Google Drive upload via gog CLI can be added later.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { logCron } from "./event-logger.js";

const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const BACKUP_DIR = join(WORKSPACE, "backup");

function main() {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().split("T")[0];
  const backupFile = join(BACKUP_DIR, `workspace-backup-${timestamp}.tar.gz`);

  if (existsSync(backupFile)) {
    console.log(`Backup already exists for ${timestamp}`);
    logCron("backup-to-drive", "ok", { action: "skipped", reason: "already exists" });
    return;
  }

  try {
    const filesToBackup = [
      "memory/",
      "tasks/",
      "RUNBOOK.md",
      "SOUL.md",
      "STATE.md",
      "TODO.md",
      "ROADMAP.md",
      "AGENTS.md",
      "COMMANDS.md",
    ].filter((f) => existsSync(join(WORKSPACE, f)));

    execFileSync("tar", ["-czf", backupFile, "-C", WORKSPACE, ...filesToBackup], { stdio: "pipe" });

    // Clean backups older than 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    try {
      for (const f of readdirSync(BACKUP_DIR)) {
        if (!f.startsWith("workspace-backup-") || !f.endsWith(".tar.gz")) {
          continue;
        }
        const fullPath = join(BACKUP_DIR, f);
        const stat = statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(fullPath);
          console.log(`Removed old backup: ${f}`);
        }
      }
    } catch {}

    console.log(`Backup created: ${backupFile}`);
    logCron("backup-to-drive", "ok", { file: backupFile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error(`Backup failed: ${msg}`);
    logCron("backup-to-drive", "error", { error: msg });
  }
}

main();
