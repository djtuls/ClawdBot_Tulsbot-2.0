#!/usr/bin/env npx tsx
/**
 * agent-preflight.ts — Boot validation for Tulsbot agents.
 *
 * Checks STATE.md staleness, gateway connectivity, model availability,
 * and heartbeat health. Returns structured JSON for agent injection.
 *
 * Usage:
 *   npx tsx scripts/agent-preflight.ts
 *   npx tsx scripts/agent-preflight.ts --json   (machine-readable output)
 */

import { execFileSync } from "child_process";
import { readFileSync, statSync } from "fs";
import { join } from "path";

const WORKSPACE = join(import.meta.dirname, "..");
const STATE_PATH = join(WORKSPACE, "STATE.md");
const HEARTBEAT_PATH = join(WORKSPACE, "memory", "heartbeat-state.json");
const TULSDAY_CONTEXT_PATH = join(WORKSPACE, "memory", "tulsday-processed-context.json");
const SESSION_HANDOFF_PATH = join(WORKSPACE, "memory", "session-handoff.md");
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours
const TULSDAY_CONTEXT_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours — warn if Tulsday context is older

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

interface PreflightResult {
  timestamp: string;
  overall: "ok" | "warn" | "error";
  checks: CheckResult[];
}

function checkStateStaleness(): CheckResult {
  try {
    const stat = statSync(STATE_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > STALE_THRESHOLD_MS) {
      const hours = Math.round(ageMs / (60 * 60 * 1000));
      return {
        name: "state_freshness",
        status: "warn",
        message: `STATE.md is ${hours}h old — may be stale`,
      };
    }
    return { name: "state_freshness", status: "ok", message: "STATE.md is fresh" };
  } catch {
    return { name: "state_freshness", status: "error", message: "STATE.md not found" };
  }
}

function checkHeartbeatHealth(): CheckResult {
  try {
    const stat = statSync(HEARTBEAT_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 2 * 60 * 60 * 1000) {
      const hours = Math.round(ageMs / (60 * 60 * 1000));
      return {
        name: "heartbeat",
        status: "warn",
        message: `heartbeat-state.json is ${hours}h old — heartbeat may not be running`,
      };
    }

    // Parse canonical schema: { lastRun, tasks: { [key]: { status: "SUCCEEDED"|"FAILED", details } } }
    const data = JSON.parse(readFileSync(HEARTBEAT_PATH, "utf-8"));
    const tasks: Record<string, { status?: string; details?: string }> =
      data.tasks ?? data.lastChecks ?? data;

    const failedSteps = Object.entries(tasks).filter(([, v]) => {
      const s = (v?.status ?? "").toUpperCase();
      return s === "FAILED" || s === "ERROR" || s === "failed" || s === "error";
    });

    const totalSteps = Object.keys(tasks).length;
    const lastRun = data.lastRun ?? "unknown";

    if (failedSteps.length > 0) {
      const names = failedSteps.map(([k]) => k).join(", ");
      return {
        name: "heartbeat",
        status: "warn",
        message: `${failedSteps.length}/${totalSteps} heartbeat step(s) failed (${names}) — last run: ${lastRun}`,
      };
    }

    return {
      name: "heartbeat",
      status: "ok",
      message: `Heartbeat healthy — ${totalSteps} steps OK — last run: ${lastRun}`,
    };
  } catch {
    return {
      name: "heartbeat",
      status: "warn",
      message: "heartbeat-state.json not found or unreadable",
    };
  }
}

/**
 * Check that Tulsday's short-term memory (tulsday-processed-context.json) is fresh
 * and actually contains real data, not empty arrays.
 */
function checkTulsdayContext(): CheckResult {
  try {
    const stat = statSync(TULSDAY_CONTEXT_PATH);
    const ageMs = Date.now() - stat.mtimeMs;

    const data = JSON.parse(readFileSync(TULSDAY_CONTEXT_PATH, "utf-8"));
    const hasContent =
      (data.activePriorities?.length ?? 0) > 0 ||
      (data.openThreads?.length ?? 0) > 0 ||
      (data.changes?.length ?? 0) > 0;

    if (ageMs > TULSDAY_CONTEXT_STALE_MS) {
      const hours = Math.round(ageMs / (60 * 60 * 1000));
      return {
        name: "tulsday_context",
        status: "warn",
        message: `tulsday-processed-context.json is ${hours}h old — run sync-tulsday-state.ts`,
      };
    }

    if (!hasContent) {
      return {
        name: "tulsday_context",
        status: "warn",
        message:
          "tulsday-processed-context.json exists but has no active priorities or changes — memory may be cold",
      };
    }

    const priorities = data.activePriorities?.length ?? 0;
    const blockers = data.blockers?.length ?? 0;
    return {
      name: "tulsday_context",
      status: "ok",
      message: `Tulsday context fresh — ${priorities} priorities, ${blockers} blockers`,
    };
  } catch {
    return {
      name: "tulsday_context",
      status: "warn",
      message: "tulsday-processed-context.json missing — run sync-tulsday-state.ts",
    };
  }
}

/**
 * Check that session-handoff.md exists (populated after last shift end).
 */
function checkSessionHandoff(): CheckResult {
  try {
    const stat = statSync(SESSION_HANDOFF_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    const hours = Math.round(ageMs / (60 * 60 * 1000));
    const ageSuffix = hours < 1 ? "fresh" : `${hours}h old`;
    return {
      name: "session_handoff",
      status: "ok",
      message: `session-handoff.md exists (${ageSuffix})`,
    };
  } catch {
    return {
      name: "session_handoff",
      status: "warn",
      message: "session-handoff.md not found — first session or shift end was not clean",
    };
  }
}

function checkGateway(): CheckResult {
  try {
    const output = execFileSync("openclaw", ["channels", "status", "--probe"], {
      timeout: 15_000,
      encoding: "utf-8",
      cwd: WORKSPACE,
    });
    const lines = output.split("\n");
    const gatewayReachable = lines.some((l) => l.includes("Gateway reachable"));
    if (!gatewayReachable) {
      return { name: "gateway", status: "error", message: "Gateway not reachable" };
    }
    const channelLines = lines.filter((l) => l.trim().startsWith("- "));
    const workingChannels = channelLines.filter((l) => l.includes("works"));
    const brokenConfigured = channelLines.filter(
      (l) => !l.includes("works") && !l.includes("not configured") && !l.includes("stopped"),
    );
    if (brokenConfigured.length > 0) {
      const names = brokenConfigured
        .map((l) => l.trim().replace(/^- /, "").split(":")[0])
        .join(", ");
      return {
        name: "gateway",
        status: "warn",
        message: `Gateway up, but channel issue: ${names}`,
      };
    }
    const summary =
      workingChannels.length > 0
        ? `Gateway up, ${workingChannels.length} channel(s) working`
        : "Gateway up, no channels working";
    return {
      name: "gateway",
      status: workingChannels.length > 0 ? "ok" : "warn",
      message: summary,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message.slice(0, 100) : "unknown";
    return {
      name: "gateway",
      status: "error",
      message: `Gateway check failed: ${message}`,
    };
  }
}

function checkStateExists(): CheckResult {
  try {
    const content = readFileSync(STATE_PATH, "utf-8");
    const hasShift = content.includes("## Shift");
    const hasHealth = content.includes("## Health");
    const hasCoord = content.includes("## Last Coordination");
    if (!hasShift || !hasHealth || !hasCoord) {
      return {
        name: "state_structure",
        status: "warn",
        message: "STATE.md missing expected sections",
      };
    }
    return { name: "state_structure", status: "ok", message: "STATE.md structure valid" };
  } catch {
    return { name: "state_structure", status: "error", message: "STATE.md not found" };
  }
}

function runPreflight(): PreflightResult {
  const checks = [
    checkStateExists(),
    checkStateStaleness(),
    checkHeartbeatHealth(),
    checkTulsdayContext(),
    checkSessionHandoff(),
    checkGateway(),
  ];

  const hasError = checks.some((c) => c.status === "error");
  const hasWarn = checks.some((c) => c.status === "warn");

  return {
    timestamp: new Date().toISOString(),
    overall: hasError ? "error" : hasWarn ? "warn" : "ok",
    checks,
  };
}

const result = runPreflight();
const jsonMode = process.argv.includes("--json");

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const icon = { ok: "✅", warn: "⚠️", error: "❌" };
  console.log(`\nPreflight: ${icon[result.overall]} ${result.overall.toUpperCase()}\n`);
  for (const check of result.checks) {
    console.log(`  ${icon[check.status]} ${check.name}: ${check.message}`);
  }
  console.log();
}

process.exit(result.overall === "error" ? 1 : 0);
