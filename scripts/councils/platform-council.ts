import "dotenv/config";
/**
 * Platform Council — System health monitoring
 *
 * Reads: cron health (event log), system logs, memory state,
 * database sizes, sync status, invariant check results.
 *
 * Cron: 4 AM BRT (07:00 UTC)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { sendToTopic, truncateForTelegram } from "../lib/telegram-notify.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const COUNCIL_DIR = join(WORKSPACE, "memory/councils");
const DATA_DIR = join(WORKSPACE, "data");

function readJsonSafe(path: string): any {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null;
  } catch {
    return null;
  }
}

function fileAge(path: string): number | null {
  try {
    const stat = statSync(path);
    return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60); // hours
  } catch {
    return null;
  }
}

function fileSizeKB(path: string): number | null {
  try {
    return Math.round(statSync(path).size / 1024);
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
  console.log("[platform-council] Starting platform health review...");
  if (!existsSync(COUNCIL_DIR)) {
    mkdirSync(COUNCIL_DIR, { recursive: true });
  }

  const findings: string[] = [];
  let issueCount = 0;

  // Memory freshness
  const today = new Date().toISOString().split("T")[0];
  const dailyPath = join(WORKSPACE, `memory/daily/${today}.md`);
  const handoffPath = join(WORKSPACE, "memory/session-handoff.md");
  const contextPath = join(WORKSPACE, "memory/tulsday-processed-context.json");

  findings.push("## Memory Freshness");
  const dailyAge = fileAge(dailyPath);
  if (dailyAge === null) {
    findings.push("- ❌ Daily memory file MISSING");
    issueCount++;
  } else if (dailyAge > 4) {
    findings.push(`- ⚠️ Daily memory stale (${dailyAge.toFixed(1)}h old)`);
    issueCount++;
  } else {
    findings.push(`- ✅ Daily memory fresh (${dailyAge.toFixed(1)}h old)`);
  }

  const handoffAge = fileAge(handoffPath);
  if (handoffAge === null) {
    findings.push("- ❌ Session handoff MISSING");
    issueCount++;
  } else if (handoffAge > 24) {
    findings.push(`- ⚠️ Session handoff stale (${handoffAge.toFixed(1)}h old)`);
    issueCount++;
  } else {
    findings.push(`- ✅ Session handoff fresh (${handoffAge.toFixed(1)}h old)`);
  }

  const contextAge = fileAge(contextPath);
  if (contextAge === null) {
    findings.push("- ❌ Processed context MISSING");
    issueCount++;
  } else if (contextAge > 2) {
    findings.push(`- ⚠️ Processed context stale (${contextAge.toFixed(1)}h old)`);
    issueCount++;
  } else {
    findings.push(`- ✅ Processed context fresh (${contextAge.toFixed(1)}h old)`);
  }

  // Sync status
  findings.push("\n## Sync Status");
  const syncs = [
    { name: "HubSpot", file: "hubspot-summary.json" },
    { name: "Notion", file: "notion-summary.json" },
    { name: "Todoist", file: "todoist-summary.json" },
  ];
  for (const s of syncs) {
    const data = readJsonSafe(join(DATA_DIR, s.file));
    if (!data) {
      findings.push(`- ❌ ${s.name}: No sync data`);
      issueCount++;
    } else {
      const age = (Date.now() - new Date(data.lastSync).getTime()) / 3600000;
      if (age > 8) {
        findings.push(`- ⚠️ ${s.name}: Last sync ${age.toFixed(1)}h ago`);
        issueCount++;
      } else {
        findings.push(`- ✅ ${s.name}: Synced ${age.toFixed(1)}h ago`);
      }
    }
  }

  // Database sizes
  findings.push("\n## Database Sizes");
  const dbs = [
    { name: "Inbox dedup", file: "data/inbox-seen.db" },
    { name: "Scriber", file: "memory/scriber.db" },
  ];
  for (const db of dbs) {
    const size = fileSizeKB(join(WORKSPACE, db.file));
    if (size !== null) {
      findings.push(`- ${db.name}: ${size} KB`);
    }
  }

  // Event log analysis
  findings.push("\n## Event Log (last 24h)");
  const eventLogPath = join(WORKSPACE, "memory/event-log.jsonl");
  if (existsSync(eventLogPath)) {
    const lines = readFileSync(eventLogPath, "utf-8").trim().split("\n").filter(Boolean);
    const dayAgo = Date.now() - 24 * 3600000;
    let errors = 0,
      oks = 0,
      skipped = 0;
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (new Date(e.ts).getTime() < dayAgo) {
          continue;
        }
        if (e.result === "error") {
          errors++;
        } else if (e.result === "ok") {
          oks++;
        } else if (e.result === "skipped") {
          skipped++;
        }
      } catch {}
    }
    findings.push(`- Events: ${oks} ok, ${errors} errors, ${skipped} skipped`);
    if (errors > 5) {
      findings.push(`- ⚠️ High error count (${errors})`);
      issueCount++;
    }
  }

  // Heartbeat state
  const heartbeat = readJsonSafe(join(WORKSPACE, "memory/heartbeat-hourly-state.json"));
  if (heartbeat) {
    findings.push("\n## Heartbeat");
    const hbAge = fileAge(join(WORKSPACE, "memory/heartbeat-hourly-state.json"));
    if (hbAge !== null && hbAge > 1.5) {
      findings.push(`- ⚠️ Heartbeat stale (${hbAge.toFixed(1)}h since last run)`);
      issueCount++;
    } else {
      findings.push(`- ✅ Heartbeat healthy (${hbAge?.toFixed(1)}h since last run)`);
    }
  }

  // Summary
  findings.push(`\n## Summary\n- Total issues found: ${issueCount}`);
  if (issueCount === 0) {
    findings.push("- 🟢 All systems healthy");
  } else if (issueCount <= 3) {
    findings.push("- 🟡 Minor issues detected");
  } else {
    findings.push("- 🔴 Multiple issues need attention");
  }

  const report = findings.join("\n");
  const reportPath = join(COUNCIL_DIR, `platform-${today}.md`);
  writeFileSync(reportPath, `# Platform Council — ${today}\n\n${report}\n`);

  console.log(`[platform-council] Report saved to ${reportPath}`);
  console.log(report);

  const emoji = issueCount === 0 ? "🟢" : issueCount <= 3 ? "🟡" : "🔴";
  sendToTopic(
    "system_health",
    truncateForTelegram(`${emoji} <b>Platform Council — ${today}</b>\n\n${report}`),
  );

  logEvent({
    source: "platform-council",
    action: "review",
    result: "ok",
    detail: `issues=${issueCount}`,
  });
}

main().catch((err) => {
  console.error("[platform-council] Fatal:", err);
  logEvent({ source: "platform-council", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
