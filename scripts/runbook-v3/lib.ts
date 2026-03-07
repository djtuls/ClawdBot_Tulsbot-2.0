import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createNotionClient } from "../lib/notion-control.js";

export const DEFAULT_STATE_PATH = join(process.cwd(), "state/approved-plans.json");
const DEFAULT_LOCK_PATH = join(process.cwd(), "state/approved-plans.lock");

export type PlanStatus = "approved" | "in_progress" | "done" | "blocked";

export interface HardBlockerRecord {
  blocker: string;
  impact: string;
  decisionNeeded: string;
  fastestUnblock: string;
  blockerType?: string;
  at: string;
}

export interface TransitionRecord {
  planId: string;
  fromStatus: PlanStatus;
  toStatus: PlanStatus;
  fromPhase: string;
  toPhase: string;
  at: string;
  executionId: string;
  reason: string;
}

export interface ApprovedPlanState {
  planId: string;
  status: PlanStatus;
  currentPhase: string;
  lastUpdateAt: string;
  blocked: boolean;
  blockerType: string | null;
  nextAction: string;
  notionPageId?: string;
  executionId: string;
  phases?: string[];
  completedPhases?: string[];
  phaseLocks?: Record<string, string>;
  blockers?: HardBlockerRecord[];
}

export interface ApprovedPlansFile {
  plans: ApprovedPlanState[];
  transitions?: TransitionRecord[];
}

export interface ExecutorResult {
  changed: number;
  skipped: number;
  synced: number;
}

function nowIso() {
  return new Date().toISOString();
}

export function loadApprovedPlans(path = DEFAULT_STATE_PATH): ApprovedPlansFile {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const seed: ApprovedPlansFile = { plans: [] };
    writeFileSync(path, JSON.stringify(seed, null, 2) + "\n", "utf-8");
    return seed;
  }

  const parsed = JSON.parse(readFileSync(path, "utf-8")) as ApprovedPlansFile;
  parsed.plans ??= [];
  parsed.transitions ??= [];
  return parsed;
}

export function saveApprovedPlans(state: ApprovedPlansFile, path = DEFAULT_STATE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function withExecutionLock<T>(fn: () => T, lockPath = DEFAULT_LOCK_PATH): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    throw new Error(`Execution already running (lock file exists: ${lockPath})`);
  }

  writeFileSync(lockPath, `${process.pid}:${nowIso()}\n`, "utf-8");
  try {
    return fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function ensureExecutionId(plan: ApprovedPlanState) {
  if (!plan.executionId) {
    plan.executionId = randomUUID();
  }
}

function canExecute(plan: ApprovedPlanState): boolean {
  return (
    (plan.status === "approved" || plan.status === "in_progress") &&
    plan.status !== "done" &&
    !plan.blocked
  );
}

export function setHardBlocker(
  state: ApprovedPlansFile,
  planId: string,
  payload: Omit<HardBlockerRecord, "at">,
) {
  const plan = state.plans.find((p) => p.planId === planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  plan.blocked = true;
  plan.status = "blocked";
  plan.blockerType = payload.blockerType || "hard";
  plan.lastUpdateAt = nowIso();
  plan.nextAction = payload.fastestUnblock;
  plan.blockers ??= [];
  plan.blockers.push({ ...payload, at: plan.lastUpdateAt });
}

export function appendTransition(
  state: ApprovedPlansFile,
  record: Omit<TransitionRecord, "at">,
): TransitionRecord {
  const transition: TransitionRecord = { ...record, at: nowIso() };
  state.transitions ??= [];
  state.transitions.push(transition);
  return transition;
}

async function appendNotionProgressBlock(
  plan: ApprovedPlanState,
  transition: TransitionRecord,
  logger: (msg: string) => void,
) {
  if (!plan.notionPageId) {
    return false;
  }

  const token =
    process.env.NOTION_TOKEN_OPENCLAW_2 ||
    process.env.NOTION_API_KEY ||
    process.env.NOTION_KEY ||
    "";
  if (!token) {
    logger(`[runbook-v3] notion no-op (missing token), plan=${plan.planId}`);
    return false;
  }

  try {
    const notion = createNotionClient(token);
    notion.request("PATCH", `/blocks/${plan.notionPageId}/children`, {
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `[Runbook v3] ${transition.fromPhase} -> ${transition.toPhase} (${transition.fromStatus} -> ${transition.toStatus}) at ${transition.at}`,
                },
              },
            ],
          },
        },
      ],
    });
    return true;
  } catch (error) {
    logger(
      `[runbook-v3] notion sync failed for plan=${plan.planId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export async function runAutoExecutor(
  statePath = DEFAULT_STATE_PATH,
  logger: (msg: string) => void = console.log,
): Promise<ExecutorResult> {
  return withExecutionLock(async () => {
    const state = loadApprovedPlans(statePath);
    let changed = 0;
    let skipped = 0;
    let synced = 0;

    for (const plan of state.plans) {
      ensureExecutionId(plan);
      plan.completedPhases ??= [];
      plan.phaseLocks ??= {};

      if (!canExecute(plan)) {
        skipped += 1;
        continue;
      }

      const phases = plan.phases && plan.phases.length ? plan.phases : ["phase-1"];
      const currentIndex = Math.max(0, phases.indexOf(plan.currentPhase));
      const currentPhase = phases[currentIndex] || phases[0];

      if (plan.completedPhases.includes(currentPhase)) {
        // Idempotency + dedupe guard: don't re-run phase already completed.
        const next = phases[currentIndex + 1];
        if (!next) {
          if (plan.status !== "done") {
            const tr = appendTransition(state, {
              planId: plan.planId,
              fromStatus: plan.status,
              toStatus: "done",
              fromPhase: currentPhase,
              toPhase: currentPhase,
              executionId: plan.executionId,
              reason: "all phases already completed",
            });
            plan.status = "done";
            plan.nextAction = "none";
            plan.lastUpdateAt = tr.at;
            changed += 1;
            if (await appendNotionProgressBlock(plan, tr, logger)) {
              synced += 1;
            }
          }
          continue;
        }
        plan.currentPhase = next;
      }

      const effectivePhase = plan.currentPhase;
      if (plan.phaseLocks[effectivePhase] === plan.executionId) {
        skipped += 1;
        continue;
      }
      plan.phaseLocks[effectivePhase] = plan.executionId;

      const phaseIndex = Math.max(0, phases.indexOf(effectivePhase));
      const nextPhase = phases[phaseIndex + 1] ?? effectivePhase;
      const toStatus: PlanStatus = phaseIndex + 1 >= phases.length ? "done" : "in_progress";

      if (!plan.completedPhases.includes(effectivePhase)) {
        plan.completedPhases.push(effectivePhase);
      }

      const transition = appendTransition(state, {
        planId: plan.planId,
        fromStatus: plan.status,
        toStatus,
        fromPhase: effectivePhase,
        toPhase: nextPhase,
        executionId: plan.executionId,
        reason: "auto executor phase advance",
      });

      plan.status = toStatus;
      plan.currentPhase = nextPhase;
      plan.lastUpdateAt = transition.at;
      plan.nextAction = toStatus === "done" ? "none" : `execute ${nextPhase}`;
      changed += 1;

      if (await appendNotionProgressBlock(plan, transition, logger)) {
        synced += 1;
      }
    }

    saveApprovedPlans(state, statePath);
    return { changed, skipped, synced };
  });
}
