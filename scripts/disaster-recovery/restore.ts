#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const HOME = process.env.HOME || "/Users/tulioferro";
const PRIMARY_WORKSPACE = path.join(HOME, ".openclaw/workspace");
const BACKUP_DIR = path.join(PRIMARY_WORKSPACE, "backup");
const LAPTOP_WORKSPACE = path.join(HOME, ".openclaw/workspace-v2-restore");
const DR_STATE = path.join(HOME, ".openclaw/state/dr-primary.json");

function latestBackup(): string | null {
  if (!fs.existsSync(BACKUP_DIR)) {
    return null;
  }
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^workspace-backup-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f))
    .toSorted()
    .toReversed();
  return files.length ? path.join(BACKUP_DIR, files[0]) : null;
}

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function readPrimaryState() {
  try {
    return JSON.parse(await fsp.readFile(DR_STATE, "utf8"));
  } catch {
    return { primary: "mini", active: true, updatedAt: new Date().toISOString() };
  }
}

async function writePrimaryState(payload: unknown) {
  await ensureDir(path.dirname(DR_STATE));
  await fsp.writeFile(DR_STATE, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const from = args.includes("--from-backup") ? args[args.indexOf("--from-backup") + 1] : "latest";
  const mode = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "local";

  if (mode !== "local") {
    console.error("Only --mode local is currently supported");
    process.exit(2);
  }

  const state = await readPrimaryState();
  if (state?.active === true && state?.primary === "mini") {
    console.error(
      "Refusing restore: mini still marked as active primary. Use explicit failover confirmation first.",
    );
    process.exit(3);
  }

  const archive = from === "latest" ? latestBackup() : path.resolve(from);
  if (!archive || !fs.existsSync(archive)) {
    console.error("No backup archive found");
    process.exit(4);
  }

  await ensureDir(LAPTOP_WORKSPACE);

  execFileSync("tar", ["-xzf", archive, "-C", LAPTOP_WORKSPACE], { stdio: "inherit" });

  await writePrimaryState({
    primary: "v2",
    active: true,
    restoredFrom: archive,
    workspace: LAPTOP_WORKSPACE,
    updatedAt: new Date().toISOString(),
  });

  console.log(
    JSON.stringify(
      { ok: true, mode: "local", restoredFrom: archive, workspace: LAPTOP_WORKSPACE },
      null,
      2,
    ),
  );
  console.log("Next: start local gateway manually if needed: openclaw gateway start");
}

main().catch((err) => {
  console.error("restore failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
