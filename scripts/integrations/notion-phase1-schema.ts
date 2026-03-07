import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

interface ControlPlaneConfig {
  notion: Record<string, string>;
  policy: {
    projectGridReadOnly: boolean;
    meetingsReadOnly: boolean;
  };
}

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const CONFIG_PATH = join(WORKSPACE, "config/notion-control-plane.json");
const REPORT_DIR = join(WORKSPACE, "reports/notion");

function loadConfig(): ControlPlaneConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as ControlPlaneConfig;
}

function buildPhase1Properties() {
  return {
    "AI Command": { rich_text: {} },
    "AI Status": {
      select: {
        options: [
          { name: "Pending" },
          { name: "In Progress" },
          { name: "Completed" },
          { name: "Needs Human Review" },
          { name: "Blocked" },
        ],
      },
    },
    "Tulio's Notes": { rich_text: {} },
    "Tulsbot Notes": { rich_text: {} },
    "Last AI Run At": { date: {} },
    "AI Evidence Links": { rich_text: {} },
  };
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION_API_KEY/NOTION_KEY missing");
  }

  const cfg = loadConfig();
  const notion = createNotionClient(token);

  const targets = [
    { key: "captureInboxDatabaseId", mode: "write" as const },
    { key: "crmContactsDatabaseId", mode: "write" as const },
    {
      key: "projectGridDatabaseId",
      mode: cfg.policy.projectGridReadOnly ? ("read-only" as const) : ("write" as const),
    },
    {
      key: "meetingsDatabaseId",
      mode: cfg.policy.meetingsReadOnly ? ("read-only" as const) : ("write" as const),
    },
  ];

  const report: Array<{
    target: string;
    databaseId: string;
    mode: string;
    result: string;
    detail: string;
  }> = [];

  for (const target of targets) {
    const databaseId = (cfg.notion[target.key] || "").trim();
    if (!databaseId) {
      report.push({
        target: target.key,
        databaseId: "",
        mode: target.mode,
        result: "skipped",
        detail: "No database id configured",
      });
      continue;
    }

    try {
      if (target.mode === "read-only") {
        notion.request("GET", `/databases/${databaseId}`);
        report.push({
          target: target.key,
          databaseId,
          mode: target.mode,
          result: "ok",
          detail: "Verified readable; mutation skipped by policy",
        });
        continue;
      }

      notion.request("PATCH", `/databases/${databaseId}`, { properties: buildPhase1Properties() });
      report.push({
        target: target.key,
        databaseId,
        mode: target.mode,
        result: "ok",
        detail: "Phase 1 AI fields ensured",
      });
    } catch (error) {
      report.push({
        target: target.key,
        databaseId,
        mode: target.mode,
        result: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  const reportPath = join(
    REPORT_DIR,
    `phase1-schema-${new Date().toISOString().slice(0, 10)}.json`,
  );
  writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2),
  );

  const okCount = report.filter((r) => r.result === "ok").length;
  const errorCount = report.filter((r) => r.result === "error").length;
  console.log(
    `[notion-phase1-schema] done ok=${okCount} errors=${errorCount} report=${reportPath}`,
  );

  logEvent({
    source: "notion-phase1-schema",
    action: "apply",
    result: errorCount > 0 ? "error" : "ok",
    detail: `ok=${okCount} error=${errorCount} report=${reportPath}`,
  });

  if (errorCount > 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("[notion-phase1-schema] fatal", error);
  logEvent({
    source: "notion-phase1-schema",
    action: "fatal",
    result: "error",
    detail: String(error),
  });
  process.exit(1);
});
