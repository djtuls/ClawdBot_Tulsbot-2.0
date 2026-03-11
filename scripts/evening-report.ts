import "dotenv/config";
/**
 * Evening Report — 6 PM BRT (21:00 UTC) daily
 *
 * Summarizes: day's completed work, remaining tasks, inbox activity,
 * sync stats, and recommendations for tomorrow.
 * Delivers to Daily Briefs Telegram topic.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { logEvent } from "./lib/event-logger.js";
import { build30SecondSection } from "./lib/report-quality.js";
import { sendToTopic, truncateForTelegram } from "./lib/telegram-notify.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DATA_DIR = join(WORKSPACE, "data");

function readJsonSafe(path: string): any {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null;
  } catch {
    return null;
  }
}

const TELEGRAM_REPORTS_DISABLED = process.env.DISABLE_TELEGRAM_REPORTS === "1";

async function main() {
  if (TELEGRAM_REPORTS_DISABLED) {
    console.log("[reports] DISABLE_TELEGRAM_REPORTS=1, skipping telegram report send.");
    return;
  }
  console.log("[evening-report] Compiling evening digest...");
  const today = new Date().toISOString().split("T")[0];
  const sections: string[] = [];

  sections.push(`🌙 <b>Evening Report — ${today}</b>`);

  const topTodo = readJsonSafe(join(DATA_DIR, "todoist-summary.json"));
  const remaining = topTodo?.totalActive || 0;

  sections.push(
    ...build30SecondSection({
      whatMatters: [
        remaining > 0 ? `${remaining} tasks remain open tonight.` : "Task board is clear tonight.",
      ],
      whyItMatters: [
        remaining > 0
          ? "Carryover compounds tomorrow's load unless explicitly planned."
          : "A clear board means you can start tomorrow from priorities, not leftovers.",
      ],
      whatToDo: [
        remaining > 0
          ? "Pick the top 1–3 carryover items and explicitly schedule them for tomorrow morning."
          : "Protect tomorrow's first block for strategic work.",
      ],
    }),
  );

  // Event log: today's activity
  const eventLogPath = join(WORKSPACE, "memory/event-log.jsonl");
  let todayOk = 0,
    todayErrors = 0,
    todaySkipped = 0;
  const todaySources = new Set<string>();
  if (existsSync(eventLogPath)) {
    const lines = readFileSync(eventLogPath, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (!e.ts?.startsWith(today)) {
          continue;
        }
        if (e.result === "ok") {
          todayOk++;
        } else if (e.result === "error") {
          todayErrors++;
        } else if (e.result === "skipped") {
          todaySkipped++;
        }
        todaySources.add(e.source);
      } catch {}
    }
  }
  sections.push(`\n📊 <b>Today's Activity</b>`);
  sections.push(`Events: ${todayOk} ok, ${todayErrors} errors, ${todaySkipped} skipped`);
  sections.push(`Active systems: ${[...todaySources].join(", ")}`);

  // Todoist: remaining tasks
  const todoist = readJsonSafe(join(DATA_DIR, "todoist-summary.json"));
  if (todoist) {
    sections.push(`\n📋 <b>Tasks</b>`);
    sections.push(`Remaining active: ${todoist.totalActive || 0}`);
    if (todoist.completedToday?.length) {
      sections.push(`Completed today: ${todoist.completedToday.length}`);
    }
    const overdue = (todoist.allTasks || []).filter(
      (t: any) => t.due && new Date(t.due) < new Date(),
    );
    if (overdue.length > 0) {
      sections.push(`\n⚠️ <b>${overdue.length} overdue tasks</b>`);
      for (const t of overdue.slice(0, 5)) {
        sections.push(`• ${t.content} (due: ${t.due})`);
      }
    }
  }

  // Inbox activity
  const pendingPath = join(WORKSPACE, "memory/inbox/pending.jsonl");
  if (existsSync(pendingPath)) {
    const lines = readFileSync(pendingPath, "utf-8").trim().split("\n").filter(Boolean);
    const pending = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((i) => i && i.status === "pending");
    if (pending.length > 0) {
      sections.push(`\n📬 <b>${pending.length} unrouted inbox items</b>`);
      for (const item of pending.slice(0, 3)) {
        sections.push(`• [${item.source}] ${item.subject || item.commitment || "?"}`);
      }
    } else {
      sections.push("\n✅ Inbox clear — all items routed");
    }
  }

  // Sync freshness
  sections.push("\n⚙️ <b>Sync Health</b>");
  const syncs = [
    { name: "Todoist", file: "todoist-summary.json" },
    { name: "HubSpot", file: "hubspot-summary.json" },
    { name: "Notion", file: "notion-summary.json" },
  ];
  for (const s of syncs) {
    const data = readJsonSafe(join(DATA_DIR, s.file));
    if (data?.lastSync) {
      const hoursAgo = ((Date.now() - new Date(data.lastSync).getTime()) / 3600000).toFixed(1);
      const status = parseFloat(hoursAgo) > 8 ? "⚠️" : "✅";
      sections.push(`${status} ${s.name}: ${hoursAgo}h ago`);
    }
  }

  sections.push("\n💤 <i>Councils will run at 3 AM. See you tomorrow.</i>");

  const digest = sections.join("\n");
  console.log(digest.replace(/<[^>]+>/g, ""));

  sendToTopic("daily_briefs", truncateForTelegram(digest));

  logEvent({
    source: "evening-report",
    action: "digest-sent",
    result: "ok",
    detail: `sections=${sections.length}`,
  });
  console.log("[evening-report] Done.");
}

main().catch((err) => {
  console.error("[evening-report] Fatal:", err);
  logEvent({ source: "evening-report", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
