#!/usr/bin/env bun
/**
 * System Monitor Audit
 * Permanent backend agent - runs every heartbeat
 *
 * Responsibilities:
 * - Audit daily notes
 * - Audit chat logs
 * - Confirm actions taken
 * - Check heartbeat loose ends
 * - Classify items according to PARA
 *
 * Usage: pnpm tsx scripts/system-monitor-audit.ts
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const WORKSPACE = join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
loadEnv({ path: join(WORKSPACE, ".env") });
const MEMORY_DIR = join(WORKSPACE, "memory");
const PARAS_DIRS = ["Projects", "Areas", "Resources", "Archives"];

interface AuditReport {
  timestamp: string;
  tokenUsage: number;
  dailyNoteStatus: "OK" | "MISSING" | "INCOMPLETE";
  paraClassification: { classified: number; unclassified: number };
  looseEnds: string[];
  actionsPending: number;
  actionsCompleted: number;
}

// Discord webhook for #system-status
const DISCORD_CHANNEL = "1469735004459368562";
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN || "";

async function sendToDiscord(message: string): Promise<void> {
  const { execSync } = await import("child_process");
  try {
    execSync(
      `curl -s -X POST -H "Authorization: Bot ${DISCORD_TOKEN}" -H "Content-Type: application/json" -d '{"content": "${message.replace(/"/g, '\\"')}"}' "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages"`,
      { stdio: "pipe" },
    );
  } catch (e) {
    console.log("Discord send failed:", e);
  }
}

// Check token usage
function checkTokenUsage(): number {
  const contextPath = join(WORKSPACE, "reports/context-window.json");
  try {
    const data = JSON.parse(readFileSync(contextPath, "utf-8"));
    const messages = data.messages || [];
    let totalChars = 2000; // system prompt
    for (const msg of messages) {
      totalChars += (msg.content || "").length + (msg.role || "").length;
    }
    return Math.floor((totalChars / 4 / 128000) * 100);
  } catch {
    return 0;
  }
}

// Check daily note
function checkDailyNote(): "OK" | "MISSING" | "INCOMPLETE" {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const notePath = join(MEMORY_DIR, `${today}.md`);

  if (!existsSync(notePath)) {
    return "MISSING";
  }

  const content = readFileSync(notePath, "utf-8");
  // Check for required sections
  const hasSections = content.includes("##") && content.length > 200;
  return hasSections ? "OK" : "INCOMPLETE";
}

// Check PARA classification
function checkPARAClassification(): { classified: number; unclassified: number } {
  const paraPath = join(WORKSPACE, "PARA");
  let classified = 0;
  let unclassified = 0;

  if (!existsSync(paraPath)) {
    return { classified: 0, unclassified: 0 };
  }

  for (const dir of PARAS_DIRS) {
    const dirPath = join(paraPath, dir);
    if (existsSync(dirPath)) {
      const files = readdirSync(dirPath);
      classified += files.filter((f) => !f.startsWith(".")).length;
    }
  }

  // Check memory dir for unclassified items
  const memoryFiles = readdirSync(MEMORY_DIR).filter((f) => f.endsWith(".md"));
  unclassified = memoryFiles.length;

  return { classified, unclassified };
}

// Check for loose ends in state
function checkLooseEnds(): string[] {
  const looseEnds: string[] = [];
  const statePath = join(WORKSPACE, "STATE.md");

  if (existsSync(statePath)) {
    const content = readFileSync(statePath, "utf-8");
    // Find pending items
    if (content.includes("🔴")) {
      looseEnds.push("Pending items in STATE.md");
    }
    if (content.includes("🟡")) {
      looseEnds.push("In-progress items need attention");
    }
  }

  // Check heartbeat state
  const hbPath = join(MEMORY_DIR, "heartbeat-state.json");
  if (existsSync(hbPath)) {
    try {
      const hb = JSON.parse(readFileSync(hbPath, "utf-8"));
      for (const [task, result] of Object.entries(hb.tasks || {})) {
        if (result.status === "FAILED") {
          looseEnds.push(`Heartbeat task failed: ${task}`);
        }
      }
    } catch {}
  }

  return looseEnds;
}

// Main audit
async function runAudit(): Promise<AuditReport> {
  console.log("🔍 Running System Monitor Audit...\n");

  const report: AuditReport = {
    timestamp: new Date().toISOString(),
    tokenUsage: checkTokenUsage(),
    dailyNoteStatus: checkDailyNote(),
    paraClassification: checkPARAClassification(),
    looseEnds: checkLooseEnds(),
    actionsPending: 0,
    actionsCompleted: 0,
  };

  // Build Discord message
  let statusEmoji = "🟢";
  if (report.tokenUsage > 70) {
    statusEmoji = "🟡";
  }
  if (report.tokenUsage > 85) {
    statusEmoji = "🔴";
  }
  if (report.dailyNoteStatus !== "OK" || report.looseEnds.length > 0) {
    statusEmoji = "🔴";
  }

  const message = `**🤖 System Monitor Audit**
─────────────────────
${statusEmoji} **Token Usage:** ${report.tokenUsage}%
📝 **Daily Note:** ${report.dailyNoteStatus}
📁 **PARA:** ${report.paraClassification.classified} classified, ${report.paraClassification.unclassified} unclassified
🔗 **Loose Ends:** ${report.looseEnds.length > 0 ? report.looseEnds.join(", ") : "None"}
─────────────────────
${new Date().toLocaleString()}`;

  console.log(message);
  await sendToDiscord(message);

  // Save report
  const reportPath = join(MEMORY_DIR, "system-monitor-latest.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return report;
}

runAudit()
  .then(() => {
    console.log("\n✅ Audit complete");
    process.exit(0);
  })
  .catch((e) => {
    console.error("Audit failed:", e);
    process.exit(1);
  });
