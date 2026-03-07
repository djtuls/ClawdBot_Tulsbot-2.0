#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Todoist Sync — Cross-Platform Integration
 *
 * Pulls current tasks and priorities from Todoist,
 * logs completed tasks to daily memory and event log.
 *
 * Cron: every hour
 */
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");

interface TodoistTask {
  id: string;
  content: string;
  description: string;
  priority: number;
  due?: { date: string; string: string };
  is_completed: boolean;
  project_id: string;
  section_id: string;
  labels: string[];
  created_at: string;
}

interface SyncState {
  lastSync: string;
  knownTaskIds: string[];
  completedToday: string[];
}

const STATE_PATH = join(WORKSPACE, "data/todoist-state.json");

function readState(): SyncState {
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    } catch {}
  }
  return { lastSync: "", knownTaskIds: [], completedToday: [] };
}

function writeState(state: SyncState): void {
  const dir = join(WORKSPACE, "data");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function fetchTasks(): TodoistTask[] {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    console.error("[todoist-sync] TODOIST_API_TOKEN not set");
    return [];
  }

  try {
    const result = execFileSync(
      "curl",
      ["-s", "https://todoist.com/api/v1/tasks", "-H", `Authorization: Bearer ${token}`],
      { timeout: 15_000, encoding: "utf-8" },
    );

    const data = JSON.parse(result);
    return data?.results || (Array.isArray(data) ? data : []);
  } catch (err: any) {
    console.error("[todoist-sync] Failed to fetch tasks:", err.message);
    return [];
  }
}

function fetchCompletedTasks(): TodoistTask[] {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    return [];
  }

  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const result = execFileSync(
      "curl",
      [
        "-s",
        `https://todoist.com/api/v1/tasks/completed?since=${since.toISOString()}&limit=50`,
        "-H",
        `Authorization: Bearer ${token}`,
      ],
      { timeout: 15_000, encoding: "utf-8" },
    );

    const data = JSON.parse(result);
    return data?.results || data?.items || [];
  } catch {
    return [];
  }
}

async function main() {
  console.log("[todoist-sync] Starting Todoist sync...");

  const state = readState();
  const tasks = fetchTasks();

  if (tasks.length === 0) {
    console.log("[todoist-sync] No tasks returned (or API error)");
    return;
  }

  // Detect newly completed tasks
  const currentIds = new Set(tasks.map((t) => t.id));
  const previousIds = new Set(state.knownTaskIds);
  const disappeared = state.knownTaskIds.filter((id) => !currentIds.has(id));

  // Check for completed tasks today
  const completed = fetchCompletedTasks();
  const newlyCompleted = completed.filter(
    (t: any) => !state.completedToday.includes(t.task_id || t.id),
  );

  if (newlyCompleted.length > 0) {
    const today = new Date().toISOString().split("T")[0];
    const dailyPath = join(WORKSPACE, `memory/daily/${today}.md`);

    const completedLines = newlyCompleted
      .map((t: any) => `- [x] ${t.content || t.task_id}`)
      .join("\n");

    const appendText = `\n\n### Todoist Completed (${new Date().toLocaleTimeString("en-US", { timeZone: "America/Sao_Paulo" })})\n${completedLines}\n`;

    if (existsSync(dailyPath)) {
      appendFileSync(dailyPath, appendText);
    }

    for (const t of newlyCompleted) {
      logEvent({
        source: "todoist-sync",
        action: "task-completed",
        target: (t as any).content || (t as any).task_id,
        result: "ok",
      });
    }
  }

  // Update priorities summary
  const priorities = tasks
    .filter((t) => t.priority >= 3)
    .toSorted((a, b) => b.priority - a.priority)
    .slice(0, 10);

  const dueToday = tasks.filter((t) => {
    if (!t.due?.date) {
      return false;
    }
    const today = new Date().toISOString().split("T")[0];
    return t.due.date === today;
  });

  // Write summary to context
  const summary = {
    lastSync: new Date().toISOString(),
    totalActive: tasks.length,
    highPriority: priorities.map((t) => ({
      content: t.content,
      priority: t.priority,
      due: t.due?.string || null,
    })),
    dueToday: dueToday.map((t) => ({
      content: t.content,
      due: t.due?.string || null,
    })),
    completedToday: [...state.completedToday, ...newlyCompleted.map((t: any) => t.task_id || t.id)],
  };

  writeFileSync(join(WORKSPACE, "data/todoist-summary.json"), JSON.stringify(summary, null, 2));

  // Update state
  writeState({
    lastSync: new Date().toISOString(),
    knownTaskIds: tasks.map((t) => t.id),
    completedToday: summary.completedToday,
  });

  console.log(
    `[todoist-sync] Done. Active: ${tasks.length}, High-pri: ${priorities.length}, Due today: ${dueToday.length}, Completed today: ${newlyCompleted.length} new`,
  );

  logEvent({
    source: "todoist-sync",
    action: "sync-complete",
    result: "ok",
    detail: `active=${tasks.length} high=${priorities.length} due=${dueToday.length} completed=${newlyCompleted.length}`,
  });
}

main().catch((err) => {
  console.error("[todoist-sync] Fatal:", err);
  logEvent({ source: "todoist-sync", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
