#!/usr/bin/env tsx
/**
 * seed-notion.ts — Tulsbot Notion Workspace Seeder
 *
 * Creates 4 PARA-ordered root pages at the Tulsbot workspace root:
 *   1. Dashboard  — active workspaces, HITL, health, handshakes (linked view stubs)
 *   2. Operations — SOPs, rules wiki, agent registry
 *   3. Databases  — all 5 DB objects (source container)
 *   4. Archive    — inactive workspaces, backlog, heartbeat history
 *
 * Idempotent — checks for existing pages/DBs before creating.
 * Writes all new IDs to .env at the end.
 * Token: NOTION_TOKEN_OPENCLAW_2 (OpenClaw 2.0)
 *
 * Usage:
 *   npx tsx scripts/seed-notion.ts
 */

import { config as loadEnv } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
loadEnv({ path: path.join(PROJECT_ROOT, ".env"), override: true });

const TOKEN = process.env.NOTION_TOKEN_OPENCLAW_2 || process.env.NOTION_API_KEY || "";

// The page the integration has access to — all 4 PARA pages are children of this
const notionWorkspaceEnv = (process.env.NOTION_WORKSPACE || "").trim();
const WORKSPACE_PARENT_ID =
  !notionWorkspaceEnv || notionWorkspaceEnv === "your_notion_workspace_id"
    ? "30251bf9-731e-819e-86fc-ca0682c85f7b"
    : notionWorkspaceEnv;

// Existing database IDs (hardcoded in codebase — never recreated).
// Inbox (Capture) is the CANONICAL task queue. shift-manager.ts writes to it.
// DB1 (4c04a5ac) was a stale Feb-21 duplicate and has been archived.
const WORKSPACES_DB = process.env.NOTION_WORKSPACES_DB || "a9acab15-5173-46c6-8a20-792c93320b99";
const INBOX_DB = process.env.NOTION_INBOX_DB || "ea9460ca-200d-494d-b3da-ba51f07a67d3";

if (!TOKEN) {
  console.error("❌ NOTION_TOKEN_OPENCLAW_2 or NOTION_API_KEY not set in .env");
  process.exit(1);
}

// ─── Notion API helpers ──────────────────────────────────────────────────────

async function notionRequest(
  method: "GET" | "POST" | "PATCH",
  endpoint: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion ${method} ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function appendBlocks(pageId: string, blocks: unknown[]): Promise<void> {
  // Notion API limit: 100 blocks per request
  for (let i = 0; i < blocks.length; i += 100) {
    await notionRequest("PATCH", `/blocks/${pageId}/children`, {
      children: blocks.slice(i, i + 100),
    });
  }
}

// ─── Idempotency helpers ─────────────────────────────────────────────────────

async function findPageByTitle(title: string, parentId: string): Promise<string | null> {
  try {
    const result = (await notionRequest("POST", "/search", {
      query: title,
      filter: { value: "page", property: "object" },
      page_size: 20,
    })) as {
      results: Array<{
        id: string;
        parent: { type: string; page_id?: string; workspace?: boolean };
        properties?: { title?: { title: Array<{ plain_text: string }> } };
      }>;
    };
    for (const page of result.results) {
      const titleText = page.properties?.title?.title?.[0]?.plain_text ?? "";
      const isRoot = parentId === "workspace" && page.parent.type === "workspace";
      const isChild =
        page.parent.type === "page_id" &&
        (page.parent.page_id === parentId || page.parent.page_id === parentId.replace(/-/g, ""));
      if (titleText === title && (isRoot || isChild)) {
        return page.id;
      }
    }
  } catch {
    // Ignore search errors — will recreate
  }
  return null;
}

async function findDatabaseByTitle(title: string, parentId: string): Promise<string | null> {
  try {
    const result = (await notionRequest("POST", "/search", {
      query: title,
      filter: { value: "database", property: "object" },
      page_size: 20,
    })) as {
      results: Array<{
        id: string;
        parent: { type: string; page_id?: string };
        title: Array<{ plain_text: string }>;
      }>;
    };
    for (const db of result.results) {
      const titleText = db.title?.[0]?.plain_text ?? "";
      const isChild =
        db.parent.type === "page_id" &&
        (db.parent.page_id === parentId || db.parent.page_id === parentId.replace(/-/g, ""));
      if (titleText === title && isChild) {
        return db.id;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

// ─── Page / DB creators ──────────────────────────────────────────────────────

async function ensureRootPage(title: string): Promise<{ id: string; created: boolean }> {
  // Pages live under WORKSPACE_PARENT_ID (internal integrations can't create workspace-root pages)
  const existing = await findPageByTitle(title, WORKSPACE_PARENT_ID);
  if (existing) {
    console.log(`  ↩  Already exists: "${title}" (${existing})`);
    return { id: existing, created: false };
  }
  const result = (await notionRequest("POST", "/pages", {
    parent: { type: "page_id", page_id: WORKSPACE_PARENT_ID },
    properties: {
      title: { title: [{ type: "text", text: { content: title } }] },
    },
  })) as { id: string };
  console.log(`  ✅ Created root page: "${title}" (${result.id})`);
  return { id: result.id, created: true };
}

async function ensureChildPage(
  title: string,
  parentId: string,
  blocks: unknown[],
): Promise<string> {
  const existing = await findPageByTitle(title, parentId);
  if (existing) {
    console.log(`    ↩  Already exists: "${title}"`);
    return existing;
  }
  const result = (await notionRequest("POST", "/pages", {
    parent: { type: "page_id", page_id: parentId },
    properties: {
      title: { title: [{ type: "text", text: { content: title } }] },
    },
    children: blocks.slice(0, 100),
  })) as { id: string };
  if (blocks.length > 100) {
    await appendBlocks(result.id, blocks.slice(100));
  }
  console.log(`    ✅ Created: "${title}" (${result.id})`);
  return result.id;
}

async function ensureDatabase(
  parentId: string,
  title: string,
  properties: Record<string, unknown>,
  seedRows?: Array<Record<string, unknown>>,
): Promise<string> {
  const existing = await findDatabaseByTitle(title, parentId);
  if (existing) {
    console.log(`    ↩  Already exists DB: "${title}" (${existing})`);
    return existing;
  }
  const result = (await notionRequest("POST", "/databases", {
    parent: { type: "page_id", page_id: parentId },
    title: [{ type: "text", text: { content: title } }],
    is_inline: true,
    properties,
  })) as { id: string };
  console.log(`    ✅ Created DB: "${title}" (${result.id})`);
  if (seedRows && seedRows.length > 0) {
    for (const row of seedRows) {
      await notionRequest("POST", "/pages", {
        parent: { type: "database_id", database_id: result.id },
        properties: row,
      });
    }
    console.log(`       Seeded ${seedRows.length} rows`);
  }
  return result.id;
}

// ─── Block builders ──────────────────────────────────────────────────────────

function callout(text: string, emoji: string): unknown {
  return {
    type: "callout",
    callout: {
      icon: { type: "emoji", emoji },
      rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }],
    },
  };
}

function h(level: 1 | 2 | 3, text: string): unknown {
  const t = `heading_${level}`;
  return { type: t, [t]: { rich_text: [{ type: "text", text: { content: text } }] } };
}

function p(text: string): unknown {
  return {
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }] },
  };
}

function divider(): unknown {
  return { type: "divider", divider: {} };
}

// ─── Markdown → Notion blocks (simplified) ───────────────────────────────────

function mdToBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      blocks.push(h(3, line.slice(4).trim()));
    } else if (line.startsWith("## ")) {
      blocks.push(h(2, line.slice(3).trim()));
    } else if (line.startsWith("# ")) {
      blocks.push(h(1, line.slice(2).trim()));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: line.slice(2).trim().slice(0, 2000) } }],
        },
      });
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: line
                  .replace(/^\d+\.\s/, "")
                  .trim()
                  .slice(0, 2000),
              },
            },
          ],
        },
      });
    } else if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: "code",
        code: {
          language: "plain text",
          rich_text: [{ type: "text", text: { content: codeLines.join("\n").slice(0, 2000) } }],
        },
      });
    } else if (line.startsWith("> ")) {
      blocks.push({
        type: "quote",
        quote: {
          rich_text: [{ type: "text", text: { content: line.slice(2).trim().slice(0, 2000) } }],
        },
      });
    } else if (line.startsWith("---")) {
      blocks.push(divider());
    } else if (line.trim() !== "") {
      blocks.push(p(line.trim()));
    }

    i++;
  }

  return blocks;
}

// ─── Split RUNBOOK.md by numbered sections ────────────────────────────────────

function splitRunbookSections(content: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = [];
  const lines = content.split("\n");
  let currentTitle = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^## (\d+\. .+)/);
    if (match) {
      if (currentTitle) {
        sections.push({ title: `RUNBOOK — ${currentTitle}`, body: currentLines.join("\n") });
      }
      currentTitle = match[1];
      currentLines = [];
    } else if (currentTitle) {
      currentLines.push(line);
    }
  }
  if (currentTitle) {
    sections.push({ title: `RUNBOOK — ${currentTitle}`, body: currentLines.join("\n") });
  }
  return sections;
}

// ─── Write IDs back to .env ───────────────────────────────────────────────────

async function updateEnv(vars: Record<string, string>): Promise<void> {
  const envPath = path.join(PROJECT_ROOT, ".env");
  let content = await fs.readFile(envPath, "utf8");
  for (const [key, value] of Object.entries(vars)) {
    if (new RegExp(`^${key}=`, "m").test(content)) {
      content = content.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  await fs.writeFile(envPath, content, "utf8");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Tulsbot Notion PARA workspace seeder starting...\n");
  const ids: Record<string, string> = {};

  // ── 1c. Databases (root page 3) — create first so IDs are known ──────────
  console.log("\n📦 Root page 3: Databases");
  const { id: dbsPageId, created: dbsCreated } = await ensureRootPage("Databases");
  ids["NOTION_DATABASES_PAGE_ID"] = dbsPageId;

  if (dbsCreated) {
    await appendBlocks(dbsPageId, [
      callout(
        "All Tulsbot database objects live here. Dashboard, Operations, and Archive pages display linked views of these databases. Source of truth: Supabase + local memory.",
        "🗄️",
      ),
      divider(),
      h(2, "Existing Databases"),
      p(`Workspaces DB — ID: ${WORKSPACES_DB}`),
      p(`Inbox (Capture) DB — ID: ${INBOX_DB}`),
      divider(),
      h(2, "New Databases"),
    ]);
  }

  console.log("\n  Agent Registry DB");
  const agentRegDbId = await ensureDatabase(
    dbsPageId,
    "Agent Registry",
    {
      Name: { title: {} },
      Status: { status: {} },
      "Operational Tag": {
        multi_select: {
          options: [
            { name: "active", color: "green" },
            { name: "observer", color: "blue" },
            { name: "builder", color: "orange" },
            { name: "archived", color: "gray" },
          ],
        },
      },
      Description: { rich_text: {} },
      "Config Notes": { rich_text: {} },
    },
    [
      {
        Name: { title: [{ type: "text", text: { content: "OpenClaw" } }] },
        "Operational Tag": { multi_select: [{ name: "active" }] },
        Description: {
          rich_text: [
            {
              type: "text",
              text: { content: "Main strategic agent — orchestrates Tulsbot and Builder." },
            },
          ],
        },
      },
      {
        Name: { title: [{ type: "text", text: { content: "Tulsbot" } }] },
        "Operational Tag": { multi_select: [{ name: "active" }] },
        Description: {
          rich_text: [
            {
              type: "text",
              text: {
                content: "Day/night shift agent. Manages workspace, heartbeat, coordination.",
              },
            },
          ],
        },
      },
      {
        Name: { title: [{ type: "text", text: { content: "Builder" } }] },
        "Operational Tag": { multi_select: [{ name: "builder" }] },
        Description: {
          rich_text: [
            {
              type: "text",
              text: { content: "tulsCodex (Cursor) — implements plans under Tulsbot authority." },
            },
          ],
        },
      },
      {
        Name: { title: [{ type: "text", text: { content: "Tulsday" } }] },
        "Operational Tag": { multi_select: [{ name: "observer" }] },
        Description: {
          rich_text: [
            { type: "text", text: { content: "Day-mode agent for user-facing interactions." } },
          ],
        },
      },
    ],
  );
  ids["NOTION_AGENT_REGISTRY_DB"] = agentRegDbId;

  console.log("\n  Bot Handshakes DB");
  const handshakesDbId = await ensureDatabase(dbsPageId, "Bot Handshakes", {
    Name: { title: {} },
    Message: { rich_text: {} },
    To: {
      select: {
        options: [
          { name: "Tulsbot", color: "blue" },
          { name: "OpenClaw", color: "purple" },
          { name: "Builder", color: "orange" },
          { name: "Tulsday", color: "green" },
        ],
      },
    },
    From: {
      select: {
        options: [
          { name: "Tulsbot", color: "blue" },
          { name: "OpenClaw", color: "purple" },
          { name: "Builder", color: "orange" },
          { name: "Tulsday", color: "green" },
        ],
      },
    },
    Status: {
      select: {
        options: [
          { name: "Pending", color: "yellow" },
          { name: "Done", color: "green" },
          { name: "Cancelled", color: "red" },
        ],
      },
    },
  });
  ids["NOTION_HANDSHAKES_DB"] = handshakesDbId;

  console.log("\n  Heartbeat Snapshots DB");
  const heartbeatDbId = await ensureDatabase(dbsPageId, "Heartbeat Snapshots", {
    Run: { title: {} },
    Status: {
      select: {
        options: [
          { name: "ok", color: "green" },
          { name: "degraded", color: "yellow" },
          { name: "failed", color: "red" },
        ],
      },
    },
    Shift: { rich_text: {} },
    Blockers: { rich_text: {} },
    "Memory Sync": { rich_text: {} },
    "Master Index Count": { number: {} },
    "Steps JSON": { rich_text: {} },
    "Raw Heartbeat": { rich_text: {} },
  });
  ids["NOTION_HEARTBEAT_SNAPSHOTS_DB"] = heartbeatDbId;

  // ── 1a. Dashboard (root page 1) ───────────────────────────────────────────
  console.log("\n\n📊 Root page 1: Dashboard");
  const { id: dashId, created: dashCreated } = await ensureRootPage("Dashboard");
  ids["NOTION_STATUS_DASHBOARD_PAGE_ID"] = dashId;

  if (dashCreated) {
    await appendBlocks(dashId, [
      callout(
        "PARA — P: Projects. What is active right now. All sections below are linked views from the Databases root page.",
        "📊",
      ),
      divider(),
      callout(
        [
          "To set up linked views: click '+ New linked view of database' on this page and select the database with the filter shown.",
          "",
          `Active Workspaces → Workspaces DB (${WORKSPACES_DB}) | filter: Active = true`,
          `HITL Queue → Inbox DB (${INBOX_DB}) | filter: HITL? = true | sort: Priority`,
          `System Health → Heartbeat Snapshots DB (${heartbeatDbId}) | sort: Run desc | limit 1`,
          `Pending Handshakes → Bot Handshakes DB (${handshakesDbId}) | filter: Status = Pending`,
        ].join("\n"),
        "💡",
      ),
      divider(),
      h(2, "Active Workspaces"),
      p(`→ Workspaces DB  |  ID: ${WORKSPACES_DB}  |  filter: Active = true`),
      divider(),
      h(2, "HITL Queue"),
      p(`→ Inbox DB  |  ID: ${INBOX_DB}  |  filter: HITL? = true  |  sort: Priority`),
      divider(),
      h(2, "System Health"),
      p(`→ Heartbeat Snapshots DB  |  ID: ${heartbeatDbId}  |  sort: Run desc  |  limit 1`),
      divider(),
      h(2, "Pending Handshakes"),
      p(`→ Bot Handshakes DB  |  ID: ${handshakesDbId}  |  filter: Status = Pending`),
    ]);
  }

  // ── 1b. Operations (root page 2) ─────────────────────────────────────────
  console.log("\n\n⚙️  Root page 2: Operations");
  const { id: opsId, created: opsCreated } = await ensureRootPage("Operations");
  ids["NOTION_DOC_WIKI_PAGE_ID"] = opsId;

  if (opsCreated) {
    await appendBlocks(opsId, [
      callout(
        "PARA — A: Areas. Ongoing responsibilities, SOPs, rules. Agent Registry and all docs live here. Source of truth: local files. Re-run seed-notion.ts to refresh.",
        "⚙️",
      ),
      divider(),
      h(2, "Agent Registry"),
      callout(
        `Linked view → Agent Registry DB  |  ID: ${agentRegDbId}  |  filter: none (all rows)\n\nClick '+ New linked view of database' and select Agent Registry to embed the live view here.`,
        "💡",
      ),
      divider(),
      h(2, "Doc Wiki"),
      p(
        "Subpages seeded from RUNBOOK.md, AGENTS.md, SOUL.md, IDENTITY.md. Source files win on conflict.",
      ),
    ]);
  }

  // Seed wiki subpages
  console.log("\n  Seeding RUNBOOK.md sections...");
  const runbookContent = await fs.readFile(path.join(PROJECT_ROOT, "RUNBOOK.md"), "utf8");
  const sections = splitRunbookSections(runbookContent);
  for (const section of sections) {
    await ensureChildPage(section.title, opsId, mdToBlocks(section.body));
  }

  console.log("\n  Seeding AGENTS.md...");
  const agentsContent = await fs.readFile(path.join(PROJECT_ROOT, "AGENTS.md"), "utf8");
  await ensureChildPage("AGENTS — Safety & Coding Rules", opsId, mdToBlocks(agentsContent));

  console.log("\n  Seeding SOUL.md...");
  const soulContent = await fs.readFile(path.join(PROJECT_ROOT, "SOUL.md"), "utf8");
  await ensureChildPage("SOUL — Persona & Communication", opsId, mdToBlocks(soulContent));

  console.log("\n  Seeding IDENTITY.md...");
  const identityContent = await fs.readFile(path.join(PROJECT_ROOT, "IDENTITY.md"), "utf8");
  await ensureChildPage("IDENTITY — Modes & Behavior", opsId, mdToBlocks(identityContent));

  // ── 1d. Archive (root page 4) ─────────────────────────────────────────────
  console.log("\n\n🗄️  Root page 4: Archive");
  const { id: archiveId, created: archiveCreated } = await ensureRootPage("Archive");
  ids["NOTION_ARCHIVE_PAGE_ID"] = archiveId;

  if (archiveCreated) {
    await appendBlocks(archiveId, [
      callout(
        "PARA — A: Archives. Inactive workspaces, backlog items, heartbeat history, deprecated databases.",
        "🗄️",
      ),
      divider(),
      callout(
        [
          "To set up linked views: click '+ New linked view of database' on this page.",
          "",
          `Inactive Workspaces → Workspaces DB (${WORKSPACES_DB}) | filter: Active = false`,
          `Backlog Inbox → Inbox DB (${INBOX_DB}) | filter: Status = Backlog`,
          `Heartbeat History → Heartbeat Snapshots DB (${heartbeatDbId}) | sort: Run desc`,
        ].join("\n"),
        "💡",
      ),
      divider(),
      h(2, "Inactive Workspaces"),
      p(`→ Workspaces DB  |  ID: ${WORKSPACES_DB}  |  filter: Active = false`),
      divider(),
      h(2, "Backlog Inbox"),
      p(`→ Inbox DB  |  ID: ${INBOX_DB}  |  filter: Status = Backlog`),
      divider(),
      h(2, "Heartbeat History"),
      p(`→ Heartbeat Snapshots DB  |  ID: ${heartbeatDbId}  |  sort: Run desc  |  all rows`),
      divider(),
    ]);
  }

  await ensureChildPage("Deprecated Databases", archiveId, [
    p("Databases found in master_index and scan-databases.ts that are no longer actively used."),
    divider(),
    p(
      `NOTION_SUPERINBOX_DATABASE_ID: 61efc873884b4c11925bc096ba38ec55  (superseded by Inbox DB ${INBOX_DB})`,
    ),
    p(
      `NOTION_DATABASE_IDS: 30251bf9-731e-8187-aa81-eb4c66e21639  (original workspace DB, deprecated)`,
    ),
  ]);

  // ── Write IDs to .env ─────────────────────────────────────────────────────
  await updateEnv(ids);

  console.log("\n\n✅ Tulsbot Notion PARA workspace seeded!");
  console.log("\nIDs written to .env:");
  for (const [key, value] of Object.entries(ids)) {
    console.log(`  ${key}=${value}`);
  }
  console.log("\n⚠️  Linked database views must be set up manually in the Notion UI.");
  console.log("   See the 💡 callout blocks on each page for filter instructions.");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
