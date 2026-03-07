import "dotenv/config";
import { execFileSync } from "child_process";
/**
 * INFT-Hub Management Council — Project portfolio health
 *
 * Reads: Notion INFT Project Context, PARA Projects,
 * project dossiers, Todoist tasks linked to projects.
 *
 * Surfaces: project health, team blockers, deadline risks,
 * resource allocation, cross-project dependencies.
 *
 * Cron: nightly 3:30 AM BRT (06:30 UTC)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { sendToTopic, truncateForTelegram } from "../lib/telegram-notify.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const OPENCLAW = process.env.OPENCLAW_BIN || "/opt/homebrew/bin/openclaw";
const DATA_DIR = join(WORKSPACE, "data");
const DOSSIER_DIR = join(WORKSPACE, "context/projects");
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
  console.log("[inft-hub-council] Starting INFT-Hub management review...");
  if (!existsSync(COUNCIL_DIR)) {
    mkdirSync(COUNCIL_DIR, { recursive: true });
  }

  const notion = readJsonSafe(join(DATA_DIR, "notion-summary.json"));
  const todoist = readJsonSafe(join(DATA_DIR, "todoist-summary.json"));

  const context: string[] = [];

  // INFT Project Context from Notion
  if (notion?.inftProjects) {
    context.push("## INFT-Hub Projects (from Notion)");
    for (const p of notion.inftProjects.slice(0, 20)) {
      context.push(
        `- ${p.title}: status=${p.status}, edited=${p.lastEdited?.split("T")[0] || "?"}`,
      );
      if (p.properties) {
        const props = Object.entries(p.properties)
          .filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ");
        if (props) {
          context.push(`  Properties: ${props}`);
        }
      }
    }
  }

  // PARA Projects
  if (notion?.paraProjects) {
    context.push("\n## PARA Projects (01-Projects)");
    for (const p of notion.paraProjects.slice(0, 15)) {
      context.push(`- ${p.title}: ${p.status} (edited: ${p.lastEdited?.split("T")[0] || "?"})`);
    }
  }

  // Project dossiers
  if (existsSync(DOSSIER_DIR)) {
    const dossiers = readdirSync(DOSSIER_DIR).filter((f) => f.endsWith(".md"));
    context.push(`\n## Project Dossiers: ${dossiers.length} files`);

    // Read dossiers that have blockers or overdue items
    for (const file of dossiers.slice(0, 10)) {
      const content = readFileSync(join(DOSSIER_DIR, file), "utf-8");
      if (content.includes("⚠️") || content.includes("Overdue") || content.includes("stale")) {
        const lines = content
          .split("\n")
          .filter((l) => l.includes("⚠️") || l.includes("Overdue") || l.includes("stale"));
        if (lines.length > 0) {
          context.push(`\nFlagged in ${file}:`);
          lines.forEach((l) => context.push(`  ${l.trim()}`));
        }
      }
    }
  }

  // Todoist project tasks
  if (todoist?.highPriority) {
    context.push("\n## High Priority Tasks (Todoist)");
    todoist.highPriority.forEach((t: any) => {
      context.push(`- ${t.content}${t.due ? ` (due: ${t.due})` : ""}`);
    });
  }

  const prompt = `You are the INFT-Hub Management Council for Tulsbot. Analyze the portfolio of INFT projects and produce a management health report.

Focus on:
1. PROJECT HEALTH: Which projects are active, stalled, or at risk?
2. TEAM STATUS: Any team member blockers, missing assignments, capacity issues?
3. DEADLINES: What's coming up in the next 14 days? Any at risk?
4. CROSS-PROJECT: Dependencies between projects, resource conflicts?
5. RECONCILIATIONS: Status of IFT Service Agreements (reconciliation items)
6. RECOMMENDATIONS: What should Tulio focus on? What needs escalation?

Be specific. Name projects, people, dates. No fluff.

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
    report = `INFT-Hub council failed: ${err.message}\n\nRaw data:\n${context.join("\n")}`;
  }

  const today = new Date().toISOString().split("T")[0];
  const reportPath = join(COUNCIL_DIR, `inft-hub-${today}.md`);
  writeFileSync(reportPath, `# INFT-Hub Management Council — ${today}\n\n${report}\n`);

  console.log(`[inft-hub-council] Report saved to ${reportPath}`);
  sendToTopic(
    "inft_hub_management",
    truncateForTelegram(`🏢 <b>INFT-Hub Council — ${today}</b>\n\n${report}`),
  );
  logEvent({
    source: "inft-hub-council",
    action: "review",
    result: "ok",
    detail: `report: councils/inft-hub-${today}.md`,
  });
}

main().catch((err) => {
  console.error("[inft-hub-council] Fatal:", err);
  logEvent({ source: "inft-hub-council", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
