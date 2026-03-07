import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { decideRouting } from "../../src/integrations/crm-control-plane.js";
import { logEvent } from "../lib/event-logger.js";
import { createNotionClient, extractPlainText } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const CONFIG_PATH = join(WORKSPACE, "config/notion-control-plane.json");
const REPORT_DIR = join(WORKSPACE, "reports/notion");

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function titleFromProperties(properties: Record<string, any>): string {
  for (const value of Object.values(properties || {})) {
    if (value?.type === "title") {
      return extractPlainText(value);
    }
  }
  return "Untitled";
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION token missing");
  }

  const cfg = loadConfig();
  const dbId = cfg?.notion?.crmContactsDatabaseId;
  if (!dbId) {
    throw new Error("crmContactsDatabaseId missing in config/notion-control-plane.json");
  }

  const notion = createNotionClient(token);

  const rows =
    notion.request("POST", `/databases/${dbId}/query`, {
      page_size: 100,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    })?.results || [];

  const updated: Array<{ pageId: string; title: string; category: string; route: string }> = [];

  for (const row of rows) {
    const props = row.properties || {};
    const title = titleFromProperties(props);
    const email = extractPlainText(props.Email) || extractPlainText(props.email);
    const company = extractPlainText(props.Company) || extractPlainText(props.company);
    const tagsRaw = props.Tags?.multi_select || props.Category?.multi_select || [];
    const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t: any) => t.name).filter(Boolean) : [];

    const decision = decideRouting({ email, company, tags, note: title });

    notion.request("PATCH", `/pages/${row.id}`, {
      properties: {
        "Relationship Type": { select: { name: decision.category } },
        Domain: { select: { name: decision.route } },
        Priority: { select: { name: decision.priority } },
        "Tulsbot Notes": {
          rich_text: [
            {
              text: {
                content: `Routing mapped: ${decision.category} -> ${decision.route} (${decision.priority})`,
              },
            },
          ],
        },
      },
    });

    updated.push({ pageId: row.id, title, category: decision.category, route: decision.route });
  }

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  const reportPath = join(
    REPORT_DIR,
    `crm-routing-sync-${new Date().toISOString().slice(0, 10)}.json`,
  );
  writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, updated }, null, 2),
  );

  console.log(
    `[crm-routing-sync] total=${rows.length} updated=${updated.length} report=${reportPath}`,
  );
  logEvent({
    source: "crm-routing-sync",
    action: "classify",
    result: "ok",
    detail: `updated=${updated.length} report=${reportPath}`,
  });
}

main().catch((error) => {
  console.error("[crm-routing-sync] fatal", error);
  logEvent({ source: "crm-routing-sync", action: "fatal", result: "error", detail: String(error) });
  process.exit(1);
});
