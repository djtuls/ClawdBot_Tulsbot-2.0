#!/usr/bin/env node
/**
 * Full Health Sync
 *
 * Runs the full repo + memory health checklist:
 *   1. Repo status snapshot (git status --short)
 *   2. pnpm check (lint/type/test bundle)
 *   3. Local ↔ Cloud markdown sync
 *   4. AnythingLLM bidirectional sync
 *   5. NotebookLM codebase snapshot upload
 *   6. Brain knowledge regeneration
 *   7. Gateway/channel status probe
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
process.chdir(repoRoot);

const reportsDir = path.join(repoRoot, "reports");
const summaryFile = path.join(reportsDir, "full-health-sync-latest.json");

interface Step {
  name: string;
  command: string;
  args?: string[];
}

const steps: Step[] = [
  { name: "Repo status snapshot", command: "git", args: ["status", "--short"] },
  { name: "pnpm check", command: "pnpm", args: ["check"] },
  {
    name: "Local ↔ Cloud memory sync",
    command: "pnpm",
    args: ["tsx", "scripts/sync-memory-cloud-bidirectional.ts"],
  },
  {
    name: "AnythingLLM brain sync",
    command: "pnpm",
    args: ["tsx", "scripts/sync-anythingllm-bidirectional.ts"],
  },
  {
    name: "NotebookLM alignment",
    command: "./scripts/nlm-sync-codebase.sh",
  },
  {
    name: "Brain knowledge regeneration",
    command: "./scripts/setup-brain-sync-service.sh",
    args: ["run"],
  },
  {
    name: "Gateway/channel status",
    command: "openclaw",
    args: ["channels", "status"],
  },
];

type StepStatus = "success" | "failed";

interface StepResult {
  name: string;
  status: StepStatus;
  error?: string;
}

const results: StepResult[] = [];

function spawnCommand(step: Step) {
  const { name, command, args = [] } = step;
  console.log(`\n🟢 ${name}`);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("error", (error) => {
      reject(new Error(`${name} failed to start: ${error.message}`));
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        console.log(`✅ ${name} complete`);
        resolve();
      } else {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        reject(new Error(`${name} failed with ${reason}`));
      }
    });
  });
}

async function runStep(step: Step) {
  try {
    await spawnCommand(step);
    results.push({ name: step.name, status: "success" });
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${step.name}: ${message}`);
    results.push({ name: step.name, status: "failed", error: message });
    return { ok: false as const, error: message };
  }
}

async function writeSummary(status: StepStatus, failureReason?: string) {
  await fs.mkdir(reportsDir, { recursive: true });
  const payload = {
    runStartedAt: runStartedAt.toISOString(),
    runFinishedAt: new Date().toISOString(),
    status,
    failureReason: failureReason ?? null,
    steps: results,
  };
  await fs.writeFile(summaryFile, JSON.stringify(payload, null, 2));
}

const runStartedAt = new Date();

async function main() {
  console.log("🚀 Starting full health sync...");
  let failureReason: string | undefined;

  for (const step of steps) {
    const { ok, error } = await runStep(step);
    if (!ok && !failureReason) {
      failureReason = `${step.name}: ${error ?? "unknown error"}`;
    }
  }

  const finalStatus: StepStatus = failureReason ? "failed" : "success";
  if (finalStatus === "success") {
    console.log("\n🎉 Full health sync completed successfully.");
  } else {
    console.error("\n⚠️ Full health sync completed with failures.");
  }

  await writeSummary(finalStatus, failureReason);
  if (finalStatus === "failed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\n❌ Full health sync crashed:", error);
  process.exit(1);
});
