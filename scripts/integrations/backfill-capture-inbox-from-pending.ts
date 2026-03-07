import "dotenv/config";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getSecret } from "../lib/secrets.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");
const REPORT_DIR = join(WORKSPACE, "reports/notion");
const CAPTURE_DB = "30351bf9-731e-81f2-bc24-dca63220f567";

interface PendingItem {
  id?: string;
  threadId?: string;
  source: string;
  category: string;
  subject?: string;
  from?: string;
  snippet?: string;
  account?: string;
  addedAt: string;
  status: string;
  commitment?: string;
  hash: string;
  reviewedAt?: string;
  notionUrl?: string;
}

function notionReq(
  method: "GET" | "POST" | "PATCH",
  endpoint: string,
  token: string,
  body?: any,
): any {
  const args = [
    "-s",
    "-X",
    method,
    `https://api.notion.com/v1${endpoint}`,
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Content-Type: application/json",
    "-H",
    "Notion-Version: 2022-06-28",
  ];
  if (body !== undefined) {
    args.push("-d", JSON.stringify(body));
  }
  const raw = execFileSync("curl", args, { encoding: "utf-8", timeout: 30000 });
  const parsed = JSON.parse(raw);
  if (parsed?.object === "error") {
    throw new Error(`${parsed.code}: ${parsed.message}`);
  }
  return parsed;
}

function sourceLink(item: PendingItem): string | null {
  if (item.source === "email" && (item.threadId || item.id)) {
    const ref = encodeURIComponent(item.threadId || item.id || "");
    if (item.account) {
      return `https://mail.google.com/mail/u/${encodeURIComponent(item.account)}/#inbox/${ref}`;
    }
    return `https://mail.google.com/mail/#inbox/${ref}`;
  }
  return null;
}

function rich(content: string) {
  return { rich_text: [{ text: { content: content.slice(0, 1800) } }] };
}

function createCapturePage(item: PendingItem, token: string): string {
  const title = (item.subject || item.commitment || "Inbox item").slice(0, 200);
  const sourceSelect = (() => {
    if (item.source === "whatsapp") {
      return "WhatsApp";
    }
    if (item.source === "email") {
      return "Email";
    }
    return "Manual";
  })();

  const props: Record<string, any> = {
    Title: { title: [{ text: { content: title } }] },
    Status: { select: { name: "To Review" } },
    "Received At": { date: { start: item.addedAt || new Date().toISOString() } },
    Source: { select: { name: sourceSelect } },
    Sender: rich((item.from || "unknown").slice(0, 300)),
    Summary: rich(item.snippet || "(no summary)"),
    "AI Status": { select: { name: "Pending" } },
    "AI Command": rich(""),
    "Tulio's Notes": rich(""),
    "Tulsbot Notes": rich(""),
    Channel: rich(item.source || "unknown"),
    "Source ID": rich((item.threadId || item.id || item.hash || "").slice(0, 300)),
    Metadata: rich(
      JSON.stringify({ category: item.category, account: item.account || "" }).slice(0, 1500),
    ),
  };
  const link = sourceLink(item);
  if (link) {
    props["Source URL"] = { url: link };
  }

  const page = notionReq("POST", "/pages", token, {
    parent: { database_id: CAPTURE_DB },
    properties: props,
  });
  return page.url as string;
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION token missing");
  }
  if (!existsSync(PENDING_PATH)) {
    throw new Error("pending file missing");
  }

  const lines = readFileSync(PENDING_PATH, "utf-8").split("\n").filter(Boolean);
  const items: PendingItem[] = lines.map((l) => JSON.parse(l));
  const targets = items.filter((i) => i.status === "awaiting-review");

  let created = 0;
  let failed = 0;
  for (const item of targets) {
    try {
      const url = createCapturePage(item, token);
      item.notionUrl = url;
      created++;
    } catch {
      failed++;
    }
  }

  writeFileSync(PENDING_PATH, items.map((i) => JSON.stringify(i)).join("\n") + "\n");

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  const reportPath = join(
    REPORT_DIR,
    `capture-inbox-backfill-${new Date().toISOString().slice(0, 10)}.json`,
  );
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        targets: targets.length,
        created,
        failed,
        reportPath,
      },
      null,
      2,
    ),
  );
  console.log(
    `[backfill] targets=${targets.length} created=${created} failed=${failed} report=${reportPath}`,
  );
}

main().catch((e) => {
  console.error("[backfill] fatal", e);
  process.exit(1);
});
