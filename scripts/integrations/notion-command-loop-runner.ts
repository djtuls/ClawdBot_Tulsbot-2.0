import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { createNotionClient, extractPlainText, richText } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

interface ControlPlaneConfig {
  notion: {
    captureInboxDatabaseId: string;
    superInboxDatabaseId: string;
    crmContactsDatabaseId: string;
  };
  policy: {
    enableCommandLoop: boolean;
    allowDirectSuperInboxWrites: boolean;
    requirePreScreenBeforeSuperInbox: boolean;
  };
}

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const CONFIG_PATH = join(WORKSPACE, "config/notion-control-plane.json");
const REPORT_DIR = join(WORKSPACE, "reports/notion");
const COMMAND_SENTINEL = "Tulsbot Action Requested";

function loadConfig(): ControlPlaneConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as ControlPlaneConfig;
}

function parseAction(notes: string): { action: string; payload: string } {
  const line =
    notes
      .split("\n")
      .map((x) => x.trim())
      .find(Boolean) || "";
  const [action, ...rest] = line.split(":");
  return { action: (action || "").trim().toLowerCase(), payload: rest.join(":").trim() };
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION token missing");
  }

  const cfg = loadConfig();
  if (!cfg.policy.enableCommandLoop) {
    console.log("[notion-command-loop] disabled by config");
    return;
  }

  const notion = createNotionClient(token);

  const query = notion.request("POST", `/databases/${cfg.notion.captureInboxDatabaseId}/query`, {
    page_size: 25,
    filter: {
      and: [
        { property: "AI Command", rich_text: { equals: COMMAND_SENTINEL } },
        {
          or: [
            { property: "AI Status", select: { equals: "Pending" } },
            { property: "AI Status", select: { equals: "In Progress" } },
          ],
        },
      ],
    },
  });

  const pages = query?.results || [];
  const evidence: string[] = [];

  for (const page of pages) {
    const pageId = page.id;
    const props = page.properties || {};
    const tulioNotes = extractPlainText(props["Tulio's Notes"]);
    const { action, payload } = parseAction(tulioNotes);

    let status = "Completed";
    let note = "";

    try {
      if (action === "archive") {
        note = "Item archived per Tulio instruction.";
        notion.request("PATCH", `/pages/${pageId}`, {
          properties: { Status: { status: { name: "Archived" } } },
        });
      } else if (action === "to_super_inbox") {
        if (!cfg.policy.allowDirectSuperInboxWrites) {
          throw new Error("Direct Super Inbox writes are disabled by policy");
        }
        const title = extractPlainText(Object.values(props).find((p: any) => p?.type === "title"));
        const created = notion.request("POST", "/pages", {
          parent: { database_id: cfg.notion.superInboxDatabaseId },
          properties: {
            Name: { title: [{ text: { content: title || "Command-loop item" } }] },
            "Tulio's Notes": richText(tulioNotes),
          },
        });
        note = `Moved to Super Inbox. New page: ${created?.url || "n/a"}`;
      } else if (action === "contact_summary") {
        const [contactPageId, ...parts] = payload.split("|");
        const summary = parts.join("|").trim();
        if (!contactPageId || !summary) {
          throw new Error("contact_summary requires 'contactPageId|summary text'");
        }

        notion.request("PATCH", `/blocks/${contactPageId}/children`, {
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: {
                      content: `[${nowIso()}] Interaction Summary: ${summary}`.slice(0, 1900),
                    },
                  },
                ],
              },
            },
          ],
        });
        note = `Interaction summary appended to contact page ${contactPageId}.`;
      } else {
        status = "Needs Human Review";
        note = `Unsupported action '${action || "(empty)"}'. No external action executed.`;
      }
    } catch (err) {
      status = "Blocked";
      note = `Execution failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const runAt = nowIso();
    const evidenceLink = page.url || "";
    evidence.push(evidenceLink);

    notion.request("PATCH", `/pages/${pageId}`, {
      properties: {
        "AI Status": { select: { name: status } },
        "AI Command": richText(status === "Completed" ? "Completed" : COMMAND_SENTINEL),
        "Tulsbot Notes": richText(note),
        "Last AI Run At": { date: { start: runAt } },
        "AI Evidence Links": richText(evidenceLink),
      },
    });
  }

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  const reportPath = join(REPORT_DIR, `command-loop-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: nowIso(), scanned: pages.length, evidence }, null, 2),
  );

  console.log(`[notion-command-loop] scanned=${pages.length} report=${reportPath}`);
  logEvent({
    source: "notion-command-loop",
    action: "run",
    result: "ok",
    detail: `scanned=${pages.length} report=${reportPath}`,
  });
}

main().catch((error) => {
  console.error("[notion-command-loop] fatal", error);
  logEvent({
    source: "notion-command-loop",
    action: "fatal",
    result: "error",
    detail: String(error),
  });
  process.exit(1);
});
