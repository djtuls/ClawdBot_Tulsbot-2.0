#!/usr/bin/env node
import {
  loadApprovedPlans,
  runAutoExecutor,
  saveApprovedPlans,
  setHardBlocker,
} from "./runbook-v3/lib.js";

function arg(name: string): string | undefined {
  return process.argv
    .find((a) => a.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

async function main() {
  const cmd = process.argv[2] || "run";
  const statePath = arg("--state") || "state/approved-plans.json";

  if (cmd === "run") {
    const result = await runAutoExecutor(statePath);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (cmd === "block") {
    const planId = arg("--plan");
    if (!planId) {
      throw new Error("Missing --plan=<planId>");
    }

    const blocker = arg("--blocker") || "unspecified blocker";
    const impact = arg("--impact") || "execution stopped";
    const decisionNeeded = arg("--decision") || "decision required";
    const fastestUnblock = arg("--unblock") || "provide approval or credential";
    const blockerType = arg("--type") || "hard";

    const state = loadApprovedPlans(statePath);
    setHardBlocker(state, planId, {
      blocker,
      impact,
      decisionNeeded,
      fastestUnblock,
      blockerType,
    });
    saveApprovedPlans(state, statePath);
    console.log(JSON.stringify({ ok: true, planId, blocked: true }, null, 2));
    return;
  }

  if (cmd === "init") {
    const state = loadApprovedPlans(statePath);
    saveApprovedPlans(state, statePath);
    console.log(JSON.stringify({ ok: true, statePath, plans: state.plans.length }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((error) => {
  console.error(`[runbook-v3] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
