/**
 * Hourly Heartbeat - Lightweight (Phase 4.3)
 *
 * Fast, essential operations only (~30 seconds):
 * - Runtime invariant checks (VISION.md non-negotiables)
 * - Node presence → tulsbot_nodes
 * - STATE.md refresh
 * - Tulsday sync (short-term memory)
 * - Context window refresh
 * - Writes heartbeat-state.json (canonical invariant status file)
 *
 * Heavy operations moved to daily heartbeat (4 AM).
 */

import { config as loadEnv } from "dotenv";
import { spawn, spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assessAndHealMemory } from "./lib/memory-health.js";
import { withWorkspaceLease } from "./lib/workspace-lock";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

loadEnv({ path: path.join(repoRoot, ".env") });

const memoryStatePath = path.join(repoRoot, "memory", "heartbeat-hourly-state.json");
const canonicalStatePath = path.join(repoRoot, "memory", "heartbeat-state.json");
const historyLogPath = path.join(repoRoot, "reports", "heartbeat-hourly-history.log");
const lockfilePath = path.join(repoRoot, "memory", ".heartbeat-hourly.lock");
const LOCK_STALE_MS = 30 * 60 * 1000; // 30 min

async function acquireLock(): Promise<boolean> {
  try {
    const stat = await fs.stat(lockfilePath).catch(() => null);
    if (stat) {
      const age = Date.now() - stat.mtimeMs;
      if (age < LOCK_STALE_MS) {
        console.log(
          `⏭️ Hourly heartbeat already running (lock age: ${Math.round(age / 1000)}s). Skipping.`,
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

interface InvariantResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkInvariants(): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // 1. Single workspace authority
  const configPath = path.join(process.env.HOME!, ".openclaw/openclaw.json");
  try {
    const config = JSON.parse(fsSync.readFileSync(configPath, "utf-8"));
    const ws = config?.agents?.tulsbot?.workspace || config?.agents?.defaults?.workspace || "";
    const isCorrect = ws.includes(".openclaw/workspace") || ws === "";
    results.push({ name: "Single workspace authority", ok: isCorrect, detail: ws || "default" });
  } catch {
    results.push({
      name: "Single workspace authority",
      ok: false,
      detail: "Cannot read openclaw.json",
    });
  }

  // 2-4. Memory health (daily + handoff + event-log) with safe auto-heal
  const memory = await assessAndHealMemory(repoRoot);
  for (const tier of memory.tiers) {
    if (tier.name === "daily") {
      results.push({ name: "Daily memory fresh", ok: tier.ok, detail: tier.detail });
    } else if (tier.name === "handoff") {
      results.push({ name: "Session handoff fresh", ok: tier.ok, detail: tier.detail });
    } else if (tier.name === "event-log") {
      results.push({ name: "Event log active", ok: tier.ok, detail: tier.detail });
    }
  }

  // 5. Cron jobs executing (check for recent cron log entries)
  const logsDir = path.join(process.env.HOME!, ".openclaw/logs");
  if (fsSync.existsSync(logsDir)) {
    const logFiles = fsSync.readdirSync(logsDir).filter((f) => f.startsWith("cron-"));
    let freshLogs = 0;
    for (const f of logFiles) {
      const stat = fsSync.statSync(path.join(logsDir, f));
      if (now - stat.mtimeMs < 4 * 3600000) {
        freshLogs++;
      }
    }
    results.push({
      name: "Cron jobs executing",
      ok: freshLogs >= 3,
      detail: `${freshLogs}/${logFiles.length} logs updated in last 4h`,
    });
  }

  // 6. Gateway reachable
  try {
    const res = spawnSync(
      "/opt/homebrew/bin/node",
      [
        "-e",
        `
      fetch("http://localhost:18891/healthz").then(r => {
        process.exit(r.ok ? 0 : 1);
      }).catch(() => process.exit(1));
    `,
      ],
      { timeout: 5000 },
    );
    results.push({
      name: "Gateway reachable",
      ok: res.status === 0,
      detail: res.status === 0 ? "healthy" : "unreachable",
    });
  } catch {
    results.push({ name: "Gateway reachable", ok: false, detail: "check failed" });
  }

  // 7. Tulsday context freshness
  const tulsdayPath = path.join(repoRoot, "memory/tulsday-processed-context.json");
  if (fsSync.existsSync(tulsdayPath)) {
    const stat = fsSync.statSync(tulsdayPath);
    const hoursAgo = (now - stat.mtimeMs) / 3600000;
    results.push({
      name: "Tulsday context fresh",
      ok: hoursAgo < 2,
      detail: `${hoursAgo.toFixed(1)}h old`,
    });
  } else {
    results.push({ name: "Tulsday context fresh", ok: false, detail: "Missing" });
  }

  return results;
}

async function registerNodePresence(): Promise<StepResult> {
  const key = "nodePresence";
  const name = "Node presence → Supabase tulsbot_nodes";
  const startedAt = Date.now();
  console.log(`\n▶ ${name}`);

  try {
    const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

    if (!supabaseUrl || !serviceKey) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    }

    let tailscaleAddr = "";
    try {
      const result = spawnSync("/usr/local/bin/tailscale", ["ip", "-4"], {
        timeout: 5000,
        encoding: "utf8",
      });
      if (result.status === 0 && result.stdout) {
        const raw = result.stdout.trim();
        if (raw) {
          tailscaleAddr = raw;
        }
      }
    } catch {
      // Tailscale not running — proceed with empty address
    }

    const now = new Date().toISOString();
    const body = {
      node_id: "openclaw-local",
      name: "OpenClaw Mac",
      kind: "laptop",
      status: "online",
      last_seen_at: now,
      tailscale_addr: tailscaleAddr,
      metadata: { version: "hybrid-v2", workspace: repoRoot, heartbeat: "hourly" },
      updated_at: now,
    };

    const res = await fetch(`${supabaseUrl}/rest/v1/tulsbot_nodes`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const elapsed = Date.now() - startedAt;
    const addrInfo = tailscaleAddr ? ` (tailscale: ${tailscaleAddr})` : " (no tailscale)";
    console.log(`✅ ${name}${addrInfo}`);
    return { key, name, status: "success", details: `registered in ${elapsed}ms${addrInfo}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`⚠️ ${name} (non-fatal): ${message}`);
    return { key, name, status: "failed", details: message };
  }
}

const steps = [
  {
    key: "stateRefresh",
    name: "STATE.md refresh",
    command: "npx",
    args: ["tsx", "scripts/refresh-state.ts", "--quiet"],
  },
  {
    key: "tulsdaySync",
    name: "Tulsday short-term memory sync",
    command: "npx",
    args: ["tsx", "scripts/sync-tulsday-state.ts", "--quiet"],
  },
  {
    key: "contextWindow",
    name: "Context window refresh",
    command: "npx",
    args: ["tsx", "scripts/build-context-window.ts"],
  },
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

async function updateState(results: StepResult[], invariants: InvariantResult[]) {
  const now = new Date();
  const tasks: Record<string, { status: string; details: string }> = {};
  for (const r of results) {
    tasks[r.key] = {
      status: r.status === "success" ? "SUCCEEDED" : "FAILED",
      details: r.details,
    };
  }
  const hourlyPayload = {
    lastRun: now.toISOString(),
    type: "hourly",
    tasks,
  };
  await fs.writeFile(memoryStatePath, JSON.stringify(hourlyPayload, null, 2));

  const invariantMap: Record<string, { ok: boolean; detail: string }> = {};
  for (const inv of invariants) {
    invariantMap[inv.name] = { ok: inv.ok, detail: inv.detail };
  }
  const canonicalPayload = {
    lastRun: now.toISOString(),
    allGreen: invariants.every((i) => i.ok),
    failedCount: invariants.filter((i) => !i.ok).length,
    invariants: invariantMap,
    tasks,
  };
  await fs.writeFile(canonicalStatePath, JSON.stringify(canonicalPayload, null, 2));
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
    console.log("⏱️ Hourly heartbeat started...");
    const startTime = Date.now();

    console.log("\n🔍 Checking runtime invariants...");
    const invariants = await checkInvariants();
    const failedInvariants = invariants.filter((i) => !i.ok);
    for (const inv of invariants) {
      console.log(`  ${inv.ok ? "✅" : "❌"} ${inv.name}: ${inv.detail}`);
    }
    if (failedInvariants.length > 0) {
      console.warn(`\n⚠️ ${failedInvariants.length} invariant(s) failed`);
    } else {
      console.log("\n✅ All invariants green");
    }

    const results: StepResult[] = [await registerNodePresence()];
    for (const step of steps) {
      const result = await runStep(step);
      results.push(result);
    }

    const agent = process.env.OPENCLAW_AGENT_ID || process.env.OPENCLAW_AGENT || "main";
    const lease = await withWorkspaceLease(repoRoot, agent, "hourly-heartbeat-write", async () => {
      await updateState(results, invariants);
      await appendHistory(results);
    });

    if (!lease.ok) {
      console.warn(`⚠️ Heartbeat write skipped: ${lease.reason}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const failures = results.filter((r) => r.status === "failed");

    if (failures.length > 0) {
      console.error(
        `⚠️ Hourly heartbeat completed with ${failures.length} failure(s) in ${elapsed}s.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`✅ Hourly heartbeat completed successfully in ${elapsed}s.`);
    }
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  console.error("Hourly heartbeat crashed:", error);
  process.exit(1);
});
