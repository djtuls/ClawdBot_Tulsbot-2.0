#!/usr/bin/env npx tsx
/**
 * seed-notion.ts — Seeds Notion databases for Mission Control
 *
 * Populates: Agent Registry, Tasks, Inbox, Workspaces
 * Idempotent: checks for existing rows before creating.
 *
 * Usage: npx tsx scripts/seed-notion.ts
 */

import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(__dirname, "..", ".env.local") });

const TOKEN = process.env.NOTION_TOKEN_OPENCLAW_2 || "";
if (!TOKEN) {
  console.error("NOTION_TOKEN_OPENCLAW_2 not set");
  process.exit(1);
}

const DB = {
  TASKS: "30051bf9-731e-804c-92b1-c8ae7b76ee0f",
  INBOX: "ea9460ca-200d-494d-b3da-ba51f07a67d3",
  WORKSPACES: process.env.NOTION_WORKSPACES_DB || "a9acab15-5173-46c6-8a20-792c93320b99",
  AGENT_REGISTRY: process.env.NOTION_AGENT_REGISTRY_DB || "30f51bf9-731e-81bc-a3a7-e26c35c69378",
  HEARTBEAT: process.env.NOTION_HEARTBEAT_DB || "30f51bf9-731e-81aa-87a9-f50c2cadbd86",
};

async function notion(method: string, endpoint: string, body?: unknown) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function queryDb(dbId: string, pageSize = 100) {
  return notion("POST", `/databases/${dbId}/query`, { page_size: pageSize });
}

async function createRow(dbId: string, properties: Record<string, unknown>) {
  return notion("POST", "/pages", {
    parent: { database_id: dbId },
    properties,
  });
}

function title(text: string) {
  return { title: [{ text: { content: text } }] };
}

function richText(text: string) {
  return { rich_text: [{ text: { content: text } }] };
}

function select(name: string) {
  return { select: { name } };
}

function multiSelect(...names: string[]) {
  return { multi_select: names.map((n) => ({ name: n })) };
}

function status(name: string) {
  return { status: { name } };
}

function checkbox(val: boolean) {
  return { checkbox: val };
}

function date(d: string) {
  return { date: { start: d } };
}

function num(n: number) {
  return { number: n };
}

async function existingTitles(dbId: string): Promise<Set<string>> {
  const data = await queryDb(dbId);
  const titles = new Set<string>();
  for (const page of data.results) {
    const props = page.properties;
    for (const key of Object.keys(props)) {
      const t = props[key]?.title?.[0]?.plain_text;
      if (t) {
        titles.add(t);
        break;
      }
    }
  }
  return titles;
}

async function seedIfMissing(
  dbId: string,
  rows: Array<{ name: string; props: Record<string, unknown> }>,
) {
  const existing = await existingTitles(dbId);
  let created = 0;
  for (const row of rows) {
    if (existing.has(row.name)) {
      console.log(`    ↩  exists: ${row.name}`);
      continue;
    }
    await createRow(dbId, row.props);
    console.log(`    ✅ created: ${row.name}`);
    created++;
  }
  return created;
}

// ─── Seed data ──────────────────────────────────────────────────────────────

const AGENTS = [
  {
    name: "OpenClaw",
    props: {
      Name: title("OpenClaw"),
      "Operational Tag": multiSelect("active"),
      Description: richText(
        "Core orchestrator and gateway. Routes commands, manages sessions, coordinates all sub-agents. GPT-5.2 backbone with 250k token system prompt.",
      ),
      "Config Notes": richText(
        "Gateway: Fly.io | Model: GPT-5.2 | Session: persistent | Tools: 47 registered",
      ),
    },
  },
  {
    name: "Tulsbot",
    props: {
      Name: title("Tulsbot"),
      "Operational Tag": multiSelect("active"),
      Description: richText(
        "Strategic lead and blueprint owner. Manages architecture decisions, task priorities, ecosystem health. Runs shift-based AM/PM cycles.",
      ),
      "Config Notes": richText(
        "Notion-integrated | Shift: AM/PM | Blueprint: v1.0 | Memory: Supabase + Notion",
      ),
    },
  },
  {
    name: "Builder",
    props: {
      Name: title("Builder"),
      "Operational Tag": multiSelect("builder"),
      Description: richText(
        "Architecture guardian. Validates blueprints, detects drift, manages pre/post hooks for deploys. Ensures implementation matches design.",
      ),
      "Config Notes": richText(
        "Blueprint: v1.0 | Drift detection: active | Hooks: pre-deploy, post-deploy",
      ),
    },
  },
  {
    name: "tulsCodex",
    props: {
      Name: title("tulsCodex"),
      "Operational Tag": multiSelect("active", "builder"),
      Description: richText(
        "Cursor-based coding agent. Implements plans under Tulsbot authority. Edits files, runs commands, manages git operations.",
      ),
      "Config Notes": richText(
        "IDE: Cursor | Model: Claude | Authority: under Tulsbot | Skills: 40+",
      ),
    },
  },
  {
    name: "Tulsday",
    props: {
      Name: title("Tulsday"),
      "Operational Tag": multiSelect("active", "observer"),
      Description: richText(
        "Context and session manager. Tracks current work, maintains state snapshots in Supabase, ensures continuity between sessions.",
      ),
      "Config Notes": richText(
        "Shift-aware | Context snapshots: Supabase | Session tracking: active",
      ),
    },
  },
  {
    name: "TulsNotion",
    props: {
      Name: title("TulsNotion"),
      "Operational Tag": multiSelect("active"),
      Description: richText(
        "Notion API specialist. Syncs all Notion databases (Workspaces, Inbox, Agent Registry, Handshakes). Processes inbox captures.",
      ),
      "Config Notes": richText("DBs synced: 6 | Sync interval: 60s | API version: 2022-06-28"),
    },
  },
  {
    name: "Scriber",
    props: {
      Name: title("Scriber"),
      "Operational Tag": multiSelect("active"),
      Description: richText(
        "Maintains the master_index in Supabase. Full-text search index of all workspace content. Powers search across all agents.",
      ),
      "Config Notes": richText(
        "Index: Supabase master_index | Files indexed: 1000+ | Refresh: on change",
      ),
    },
  },
  {
    name: "TulsManager",
    props: {
      Name: title("TulsManager"),
      "Operational Tag": multiSelect("active"),
      Description: richText(
        "Orchestrates 17 sub-agents. Routes tasks to the right agent based on capability and current load. Manages coordination cycles.",
      ),
      "Config Notes": richText(
        "Sub-agents: 17 | Routing: capability-based | Load balancing: active",
      ),
    },
  },
  {
    name: "ShiftManager",
    props: {
      Name: title("ShiftManager"),
      "Operational Tag": multiSelect("active"),
      Description: richText(
        "Manages AM/PM shift transitions. Writes shift reports, updates inbox, triggers heartbeat checks at shift boundaries.",
      ),
      "Config Notes": richText(
        "Shifts: AM (6-18), PM (18-6) | Reports: Notion Inbox | Heartbeat: on shift change",
      ),
    },
  },
  {
    name: "MemorySync",
    props: {
      Name: title("MemorySync"),
      "Operational Tag": multiSelect("observer"),
      Description: richText(
        "Bidirectional memory sync between Supabase and local workspace. Ensures all agents have consistent context.",
      ),
      "Config Notes": richText(
        "Sources: Supabase, local files, Notion | Sync: every 5min | Conflict: last-write-wins",
      ),
    },
  },
];

const today = new Date().toISOString().split("T")[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

const TASKS = [
  {
    name: "Notion views — HITL Queue, NOW, embed in canvas",
    props: {
      Name: title("Notion views — HITL Queue, NOW, embed in canvas"),
      Status: status("Queued"),
      Priority: select("🟠 High"),
      Category: select("Infrastructure"),
      "Due Date": date(tomorrow),
    },
  },
  {
    name: "Voice call fix — verify commit a706e48dd",
    props: {
      Name: title("Voice call fix — verify commit a706e48dd"),
      Status: status("Queued"),
      Priority: select("🟡 Medium"),
      Category: select("Integration"),
      "Due Date": date(tomorrow),
    },
  },
  {
    name: "Nostr pipeline — test relay stability",
    props: {
      Name: title("Nostr pipeline — test relay stability"),
      Status: status("Backlog"),
      Priority: select("🟡 Medium"),
      Category: select("Integration"),
      "Due Date": date(nextWeek),
    },
  },
  {
    name: "Supabase RLS policy review — all tables",
    props: {
      Name: title("Supabase RLS policy review — all tables"),
      Status: status("Queued"),
      Priority: select("🟠 High"),
      Category: select("Infrastructure"),
      "Due Date": date(nextWeek),
    },
  },
  {
    name: "Notion database templates for Workspaces and Inbox",
    props: {
      Name: title("Notion database templates for Workspaces and Inbox"),
      Status: status("Backlog"),
      Priority: select("🟢 Low"),
      Category: select("Documentation"),
    },
  },
  {
    name: "Weekly review template — create Notion template",
    props: {
      Name: title("Weekly review template — create Notion template"),
      Status: status("Backlog"),
      Priority: select("🟢 Low"),
      Category: select("Documentation"),
    },
  },
  {
    name: "Telegram bot — voice integration end-to-end test",
    props: {
      Name: title("Telegram bot — voice integration end-to-end test"),
      Status: status("Queued"),
      Priority: select("🟡 Medium"),
      Category: select("Integration"),
      "Due Date": date(tomorrow),
    },
  },
  {
    name: "Deploy Mission Control to Fly.io",
    props: {
      Name: title("Deploy Mission Control to Fly.io"),
      Status: status("Queued"),
      Priority: select("🟠 High"),
      Category: select("Infrastructure"),
      "Due Date": date(nextWeek),
    },
  },
];

const INBOX_ITEMS = [
  {
    name: "Nostr relay pipeline idea — evaluate relay software",
    props: {
      Item: title("Nostr relay pipeline idea — evaluate relay software"),
      Priority: select("Medium"),
      Type: select("Idea"),
    },
  },
  {
    name: "Mac Mini SSH config notes — generate keys, sshd, Tailscale",
    props: {
      Item: title("Mac Mini SSH config notes — generate keys, sshd, Tailscale"),
      Priority: select("High"),
      Type: select("Task"),
      "HITL?": checkbox(true),
    },
  },
  {
    name: "Voice call bug report — commit a706e48dd fix",
    props: {
      Item: title("Voice call bug report — commit a706e48dd fix"),
      Priority: select("Medium"),
      Type: select("Bug"),
    },
  },
  {
    name: "Notion template for weekly reviews",
    props: {
      Item: title("Notion template for weekly reviews"),
      Priority: select("Low"),
      Type: select("Task"),
    },
  },
  {
    name: "Supabase RLS policy review reminder",
    props: {
      Item: title("Supabase RLS policy review reminder"),
      Priority: select("High"),
      Type: select("Task"),
      "HITL?": checkbox(true),
    },
  },
  {
    name: "Explore Cloudflare Workers for edge functions",
    props: {
      Item: title("Explore Cloudflare Workers for edge functions"),
      Priority: select("Low"),
      Type: select("Research"),
    },
  },
  {
    name: "Research vector DB options — Pinecone vs pgvector",
    props: {
      Item: title("Research vector DB options — Pinecone vs pgvector"),
      Priority: select("Medium"),
      Type: select("Research"),
    },
  },
  {
    name: "Set up GitHub Actions CI for tulsbot repo",
    props: {
      Item: title("Set up GitHub Actions CI for tulsbot repo"),
      Priority: select("Medium"),
      Type: select("Task"),
    },
  },
];

const WORKSPACES = [
  {
    name: "INF-2603",
    props: {
      Workspace: title("INF-2603"),
      Active: checkbox(true),
      Brief: richText("Infrastructure hub — server management, deployments, CI/CD, monitoring"),
      Priority: select("High"),
    },
  },
  {
    name: "Sales",
    props: {
      Workspace: title("Sales"),
      Active: checkbox(false),
      Brief: richText("Business development, leads, proposals, client outreach"),
    },
  },
  {
    name: "Staffing",
    props: {
      Workspace: title("Staffing"),
      Active: checkbox(false),
      Brief: richText("Team and contractors — AJ, Duda, hiring pipeline"),
    },
  },
  {
    name: "Finance",
    props: {
      Workspace: title("Finance"),
      Active: checkbox(false),
      Brief: richText("Money, budgets, invoices, tax planning"),
    },
  },
  {
    name: "Tulsbot",
    props: {
      Workspace: title("Tulsbot"),
      Active: checkbox(true),
      Brief: richText("Tulsbot ecosystem development — agents, memory, gateway, Mission Control"),
      Priority: select("High"),
    },
  },
];

const HEARTBEAT_ROWS = [
  {
    name: `heartbeat-${today}-AM`,
    props: {
      Run: title(`heartbeat-${today}-AM`),
      Status: select("ok"),
      Shift: richText("AM"),
      Blockers: richText("None"),
      "Memory Sync": richText("Supabase: synced | Notion: synced | Local: synced"),
      "Master Index Count": num(1034),
      "Steps JSON": richText(
        '{"boot":true,"memory_sync":true,"inbox_check":true,"heartbeat_write":true}',
      ),
      "Raw Heartbeat": richText(
        `AM shift started at ${new Date().toISOString()}. All systems nominal. 5 agents active, 3 nodes online, 10 active tasks, 8 inbox items.`,
      ),
    },
  },
];

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Mission Control Notion seeder\n");

  console.log("📋 Seeding Agent Registry...");
  const agentCount = await seedIfMissing(DB.AGENT_REGISTRY, AGENTS);
  console.log(`   → ${agentCount} new agents\n`);

  console.log("✅ Seeding Tasks...");
  const taskCount = await seedIfMissing(DB.TASKS, TASKS);
  console.log(`   → ${taskCount} new tasks\n`);

  console.log("📥 Seeding Inbox...");
  const inboxCount = await seedIfMissing(DB.INBOX, INBOX_ITEMS);
  console.log(`   → ${inboxCount} new inbox items\n`);

  console.log("📁 Seeding Workspaces...");
  const wsCount = await seedIfMissing(DB.WORKSPACES, WORKSPACES);
  console.log(`   → ${wsCount} new workspaces\n`);

  console.log("💓 Seeding Heartbeat...");
  const hbCount = await seedIfMissing(DB.HEARTBEAT, HEARTBEAT_ROWS);
  console.log(`   → ${hbCount} new heartbeat rows\n`);

  console.log("✅ Seed complete!");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
