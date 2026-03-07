#!/usr/bin/env tsx

/**
 * Shift Manager - Tulsbot 12-Hour Shift System
 *
 * Manages shift lifecycle for Tulsbot:
 * - Starts/ends shifts (Builder/Tulsday modes)
 * - Processes context at shift start
 * - Syncs to cloud/Supabase before fresh start
 * - Updates Notion Shift Planner
 * - Handles flexible duration (extend/shorten)
 *
 * Usage:
 *   bun scripts/shift-manager.ts start           # Start a new shift
 *   bun scripts/shift-manager.ts end             # End current shift
 *   bun scripts/shift-manager.ts status          # Show current shift status
 *   bun scripts/shift-manager.ts extend <hours>  # Extend shift
 *   bun scripts/shift-manager.ts shorten <hours> # Shorten shift
 *   bun scripts/shift-manager.ts handoff         # Manual handoff
 */

import { config as loadEnv } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
loadEnv({ path: path.join(PROJECT_ROOT, ".env") });

const MEMORY_DIR = path.join(PROJECT_ROOT, "memory");
const SHIFT_CONFIG_PATH = path.join(MEMORY_DIR, "shift-config.json");
const STATE_PATH = path.join(MEMORY_DIR, "tulsday-state.json");
const STATE_MD_PATH = path.join(PROJECT_ROOT, "STATE.md");

interface ShiftConfig {
  defaultDurationHours: number;
  shiftSchedule: {
    dayShift: { name: string; startHour: number; endHour: number; timezone: string };
    nightShift: { name: string; startHour: number; endHour: number; timezone: string };
  };
  modes: {
    builder: { description: string; autoStart: boolean; priority: string };
    tulsday: { description: string; autoStart: boolean; priority: string };
  };
  syncSettings: {
    beforeShiftStart: boolean;
    afterShiftEnd: boolean;
    syncToSupabase: boolean;
    updateNotionPlanner: boolean;
  };
  handoffSettings: {
    includeContextSummary: boolean;
    includeActiveThreads: boolean;
    includeBlockers: boolean;
    includeNextPriorities: boolean;
  };
}

interface ShiftState {
  currentShift: {
    id: string | null;
    mode: "builder" | "tulsday" | null;
    startedAt: string | null;
    endsAt: string | null;
    durationHours: number;
  };
  shortTermMemory: {
    currentFocus: string | null;
    activeThreads: string[];
    blockers: string[];
    recentChanges: string[];
    pendingDecisions: string[];
  };
  handoff: {
    previousShiftSummary: string | null;
    contextChanges: string[];
    accomplishments: string[];
    nextPriorities: string[];
    handedOverAt: string | null;
  };
  sync: {
    lastContextSync: string | null;
    lastCloudSync: string | null;
    lastNotionUpdate: string | null;
  };
}

/**
 * Load shift configuration
 */
async function loadConfig(): Promise<ShiftConfig> {
  const content = await fs.readFile(SHIFT_CONFIG_PATH, "utf-8");
  return JSON.parse(content);
}

/**
 * Load current state
 */
async function loadState(): Promise<ShiftState> {
  try {
    const content = await fs.readFile(STATE_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    // Return default state if file doesn't exist
    return {
      currentShift: { id: null, mode: null, startedAt: null, endsAt: null, durationHours: 12 },
      shortTermMemory: {
        currentFocus: null,
        activeThreads: [],
        blockers: [],
        recentChanges: [],
        pendingDecisions: [],
      },
      handoff: {
        previousShiftSummary: null,
        contextChanges: [],
        accomplishments: [],
        nextPriorities: [],
        handedOverAt: null,
      },
      sync: { lastContextSync: null, lastCloudSync: null, lastNotionUpdate: null },
    };
  }
}

/**
 * Save state
 */
async function saveState(state: ShiftState): Promise<void> {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Update the Shift section of STATE.md so it stays in sync with tulsday-state.json.
 * STATE.md is the authoritative file that sync-tulsday-state.ts reads from.
 */
async function updateStateMdShift(shift: ShiftState["currentShift"]): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(STATE_MD_PATH, "utf-8");
  } catch {
    return;
  }

  const now = new Date();
  const brt = now.toLocaleString("en-GB", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const shiftBlock = shift.id
    ? [
        `- **Active:** yes`,
        `- **Mode:** ${shift.mode}`,
        `- **Started:** ${new Date(shift.startedAt!).toLocaleString("en-GB", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} BRT`,
        `- **Ends:** ${new Date(shift.endsAt!).toLocaleString("en-GB", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} BRT`,
      ].join("\n")
    : [`- **Active:** no`, `- **Mode:** none`, `- **Started:** --`, `- **Ends:** --`].join("\n");

  const shiftRegex = /## Shift\n\n[\s\S]*?(?=\n## )/;
  if (shiftRegex.test(content)) {
    content = content.replace(shiftRegex, `## Shift\n\n${shiftBlock}\n`);
  }

  content = content.replace(/Last updated:.*/, `Last updated: ${brt} BRT`);

  await fs.writeFile(STATE_MD_PATH, content);
  console.log("✅ STATE.md shift section updated");
}

/**
 * Generate shift ID
 */
function generateShiftId(): string {
  const now = new Date();
  return `shift-${now.toISOString().slice(0, 10)}-${now.getHours().toString().padStart(2, "0")}`;
}

/**
 * Run cloud sync
 */
async function runCloudSync(): Promise<void> {
  console.log("☁️ Running cloud sync...");
  const syncScript = path.join(PROJECT_ROOT, "scripts", "sync-memory-cloud-bidirectional.ts");

  const result = await execFileNoThrow("npx", ["tsx", syncScript], {
    cwd: PROJECT_ROOT,
    timeout: 120000,
  });

  if (!result.error) {
    console.log("✅ Cloud sync complete");
  } else {
    console.log("⚠️ Cloud sync had issues:", result.stderr || result.stdout);
  }
}

/**
 * Process context window — rebuild context-window.json then sync tulsday state.
 * Replaces the old tulsday-context.ts call (which read wrong fields and always
 * produced empty activePriorities/blockers).
 */
async function processContext(): Promise<void> {
  console.log("📋 Refreshing context window...");
  const cwScript = path.join(PROJECT_ROOT, "scripts", "build-context-window.ts");
  const cwResult = await execFileNoThrow("npx", ["tsx", cwScript], {
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  if (!cwResult.error) {
    console.log("✅ Context window refreshed");
  } else {
    console.log("⚠️ Context window refresh had issues:", cwResult.stderr || cwResult.stdout);
  }

  console.log("🧠 Syncing Tulsday short-term memory...");
  const syncScript = path.join(PROJECT_ROOT, "scripts", "sync-tulsday-state.ts");
  const syncResult = await execFileNoThrow("npx", ["tsx", syncScript, "--quiet"], {
    cwd: PROJECT_ROOT,
    timeout: 30000,
  });
  if (!syncResult.error) {
    console.log("✅ Tulsday short-term memory synced");
  } else {
    console.log("⚠️ Tulsday sync had issues:", syncResult.stderr || syncResult.stdout);
  }
}

/**
 * Write handoff doc and append to CHANGELOG.md at shift end.
 */
async function flushHandoff(state: ShiftState): Promise<void> {
  console.log("📝 Generating rich handoff...");

  // Write session-handoff.md via sync-tulsday-state --handoff
  const syncScript = path.join(PROJECT_ROOT, "scripts", "sync-tulsday-state.ts");
  const syncResult = await execFileNoThrow("npx", ["tsx", syncScript, "--handoff", "--quiet"], {
    cwd: PROJECT_ROOT,
    timeout: 30000,
  });
  if (!syncResult.error) {
    console.log("✅ session-handoff.md written");
  } else {
    console.log("⚠️ Handoff doc had issues:", syncResult.stderr || syncResult.stdout);
  }

  // Save session transcript for recovery on next boot
  const transcriptScript = path.join(PROJECT_ROOT, "scripts", "save-session-transcript.ts");
  const transcriptResult = await execFileNoThrow("npx", ["tsx", transcriptScript, "--quiet"], {
    cwd: PROJECT_ROOT,
    timeout: 15000,
  });
  if (!transcriptResult.error) {
    console.log("✅ Session transcript saved for next boot");
  } else {
    console.log(
      "⚠️ Transcript save had issues:",
      transcriptResult.stderr || transcriptResult.stdout,
    );
  }

  // Append shift summary to CHANGELOG.md
  const changelogPath = path.join(PROJECT_ROOT, "memory", "CHANGELOG.md");
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-GB", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeLabel = now.toLocaleTimeString("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

  const accomplishments =
    state.shortTermMemory.recentChanges.length > 0
      ? state.shortTermMemory.recentChanges
      : state.handoff.accomplishments.filter((a) => a !== "task1" && a !== "done");

  const nextPriorities = state.handoff.nextPriorities.filter((n) => n !== "next1" && n !== "next2");

  const entry = [
    ``,
    `### Shift ended: ${state.currentShift.id || "unknown"} (${timeLabel} BRT)`,
    `- Mode: ${state.currentShift.mode || "unknown"}`,
    `- Focus: ${state.shortTermMemory.currentFocus || "unspecified"}`,
    accomplishments.length > 0
      ? accomplishments.map((a) => `- ✓ ${a}`).join("\n")
      : "- (no changes recorded this shift)",
    nextPriorities.length > 0 ? `- **Next:** ${nextPriorities.join("; ")}` : "",
    ``,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  try {
    const existing = await fs.readFile(changelogPath, "utf-8").catch(() => "");
    // Insert after the first ## date heading or at top
    const firstDateIdx = existing.indexOf("\n## 20");
    const insertAt = firstDateIdx === -1 ? existing.length : firstDateIdx + 1;
    const updated =
      existing.slice(0, insertAt) + `\n## ${dateLabel}\n` + entry + existing.slice(insertAt);
    await fs.writeFile(changelogPath, updated);
    console.log("✅ CHANGELOG.md updated");
  } catch {
    console.log("⚠️ Could not update CHANGELOG.md");
  }
}

const NOTION_API_KEY = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN_OPENCLAW_2 || "";
const NOTION_WORKSPACES_DB = "a9acab15-5173-46c6-8a20-792c93320b99";
const NOTION_INBOX_DB = "ea9460ca-200d-494d-b3da-ba51f07a67d3";
const NOTION_OPS_PAGE_ID = process.env.NOTION_DOC_WIKI_PAGE_ID || "";

async function notionFetch(endpoint: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  return res.json();
}

async function notionPatch(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  return res.json();
}

async function getActiveWorkspace(): Promise<{ id: string; name: string } | null> {
  const result = (await notionFetch(`/databases/${NOTION_WORKSPACES_DB}/query`, {
    filter: { property: "Active", checkbox: { equals: true } },
    page_size: 1,
  })) as {
    results: Array<{
      id: string;
      properties: { Workspace: { title: Array<{ plain_text: string }> } };
    }>;
  };

  if (result.results.length === 0) {
    return null;
  }
  const page = result.results[0];
  const name = page.properties.Workspace?.title?.[0]?.plain_text || "Unknown";
  return { id: page.id, name };
}

/**
 * Update Notion Shift Planner — creates/updates an Inbox item for the shift
 */
async function updateNotionPlanner(
  shift: ShiftState["currentShift"],
  action: "start" | "end",
): Promise<void> {
  console.log(`📝 Updating Notion Shift Planner (${action})...`);

  if (!NOTION_API_KEY) {
    console.log("⚠️ No Notion API key configured, skipping update");
    return;
  }

  try {
    if (action === "start" && shift.id) {
      const workspace = await getActiveWorkspace();
      const relations = workspace ? [{ id: workspace.id }] : [];

      await notionFetch(`/pages`, {
        parent: { database_id: NOTION_INBOX_DB },
        properties: {
          Item: { title: [{ text: { content: `Shift: ${shift.mode} — ${shift.id}` } }] },
          "Status lane": { select: { name: "Doing" } },
          Type: { select: { name: "deep_work" } },
          Priority: { select: { name: "Do-it-now" } },
          Owner: { select: { name: "Tulio" } },
          "Next action": {
            rich_text: [
              {
                text: {
                  content: `${shift.mode === "builder" ? "Coding & automation" : "Context management & triage"} until ${shift.endsAt ? new Date(shift.endsAt).toLocaleTimeString() : "TBD"}`,
                },
              },
            ],
          },
          ...(relations.length > 0 ? { Workspace: { relation: relations } } : {}),
        },
      });
      console.log("✅ Notion shift entry created");
    } else if (action === "end") {
      const result = (await notionFetch(`/databases/${NOTION_INBOX_DB}/query`, {
        filter: {
          and: [
            { property: "Item", title: { starts_with: "Shift:" } },
            { property: "Status lane", select: { equals: "Doing" } },
          ],
        },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        page_size: 1,
      })) as { results: Array<{ id: string }> };

      if (result.results.length > 0) {
        await notionPatch(`/pages/${result.results[0].id}`, {
          properties: {
            "Status lane": { select: { name: "Backlog" } },
            "Next action": {
              rich_text: [
                { text: { content: `Shift ended at ${new Date().toLocaleTimeString()}` } },
              ],
            },
          },
        });
        console.log("✅ Notion shift entry closed");
      } else {
        console.log("ℹ️ No active shift entry found in Notion to close");
      }
    }
  } catch (err) {
    console.log(`⚠️ Notion update failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Push a shift report page to Notion under the Operations root page.
 * Called during endShift() — all data comes from the ShiftState object.
 */
async function pushShiftReportToNotion(state: ShiftState, endedAt: Date): Promise<void> {
  if (!NOTION_API_KEY || !NOTION_OPS_PAGE_ID) {
    console.log("⚠️ Notion API key or Operations page ID not configured, skipping shift report");
    return;
  }

  const shift = state.currentShift;
  if (!shift.id || !shift.mode || !shift.startedAt) {
    return;
  }

  const startedAt = new Date(shift.startedAt);
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(1);

  const focus = state.shortTermMemory.currentFocus || "unspecified";
  const accomplishments =
    state.shortTermMemory.recentChanges.length > 0
      ? state.shortTermMemory.recentChanges
      : state.handoff.accomplishments.filter((a) => a !== "task1" && a !== "done");
  const blockers = state.shortTermMemory.blockers;
  const nextPriorities = state.handoff.nextPriorities.filter((n) => n !== "next1" && n !== "next2");

  const formatBrt = (d: Date) =>
    d.toLocaleString("en-GB", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const title = `Shift Report: ${shift.mode} — ${shift.id}`;

  const blocks: Record<string, unknown>[] = [
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Summary" } }] },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content: [
                `Mode: ${shift.mode}`,
                `Duration: ${durationHours}h`,
                `Started: ${formatBrt(startedAt)} BRT`,
                `Ended: ${formatBrt(endedAt)} BRT`,
                `Focus: ${focus}`,
              ].join("\n"),
            },
          },
        ],
      },
    },
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Accomplishments" } }] },
    },
  ];

  if (accomplishments.length > 0) {
    for (const item of accomplishments) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: item } }] },
      });
    }
  } else {
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: "(no changes recorded this shift)" } }],
      },
    });
  }

  if (blockers.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Blockers" } }] },
    });
    for (const item of blockers) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: item } }] },
      });
    }
  }

  if (nextPriorities.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Next Priorities" } }] },
    });
    for (const item of nextPriorities) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: item } }] },
      });
    }
  }

  try {
    await notionFetch("/pages", {
      parent: { page_id: NOTION_OPS_PAGE_ID },
      properties: {
        title: { title: [{ type: "text", text: { content: title } }] },
      },
      children: blocks,
    });
    console.log("✅ Notion shift report page created");
  } catch (err) {
    console.log(
      `⚠️ Notion shift report failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Start a new shift
 */
async function startShift(mode: "builder" | "tulsday", customDuration?: number): Promise<void> {
  const config = await loadConfig();
  const state = await loadState();

  // End previous shift if exists
  if (state.currentShift.id) {
    console.log("⚠️ Ending previous shift before starting new one...");
    await endShift("auto");
  }

  const now = new Date();
  const duration = customDuration || config.defaultDurationHours;
  const endsAt = new Date(now.getTime() + duration * 60 * 60 * 1000);

  // Run pre-shift sync
  if (config.syncSettings.beforeShiftStart) {
    await runCloudSync();
    await processContext();
  }

  // Create new shift
  state.currentShift = {
    id: generateShiftId(),
    mode,
    startedAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    durationHours: duration,
  };

  // Load shortTermMemory from the just-synced tulsday-state rather than wiping it.
  // processContext() above already ran sync-tulsday-state.ts which populated the fields.
  const freshState = await loadState();
  state.shortTermMemory =
    freshState.shortTermMemory.currentFocus !== null
      ? freshState.shortTermMemory
      : {
          currentFocus: null,
          activeThreads: [],
          blockers: [],
          recentChanges: [],
          pendingDecisions: [],
        };

  await saveState(state);

  // Update Notion
  if (config.syncSettings.updateNotionPlanner) {
    await updateNotionPlanner(state.currentShift, "start");
    state.sync.lastNotionUpdate = new Date().toISOString();
    await saveState(state);
  }

  await updateStateMdShift(state.currentShift);

  console.log(`\n🎯 Shift started: ${mode.toUpperCase()}`);
  console.log(`   ID: ${state.currentShift.id}`);
  console.log(`   Started: ${now.toLocaleString()}`);
  console.log(`   Ends: ${endsAt.toLocaleString()}`);
  console.log(`   Duration: ${duration} hours`);
}

/**
 * End current shift
 */
async function endShift(reason: "manual" | "auto" | "completed" = "manual"): Promise<void> {
  const config = await loadConfig();
  const state = await loadState();

  if (!state.currentShift.id) {
    console.log("ℹ️ No active shift to end");
    return;
  }

  const endedAt = new Date();

  // Sync tulsday state one final time so shortTermMemory is current before handoff
  await processContext();
  const latestState = await loadState();
  state.shortTermMemory = latestState.shortTermMemory;

  // Build handoff from real data (not placeholders)
  const existingHandoff = state.handoff;
  state.handoff = {
    previousShiftSummary: `Shift ${state.currentShift.id} ended at ${endedAt.toISOString()}`,
    contextChanges:
      state.shortTermMemory.recentChanges.length > 0
        ? state.shortTermMemory.recentChanges
        : existingHandoff.contextChanges,
    accomplishments:
      state.shortTermMemory.recentChanges.length > 0
        ? state.shortTermMemory.recentChanges
        : existingHandoff.accomplishments.filter((a) => a !== "task1" && a !== "done"),
    nextPriorities:
      state.shortTermMemory.activeThreads.length > 0
        ? state.shortTermMemory.activeThreads.slice(0, 5)
        : existingHandoff.nextPriorities.filter((n) => n !== "next1" && n !== "next2"),
    handedOverAt: endedAt.toISOString(),
  };

  // Write session-handoff.md + CHANGELOG entry
  await flushHandoff(state);

  // Push shift report page to Notion (best-effort)
  await pushShiftReportToNotion(state, endedAt);

  // Run post-shift cloud sync
  if (config.syncSettings.afterShiftEnd) {
    await runCloudSync();
  }

  // Clear current shift
  state.currentShift = {
    id: null,
    mode: null,
    startedAt: null,
    endsAt: null,
    durationHours: config.defaultDurationHours,
  };

  await saveState(state);

  // Update Notion
  if (config.syncSettings.updateNotionPlanner) {
    await updateNotionPlanner(
      { id: null, mode: null, startedAt: null, endsAt: null, durationHours: 0 },
      "end",
    );
    state.sync.lastNotionUpdate = new Date().toISOString();
    await saveState(state);
  }

  await updateStateMdShift(state.currentShift);

  console.log(`\n🛑 Shift ended (${reason})`);
  console.log(`   Ended at: ${endedAt.toLocaleString()}`);
  console.log("📝 Handoff info saved for next shift");
}

/**
 * Show shift status
 */
async function showStatus(): Promise<void> {
  const state = await loadState();
  const config = await loadConfig();

  console.log("\n📊 Tulsbot Shift Status");
  console.log("======================");

  if (state.currentShift.id) {
    const started = new Date(state.currentShift.startedAt!);
    const ends = new Date(state.currentShift.endsAt!);
    const now = new Date();
    const remaining = Math.max(0, ends.getTime() - now.getTime());
    const remainingHours = Math.floor(remaining / (1000 * 60 * 60));
    const remainingMins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    console.log(`\n🎯 Active Shift: ${state.currentShift.mode?.toUpperCase()}`);
    console.log(`   ID: ${state.currentShift.id}`);
    console.log(`   Started: ${started.toLocaleString()}`);
    console.log(`   Ends: ${ends.toLocaleString()}`);
    console.log(`   Remaining: ${remainingHours}h ${remainingMins}m`);

    console.log("\n📋 Short-Term Memory:");
    console.log(`   Current Focus: ${state.shortTermMemory.currentFocus || "None"}`);
    console.log(`   Active Threads: ${state.shortTermMemory.activeThreads.length}`);
    console.log(`   Blockers: ${state.shortTermMemory.blockers.length}`);
    console.log(`   Recent Changes: ${state.shortTermMemory.recentChanges.length}`);
  } else {
    console.log("\nℹ️ No active shift");
    console.log(`   Default duration: ${config.defaultDurationHours} hours`);
  }

  console.log("\n🔄 Sync Status:");
  console.log(`   Last Context Sync: ${state.sync.lastContextSync || "Never"}`);
  console.log(`   Last Cloud Sync: ${state.sync.lastCloudSync || "Never"}`);
  console.log(`   Last Notion Update: ${state.sync.lastNotionUpdate || "Never"}`);
}

/**
 * Extend shift duration
 */
async function extendShift(hours: number): Promise<void> {
  const state = await loadState();

  if (!state.currentShift.id) {
    console.error("❌ No active shift to extend");
    return;
  }

  const currentEnds = new Date(state.currentShift.endsAt!);
  const newEnds = new Date(currentEnds.getTime() + hours * 60 * 60 * 1000);
  state.currentShift.endsAt = newEnds.toISOString();
  state.currentShift.durationHours += hours;

  await saveState(state);

  console.log(`✅ Shift extended by ${hours} hours`);
  console.log(`   New end time: ${newEnds.toLocaleString()}`);
}

/**
 * Shorten shift duration
 */
async function shortenShift(hours: number): Promise<void> {
  const state = await loadState();

  if (!state.currentShift.id) {
    console.error("❌ No active shift to shorten");
    return;
  }

  const currentEnds = new Date(state.currentShift.endsAt!);
  const newEnds = new Date(currentEnds.getTime() - hours * 60 * 60 * 1000);

  if (newEnds <= new Date()) {
    console.error("❌ Cannot shorten shift to a past time");
    return;
  }

  state.currentShift.endsAt = newEnds.toISOString();
  state.currentShift.durationHours -= hours;

  await saveState(state);

  console.log(`✅ Shift shortened by ${hours} hours`);
  console.log(`   New end time: ${newEnds.toLocaleString()}`);
}

/**
 * Manual handoff
 */
async function handoff(accomplishments: string[], nextPriorities: string[]): Promise<void> {
  const state = await loadState();

  state.handoff.accomplishments = accomplishments;
  state.handoff.nextPriorities = nextPriorities;
  state.handoff.handedOverAt = new Date().toISOString();

  await saveState(state);

  console.log("✅ Handoff prepared");
  console.log("   Accomplishments:", accomplishments.join(", "));
  console.log("   Next priorities:", nextPriorities.join(", "));
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "start": {
      const mode = (args[1] as "builder" | "tulsday") || "tulsday";
      const hours = args[2] ? parseInt(args[2], 10) : undefined;
      await startShift(mode, hours);
      break;
    }
    case "end":
      await endShift("manual");
      break;
    case "status":
      await showStatus();
      break;
    case "extend": {
      const hours = parseInt(args[1], 10);
      if (isNaN(hours)) {
        console.error("Usage: shift-manager extend <hours>");
        process.exit(1);
      }
      await extendShift(hours);
      break;
    }
    case "shorten": {
      const hours = parseInt(args[1], 10);
      if (isNaN(hours)) {
        console.error("Usage: shift-manager shorten <hours>");
        process.exit(1);
      }
      await shortenShift(hours);
      break;
    }
    case "handoff": {
      const accomplishments = args[1] ? args[1].split(",") : [];
      const nextPriorities = args[2] ? args[2].split(",") : [];
      await handoff(accomplishments, nextPriorities);
      break;
    }
    default:
      console.log(`
Tulsbot Shift Manager

Usage:
  shift-manager start [mode] [hours]   Start a new shift (mode: builder|tulsday, hours: optional)
  shift-manager end                     End current shift
  shift-manager status                  Show current shift status
  shift-manager extend <hours>          Extend shift duration
  shift-manager shorten <hours>         Shorten shift duration
  shift-manager handoff <acc> <next>    Prepare handoff (comma-separated lists)

Examples:
  shift-manager start tulsday            Start 12-hour Tulsday shift
  shift-manager start builder 8         Start 8-hour Builder shift
  shift-manager extend 2               Extend current shift by 2 hours
  shift-manager handoff "task1,task2" "next1,next2"
`);
      process.exit(command ? 1 : 0);
  }
}

main().catch(console.error);
