#!/usr/bin/env tsx
/**
 * push-status-to-notion.ts — Heartbeat step 8
 *
 * 1. Drift detection: query Agent Registry + Bot Handshakes DBs, compare
 *    against last-push snapshot. If rows were manually edited since last push,
 *    create HITL Inbox items so the operator can confirm or reject.
 * 2. Insert a new heartbeat snapshot row into the Heartbeat Snapshots DB.
 * 3. Save a new drift snapshot for next run.
 *
 * Source-of-truth hierarchy:
 *   Operator (Tulio) > Supabase/memory > Notion (projection only)
 *
 * Data flows one direction: Supabase/memory → Notion.
 * This script NEVER reads Notion to update Supabase or memory files.
 *
 * Usage: npx tsx scripts/push-status-to-notion.ts
 */

import { config as loadEnv } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
loadEnv({ path: path.join(PROJECT_ROOT, ".env") });

const NOTION_TOKEN = process.env.NOTION_TOKEN_OPENCLAW_2 || process.env.NOTION_API_KEY || "";
const HEARTBEAT_SNAPSHOTS_DB = process.env.NOTION_HEARTBEAT_SNAPSHOTS_DB || "";
const AGENT_REGISTRY_DB = process.env.NOTION_AGENT_REGISTRY_DB || "";
const HANDSHAKES_DB = process.env.NOTION_HANDSHAKES_DB || "";
const INBOX_DB = process.env.NOTION_INBOX_DB || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const DRIFT_SNAPSHOT_PATH = path.join(PROJECT_ROOT, "memory", "notion-drift-snapshot.json");

if (!NOTION_TOKEN || !HEARTBEAT_SNAPSHOTS_DB) {
  const missing = [
    !NOTION_TOKEN && "NOTION_TOKEN_OPENCLAW_2",
    !HEARTBEAT_SNAPSHOTS_DB && "NOTION_HEARTBEAT_SNAPSHOTS_DB",
  ]
    .filter(Boolean)
    .join(", ");
  console.error(`❌ Missing env vars: ${missing}. Run seed-notion.ts first.`);
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotionRow {
  id: string;
  last_edited_time: string;
  /** Flattened plain-text representation of key properties for diff display */
  snapshot: Record<string, string>;
}

interface DriftSnapshot {
  lastPushedAt: string;
  agentRegistry: Record<string, NotionRow>;
  handshakes: Record<string, NotionRow>;
}

interface DriftEvent {
  db: "Agent Registry" | "Bot Handshakes";
  rowId: string;
  rowName: string;
  oldSnapshot: Record<string, string> | null;
  newSnapshot: Record<string, string>;
  editedAt: string;
  reason: "new_row" | "edited_row" | "deleted_row";
}

// ─── Notion helpers ───────────────────────────────────────────────────────────

async function notionRequest<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion ${method} ${endpoint} failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function notionQueryDatabase(databaseId: string): Promise<NotionRow[]> {
  const rows: NotionRow[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) {
      body.start_cursor = cursor;
    }

    const data = await notionRequest<{
      results: Array<{
        id: string;
        last_edited_time: string;
        properties: Record<string, unknown>;
      }>;
      has_more: boolean;
      next_cursor?: string;
    }>("POST", `/databases/${databaseId}/query`, body);

    for (const page of data.results) {
      rows.push({
        id: page.id,
        last_edited_time: page.last_edited_time,
        snapshot: flattenProperties(page.properties),
      });
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return rows;
}

/** Extract plain-text values from Notion property objects for diff display */
function flattenProperties(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(props)) {
    const p = val as Record<string, unknown>;
    try {
      if (p.type === "title") {
        out[key] = ((p.title as Array<{ plain_text: string }>) ?? [])
          .map((t) => t.plain_text)
          .join("");
      } else if (p.type === "rich_text") {
        out[key] = ((p.rich_text as Array<{ plain_text: string }>) ?? [])
          .map((t) => t.plain_text)
          .join("")
          .slice(0, 200);
      } else if (p.type === "select") {
        out[key] = (p.select as { name?: string } | null)?.name ?? "";
      } else if (p.type === "status") {
        out[key] = (p.status as { name?: string } | null)?.name ?? "";
      } else if (p.type === "multi_select") {
        out[key] = ((p.multi_select as Array<{ name: string }>) ?? [])
          .map((t) => t.name)
          .join(", ");
      } else if (p.type === "checkbox") {
        out[key] = String(p.checkbox ?? false);
      } else if (p.type === "number") {
        out[key] = String(p.number ?? "");
      } else if (p.type === "url") {
        out[key] = String(p.url ?? "");
      }
    } catch {
      // skip unreadable properties
    }
  }
  return out;
}

async function notionInsertRow(
  databaseId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await notionRequest("POST", "/pages", {
    parent: { type: "database_id", database_id: databaseId },
    properties,
  });
}

// ─── Drift snapshot ───────────────────────────────────────────────────────────

async function loadDriftSnapshot(): Promise<DriftSnapshot | null> {
  try {
    const raw = await fs.readFile(DRIFT_SNAPSHOT_PATH, "utf8");
    return JSON.parse(raw) as DriftSnapshot;
  } catch {
    return null;
  }
}

async function saveDriftSnapshot(snapshot: DriftSnapshot): Promise<void> {
  await fs.writeFile(DRIFT_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
}

function rowsToMap(rows: NotionRow[]): Record<string, NotionRow> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

// ─── Drift detection ──────────────────────────────────────────────────────────

function detectDriftEvents(
  db: "Agent Registry" | "Bot Handshakes",
  previousMap: Record<string, NotionRow>,
  currentRows: NotionRow[],
  lastPushedAt: string,
): DriftEvent[] {
  const events: DriftEvent[] = [];
  const lastPushTime = new Date(lastPushedAt).getTime();

  for (const row of currentRows) {
    const editedTime = new Date(row.last_edited_time).getTime();
    const prev = previousMap[row.id];
    const rowName = row.snapshot["Name"] || row.snapshot["name"] || row.id.slice(0, 8);

    if (!prev) {
      // New row appeared after last push — likely manual creation
      if (editedTime > lastPushTime) {
        events.push({
          db,
          rowId: row.id,
          rowName,
          oldSnapshot: null,
          newSnapshot: row.snapshot,
          editedAt: row.last_edited_time,
          reason: "new_row",
        });
      }
    } else if (editedTime > lastPushTime) {
      // Row was edited after our last push — check if content actually changed
      const changed = Object.keys({ ...prev.snapshot, ...row.snapshot }).some(
        (k) => prev.snapshot[k] !== row.snapshot[k],
      );
      if (changed) {
        events.push({
          db,
          rowId: row.id,
          rowName,
          oldSnapshot: prev.snapshot,
          newSnapshot: row.snapshot,
          editedAt: row.last_edited_time,
          reason: "edited_row",
        });
      }
    }
  }

  // Detect deletions
  const currentIds = new Set(currentRows.map((r) => r.id));
  for (const [id, prev] of Object.entries(previousMap)) {
    if (!currentIds.has(id)) {
      const rowName = prev.snapshot["Name"] || id.slice(0, 8);
      events.push({
        db,
        rowId: id,
        rowName,
        oldSnapshot: prev.snapshot,
        newSnapshot: {},
        editedAt: new Date().toISOString(),
        reason: "deleted_row",
      });
    }
  }

  return events;
}

function formatDiff(event: DriftEvent): string {
  const lines: string[] = [];
  lines.push(`DB: ${event.db}`);
  lines.push(`Row: ${event.rowName} (${event.rowId.slice(0, 8)})`);
  lines.push(`Type: ${event.reason} — edited at ${event.editedAt}`);
  lines.push("");

  if (event.reason === "new_row") {
    lines.push("New row values:");
    for (const [k, v] of Object.entries(event.newSnapshot)) {
      if (v) {
        lines.push(`  + ${k}: ${v}`);
      }
    }
  } else if (event.reason === "deleted_row") {
    lines.push("Row was deleted. Previous values:");
    for (const [k, v] of Object.entries(event.oldSnapshot ?? {})) {
      if (v) {
        lines.push(`  - ${k}: ${v}`);
      }
    }
  } else {
    lines.push("Changed fields:");
    const allKeys = new Set([
      ...Object.keys(event.oldSnapshot ?? {}),
      ...Object.keys(event.newSnapshot),
    ]);
    for (const k of allKeys) {
      const before = event.oldSnapshot?.[k] ?? "";
      const after = event.newSnapshot[k] ?? "";
      if (before !== after) {
        lines.push(`  ${k}:`);
        lines.push(`    before: ${before || "(empty)"}`);
        lines.push(`    after:  ${after || "(empty)"}`);
      }
    }
  }

  return lines.join("\n");
}

// ─── HITL Inbox item ──────────────────────────────────────────────────────────

async function createHitlInboxItem(event: DriftEvent): Promise<void> {
  if (!INBOX_DB) {
    console.warn("⚠️  NOTION_INBOX_DB not set — skipping HITL item creation");
    return;
  }

  const reasonLabel =
    event.reason === "new_row"
      ? "new row created"
      : event.reason === "deleted_row"
        ? "row deleted"
        : "row edited";

  const title = `🔍 Drift: ${event.db} — "${event.rowName}" ${reasonLabel}`;
  const diff = formatDiff(event);
  const nextAction =
    "Reply YES to sync this change upstream to Supabase/memory. Reply NO to let Tulsbot overwrite on next push.";

  await notionInsertRow(INBOX_DB, {
    Item: { title: [{ type: "text", text: { content: title.slice(0, 2000) } }] },
    "HITL?": { checkbox: true },
    Type: { select: { name: "Task" } },
    Priority: { select: { name: "High" } },
    "Status lane": { select: { name: "Next" } },
    Owner: { select: { name: "Tulio" } },
    Notes: { rich_text: [{ type: "text", text: { content: diff.slice(0, 2000) } }] },
    "Next action": {
      rich_text: [{ type: "text", text: { content: nextAction } }],
    },
  });

  console.log(`   📬 HITL item created: ${title}`);
}

// ─── Data readers (local memory only — never reads Notion for state) ──────────

interface HeartbeatState {
  lastRun?: string;
  tasks?: Record<string, { status: string; details?: string }>;
  summary?: string;
}

async function readHeartbeatState(): Promise<HeartbeatState> {
  try {
    const raw = await fs.readFile(
      path.join(PROJECT_ROOT, "memory", "heartbeat-state.json"),
      "utf8",
    );
    return JSON.parse(raw) as HeartbeatState;
  } catch {
    return {};
  }
}

interface StateInfo {
  active: boolean;
  mode: string;
  workspace: string;
  blockers: string;
}

async function readStateFile(): Promise<StateInfo> {
  try {
    const raw = await fs.readFile(path.join(PROJECT_ROOT, "STATE.md"), "utf8");
    const active = /\*\*Active:\*\*\s*yes/i.test(raw);
    const modeMatch = raw.match(/\*\*Mode:\*\*\s*(.+)/);
    const wsMatch = raw.match(/\*\*Workspace:\*\*\s*(.+)/);
    const blockersMatch = raw.match(/## Blockers\s+([\s\S]*?)(?=\n##|$)/);
    const blockers = blockersMatch?.[1]?.trim().slice(0, 500) || "none";
    return {
      active,
      mode: modeMatch?.[1]?.trim() || "none",
      workspace: wsMatch?.[1]?.trim() || "unknown",
      blockers: blockers || "none",
    };
  } catch {
    return { active: false, mode: "unknown", workspace: "unknown", blockers: "unknown" };
  }
}

async function getMasterIndexCount(): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return -1;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/master_index?select=id`, {
      method: "HEAD",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "count=exact",
      },
    });
    const count = res.headers.get("content-range");
    if (count) {
      const match = count.match(/\/(\d+)$/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return -1;
  } catch {
    return -1;
  }
}

function deriveStatus(tasks: Record<string, { status: string }>): "ok" | "degraded" | "failed" {
  const statuses = Object.values(tasks).map((t) => t.status.toUpperCase());
  const failCount = statuses.filter((s) => s === "FAILED" || s === "ERROR").length;
  if (failCount === 0) {
    return "ok";
  }
  if (failCount < statuses.length) {
    return "degraded";
  }
  return "failed";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📡 push-status-to-notion: starting...");

  // ── Step 1: Drift detection (before push, only if DBs are configured) ──────
  let driftEvents: DriftEvent[] = [];
  let currentRegistryRows: NotionRow[] = [];
  let currentHandshakeRows: NotionRow[] = [];

  if (AGENT_REGISTRY_DB && HANDSHAKES_DB) {
    console.log("🔍 Checking for manual Notion edits (drift detection)...");
    try {
      const [prevSnapshot, registryRows, handshakeRows] = await Promise.all([
        loadDriftSnapshot(),
        notionQueryDatabase(AGENT_REGISTRY_DB),
        notionQueryDatabase(HANDSHAKES_DB),
      ]);

      currentRegistryRows = registryRows;
      currentHandshakeRows = handshakeRows;

      if (prevSnapshot) {
        const registryEvents = detectDriftEvents(
          "Agent Registry",
          prevSnapshot.agentRegistry,
          registryRows,
          prevSnapshot.lastPushedAt,
        );
        const handshakeEvents = detectDriftEvents(
          "Bot Handshakes",
          prevSnapshot.handshakes,
          handshakeRows,
          prevSnapshot.lastPushedAt,
        );
        driftEvents = [...registryEvents, ...handshakeEvents];

        if (driftEvents.length > 0) {
          console.log(`⚠️  ${driftEvents.length} manual edit(s) detected — creating HITL items...`);
          for (const event of driftEvents) {
            await createHitlInboxItem(event);
          }
        } else {
          console.log("✅ No drift detected.");
        }
      } else {
        console.log("ℹ️  No previous snapshot found — first run, skipping drift check.");
      }
    } catch (err) {
      // Drift detection is non-fatal
      console.warn("⚠️  Drift detection failed (non-fatal):", (err as Error).message);
    }
  }

  // ── Step 2: Push heartbeat snapshot ──────────────────────────────────────
  console.log("📊 Reading local memory files...");
  const [heartbeat, stateInfo, masterIndexCount] = await Promise.all([
    readHeartbeatState(),
    readStateFile(),
    getMasterIndexCount(),
  ]);

  const tasks = heartbeat.tasks ?? {};
  const status = Object.keys(tasks).length > 0 ? deriveStatus(tasks) : "degraded";
  const runTimestamp = heartbeat.lastRun ?? new Date().toISOString();
  const shiftLabel = stateInfo.active
    ? `${stateInfo.mode} | ${stateInfo.workspace}`
    : `idle | ${stateInfo.workspace}`;

  const memSyncStep = tasks["sync-memory-cloud-bidirectional"] ?? tasks["memorySync"] ?? null;
  const memorySyncDetail = memSyncStep
    ? `${memSyncStep.status}: ${memSyncStep.details ?? ""}`
    : "not run";

  const stepsJsonStr = JSON.stringify(tasks).slice(0, 2000);
  const rawHeartbeat = heartbeat.summary ?? `${Object.keys(tasks).length} steps`;

  await notionInsertRow(HEARTBEAT_SNAPSHOTS_DB, {
    Run: { title: [{ type: "text", text: { content: runTimestamp } }] },
    Status: { select: { name: status } },
    Shift: { rich_text: [{ type: "text", text: { content: shiftLabel.slice(0, 2000) } }] },
    Blockers: {
      rich_text: [{ type: "text", text: { content: stateInfo.blockers.slice(0, 2000) } }],
    },
    "Memory Sync": {
      rich_text: [{ type: "text", text: { content: memorySyncDetail.slice(0, 2000) } }],
    },
    "Master Index Count": {
      number: masterIndexCount >= 0 ? masterIndexCount : null,
    },
    "Steps JSON": {
      rich_text: [{ type: "text", text: { content: stepsJsonStr } }],
    },
    "Raw Heartbeat": {
      rich_text: [{ type: "text", text: { content: rawHeartbeat.slice(0, 2000) } }],
    },
  });

  console.log(`✅ Heartbeat snapshot pushed → DB ${HEARTBEAT_SNAPSHOTS_DB}`);
  console.log(`   Run: ${runTimestamp}  Status: ${status}  Master Index: ${masterIndexCount}`);

  // ── Step 3: Save updated drift snapshot ───────────────────────────────────
  if (AGENT_REGISTRY_DB && HANDSHAKES_DB) {
    try {
      const newSnapshot: DriftSnapshot = {
        lastPushedAt: new Date().toISOString(),
        agentRegistry: rowsToMap(currentRegistryRows),
        handshakes: rowsToMap(currentHandshakeRows),
      };
      await saveDriftSnapshot(newSnapshot);
      console.log(`💾 Drift snapshot saved → ${path.relative(PROJECT_ROOT, DRIFT_SNAPSHOT_PATH)}`);
    } catch (err) {
      console.warn("⚠️  Failed to save drift snapshot (non-fatal):", (err as Error).message);
    }
  }

  if (driftEvents.length > 0) {
    console.log(`\n📬 ${driftEvents.length} HITL item(s) created in Notion Inbox for your review.`);
  }
}

main().catch((err) => {
  // Non-fatal — heartbeat continues even if Notion push fails
  console.error("⚠️  push-status-to-notion failed (non-fatal):", err.message);
  process.exit(0);
});
