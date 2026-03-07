import "dotenv/config";
import { execFileSync } from "child_process";
/**
 * Operations Council — Nightly analysis of operational state
 *
 * Reads: HubSpot pipeline, Notion projects, email activity,
 * WhatsApp captures, Todoist, project dossiers, calendar.
 *
 * Surfaces: stale deals, missed follow-ups, upcoming deadlines,
 * team blockers, unfulfilled promises.
 *
 * Cron: 3 AM BRT (06:00 UTC)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { sendToTopic, truncateForTelegram } from "../lib/telegram-notify.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const OPENCLAW = process.env.OPENCLAW_BIN || "/opt/homebrew/bin/openclaw";
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
  if (TELEGRAM_REPORTS_DISABLED) {
    console.log("[reports] DISABLE_TELEGRAM_REPORTS=1, skipping telegram report send.");
    return;
  }
  console.log("[operations-council] Starting nightly operations review...");
  if (!existsSync(COUNCIL_DIR)) {
    mkdirSync(COUNCIL_DIR, { recursive: true });
  }

  const hubspot = readJsonSafe(join(DATA_DIR, "hubspot-summary.json"));
  const notion = readJsonSafe(join(DATA_DIR, "notion-summary.json"));
  const todoist = readJsonSafe(join(DATA_DIR, "todoist-summary.json"));

  const context: string[] = [];

  // HubSpot analysis
  if (hubspot) {
    context.push(`## HubSpot CRM (last sync: ${hubspot.lastSync})`);
    context.push(`Deals: ${hubspot.totalDeals}, Contacts: ${hubspot.totalContacts}`);
    if (hubspot.changes?.length) {
      context.push("Changes since last sync:");
      hubspot.changes.forEach((c: string) => context.push(`- ${c}`));
    }
    (hubspot.deals || []).forEach((d: any) => {
      if (d.lastModified) {
        const days = (Date.now() - new Date(d.lastModified).getTime()) / 86400000;
        if (days > 14) {
          context.push(`- STALE DEAL: ${d.name} (${Math.floor(days)} days inactive)`);
        }
      }
    });
  }

  // Notion INFT analysis
  if (notion) {
    context.push(`\n## Notion INFT Projects (last sync: ${notion.lastSync})`);
    context.push(
      `INFT Projects: ${notion.inftProjects?.length || 0}, Finance Inbox: ${notion.financeInbox?.length || 0}`,
    );
    (notion.inftProjects || []).slice(0, 10).forEach((p: any) => {
      context.push(`- ${p.title}: ${p.status} (edited: ${p.lastEdited?.split("T")[0]})`);
    });
  }

  // Todoist analysis
  if (todoist) {
    context.push(`\n## Todoist (last sync: ${todoist.lastSync})`);
    context.push(
      `Active tasks: ${todoist.totalActive}, Due today: ${todoist.dueToday?.length || 0}`,
    );
    if (todoist.highPriority?.length) {
      context.push("High priority:");
      todoist.highPriority.forEach((t: any) =>
        context.push(`- ${t.content}${t.due ? ` (due: ${t.due})` : ""}`),
      );
    }
  }

  // Ask agent for analysis
  const prompt = `You are the Operations Council for Tulsbot. Analyze this operational data and produce a concise, actionable nightly report.

Focus on:
1. STALE items (deals inactive >14 days, tasks overdue, follow-ups missed)
2. UPCOMING items (deadlines in next 7 days, meetings, deliverables)
3. ATTENTION items (anything that needs Tulio's decision)
4. RECOMMENDATIONS (what to prioritize tomorrow)

Be specific. Name names, dates, amounts. No fluff.

Data:
${context.join("\n")}

Report:`;

  let report = "";
  try {
    const result = execFileSync(
      OPENCLAW,
      ["agent", "--agent", "main", "--json", "--message", prompt],
      {
        timeout: 60_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      report =
        data?.payloads?.[0]?.text || data?.result?.payloads?.[0]?.text || "No analysis generated";
    }
  } catch (err: any) {
    report = `Council analysis failed: ${err.message}\n\nRaw data:\n${context.join("\n")}`;
  }

  // Save report
  const today = new Date().toISOString().split("T")[0];
  const reportPath = join(COUNCIL_DIR, `operations-${today}.md`);
  writeFileSync(reportPath, `# Operations Council — ${today}\n\n${report}\n`);

  console.log(`[operations-council] Report saved to ${reportPath}`);
  console.log(report.slice(0, 500));

  sendToTopic(
    "daily_briefs",
    truncateForTelegram(`📊 <b>Operations Council — ${today}</b>\n\n${report}`),
  );

  logEvent({
    source: "operations-council",
    action: "nightly-review",
    result: "ok",
    detail: `report saved to councils/operations-${today}.md`,
  });
}

main().catch((err) => {
  console.error("[operations-council] Fatal:", err);
  logEvent({ source: "operations-council", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
