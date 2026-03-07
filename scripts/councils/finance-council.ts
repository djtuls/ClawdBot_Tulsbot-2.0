import "dotenv/config";
import { execFileSync } from "child_process";
/**
 * Finance Council — Weekly financial review
 *
 * Reads: Notion Finance Inbox, HubSpot deal amounts,
 * Google Drive Financial folders (when gog is available).
 *
 * Surfaces: pending invoices, overdue payments, budget variances,
 * upcoming financial commitments.
 *
 * Cron: Weekly (or nightly if volume warrants it)
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
  console.log("[finance-council] Starting finance review...");
  if (!existsSync(COUNCIL_DIR)) {
    mkdirSync(COUNCIL_DIR, { recursive: true });
  }

  const hubspot = readJsonSafe(join(DATA_DIR, "hubspot-summary.json"));
  const notion = readJsonSafe(join(DATA_DIR, "notion-summary.json"));

  const context: string[] = [];

  // HubSpot deal financials
  if (hubspot?.deals) {
    context.push("## Deal Pipeline (HubSpot)");
    let totalPipeline = 0;
    for (const deal of hubspot.deals) {
      const amount = parseFloat(deal.amount || "0");
      totalPipeline += amount;
      if (amount > 0) {
        context.push(
          `- ${deal.name}: $${amount.toLocaleString()} (stage: ${deal.stage}, close: ${deal.closeDate || "no date"})`,
        );
      }
    }
    context.push(`Total pipeline: $${totalPipeline.toLocaleString()}`);
  }

  // Notion Finance Inbox
  if (notion?.financeInbox) {
    context.push("\n## Finance Inbox (Notion)");
    context.push(`${notion.financeInbox.length} items`);
    for (const item of notion.financeInbox.slice(0, 15)) {
      context.push(
        `- ${item.title}: ${item.status} (edited: ${item.lastEdited?.split("T")[0] || "?"})`,
      );
    }
  }

  // IFT Reconciliation items from Notion
  if (notion?.inftProjects) {
    const reconciliations = notion.inftProjects.filter((p: any) =>
      (p.title || "").toLowerCase().includes("reconciliation"),
    );
    if (reconciliations.length > 0) {
      context.push("\n## IFT Service Reconciliations");
      reconciliations.forEach((r: any) => {
        context.push(`- ${r.title}: ${r.status} (edited: ${r.lastEdited?.split("T")[0] || "?"})`);
      });
    }
  }

  const prompt = `You are the Finance Council for Tulsbot. Analyze this financial data and produce a concise financial health report.

Focus on:
1. REVENUE: Pipeline total, deals close to closing, stale deals
2. PAYABLES: Pending invoices, overdue items from Finance Inbox
3. RECEIVABLES: Outstanding payments, reconciliation status
4. RISKS: Budget overruns, cash flow concerns, stale financial items
5. ACTIONS: What financial tasks need attention this week

Be specific with numbers and dates. No fluff.

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
    report = `Finance council failed: ${err.message}\n\nRaw data:\n${context.join("\n")}`;
  }

  const today = new Date().toISOString().split("T")[0];
  const reportPath = join(COUNCIL_DIR, `finance-${today}.md`);
  writeFileSync(reportPath, `# Finance Council — ${today}\n\n${report}\n`);

  console.log(`[finance-council] Report saved to ${reportPath}`);
  sendToTopic("finances", truncateForTelegram(`💰 <b>Finance Council — ${today}</b>\n\n${report}`));
  logEvent({
    source: "finance-council",
    action: "review",
    result: "ok",
    detail: `report: councils/finance-${today}.md`,
  });
}

main().catch((err) => {
  console.error("[finance-council] Fatal:", err);
  logEvent({ source: "finance-council", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
