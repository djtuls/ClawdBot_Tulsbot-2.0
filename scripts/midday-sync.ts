/**
 * Midday Sync — 12 PM BRT daily
 * Memory flush, task board review.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { logCron } from "./event-logger.js";

const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const TASK_BOARD = join(WORKSPACE, "tasks/backlog.json");

function main() {
  let taskSummary = "No task board found";

  if (existsSync(TASK_BOARD)) {
    try {
      const board = JSON.parse(readFileSync(TASK_BOARD, "utf-8"));
      const tasks = board.tasks || [];
      const byStatus: Record<string, number> = {};
      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      }
      taskSummary = Object.entries(byStatus)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
    } catch {}
  }

  console.log(`Midday sync: tasks [${taskSummary}]`);
  logCron("midday-sync", "ok", { taskSummary });
}

main();
