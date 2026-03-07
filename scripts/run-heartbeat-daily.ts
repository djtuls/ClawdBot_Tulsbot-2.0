/**
 * Daily Heartbeat - Full/Heavyweight (Phase 4.3)
 *
 * Heavy operations that only need to run once per day (~5-10 minutes):
 * - Memory sync → Supabase cloud mirror
 * - AnythingLLM backfill → Local RAG
 * - Master indexer → Tools, DBs, docs → Supabase
 * - Notion status snapshot & dashboard sync
 * - Brief backfill (context → memory)
 *
 * Runs once per day at 4:00 AM via cron.
 */

// import Database from "better-sqlite3";
import { config as loadEnv } from "dotenv";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

loadEnv({ path: path.join(repoRoot, ".env") });

const memoryStatePath = path.join(repoRoot, "memory", "heartbeat-daily-state.json");
const historyLogPath = path.join(repoRoot, "reports", "heartbeat-daily-history.log");
const lockfilePath = path.join(repoRoot, "memory", ".heartbeat-daily.lock");
const LOCK_STALE_MS = 60 * 60 * 1000; // 60 min

async function acquireLock(): Promise<boolean> {
  try {
    const stat = await fs.stat(lockfilePath).catch(() => null);
    if (stat) {
      const age = Date.now() - stat.mtimeMs;
      if (age < LOCK_STALE_MS) {
        console.log(
          `⏭️ Daily heartbeat already running (lock age: ${Math.round(age / 1000)}s). Skipping.`,
        );
        return false;
      }
      console.log(`⚠️ Stale lock detected (${Math.round(age / 1000)}s old), overriding.`);
    }
    await fs.writeFile(
      lockfilePath,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(): Promise<void> {
  await fs.unlink(lockfilePath).catch(() => {});
}

const steps = [
  {
    key: "memorySyncSupabase",
    name: "Memory sync → Supabase (cloud mirror)",
    command: "npx",
    args: ["tsx", "scripts/sync-memory-supabase.ts"],
  },
  {
    key: "anythingLLMBackfill",
    name: "AnythingLLM backfill (local RAG)",
    command: "npx",
    args: ["tsx", "scripts/backfill-anythingllm.ts"],
  },
  {
    key: "briefBackfill",
    name: "Brief backfill (context-window → memory)",
    command: "npx",
    args: ["tsx", "scripts/backfill-daily-brief-from-context-window.ts"],
  },
  {
    key: "masterIndexer",
    name: "Master indexer sync (tools, databases, docs → Supabase)",
    command: "npx",
    args: ["tsx", "scripts/indexer/run-indexer.ts", "--quiet"],
  },
  // Notion system ops push removed (IOS Rebuild).
  // Notion is now domain-only (Live Engine, Creative Tools, INFT).
  // System ops live in Mission Control.
];

type StepResult = {
  key: string;
  name: string;
  status: "success" | "failed";
  details: string;
};

async function runStep(step: (typeof steps)[number]): Promise<StepResult> {
  console.log(`\n▶ ${step.name}`);
  const startedAt = new Date();
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(step.command, step.args, {
        cwd: repoRoot,
        stdio: "inherit",
        shell: false,
        env: process.env,
      });
      child.on("error", (error) => reject(error));
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve();
        } else {
          const reason = signal ? `signal ${signal}` : `exit code ${code}`;
          reject(new Error(reason));
        }
      });
    });
    console.log(`✅ ${step.name}`);
    return {
      key: step.key,
      name: step.name,
      status: "success",
      details: `${step.name} succeeded in ${new Date().getTime() - startedAt.getTime()}ms`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${step.name}: ${message}`);
    return {
      key: step.key,
      name: step.name,
      status: "failed",
      details: message,
    };
  }
}

async function updateState(results: StepResult[]) {
  const now = new Date();
  const tasks: Record<string, { status: string; details: string }> = {};
  for (const r of results) {
    tasks[r.key] = {
      status: r.status === "success" ? "SUCCEEDED" : "FAILED",
      details: r.details,
    };
  }
  const payload = {
    lastRun: now.toISOString(),
    type: "daily",
    tasks,
  };
  await fs.writeFile(memoryStatePath, JSON.stringify(payload, null, 2));
}

async function appendHistory(results: StepResult[]) {
  await fs.mkdir(path.dirname(historyLogPath), { recursive: true });
  const timestamp = new Date().toISOString();
  const summary = results.map((result) => `${result.name}: ${result.status}`).join(" | ");
  await fs.appendFile(historyLogPath, `${timestamp} ${summary}\n`);
}

async function main() {
  if (!(await acquireLock())) {
    process.exit(0);
  }

  try {
    console.log("⏱️ Daily heartbeat started...");
    const startTime = Date.now();
    const results: StepResult[] = [];

    for (const step of steps) {
      const result = await runStep(step);
      results.push(result);
    }

    await updateState(results);
    await appendHistory(results);

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const failures = results.filter((r) => r.status === "failed");

    if (failures.length > 0) {
      console.error(
        `❌ Daily heartbeat completed with ${failures.length} failure(s) in ${elapsed} minutes.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`✅ Daily heartbeat completed successfully in ${elapsed} minutes.`);
    }
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  console.error("Daily heartbeat crashed:", error);
  process.exit(1);
});
