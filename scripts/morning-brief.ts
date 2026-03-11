import "dotenv/config";
/**
 * Morning Brief — 6 AM BRT (09:00 UTC) daily
 *
 * Compiles: overnight events, today's tasks, calendar, council summaries,
 * pending inbox items, and system health into a single digest.
 * Delivers to Daily Briefs Telegram topic.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { fetchUpcomingEvents } from "./lib/calendar-events.js";
import { logEvent } from "./lib/event-logger.js";
import { loadLifecycleSummary } from "./lib/project-lifecycle.js";
import { build30SecondSection } from "./lib/report-quality.js";
import { sendToTopic, truncateForTelegram } from "./lib/telegram-notify.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DATA_DIR = join(WORKSPACE, "data");
const COUNCIL_DIR = join(WORKSPACE, "memory/councils");

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
  console.log("[morning-brief] Compiling morning digest...");
  const today = new Date().toISOString().split("T")[0];
  const sections: string[] = [];

  sections.push(`☀️ <b>Good morning, Tulio — ${today}</b>`);

  // 30-second test framing (lead with conclusion)
  const topPendingPath = join(WORKSPACE, "memory/inbox/pending.jsonl");
  let pendingCount = 0;
  if (existsSync(topPendingPath)) {
    const lines = readFileSync(topPendingPath, "utf-8").trim().split("\n").filter(Boolean);
    pendingCount = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((i) => i && i.status === "pending").length;
  }
  const topTodo = readJsonSafe(join(DATA_DIR, "todoist-summary.json"));
  const dueToday = topTodo?.dueToday?.length || 0;
  const highPriority = topTodo?.highPriority?.length || 0;

  sections.push(
    ...build30SecondSection({
      whatMatters: [
        dueToday > 0 ? `${dueToday} tasks are due today.` : "No tasks due today.",
        pendingCount > 0
          ? `${pendingCount} inbox items still need routing.`
          : "Inbox routing is currently clear.",
      ],
      whyItMatters: [
        dueToday > 0
          ? "Without early sequencing, today can become reactive."
          : "Use the open window to push strategic work.",
        pendingCount > 0
          ? "Unrouted inbox items can hide urgent commitments."
          : "Low inbox load means less context-switching overhead.",
      ],
      whatToDo: [
        highPriority > 0
          ? `Start with the top ${Math.min(highPriority, 3)} high-priority tasks before meetings.`
          : "Lock one high-impact objective for the morning block.",
        pendingCount > 0
          ? "Run inbox routing pass before midday."
          : "Maintain focus; avoid unnecessary intake churn.",
      ],
    }),
  );

  // Todoist: today's tasks
  const todoist = readJsonSafe(join(DATA_DIR, "todoist-summary.json"));
  if (todoist) {
    sections.push("\n📋 <b>Today's Tasks</b>");
    sections.push(
      `Active: ${todoist.totalActive || 0} | Due today: ${todoist.dueToday?.length || 0} | High priority: ${todoist.highPriority?.length || 0}`,
    );
    if (todoist.dueToday?.length) {
      for (const t of todoist.dueToday.slice(0, 8)) {
        sections.push(`• ${t.content}`);
      }
    }
    if (todoist.highPriority?.length) {
      sections.push("\n🔴 <b>High Priority</b>");
      for (const t of todoist.highPriority.slice(0, 5)) {
        sections.push(`• ${t.content}${t.due ? ` (due: ${t.due})` : ""}`);
      }
    }
  }

  // Pending inbox items
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
      sections.push(`\n📬 <b>Pending Inbox (${pending.length} items)</b>`);
      for (const item of pending.slice(0, 5)) {
        sections.push(`• [${item.source}] ${item.subject || item.commitment || "?"}`);
      }
    }
  }

  // Overnight council summaries (if they ran)
  const councilFiles = [
    { file: `operations-${today}.md`, label: "Operations" },
    { file: `finance-${today}.md`, label: "Finance" },
    { file: `inft-hub-${today}.md`, label: "INFT-Hub" },
    { file: `platform-${today}.md`, label: "Platform" },
  ];
  const councilSummaries: string[] = [];
  for (const c of councilFiles) {
    const path = join(COUNCIL_DIR, c.file);
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      const firstPara = content
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .slice(0, 3)
        .join(" ")
        .slice(0, 150);
      councilSummaries.push(`• <b>${c.label}:</b> ${firstPara}...`);
    }
  }
  if (councilSummaries.length > 0) {
    sections.push("\n🏛️ <b>Overnight Council Reports</b>");
    sections.push(councilSummaries.join("\n"));
    sections.push("(Full reports in their respective topics)");
  }

  // Notion Super Inbox status
  const notion = readJsonSafe(join(DATA_DIR, "notion-summary.json"));
  if (notion?.superInbox?.length) {
    const inboxItems = notion.superInbox;
    const byStatus: Record<string, number> = {};
    for (const item of inboxItems) {
      const s = item.status || "Unknown";
      byStatus[s] = (byStatus[s] || 0) + 1;
    }
    const statusLine = Object.entries(byStatus)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
    sections.push(`\n📥 <b>Super Inbox</b>`);
    sections.push(statusLine);
    const toReview = inboxItems.filter(
      (i: any) => i.status === "Inbox" || i.status === "To Review",
    );
    if (toReview.length > 0) {
      for (const item of toReview.slice(0, 5)) {
        const priority = item.properties?.Priority || "";
        const src = item.properties?.Source || "";
        sections.push(
          `• ${priority ? `[${priority}] ` : ""}${item.title.slice(0, 60)}${src ? ` (${src})` : ""}`,
        );
      }
      if (toReview.length > 5) {
        sections.push(`  ... and ${toReview.length - 5} more`);
      }
    }
  }

  // Calendar snapshot (multi-account)
  const events = fetchUpcomingEvents(2).slice(0, 6);
  sections.push("\n🗓️ <b>Upcoming (next 48h)</b>");
  if (!events.length) {
    sections.push("• No upcoming events found across connected calendars.");
  } else {
    for (const e of events) {
      sections.push(`• ${e.start} — ${e.summary} (${e.account})`);
    }
  }

  // Lifecycle-aware project snapshot
  const lifecycle = loadLifecycleSummary(WORKSPACE, 10);
  if (lifecycle.length) {
    sections.push("\n🧩 <b>Projects by Lifecycle</b>");
    const groups = new Map<string, typeof lifecycle>();
    for (const row of lifecycle) {
      const arr = groups.get(row.lifecycle) || [];
      arr.push(row);
      groups.set(row.lifecycle, arr);
    }
    for (const [stage, items] of groups.entries()) {
      sections.push(`\n<b>${stage.toUpperCase()}</b>`);
      for (const p of items.slice(0, 3)) {
        sections.push(`• ${p.code} (${p.health}): ${p.keySignal.slice(0, 90)}`);
      }
    }
  }

  // System health snapshot
  const hubspot = readJsonSafe(join(DATA_DIR, "hubspot-summary.json"));
  const serviceHealth = readJsonSafe(join(WORKSPACE, "state/service-health.json"));
  sections.push("\n⚙️ <b>System Status</b>");
  const syncs = [];
  if (todoist) {
    syncs.push(`Todoist: ${todoist.totalActive || 0} tasks`);
  }
  if (hubspot) {
    syncs.push(`HubSpot: ${hubspot.totalDeals || 0} deals, ${hubspot.totalContacts || 0} contacts`);
  }
  if (notion) {
    syncs.push(
      `Notion: ${notion.inftProjects?.length || 0} INFT, ${notion.projectGrid?.length || 0} Grid, ${notion.superInbox?.length || 0} Inbox`,
    );
  }
  sections.push(syncs.join(" | "));

  if (serviceHealth) {
    sections.push(
      `Services: ok ${serviceHealth.ok || 0} | warn ${serviceHealth.warn || 0} | error ${serviceHealth.error || 0}`,
    );
  }

  // Event log overnight errors
  const eventLogPath = join(WORKSPACE, "memory/event-log.jsonl");
  if (existsSync(eventLogPath)) {
    const lines = readFileSync(eventLogPath, "utf-8").trim().split("\n").filter(Boolean);
    const eightHoursAgo = Date.now() - 8 * 3600000;
    const overnightErrors = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((e) => e && e.result === "error" && new Date(e.ts).getTime() > eightHoursAgo);
    if (overnightErrors.length > 0) {
      sections.push(`\n⚠️ <b>${overnightErrors.length} overnight errors</b>`);
      for (const e of overnightErrors.slice(0, 3)) {
        sections.push(`• [${e.source}] ${e.detail?.slice(0, 80) || e.action}`);
      }
    }
  }

  const digest = sections.join("\n");
  console.log(digest.replace(/<[^>]+>/g, ""));

  sendToTopic("daily_briefs", truncateForTelegram(digest));

  logEvent({
    source: "morning-brief",
    action: "digest-sent",
    result: "ok",
    detail: `sections=${sections.length}`,
  });
  console.log("[morning-brief] Done.");
}

main().catch((err) => {
  console.error("[morning-brief] Fatal:", err);
  logEvent({ source: "morning-brief", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
