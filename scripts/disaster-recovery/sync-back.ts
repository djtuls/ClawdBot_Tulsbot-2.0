#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const HOME = process.env.HOME || "/Users/tulioferro";
const MINI_HOST = process.env.MINI_HOST || "tulioferro@Tulios-Mac-mini.local";
const MINI_WORKSPACE = "/Users/tulioferro/.openclaw/workspace";
const V2_WORKSPACE = path.join(HOME, ".openclaw/workspace-v2-restore");
const DR_STATE = path.join(HOME, ".openclaw/state/dr-primary.json");

const SYNC_PATHS = [
  "memory",
  "state",
  "TODO.md",
  "STATE.md",
  "RUNBOOK.md",
  "AGENTS.md",
  "GOVERNANCE.md",
];

async function readPrimaryState() {
  try {
    return JSON.parse(await fsp.readFile(DR_STATE, "utf8"));
  } catch {
    return null;
  }
}

async function writePrimaryState(payload: unknown) {
  await fsp.mkdir(path.dirname(DR_STATE), { recursive: true });
  await fsp.writeFile(DR_STATE, `${JSON.stringify(payload, null, 2)}\n`);
}

function rsyncPath(rel: string, dryRun: boolean) {
  const src = path.join(V2_WORKSPACE, rel);
  if (!fs.existsSync(src)) {
    return;
  }
  const args = ["-az", "--update", "--partial"];
  if (dryRun) {
    args.push("--dry-run");
  }
  args.push(src, `${MINI_HOST}:${MINI_WORKSPACE}/${rel}`);
  execFileSync("rsync", args, { stdio: "inherit" });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--execute");

  const state = await readPrimaryState();
  if (!state || state.primary !== "v2" || state.active !== true) {
    console.error("Refusing sync-back: V2 is not marked active primary in dr state");
    process.exit(2);
  }

  if (!fs.existsSync(V2_WORKSPACE)) {
    console.error("V2 workspace missing:", V2_WORKSPACE);
    process.exit(3);
  }

  for (const rel of SYNC_PATHS) {
    rsyncPath(rel, dryRun);
  }

  if (dryRun) {
    console.log("Dry-run complete. Re-run with --execute to apply.");
    return;
  }

  await writePrimaryState({
    primary: "mini",
    active: true,
    lastSyncBackAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({ ok: true, synced: SYNC_PATHS, host: MINI_HOST }, null, 2));
  console.log("You can now stop local V2 gateway and return to mini-primary operation.");
}

main().catch((err) => {
  console.error("sync-back failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
