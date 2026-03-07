#!/usr/bin/env tsx
/**
 * sync-notion-dashboard.ts — Keep the Notion Dashboard page in sync
 *
 * Queries live data from Supabase and Notion databases, then rewrites the
 * Dashboard page content with current status. Designed to run on a schedule
 * (e.g. after each heartbeat) or on-demand.
 *
 * Data flow: Supabase + Notion DBs → this script → Dashboard page (write-only)
 *
 * Usage: npx tsx scripts/sync-notion-dashboard.ts [--quiet]
 */

import { config as loadEnv } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
loadEnv({ path: path.join(PROJECT_ROOT, ".env") });

const quiet = process.argv.includes("--quiet");
function log(...args: unknown[]) {
  if (!quiet) {
    console.log(...args);
  }
}

const NOTION_TOKEN = process.env.NOTION_TOKEN_OPENCLAW_2 || process.env.NOTION_API_KEY || "";
const DASHBOARD_PAGE_ID = "30e51bf9-731e-8086-991c-efb20a68a02a";
const WORKSPACES_DB = process.env.NOTION_WORKSPACES_DB || "a9acab15-5173-46c6-8a20-792c93320b99";
const INBOX_DB = process.env.NOTION_INBOX_DB || "ea9460ca-200d-494d-b3da-ba51f07a67d3";
const AGENT_REGISTRY_DB =
  process.env.NOTION_AGENT_REGISTRY_DB || "30f51bf9-731e-81bc-a3a7-e26c35c69378";
const HEARTBEAT_DB =
  process.env.NOTION_HEARTBEAT_SNAPSHOTS_DB || "30f51bf9-731e-81aa-87a9-f50c2cadbd86";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!NOTION_TOKEN) {
  console.error("❌ Missing NOTION_TOKEN_OPENCLAW_2 or NOTION_API_KEY");
  process.exit(1);
}

// ─── Notion helpers ──────────────────────────────────────────────────────────

type Block = Record<string, unknown>;

async function notionFetch(endpoint: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
}

async function queryDb(dbId: string, filter?: unknown, sorts?: unknown[], pageSize = 10) {
  const body: Record<string, unknown> = { page_size: pageSize };
  if (filter) {
    body.filter = filter;
  }
  if (sorts) {
    body.sorts = sorts;
  }
  try {
    const res = await notionFetch(`/databases/${dbId}/query`, "POST", body);
    return res?.results || [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.includes("object_not_found")) {
      log(`⚠️  Database ${dbId} not found or in trash — skipping`);
      return [];
    }
    throw err;
  }
}

async function getBlockChildren(blockId: string): Promise<unknown[]> {
  const res = await notionFetch(`/blocks/${blockId}/children?page_size=100`);
  return res?.results || [];
}

async function deleteBlock(blockId: string) {
  await notionFetch(`/blocks/${blockId}`, "DELETE");
}

async function appendBlocks(pageId: string, blocks: Block[]) {
  // Notion limit: 100 blocks per request
  for (let i = 0; i < blocks.length; i += 100) {
    await notionFetch(`/blocks/${pageId}/children`, "PATCH", {
      children: blocks.slice(i, i + 100),
    });
  }
}

interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
}

// ─── Block builders ──────────────────────────────────────────────────────────

function heading2(text: string): Block {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

function paragraph(text: string): Block {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

function bulletItem(text: string): Block {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

function callout(text: string, emoji: string): Block {
  return {
    object: "block",
    type: "callout",
    callout: {
      icon: { type: "emoji", emoji },
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

function divider(): Block {
  return { object: "block", type: "divider", divider: {} };
}

// ─── Data readers ────────────────────────────────────────────────────────────

function richText(prop: unknown): string {
  if (!prop) {
    return "";
  }
  const arr = prop.title || prop.rich_text || [];
  return arr.map((r: unknown) => r?.plain_text ?? "").join("");
}

interface WorkspaceRow {
  name: string;
  phase: string;
  priority: string;
  status: string;
}
async function getActiveWorkspaces(): Promise<WorkspaceRow[]> {
  const pages = await queryDb(
    WORKSPACES_DB,
    { property: "Active", checkbox: { equals: true } },
    undefined,
    20,
  );
  return pages.map((p: NotionPage) => ({
    name: richText(p.properties.Workspace) || richText(p.properties.Name) || p.id,
    phase:
      (p.properties.Phase as Record<string, Record<string, string>> | undefined)?.select?.name ??
      "—",
    priority:
      (p.properties.Priority as Record<string, Record<string, string>> | undefined)?.select?.name ??
      "—",
    status:
      (p.properties.Status as Record<string, Record<string, string>> | undefined)?.status?.name ??
      "—",
  }));
}

interface HitlItem {
  item: string;
  priority: string;
  workspace: string;
  status: string;
}
async function getHitlQueue(): Promise<HitlItem[]> {
  const pages = await queryDb(
    INBOX_DB,
    { property: "HITL?", checkbox: { equals: true } },
    [{ property: "Priority", direction: "ascending" }],
    10,
  );
  return pages.map((p: NotionPage) => ({
    item: richText(p.properties.Item) || p.id,
    priority:
      (p.properties.Priority as Record<string, Record<string, string>> | undefined)?.select?.name ??
      "—",
    workspace: richText(p.properties.Workspace) || "—",
    status:
      (p.properties["Status lane"] as Record<string, Record<string, string>> | undefined)?.select
        ?.name ?? "—",
  }));
}

interface AgentRow {
  name: string;
  status: string;
  tags: string;
}
async function getAgents(): Promise<AgentRow[]> {
  const pages = await queryDb(AGENT_REGISTRY_DB, undefined, undefined, 20);
  return pages.map((p: NotionPage) => ({
    name: richText(p.properties.Name) || p.id,
    status:
      (p.properties.Status as Record<string, Record<string, string>> | undefined)?.status?.name ??
      "—",
    tags:
      (
        (p.properties["Operational Tag"] as Record<string, Array<{ name: string }>> | undefined)
          ?.multi_select ?? []
      )
        .map((t) => t.name)
        .join(", ") || "—",
  }));
}

interface HeartbeatRow {
  run: string;
  status: string;
  shift: string;
  masterIndex: number | null;
}
async function getLatestHeartbeat(): Promise<HeartbeatRow | null> {
  const pages = await queryDb(
    HEARTBEAT_DB,
    undefined,
    [{ timestamp: "created_time", direction: "descending" }],
    1,
  );
  if (pages.length === 0) {
    return null;
  }
  const p = pages[0];
  return {
    run: richText(p.properties.Run) || "—",
    status: p.properties.Status?.select?.name ?? "—",
    shift: richText(p.properties.Shift) || "—",
    masterIndex: p.properties["Master Index Count"]?.number ?? null,
  };
}

interface ShiftInfo {
  active: boolean;
  mode: string;
  workspace: string;
  blockers: string;
}
async function readStateFile(): Promise<ShiftInfo> {
  try {
    const raw = await fs.readFile(path.join(PROJECT_ROOT, "STATE.md"), "utf8");
    const active = /\*\*Active:\*\*\s*yes/i.test(raw);
    const modeMatch = raw.match(/\*\*Mode:\*\*\s*(.+)/);
    const wsMatch = raw.match(/\*\*Workspace:\*\*\s*(.+)/);
    const blockersMatch = raw.match(/## Blockers\s+([\s\S]*?)(?=\n##|$)/);
    return {
      active,
      mode: modeMatch?.[1]?.trim() || "none",
      workspace: wsMatch?.[1]?.trim() || "—",
      blockers: blockersMatch?.[1]?.trim().slice(0, 300) || "none",
    };
  } catch {
    return { active: false, mode: "—", workspace: "—", blockers: "—" };
  }
}

async function getHitlQueueCount(): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return -1;
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tulsbot_hitl_queue?select=id&status=eq.pending`,
      {
        method: "HEAD",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "count=exact",
        },
      },
    );
    const range = res.headers.get("content-range");
    const match = range?.match(/\/(\d+)$/);
    return match ? parseInt(match[1], 10) : -1;
  } catch {
    return -1;
  }
}

// ─── Dashboard builder ───────────────────────────────────────────────────────

async function buildDashboardBlocks(): Promise<Block[]> {
  log("📡 Fetching live data...");

  const [workspaces, hitlItems, agents, heartbeat, stateInfo, hitlCount] = await Promise.all([
    getActiveWorkspaces(),
    getHitlQueue(),
    getAgents(),
    getLatestHeartbeat(),
    readStateFile(),
    getHitlQueueCount(),
  ]);

  const now = new Date();
  const brt = now.toLocaleString("en-GB", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const blocks: Block[] = [];

  // Header
  blocks.push(
    callout(`Dashboard synced: ${brt} BRT — auto-updated by sync-notion-dashboard.ts`, "🔄"),
  );

  // ── Shift Status ──
  blocks.push(divider());
  blocks.push(heading2("🎯 Current Shift"));
  if (stateInfo.active) {
    blocks.push(bulletItem(`Mode: ${stateInfo.mode}`));
    blocks.push(bulletItem(`Workspace: ${stateInfo.workspace}`));
    if (stateInfo.blockers !== "none") {
      blocks.push(bulletItem(`Blockers: ${stateInfo.blockers}`));
    }
  } else {
    blocks.push(paragraph("No active shift."));
  }

  // ── System Health ──
  blocks.push(divider());
  blocks.push(heading2("💚 System Health"));
  if (heartbeat) {
    const statusEmoji =
      heartbeat.status === "ok" ? "🟢" : heartbeat.status === "degraded" ? "🟡" : "🔴";
    blocks.push(bulletItem(`${statusEmoji} Status: ${heartbeat.status}`));
    blocks.push(bulletItem(`Last heartbeat: ${heartbeat.run}`));
    blocks.push(bulletItem(`Shift: ${heartbeat.shift}`));
    if (heartbeat.masterIndex !== null) {
      blocks.push(bulletItem(`Master Index: ${heartbeat.masterIndex} items`));
    }
  } else {
    blocks.push(paragraph("No heartbeat data yet."));
  }

  // ── Active Workspaces ──
  blocks.push(divider());
  blocks.push(heading2("🏢 Active Workspaces"));
  if (workspaces.length > 0) {
    for (const ws of workspaces) {
      blocks.push(
        bulletItem(
          `${ws.name} — Phase: ${ws.phase} | Priority: ${ws.priority} | Status: ${ws.status}`,
        ),
      );
    }
  } else {
    blocks.push(paragraph("No active workspaces."));
  }

  // ── HITL Queue ──
  blocks.push(divider());
  blocks.push(heading2("🚨 HITL Queue"));
  const hitlLabel = hitlCount >= 0 ? ` (${hitlCount} pending in Supabase)` : "";
  if (hitlItems.length > 0) {
    blocks.push(paragraph(`${hitlItems.length} items flagged HITL in Notion${hitlLabel}:`));
    for (const item of hitlItems) {
      blocks.push(bulletItem(`[${item.priority}] ${item.item} — ${item.status}`));
    }
  } else {
    blocks.push(
      paragraph(`No HITL items in Notion inbox.${hitlLabel ? ` Supabase: ${hitlLabel}` : ""}`),
    );
  }

  // ── Agents ──
  blocks.push(divider());
  blocks.push(heading2("🤖 Agents"));
  if (agents.length > 0) {
    for (const agent of agents) {
      const statusEmoji =
        agent.status === "Active" ? "🟢" : agent.status === "Standby" ? "🟡" : "⚪";
      blocks.push(bulletItem(`${statusEmoji} ${agent.name} — ${agent.status} | ${agent.tags}`));
    }
  } else {
    blocks.push(paragraph("No agents registered."));
  }

  // Footer
  blocks.push(divider());
  blocks.push(
    callout(
      "This page is auto-generated. Do not edit manually — changes will be overwritten on next sync. Source: scripts/sync-notion-dashboard.ts",
      "⚠️",
    ),
  );

  return blocks;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log("📊 Syncing Notion Dashboard...");

  // Step 1: Build new content
  const newBlocks = await buildDashboardBlocks();

  // Step 2: Clear existing Dashboard content
  log("🗑️  Clearing old Dashboard content...");
  let existing: unknown[] = [];
  try {
    existing = await getBlockChildren(DASHBOARD_PAGE_ID);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`⚠️  Could not read Dashboard page (${msg.slice(0, 100)}) — will attempt overwrite`);
  }
  for (const block of existing) {
    try {
      await deleteBlock((block as { id: string }).id);
    } catch {
      // Some blocks may not be deletable; skip
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Step 3: Write new content
  log("📝 Writing updated Dashboard...");
  await appendBlocks(DASHBOARD_PAGE_ID, newBlocks);

  log("✅ Dashboard synced successfully");
}

main().catch((err) => {
  console.error("⚠️  sync-notion-dashboard failed:", err.message);
  // Always exit 0 — dashboard sync is best-effort and must not fail scheduled jobs
  process.exit(0);
});
