#!/usr/bin/env pnpm tsx
/**
 * Agent Supervisor - Keeps all agents running
 * Background process that manages all always-on agents
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const AGENTS_DIR = join(process.cwd(), "agents");

// Ensure logs directories exist
["builder", "scriber", "inf-hub", "inf-2603", "concacaf", "finalissima"].forEach((agent) => {
  const logDir = join(AGENTS_DIR, agent, "logs");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
});

const AGENTS = [
  { name: "Builder", script: "agents/builder/agent.ts", interval: 60000 },
  { name: "Scriber", script: "agents/scriber/agent.ts", interval: 300000 },
  { name: "TulsManager", script: "agents/tulsmanager/agent.ts", interval: 60000 },
  { name: "INF-2603", script: "agents/inf-2603/agent.ts", interval: 60000 },
];

const running: Map<string, ReturnType<typeof spawn>> = new Map();

async function runAgent(agent: (typeof AGENTS)[0]) {
  return new Promise((resolve) => {
    console.log(`[${agent.name}] Starting...`);

    const proc = spawn("pnpm", ["tsx", agent.script], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    let output = "";

    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      console.log(`[${agent.name}] Stopped (code: ${code})`);
      running.delete(agent.name);
      resolve(null);
    });

    running.set(agent.name, proc);

    // Run once to get initial status
    setTimeout(() => {
      console.log(`[${agent.name}] ${output.split("\n").slice(0, 3).join(" ")}`);
      resolve(null);
    }, 2000);
  });
}

async function main() {
  console.log("🎛️ Agent Supervisor starting...");
  console.log(`Agents: ${AGENTS.map((a) => a.name).join(", ")}`);

  // Run all agents once
  await Promise.all(AGENTS.map(runAgent));

  console.log("✅ All agents initialized");
  console.log("Running in background...");

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("🛑 Stopping agents...");
    for (const [, proc] of running) {
      proc.kill();
    }
    process.exit(0);
  });
}

main().catch(console.error);
