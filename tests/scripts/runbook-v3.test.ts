import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadApprovedPlans,
  runAutoExecutor,
  saveApprovedPlans,
  setHardBlocker,
  type ApprovedPlansFile,
} from "../../scripts/runbook-v3/lib.js";

function makeTempState(seed: ApprovedPlansFile) {
  const dir = mkdtempSync(join(tmpdir(), "runbook-v3-"));
  const path = join(dir, "approved-plans.json");
  writeFileSync(path, JSON.stringify(seed, null, 2));
  return { dir, path };
}

describe("runbook-v3", () => {
  it("advances exactly one phase and is idempotent on repeated run", async () => {
    const { dir, path } = makeTempState({
      plans: [
        {
          planId: "p1",
          status: "approved",
          currentPhase: "phase-1",
          lastUpdateAt: "2026-03-08T00:00:00.000Z",
          blocked: false,
          blockerType: null,
          nextAction: "start",
          executionId: "exec-1",
          phases: ["phase-1", "phase-2"],
          notionPageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      transitions: [],
    });

    try {
      const logs: string[] = [];
      const first = await runAutoExecutor(path, (m) => logs.push(m));
      expect(first.changed).toBe(1);

      const second = await runAutoExecutor(path, (m) => logs.push(m));
      expect(second.changed).toBe(1);

      const state = loadApprovedPlans(path);
      const plan = state.plans[0];
      expect(plan.status).toBe("done");
      expect(plan.completedPhases).toEqual(["phase-1", "phase-2"]);
      expect((state.transitions || []).length).toBe(2);
      const joinedLogs = logs.join("\n");
      expect(joinedLogs.includes("notion no-op") || joinedLogs.includes("notion sync failed")).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sets hard blocker payload and blocks execution", () => {
    const state: ApprovedPlansFile = {
      plans: [
        {
          planId: "p2",
          status: "approved",
          currentPhase: "phase-1",
          lastUpdateAt: "2026-03-08T00:00:00.000Z",
          blocked: false,
          blockerType: null,
          nextAction: "start",
          executionId: "exec-2",
        },
      ],
      transitions: [],
    };

    setHardBlocker(state, "p2", {
      blocker: "Missing production API key",
      impact: "Cannot run deploy phase",
      decisionNeeded: "Provide key or approve mock mode",
      fastestUnblock: "Add PROD_API_KEY in secrets",
      blockerType: "credential",
    });

    const plan = state.plans[0];
    expect(plan.blocked).toBe(true);
    expect(plan.status).toBe("blocked");
    expect(plan.blockerType).toBe("credential");
    expect(plan.blockers?.[0]?.decisionNeeded).toContain("Provide key");
  });

  it("records transition logs in state file", async () => {
    const { dir, path } = makeTempState({
      plans: [
        {
          planId: "p3",
          status: "approved",
          currentPhase: "phase-1",
          lastUpdateAt: "2026-03-08T00:00:00.000Z",
          blocked: false,
          blockerType: null,
          nextAction: "start",
          executionId: "exec-3",
          phases: ["phase-1"],
        },
      ],
      transitions: [],
    });

    try {
      await runAutoExecutor(path, () => {});
      const disk = JSON.parse(readFileSync(path, "utf-8")) as ApprovedPlansFile;
      expect(disk.transitions?.length).toBe(1);
      expect(disk.transitions?.[0]?.planId).toBe("p3");
      expect(disk.transitions?.[0]?.reason).toContain("auto executor");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
