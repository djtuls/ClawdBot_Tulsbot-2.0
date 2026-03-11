import "dotenv/config";
/**
 * Notion INFT_Hub Sync — Cross-Platform Integration (V1: One-Way Pull)
 *
 * Reads key databases from the Notion workspace:
 * - INFT Project Context
 * - 01-Projects (PARA)
 * - Finance Inbox
 * - CRM Contacts/Companies
 * - Tulsbot Tasks
 *
 * V1: Read-only. No writes back to Notion except to Tulsbot Tasks.
 * Cron: every 4 hours
 */
import { execFileSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const NOTION_TOKEN = process.env.NOTION_API_KEY || process.env.NOTION_KEY || "";
const DATA_DIR = join(WORKSPACE, "data");

const DATABASES = {
  projectGrid: "4bd8a8b2-5637-47c7-8ebd-33b0fb2f80ee",
  inftContext: "af146921-faad-4306-81b3-5a31dcdc202f",
  superInbox: "61efc873-884b-4c11-925b-c096ba38ec55",
  crmContacts: "f3c32b0d-5b7d-4a05-82da-7ac306b64cf8",
  tulsbotTasks: "30051bf9-731e-804c-92b1-c8ae7b76ee0f",
  knowledgeIndex: "9bb61f68-1fad-4f90-afe9-a8c2bf6fcbae",
};

function notionQuery(endpoint: string, body?: any): any {
  if (!NOTION_TOKEN) {
    console.error("[notion-sync] No Notion token");
    return null;
  }
  try {
    const args = [
      "-s",
      "-X",
      body ? "POST" : "GET",
      `https://api.notion.com/v1${endpoint}`,
      "-H",
      `Authorization: Bearer ${NOTION_TOKEN}`,
      "-H",
      "Content-Type: application/json",
      "-H",
      "Notion-Version: 2022-06-28",
    ];
    if (body) {
      args.push("-d", JSON.stringify(body));
    }
    const result = execFileSync("curl", args, { timeout: 30_000, encoding: "utf-8" });
    return JSON.parse(result);
  } catch (err: any) {
    console.error(`[notion-sync] API error for ${endpoint}:`, err.message);
    return null;
  }
}

function queryDatabase(dbId: string, pageSize = 100): any[] {
  const data = notionQuery(`/databases/${dbId}/query`, {
    page_size: pageSize,
    sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
  });
  return data?.results || [];
}

function extractTitle(page: any): string {
  for (const [, v] of Object.entries(page.properties || {})) {
    const prop = v as any;
    if (prop.type === "title" && prop.title?.length > 0) {
      return prop.title.map((t: any) => t.plain_text).join("");
    }
  }
  return "Untitled";
}

function extractStatus(page: any): string {
  // Prefer Notion's native status type over select fields
  for (const [, v] of Object.entries(page.properties || {})) {
    const prop = v as any;
    if (prop.type === "status" && prop.status?.name) {
      return prop.status.name;
    }
  }
  for (const [k, v] of Object.entries(page.properties || {})) {
    const prop = v as any;
    if (k === "Status" && prop.type === "select" && prop.select?.name) {
      return prop.select.name;
    }
  }
  return "Unknown";
}

function extractProperties(page: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, v] of Object.entries(page.properties || {})) {
    const prop = v as any;
    switch (prop.type) {
      case "title":
        result[key] = extractTitle(page);
        break;
      case "rich_text":
        result[key] = prop.rich_text?.map((t: any) => t.plain_text).join("") || "";
        break;
      case "number":
        result[key] = prop.number;
        break;
      case "select":
        result[key] = prop.select?.name || null;
        break;
      case "multi_select":
        result[key] = prop.multi_select?.map((s: any) => s.name) || [];
        break;
      case "status":
        result[key] = prop.status?.name || null;
        break;
      case "date":
        result[key] = prop.date?.start || null;
        break;
      case "people":
        result[key] = prop.people?.map((p: any) => p.name || p.id) || [];
        break;
      case "relation":
        result[key] = prop.relation?.map((r: any) => r.id) || [];
        break;
      case "url":
        result[key] = prop.url || null;
        break;
      case "email":
        result[key] = prop.email || null;
        break;
      case "phone_number":
        result[key] = prop.phone_number || null;
        break;
      default:
        break;
    }
  }
  return result;
}

async function main() {
  console.log("[notion-sync] Starting Notion INFT_Hub sync...");

  if (!NOTION_TOKEN) {
    console.error("[notion-sync] No Notion token set. Skipping.");
    logEvent({ source: "notion-sync", action: "sync", result: "skipped", detail: "No API token" });
    return;
  }

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const summary: Record<string, any> = { lastSync: new Date().toISOString() };

  // 1. INFT Project Context
  const inftPages = queryDatabase(DATABASES.inftContext, 50);
  summary.inftProjects = inftPages.map((p) => ({
    id: p.id,
    title: extractTitle(p),
    status: extractStatus(p),
    lastEdited: p.last_edited_time,
    url: p.url,
    properties: extractProperties(p),
  }));
  console.log(`[notion-sync] INFT Projects: ${inftPages.length}`);

  // 2. Project Grid (master INFT-Hub tracker)
  const gridPages = queryDatabase(DATABASES.projectGrid, 100);
  summary.projectGrid = gridPages.map((p) => ({
    id: p.id,
    title: extractTitle(p),
    status: extractStatus(p),
    lastEdited: p.last_edited_time,
    url: p.url,
    properties: extractProperties(p),
  }));
  console.log(`[notion-sync] Project Grid: ${gridPages.length}`);

  // 3. Super Inbox (capture inbox — tasks, voice memos, emails, commitments)
  const superInboxItems = queryDatabase(DATABASES.superInbox, 100);
  summary.superInbox = superInboxItems.map((p) => ({
    id: p.id,
    title: extractTitle(p),
    status: extractStatus(p),
    lastEdited: p.last_edited_time,
    url: p.url,
    properties: extractProperties(p),
  }));
  console.log(`[notion-sync] Super Inbox: ${superInboxItems.length}`);

  // 4. Tulsbot Tasks
  const tasks = queryDatabase(DATABASES.tulsbotTasks, 50);
  summary.tulsbotTasks = tasks.map((p) => ({
    id: p.id,
    title: extractTitle(p),
    status: extractStatus(p),
    lastEdited: p.last_edited_time,
  }));
  console.log(`[notion-sync] Tulsbot Tasks: ${tasks.length}`);

  // 5. CRM Contacts (top 50)
  const contacts = queryDatabase(DATABASES.crmContacts, 50);
  summary.crmContacts = contacts.map((p) => ({
    id: p.id,
    title: extractTitle(p),
    properties: extractProperties(p),
  }));
  console.log(`[notion-sync] CRM Contacts: ${contacts.length}`);

  // 6. Knowledge Index
  const knowledge = queryDatabase(DATABASES.knowledgeIndex, 30);
  summary.knowledgeIndex = knowledge.map((p) => ({
    id: p.id,
    title: extractTitle(p),
    lastEdited: p.last_edited_time,
    properties: extractProperties(p),
  }));
  console.log(`[notion-sync] Knowledge Index: ${knowledge.length}`);

  // Write full summary
  writeFileSync(join(DATA_DIR, "notion-summary.json"), JSON.stringify(summary, null, 2));

  // Meeting note integration (project/contact/action linkage)
  try {
    execFileSync("npx", ["tsx", "scripts/integrations/notion-meeting-integrator.ts"], {
      cwd: WORKSPACE,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (err: any) {
    logEvent({
      source: "notion-sync",
      action: "meeting-integrator",
      result: "error",
      detail: String(err?.message || err),
    });
  }

  const total =
    inftPages.length +
    gridPages.length +
    superInboxItems.length +
    tasks.length +
    contacts.length +
    knowledge.length;
  console.log(`[notion-sync] Done. Total items synced: ${total}`);

  logEvent({
    source: "notion-sync",
    action: "sync-complete",
    result: "ok",
    detail: `inft=${inftPages.length} grid=${gridPages.length} superInbox=${superInboxItems.length} tasks=${tasks.length} contacts=${contacts.length} knowledge=${knowledge.length}`,
  });
}

main().catch((err) => {
  console.error("[notion-sync] Fatal:", err);
  logEvent({ source: "notion-sync", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
