#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import path from "node:path";

const WORKSPACE =
  process.env.WORKSPACE_DIR ||
  path.join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");

interface DispatchOutput {
  mode: "inline" | "background";
  reason: string;
  taskId?: string;
  title: string;
  workerSpec?: {
    runtime: "subagent";
    mode: "run";
    task: string;
    cwd: string;
    runTimeoutSeconds: number;
    label: string;
  };
}

function scoreHeavy(title: string, details: string): number {
  const t = `${title} ${details}`.toLowerCase();
  let score = 0;
  const signals = [
    "refactor",
    "migration",
    "implement",
    "build",
    "investigate",
    "debug",
    "ci",
    "docker",
    "lint",
    "test",
    "multi-file",
    "architecture",
  ];
  for (const s of signals) {
    if (t.includes(s)) {
      score += 1;
    }
  }
  if (details.length > 300) {
    score += 1;
  }
  return score;
}

function registerBackground(title: string): string {
  const res = spawnSync(
    "npx",
    ["tsx", "scripts/builder-task-manager.ts", "start", title, "--owner", "main"],
    { cwd: WORKSPACE, encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(res.stderr || `builder-task-manager exited ${res.status}`);
  }
  const parsed = JSON.parse(res.stdout || "{}");
  if (!parsed.id) {
    throw new Error("missing task id from task manager");
  }
  return parsed.id;
}

function usage() {
  console.log(
    `Usage:\n  npx tsx scripts/builder-dispatch.ts "<title>" [--details "..."] [--timeout 1800] [--force-background]`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const title = args[0];
  if (!title) {
    return usage();
  }

  const detailsIdx = args.indexOf("--details");
  const details = detailsIdx >= 0 ? args[detailsIdx + 1] || "" : "";
  const timeoutIdx = args.indexOf("--timeout");
  const timeout = timeoutIdx >= 0 ? Number(args[timeoutIdx + 1] || "1800") : 1800;
  const forceBackground = args.includes("--force-background");

  const heavyScore = scoreHeavy(title, details);
  const background = forceBackground || heavyScore >= 2;

  if (!background) {
    const out: DispatchOutput = {
      mode: "inline",
      reason: `heavy_score=${heavyScore} (<2)`,
      title,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const taskId = registerBackground(title);
  const out: DispatchOutput = {
    mode: "background",
    reason: forceBackground ? "forced" : `heavy_score=${heavyScore} (>=2)`,
    taskId,
    title,
    workerSpec: {
      runtime: "subagent",
      mode: "run",
      task: `${title}\n\n${details}`.trim(),
      cwd: WORKSPACE,
      runTimeoutSeconds: Number.isFinite(timeout) ? timeout : 1800,
      label: `builder-${taskId}`,
    },
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
