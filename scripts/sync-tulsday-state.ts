#!/usr/bin/env tsx
/**
 * sync-tulsday-state.ts — Keep Tulsday's short-term memory sharp and in sync.
 *
 * Runs:
 *   - During every heartbeat cycle (every 60 min)
 *   - At shift start (before shortTermMemory is populated)
 *   - At shift end (before handoff is generated)
 *
 * Sources (in priority order):
 *   1. STATE.md             — structured ops state (authoritative)
 *   2. memory/CHANGELOG.md  — recent completed work
 *   3. reports/context-window.json — last 4h of conversation messages
 *   4. memory/tulsday-processed-context.json — prior processed context (carry-over)
 *
 * Output:
 *   - memory/tulsday-state.json .shortTermMemory (populated, not empty)
 *   - memory/tulsday-processed-context.json (enriched, structured)
 *   - memory/session-handoff.md (rich handoff doc for next session boot)
 *
 * Usage:
 *   npx tsx scripts/sync-tulsday-state.ts [--handoff] [--quiet]
 *
 *   --handoff  Also regenerate session-handoff.md (used at shift end)
 *   --quiet    Suppress non-error output
 */

import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MEMORY_DIR = path.join(ROOT, "memory");
const REPORTS_DIR = path.join(ROOT, "reports");

const STATE_MD = path.join(ROOT, "STATE.md");
const CHANGELOG_MD = path.join(MEMORY_DIR, "CHANGELOG.md");
const CONTEXT_WINDOW_JSON = path.join(REPORTS_DIR, "context-window.json");
const TULSDAY_STATE_JSON = path.join(MEMORY_DIR, "tulsday-state.json");
const PROCESSED_CONTEXT_JSON = path.join(MEMORY_DIR, "tulsday-processed-context.json");
const SESSION_HANDOFF_MD = path.join(MEMORY_DIR, "session-handoff.md");

const args = new Set(process.argv.slice(2));
const WRITE_HANDOFF = args.has("--handoff");
const QUIET = args.has("--quiet");

function log(msg: string) {
  if (!QUIET) {
    console.log(msg);
  }
}

// ─── STATE.md parsers ────────────────────────────────────────────────────────

function parseSectionText(md: string, heading: string): string {
  const lines = md.split("\n");
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) {
    return "";
  }
  const result: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ") || lines[i].startsWith("---")) {
      break;
    }
    result.push(lines[i]);
  }
  return result.join("\n").trim();
}

function parseBulletList(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .filter(
      (l) =>
        l && !l.startsWith("|") && !l.startsWith("#") && l !== "(none currently)" && l !== "(none)",
    );
}

function parseMarkdownTable(section: string): Array<Record<string, string>> {
  const lines = section.split("\n").filter((l) => l.includes("|"));
  if (lines.length < 2) {
    return [];
  }
  const header = lines[0]
    .split("|")
    .map((h) => h.trim())
    .filter(Boolean);
  const rows: Array<Record<string, string>> = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i]
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length === 0) {
      continue;
    }
    const row: Record<string, string> = {};
    header.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function parseOrderedList(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

interface StateSnapshot {
  currentFocus: string;
  activeTasks: Array<{ id: string; task: string; status: string; owner: string }>;
  blockers: string[];
  nextActions: string[];
  health: Record<string, string>;
  lastUpdated: string;
}

function parseStateMd(content: string): StateSnapshot {
  // Try exact match first, then emoji variants
  const focusRaw =
    parseSectionText(content, "## Current Focus") ||
    parseSectionText(content, "## 🎯 Current Focus") ||
    parseSectionText(content, "## 🎯Current Focus");
  const currentFocus =
    focusRaw
      .split("\n")[0]
      ?.replace(/^\*\*.*?\*\*\s*/, "")
      .trim() || "";

  const tasksSection = parseSectionText(content, "## Active Tasks");
  const taskRows = parseMarkdownTable(tasksSection);
  const activeTasks = taskRows.map((r) => ({
    id: r["ID"] || r["id"] || "",
    task: r["Task"] || r["task"] || "",
    status: r["Status"] || r["status"] || "",
    owner: r["Owner"] || r["owner"] || "",
  }));

  const blockersSection = parseSectionText(content, "## Blockers");
  const blockers = parseBulletList(blockersSection);

  const nextSection = parseSectionText(content, "## Next Actions");
  const nextActions = parseOrderedList(nextSection);

  const healthSection = parseSectionText(content, "## Health");
  const healthRows = parseMarkdownTable(healthSection);
  const health: Record<string, string> = {};
  healthRows.forEach((r) => {
    const key = r["System"] || r["system"] || "";
    const val = r["Status"] || r["status"] || "";
    if (key) {
      health[key] = val;
    }
  });

  // Extract last updated
  const updatedMatch = content.match(/Last updated:\s*(.+)/);
  const lastUpdated = updatedMatch?.[1]?.trim() || "";

  return { currentFocus, activeTasks, blockers, nextActions, health, lastUpdated };
}

// ─── CHANGELOG.md parsers ────────────────────────────────────────────────────

function parseRecentChangelog(content: string, maxEntries = 10): string[] {
  const lines = content.split("\n");
  const changes: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("## 20")) {
      if (inSection && changes.length >= maxEntries) {
        break;
      }
      inSection = true;
      continue;
    }
    if (inSection && (line.startsWith("### ") || line.startsWith("- ") || line.startsWith("| "))) {
      if (line.startsWith("- ")) {
        const entry = line.replace(/^-\s+/, "").trim();
        if (entry && changes.length < maxEntries) {
          changes.push(entry);
        }
      }
    }
  }
  return changes;
}

// ─── Context-window.json parsers ────────────────────────────────────────────

interface ContextWindowItem {
  timestamp: string;
  role: string;
  agent: string;
  channel: string;
  text: string;
}

interface ContextWindowJSON {
  generated_at?: string;
  items?: ContextWindowItem[];
}

// Keywords that suggest mentions of specific state types in conversation
const BLOCKER_PATTERNS = [
  /\bblock(ed|er|ing)?\b/i,
  /\bstuck\b/i,
  /\bcannot\b/i,
  /\bfail(ed|ing)?\b/i,
  /\berror\b/i,
  /\bbroken\b/i,
  /\bissue\b/i,
  /\bproblem\b/i,
];
const DECISION_PATTERNS = [
  /\bshould we\b/i,
  /\bshould I\b/i,
  /\bneed to decide\b/i,
  /\bTBD\b/,
  /\bopen question\b/i,
  /\bwaiting on\b/i,
  /\bpending\b/i,
];
const FOCUS_PATTERNS = [
  /\bworking on\b/i,
  /\bcurrently\b/i,
  /\bright now\b/i,
  /\bfocused on\b/i,
  /\bnext step\b/i,
  /\bimplementing\b/i,
  /\bbuilding\b/i,
];

// Patterns that indicate raw model reasoning leaked into message content — strip these
const THINKING_PREFIXES = [
  /^Okay,?\s+(let'?s?|I'?ll|the user|let me)/i,
  /^Alright,?\s/i,
  /^So,?\s+(the user|I need|let me)/i,
  /^First,?\s+(I|let me|the)/i,
  /^Now,?\s+(let me|I need|the)/i,
  /^I should\b/i,
  /^I need to\b/i,
  /^I'?ll\s+(need|check|look|start|try)/i,
  /^Looking at (the|this|that)\b/i,
  /^The user (is|wants|asked|has|said|provided)\b/i,
  /^Let me\b/i,
  /^Wait,?\s/i,
  /^Hmm,?\s/i,
];

function isThinkingLine(text: string): boolean {
  return THINKING_PREFIXES.some((p) => p.test(text.trim()));
}

function stripThinkingPreamble(text: string): string {
  const lines = text.split("\n");
  // Drop leading lines that look like internal reasoning
  let start = 0;
  while (start < lines.length && isThinkingLine(lines[start])) {
    start++;
  }
  return lines.slice(start).join("\n");
}

function extractFromMessages(items: ContextWindowItem[]): {
  recentTopics: string[];
  mentionedBlockers: string[];
  pendingDecisions: string[];
  recentFocus: string;
} {
  const recentItems = items.slice(-40); // last 40 messages
  const recentTopics: string[] = [];
  const mentionedBlockers: string[] = [];
  const pendingDecisions: string[] = [];
  let recentFocus = "";

  for (const item of recentItems) {
    // Strip thinking preamble before processing
    const rawText = item.role === "assistant" ? stripThinkingPreamble(item.text) : item.text;
    const text = rawText.slice(0, 300); // cap each message
    const lines = text.split("\n").filter((l) => l.trim().length > 10);

    for (const line of lines) {
      // Skip lines that are clearly internal reasoning/thinking
      if (isThinkingLine(line)) {
        continue;
      }

      if (BLOCKER_PATTERNS.some((p) => p.test(line))) {
        const clean = line.trim().slice(0, 120);
        if (!mentionedBlockers.includes(clean)) {
          mentionedBlockers.push(clean);
        }
      }
      if (DECISION_PATTERNS.some((p) => p.test(line))) {
        const clean = line.trim().slice(0, 120);
        if (!pendingDecisions.includes(clean)) {
          pendingDecisions.push(clean);
        }
      }
      if (!recentFocus && item.role === "assistant" && FOCUS_PATTERNS.some((p) => p.test(line))) {
        recentFocus = line.trim().slice(0, 120);
      }
    }
  }

  // Extract last 5 unique assistant messages as recent topics
  // Skip messages that are pure reasoning preamble
  const assistantMsgs = recentItems.filter((i) => i.role === "assistant").slice(-5);
  for (const msg of assistantMsgs) {
    const cleaned = stripThinkingPreamble(msg.text);
    const snippet =
      cleaned
        .split("\n")
        .find((l) => l.trim().length > 10)
        ?.trim()
        .slice(0, 100) || "";
    if (snippet && !isThinkingLine(snippet) && !recentTopics.includes(snippet)) {
      recentTopics.push(snippet);
    }
  }

  return {
    recentTopics,
    mentionedBlockers: mentionedBlockers.slice(0, 5),
    pendingDecisions: pendingDecisions.slice(0, 5),
    recentFocus,
  };
}

// ─── Main sync ────────────────────────────────────────────────────────────────

interface ShortTermMemory {
  currentFocus: string | null;
  activeThreads: string[];
  blockers: string[];
  recentChanges: string[];
  pendingDecisions: string[];
}

interface TulsdayState {
  currentShift: {
    id: string | null;
    mode: string | null;
    startedAt: string | null;
    endsAt: string | null;
    durationHours: number;
  };
  shortTermMemory: ShortTermMemory;
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

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function syncTulsdayState(): Promise<ShortTermMemory> {
  log("🧠 sync-tulsday-state: syncing short-term memory...");

  // 1. Parse STATE.md (authoritative source)
  let stateSnapshot: StateSnapshot = {
    currentFocus: "",
    activeTasks: [],
    blockers: [],
    nextActions: [],
    health: {},
    lastUpdated: "",
  };
  if (existsSync(STATE_MD)) {
    const stateMd = readFileSync(STATE_MD, "utf-8");
    stateSnapshot = parseStateMd(stateMd);
    log(`  ✓ STATE.md parsed (focus: "${stateSnapshot.currentFocus}")`);
  }

  // 2. Parse CHANGELOG.md
  let recentChanges: string[] = [];
  if (existsSync(CHANGELOG_MD)) {
    const changelogContent = readFileSync(CHANGELOG_MD, "utf-8");
    recentChanges = parseRecentChangelog(changelogContent, 8);
    log(`  ✓ CHANGELOG.md: ${recentChanges.length} recent entries`);
  }

  // 3. Parse context-window.json
  let contextExtract = {
    recentTopics: [] as string[],
    mentionedBlockers: [] as string[],
    pendingDecisions: [] as string[],
    recentFocus: "",
  };
  const ctxJson = await readJson<ContextWindowJSON>(CONTEXT_WINDOW_JSON);
  if (ctxJson?.items && ctxJson.items.length > 0) {
    contextExtract = extractFromMessages(ctxJson.items);
    log(`  ✓ context-window.json: ${ctxJson.items.length} messages processed`);
  }

  // 4. Merge into shortTermMemory
  // Priority: STATE.md > CHANGELOG > context-window
  const recentFocusSafe =
    contextExtract.recentFocus && !isThinkingLine(contextExtract.recentFocus)
      ? contextExtract.recentFocus
      : null;
  const currentFocus = stateSnapshot.currentFocus || recentFocusSafe || null;

  const activeThreads = [
    ...stateSnapshot.activeTasks
      .filter((t) => t.status !== "done" && t.status !== "completed")
      .map((t) => `[${t.id}] ${t.task} (${t.status})`),
    ...stateSnapshot.nextActions.map((a) => `next: ${a}`),
    ...contextExtract.recentTopics,
  ]
    .filter(Boolean)
    .slice(0, 10);

  // Deduplicate blockers from STATE.md + context
  const blockerSet = new Set([...stateSnapshot.blockers, ...contextExtract.mentionedBlockers]);
  const blockers = [...blockerSet].slice(0, 8);

  const pendingDecisions = [...contextExtract.pendingDecisions].slice(0, 5);

  const shortTermMemory: ShortTermMemory = {
    currentFocus,
    activeThreads,
    blockers,
    recentChanges: recentChanges.slice(0, 8),
    pendingDecisions,
  };

  // 5. Load and update tulsday-state.json
  const existingState = await readJson<TulsdayState>(TULSDAY_STATE_JSON);
  const newState: TulsdayState = {
    currentShift: existingState?.currentShift ?? {
      id: null,
      mode: null,
      startedAt: null,
      endsAt: null,
      durationHours: 12,
    },
    shortTermMemory,
    handoff: existingState?.handoff ?? {
      previousShiftSummary: null,
      contextChanges: [],
      accomplishments: [],
      nextPriorities: [],
      handedOverAt: null,
    },
    sync: {
      lastContextSync: new Date().toISOString(),
      lastCloudSync: existingState?.sync?.lastCloudSync ?? null,
      lastNotionUpdate: existingState?.sync?.lastNotionUpdate ?? null,
    },
  };

  await fs.writeFile(TULSDAY_STATE_JSON, JSON.stringify(newState, null, 2));
  log(`  ✓ tulsday-state.json.shortTermMemory written`);

  // 6. Write enriched tulsday-processed-context.json
  const processedContext = {
    summary: stateSnapshot.currentFocus || "No current focus in STATE.md",
    planVsActual: stateSnapshot.activeTasks.map((t) => `[${t.status}] ${t.task} (${t.id})`),
    changes: recentChanges,
    activePriorities: activeThreads,
    openThreads: stateSnapshot.activeTasks.filter((t) => t.status !== "done").map((t) => t.id),
    blockers,
    nextActions: stateSnapshot.nextActions,
    health: stateSnapshot.health,
    processedAt: new Date().toISOString(),
  };
  await fs.writeFile(PROCESSED_CONTEXT_JSON, JSON.stringify(processedContext, null, 2));
  log(`  ✓ tulsday-processed-context.json written`);

  // 7. Optionally write session-handoff.md
  if (WRITE_HANDOFF) {
    await writeHandoffDoc(shortTermMemory, stateSnapshot, recentChanges);
  }

  log(`✅ sync-tulsday-state complete`);
  log(`   focus: ${currentFocus || "(none)"}`);
  log(
    `   threads: ${activeThreads.length} | blockers: ${blockers.length} | changes: ${recentChanges.length}`,
  );

  return shortTermMemory;
}

// ─── Session handoff doc ─────────────────────────────────────────────────────

async function writeHandoffDoc(
  mem: ShortTermMemory,
  state: StateSnapshot,
  changelog: string[],
): Promise<void> {
  const now = new Date();
  const ts = now.toLocaleString("en-GB", { timeZone: "America/Sao_Paulo" });

  const lines: string[] = [
    `# Session Handoff — ${ts} BRT`,
    "",
    "> Auto-generated by sync-tulsday-state.ts at shift end.",
    "> The next session boots from this document for instant context recovery.",
    "",
    "---",
    "",
    "## Current Focus",
    "",
    mem.currentFocus ? `**${mem.currentFocus}**` : "_No active focus recorded._",
    "",
    "## Active Threads",
    "",
  ];

  if (mem.activeThreads.length === 0) {
    lines.push("_No active threads._");
  } else {
    mem.activeThreads.forEach((t) => lines.push(`- ${t}`));
  }
  lines.push("");

  lines.push("## Blockers");
  lines.push("");
  if (mem.blockers.length === 0) {
    lines.push("_None._");
  } else {
    mem.blockers.forEach((b) => lines.push(`- ⚠️ ${b}`));
  }
  lines.push("");

  lines.push("## Pending Decisions");
  lines.push("");
  if (mem.pendingDecisions.length === 0) {
    lines.push("_None._");
  } else {
    mem.pendingDecisions.forEach((d) => lines.push(`- ❓ ${d}`));
  }
  lines.push("");

  lines.push("## Recent Changes (CHANGELOG)");
  lines.push("");
  if (changelog.length === 0) {
    lines.push("_Nothing recent._");
  } else {
    changelog.slice(0, 6).forEach((c) => lines.push(`- ${c}`));
  }
  lines.push("");

  lines.push("## Next Actions");
  lines.push("");
  if (state.nextActions.length === 0) {
    lines.push("_None specified in STATE.md._");
  } else {
    state.nextActions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  }
  lines.push("");

  lines.push("## Health");
  lines.push("");
  const healthEntries = Object.entries(state.health);
  if (healthEntries.length === 0) {
    lines.push("_No health data._");
  } else {
    healthEntries.forEach(([sys, status]) => {
      const icon = status.toLowerCase().startsWith("ok") ? "✅" : "⚠️";
      lines.push(`- ${icon} **${sys}**: ${status}`);
    });
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`_Generated: ${now.toISOString()}_`);
  lines.push(`_STATE.md last updated: ${state.lastUpdated}_`);

  await fs.writeFile(SESSION_HANDOFF_MD, lines.join("\n"));
  log(`  ✓ session-handoff.md written → ${SESSION_HANDOFF_MD}`);
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

syncTulsdayState().catch((err) => {
  console.error("❌ sync-tulsday-state failed:", err);
  process.exit(1);
});

export { syncTulsdayState };
