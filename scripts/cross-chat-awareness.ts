#!/usr/bin/env bun
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

type State = {
  version: number;
  lineOffsets: Record<string, number>;
  seenEventIds: string[];
  lastRunAt?: string;
  lastReconcileAt?: string;
  lastError?: string;
};

type LogEntry = {
  id: string;
  timestamp: string;
  channel: string;
  chatOrTopic: string;
  sender: string;
  senderId?: string;
  direction: "incoming" | "outgoing" | "tool" | "unknown";
  role: "user" | "assistant" | "tool" | "unknown";
  messageText: string;
  mediaReference?: string;
  actionTags: string[];
  projectLinks: string[];
  contactLinks: string[];
  sourceFile: string;
  sessionId: string;
};

const HOME = homedir();
const WORKSPACE = process.env.CROSSCHAT_WORKSPACE || "/Users/tulioferro/.openclaw/workspace";
const AGENTS_ROOT = process.env.CROSSCHAT_AGENTS_ROOT || join(HOME, ".openclaw", "agents");

const DATA_DIR = join(WORKSPACE, "data", "cross-chat-awareness");
const STATE_PATH = join(DATA_DIR, "state.json");
const INDEX_JSON = join(DATA_DIR, "index.json");
const INCIDENT_LOG = join(WORKSPACE, "reports", "ops", "cross-chat-awareness.log");

const LOG_ROOT = join(WORKSPACE, "logs", "cross-chat-awareness");

const DEFAULT_VAULT = join(
  HOME,
  "Library",
  "Mobile Documents",
  "iCloud~md~obsidian",
  "Documents",
  "tuls-vault",
);
const VAULT_ROOT = process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT;
const OBS_ROOT = join(VAULT_ROOT, "03_openclaw", "chat-logs");
const OBS_DAILY = join(OBS_ROOT, "daily");
const OBS_BY_CHANNEL = join(OBS_ROOT, "by-channel");
const OBS_INDEX = join(OBS_ROOT, "index.md");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_TABLE = process.env.CROSSCHAT_SUPABASE_TABLE; // optional

const POLL_MS = Number(process.env.CROSSCHAT_POLL_MS || 15000);

function nowIso() {
  return new Date().toISOString();
}

function slug(v: string): string {
  return (
    v
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "unknown"
  );
}

function ensureDirs() {
  [DATA_DIR, LOG_ROOT, join(WORKSPACE, "reports", "ops")].forEach((d) =>
    mkdirSync(d, { recursive: true }),
  );
  if (existsSync(VAULT_ROOT)) {
    [OBS_ROOT, OBS_DAILY, OBS_BY_CHANNEL].forEach((d) => mkdirSync(d, { recursive: true }));
  }
}

function loadState(): State {
  if (!existsSync(STATE_PATH)) {
    return { version: 2, lineOffsets: {}, seenEventIds: [] };
  }
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
    s.seenEventIds ||= [];
    return s;
  } catch {
    return { version: 2, lineOffsets: {}, seenEventIds: [] };
  }
}

function saveState(state: State) {
  while (state.seenEventIds.length > 50000) {
    state.seenEventIds.shift();
  }
  state.lastRunAt = nowIso();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function listSessionFiles(): string[] {
  const out: string[] = [];
  if (!existsSync(AGENTS_ROOT)) {
    return out;
  }
  for (const agent of readdirSync(AGENTS_ROOT)) {
    const sessions = join(AGENTS_ROOT, agent, "sessions");
    if (!existsSync(sessions)) {
      continue;
    }
    for (const f of readdirSync(sessions)) {
      if (!f.endsWith(".jsonl")) {
        continue;
      }
      if (f.includes(".deleted.")) {
        continue;
      }
      const p = join(sessions, f);
      try {
        if (statSync(p).isFile()) {
          out.push(p);
        }
      } catch {}
    }
  }
  return out;
}

function parseConversationInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = text.match(/Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)```/);
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      if (j.conversation_label) {
        out.conversation_label = String(j.conversation_label);
      }
      if (j.topic_id) {
        out.topic_id = String(j.topic_id);
      }
      if (j.group_subject) {
        out.group_subject = String(j.group_subject);
      }
      if (j.sender) {
        out.sender = String(j.sender);
      }
      if (j.sender_id) {
        out.sender_id = String(j.sender_id);
      }
      if (j.message_id) {
        out.message_id = String(j.message_id);
      }
    } catch {}
  }

  const s = text.match(/Sender \(untrusted metadata\):\s*```json\s*([\s\S]*?)```/);
  if (s) {
    try {
      const j = JSON.parse(s[1]);
      if (!out.sender && (j.name || j.label)) {
        out.sender = String(j.name || j.label);
      }
      if (!out.sender_id && j.id) {
        out.sender_id = String(j.id);
      }
    } catch {}
  }
  return out;
}

function detectChannel(convLabel?: string): string {
  if (!convLabel) {
    return "unknown";
  }
  if (/telegram/i.test(convLabel)) {
    return "telegram";
  }
  if (/discord/i.test(convLabel)) {
    return "discord";
  }
  if (/slack/i.test(convLabel)) {
    return "slack";
  }
  if (/whatsapp/i.test(convLabel)) {
    return "whatsapp";
  }
  return "unknown";
}

function extractActionTags(text: string): string[] {
  const tags = new Set<string>();
  if (/\[\[reply_to/i.test(text)) {
    tags.add("reply-tag");
  }
  if (/HITL|approve|approval/i.test(text)) {
    tags.add("hitl");
  }
  if (/RUNBOOK_[A-Z_]+/.test(text)) {
    tags.add("runbook-status");
  }
  if (/Critical alert|blocker|urgent/i.test(text)) {
    tags.add("alert");
  }
  return [...tags];
}

function extractLinks(text: string): { projectLinks: string[]; contactLinks: string[] } {
  const projectLinks = new Set<string>();
  const contactLinks = new Set<string>();
  for (const m of text.matchAll(/#([A-Za-z0-9._-]{2,})/g)) {
    projectLinks.add(m[1]);
  }
  for (const m of text.matchAll(/@([A-Za-z0-9_]{2,})/g)) {
    contactLinks.add(m[1]);
  }
  return { projectLinks: [...projectLinks], contactLinks: [...contactLinks] };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractEntries(file: string, lines: string[]): LogEntry[] {
  const entries: LogEntry[] = [];
  const sessionId = basename(file, ".jsonl");
  let context: Record<string, string> = {};

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type !== "message" || !row.message) {
      continue;
    }

    const role = row.message.role || "unknown";
    const content = Array.isArray(row.message.content) ? row.message.content : [];

    const textParts = content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text);
    if (textParts.length === 0) {
      continue;
    }
    const rawText = textParts.join("\n");
    const parsed = parseConversationInfo(rawText);
    if (Object.keys(parsed).length) {
      context = { ...context, ...parsed };
    }

    const channel = detectChannel(parsed.conversation_label || context.conversation_label);
    const chatOrTopic =
      parsed.topic_id ||
      context.topic_id ||
      parsed.conversation_label ||
      context.conversation_label ||
      sessionId;
    const sender =
      parsed.sender || context.sender || (role === "assistant" ? "assistant" : "unknown");
    const senderId = parsed.sender_id || context.sender_id;

    const messageText = normalizeText(rawText);
    const mediaReference = content.find((c: any) => c?.type && c.type !== "text")?.type;
    const actionTags = extractActionTags(messageText);
    const { projectLinks, contactLinks } = extractLinks(messageText);

    const id = `${sessionId}:${row.id || row.timestamp || "x"}:${role}`;

    entries.push({
      id,
      timestamp: row.timestamp || nowIso(),
      channel,
      chatOrTopic: String(chatOrTopic),
      sender,
      senderId,
      direction:
        role === "user"
          ? "incoming"
          : role === "assistant"
            ? "outgoing"
            : role === "tool"
              ? "tool"
              : "unknown",
      role,
      messageText,
      mediaReference,
      actionTags,
      projectLinks,
      contactLinks,
      sourceFile: file,
      sessionId,
    });
  }

  return entries;
}

function formatEntryMarkdown(e: LogEntry): string {
  return [
    "",
    "---",
    `- timestamp: ${e.timestamp}`,
    `- channel_chat_topic: ${e.channel} / ${e.chatOrTopic}`,
    `- sender: ${e.sender}${e.senderId ? ` (${e.senderId})` : ""}`,
    `- direction: ${e.direction}`,
    `- role: ${e.role}`,
    `- message_text: ${e.messageText}`,
    `- media_reference: ${e.mediaReference || "none"}`,
    `- action_tags: ${e.actionTags.length ? e.actionTags.join(", ") : "none"}`,
    `- links_project: ${e.projectLinks.length ? e.projectLinks.join(", ") : "none"}`,
    `- links_contact: ${e.contactLinks.length ? e.contactLinks.join(", ") : "none"}`,
  ].join("\n");
}

function ensureFileHeader(path: string, header: string) {
  if (!existsSync(path)) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, header);
  }
}

function appendToWorkspaceLogs(e: LogEntry) {
  const day = e.timestamp.slice(0, 10);
  const p = join(LOG_ROOT, day, `${e.channel}-${slug(e.chatOrTopic)}.jsonl`);
  mkdirSync(join(LOG_ROOT, day), { recursive: true });
  appendFileSync(p, JSON.stringify(e) + "\n");
}

function appendToObsidian(e: LogEntry) {
  if (!existsSync(VAULT_ROOT)) {
    return;
  }
  const day = e.timestamp.slice(0, 10);
  const daily = join(OBS_DAILY, `${day}.md`);
  const byChan = join(OBS_BY_CHANNEL, slug(e.channel), slug(e.chatOrTopic), `${day}.md`);

  ensureFileHeader(daily, `# OpenClaw Chat Logs — ${day}\n\nAppend-only daily transcript.\n`);
  ensureFileHeader(
    byChan,
    `# OpenClaw Chat Logs — ${e.channel}/${e.chatOrTopic} — ${day}\n\nAppend-only channel/topic transcript.\n`,
  );

  const block = formatEntryMarkdown(e) + "\n";
  appendFileSync(daily, block);
  appendFileSync(byChan, block);
}

async function maybeWriteSupabase(entries: LogEntry[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_TABLE || entries.length === 0) {
    return;
  }
  try {
    const payload = entries.map((e) => ({
      id: e.id,
      ts: e.timestamp,
      channel: e.channel,
      chat_topic: e.chatOrTopic,
      sender: e.sender,
      sender_id: e.senderId || null,
      direction: e.direction,
      role: e.role,
      text: e.messageText,
      media_reference: e.mediaReference || null,
      action_tags: e.actionTags,
      project_links: e.projectLinks,
      contact_links: e.contactLinks,
      source_file: e.sourceFile,
      session_id: e.sessionId,
    }));

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      appendFileSync(
        INCIDENT_LOG,
        `${nowIso()} supabase_write_error status=${res.status} ${body.slice(0, 300)}\n`,
      );
    }
  } catch (err: any) {
    appendFileSync(
      INCIDENT_LOG,
      `${nowIso()} supabase_write_error ${String(err?.message || err)}\n`,
    );
  }
}

function rebuildIndex() {
  const byTopic = new Map<
    string,
    { count: number; lastTs: string; channel: string; topic: string }
  >();
  const days = existsSync(LOG_ROOT) ? readdirSync(LOG_ROOT).toSorted() : [];

  for (const d of days) {
    const dayDir = join(LOG_ROOT, d);
    if (!existsSync(dayDir) || !statSync(dayDir).isDirectory()) {
      continue;
    }
    for (const f of readdirSync(dayDir)) {
      if (!f.endsWith(".jsonl")) {
        continue;
      }
      const p = join(dayDir, f);
      const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
      for (const ln of lines) {
        try {
          const e = JSON.parse(ln) as LogEntry;
          const key = `${e.channel}:${e.chatOrTopic}`;
          const cur = byTopic.get(key) || {
            count: 0,
            lastTs: e.timestamp,
            channel: e.channel,
            topic: e.chatOrTopic,
          };
          cur.count += 1;
          if (e.timestamp > cur.lastTs) {
            cur.lastTs = e.timestamp;
          }
          byTopic.set(key, cur);
        } catch {}
      }
    }
  }

  writeFileSync(
    INDEX_JSON,
    JSON.stringify({ updatedAt: nowIso(), topics: [...byTopic.entries()] }, null, 2),
  );

  if (existsSync(VAULT_ROOT)) {
    const lines = [
      "# Chat Logs Index",
      "",
      `Updated: ${nowIso()}`,
      "",
      "| Channel | Chat/Topic | Entries | Last Timestamp |",
      "|---|---|---:|---|",
      ...[...byTopic.values()]
        .toSorted((a, b) => String(b.lastTs || "").localeCompare(String(a.lastTs || "")))
        .map((r) => `| ${r.channel} | ${r.topic} | ${r.count} | ${r.lastTs || "unknown"} |`),
      "",
      "Health check: `bun scripts/cross-chat-awareness.ts status`",
      'Query: `bun scripts/cross-chat-awareness.ts query --topic "General"`',
    ];
    writeFileSync(OBS_INDEX, lines.join("\n") + "\n");
  }
}

function syncIncremental(mode: "live" | "reconcile" = "live") {
  ensureDirs();
  const state = loadState();
  const seen = new Set(state.seenEventIds);
  const supabaseBatch: LogEntry[] = [];
  let appended = 0;

  for (const file of listSessionFiles()) {
    const lines = readFileSync(file, "utf8").split("\n");
    const prev = mode === "reconcile" ? 0 : state.lineOffsets[file] || 0;
    if (lines.length <= prev) {
      state.lineOffsets[file] = lines.length;
      continue;
    }

    const entries = extractEntries(file, lines.slice(prev));
    for (const e of entries) {
      if (seen.has(e.id)) {
        continue;
      }
      seen.add(e.id);
      state.seenEventIds.push(e.id);
      appendToWorkspaceLogs(e);
      appendToObsidian(e);
      supabaseBatch.push(e);
      appended += 1;
    }
    state.lineOffsets[file] = lines.length;
  }

  if (mode === "reconcile") {
    state.lastReconcileAt = nowIso();
  }
  saveState(state);
  rebuildIndex();
  void maybeWriteSupabase(supabaseBatch);
  console.log(`[cross-chat-awareness] mode=${mode} appended=${appended}`);
}

function recentEntries(hours = 24): LogEntry[] {
  const cutoff = Date.now() - hours * 3600_000;
  const out: LogEntry[] = [];
  const days = existsSync(LOG_ROOT) ? readdirSync(LOG_ROOT).toSorted() : [];
  for (const d of days) {
    const dayDir = join(LOG_ROOT, d);
    if (!existsSync(dayDir) || !statSync(dayDir).isDirectory()) {
      continue;
    }
    for (const f of readdirSync(dayDir).filter((x) => x.endsWith(".jsonl"))) {
      const p = join(dayDir, f);
      for (const ln of readFileSync(p, "utf8").split("\n")) {
        if (!ln.trim()) {
          continue;
        }
        try {
          const e = JSON.parse(ln) as LogEntry;
          if (new Date(e.timestamp).getTime() >= cutoff) {
            out.push(e);
          }
        } catch {}
      }
    }
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return out;
}

function generateDailyRecap() {
  const rows = recentEntries(24);
  const day = new Date().toISOString().slice(0, 10);
  const reportDir = join(WORKSPACE, "reports", "daily-chat-recap");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${day}.md`);

  const decisions = rows
    .filter((r) => /approved|agreed|decision|lock(ed)? in|go ahead/i.test(r.messageText))
    .slice(-12);
  const actions = rows
    .filter((r) => /todo|next|action|need to|will do|follow-up/i.test(r.messageText))
    .slice(-12);

  const byTopic = new Map<string, number>();
  rows.forEach((r) =>
    byTopic.set(
      `${r.channel}/${r.chatOrTopic}`,
      (byTopic.get(`${r.channel}/${r.chatOrTopic}`) || 0) + 1,
    ),
  );

  const body = [
    `# Daily Chat Recap — ${day}`,
    "",
    `Generated: ${nowIso()}`,
    `Total logged entries (24h): ${rows.length}`,
    "",
    "## Top active chats/topics",
    ...[...byTopic.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Key decisions",
    ...(decisions.length
      ? decisions.map((d) => `- ${d.timestamp} | ${d.sender}: ${d.messageText.slice(0, 220)}`)
      : ["- none detected"]),
    "",
    "## Key actions",
    ...(actions.length
      ? actions.map((d) => `- ${d.timestamp} | ${d.sender}: ${d.messageText.slice(0, 220)}`)
      : ["- none detected"]),
    "",
    "## Notes",
    "- This recap is derived from append-only chat logs.",
    "- STATE.md was refreshed with a short summary pointer.",
    "",
  ].join("\n");

  writeFileSync(reportPath, body);

  const statePath = join(WORKSPACE, "STATE.md");
  const marker = `\n## Chat Recap Refresh (${day})\n- source: reports/daily-chat-recap/${day}.md\n- entries_24h: ${rows.length}\n- generated_at: ${nowIso()}\n`;
  appendFileSync(statePath, marker);

  console.log(`[cross-chat-awareness] daily recap written ${reportPath}`);
}

function queryTopic(topic: string, limit = 30) {
  const needle = slug(topic);
  const rows = recentEntries(72).filter(
    (r) => slug(r.chatOrTopic).includes(needle) || slug(r.messageText).includes(needle),
  );
  const recent = rows.slice(-limit);
  console.log(`Topic query '${topic}' -> ${recent.length} entries`);
  for (const r of recent) {
    console.log(
      `- ${r.timestamp} | ${r.channel}/${r.chatOrTopic} | ${r.sender}: ${r.messageText.slice(0, 240)}`,
    );
  }
}

function status() {
  ensureDirs();
  const s = loadState();
  console.log("cross-chat-awareness status");
  console.log(`- state: ${STATE_PATH}`);
  console.log(`- tracked session files: ${Object.keys(s.lineOffsets).length}`);
  console.log(`- last live run: ${s.lastRunAt || "never"}`);
  console.log(`- last reconcile: ${s.lastReconcileAt || "never"}`);
  console.log(`- index json: ${existsSync(INDEX_JSON) ? INDEX_JSON : "missing"}`);
  console.log(`- obsidian root: ${existsSync(VAULT_ROOT) ? VAULT_ROOT : "missing"}`);
  console.log(`- obsidian index: ${existsSync(OBS_INDEX) ? OBS_INDEX : "missing"}`);
  console.log(
    `- supabase sink: ${SUPABASE_URL && SUPABASE_TABLE ? `${SUPABASE_TABLE} enabled` : "disabled"}`,
  );
  if (s.lastError) {
    console.log(`- last error: ${s.lastError}`);
  }
}

async function main() {
  const cmd = process.argv[2] || "once";
  if (cmd === "once") {
    return syncIncremental("live");
  }
  if (cmd === "watch") {
    syncIncremental("live");
    console.log(`[cross-chat-awareness] watch poll=${POLL_MS}ms`);
    setInterval(() => {
      try {
        syncIncremental("live");
      } catch (err: any) {
        const s = loadState();
        s.lastError = String(err?.message || err);
        saveState(s);
        appendFileSync(INCIDENT_LOG, `${nowIso()} live_error ${s.lastError}\n`);
      }
    }, POLL_MS);
    return;
  }
  if (cmd === "reconcile") {
    return syncIncremental("reconcile");
  }
  if (cmd === "daily-recap") {
    return generateDailyRecap();
  }
  if (cmd === "query") {
    const topic = process.argv.slice(3).join(" ") || "general";
    return queryTopic(topic);
  }
  if (cmd === "status") {
    return status();
  }

  console.log(
    "Usage: bun scripts/cross-chat-awareness.ts [once|watch|reconcile|daily-recap|query <topic>|status]",
  );
}

main().catch((err) => {
  console.error("[cross-chat-awareness] fatal", err);
  process.exit(1);
});
