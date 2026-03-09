#!/usr/bin/env bun
import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

type State = {
  version: number;
  lineOffsets: Record<string, number>;
  lastRunAt?: string;
  lastError?: string;
};

type TranscriptEvent = {
  ts: string;
  channel: string;
  peerKind: "group" | "direct" | "unknown";
  peerId: string;
  topicId?: string;
  topicName?: string;
  sender?: string;
  senderId?: string;
  role: "user" | "assistant" | "tool" | "unknown";
  text: string;
  sourceFile: string;
  sessionId: string;
  messageId?: string;
};

const HOME = homedir();
const WORKSPACE = process.env.CROSSCHAT_WORKSPACE || "/Users/tulioferro/.openclaw/workspace";
const AGENTS_ROOT = process.env.CROSSCHAT_AGENTS_ROOT || join(HOME, ".openclaw", "agents");
const DATA_DIR = join(WORKSPACE, "data", "cross-chat-awareness");
const LOG_DIR = join(WORKSPACE, "logs", "cross-chat-awareness");
const STATE_PATH = join(DATA_DIR, "state.json");
const INDEX_PATH = join(DATA_DIR, "index.json");
const INCIDENT_LOG = join(WORKSPACE, "reports", "ops", "cross-chat-awareness.log");

const DEFAULT_VAULT = join(
  HOME,
  "Library",
  "Mobile Documents",
  "iCloud~md~obsidian",
  "Documents",
  "tuls-vault",
);
const VAULT_ROOT = process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT;
const VAULT_TRANSCRIPTS = join(VAULT_ROOT, "07_chats", "transcripts");
const VAULT_INDEX = join(VAULT_ROOT, "07_chats", "index", "topics.md");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_TABLE = process.env.CROSSCHAT_SUPABASE_TABLE; // optional (no default)

const POLL_MS = Number(process.env.CROSSCHAT_POLL_MS || 15000);

function ensureDirs() {
  [DATA_DIR, LOG_DIR, join(WORKSPACE, "reports", "ops")].forEach((d) =>
    mkdirSync(d, { recursive: true }),
  );
  if (existsSync(VAULT_ROOT)) {
    mkdirSync(VAULT_TRANSCRIPTS, { recursive: true });
    mkdirSync(join(VAULT_ROOT, "07_chats", "index"), { recursive: true });
  }
}

function loadState(): State {
  if (!existsSync(STATE_PATH)) {
    return { version: 1, lineOffsets: {} };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    return { version: 1, lineOffsets: {} };
  }
}

function saveState(state: State) {
  state.lastRunAt = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "unknown"
  );
}

function parseConversationMetadata(text: string): Partial<TranscriptEvent> {
  const out: Partial<TranscriptEvent> = {};
  const conv = text.match(/Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)```/);
  if (conv) {
    try {
      const j = JSON.parse(conv[1]);
      out.topicId = j.topic_id ? String(j.topic_id) : undefined;
      out.topicName = j.group_subject || undefined;
      out.sender = j.sender || undefined;
      out.peerId = j.conversation_label || undefined;
      out.messageId = j.message_id ? String(j.message_id) : undefined;
    } catch {}
  }
  const sender = text.match(/Sender \(untrusted metadata\):\s*```json\s*([\s\S]*?)```/);
  if (sender) {
    try {
      const j = JSON.parse(sender[1]);
      out.sender = out.sender || j.name || j.label;
      out.senderId = j.id ? String(j.id) : undefined;
    } catch {}
  }
  return out;
}

function listSessionFiles(): string[] {
  const out: string[] = [];
  const agents = existsSync(AGENTS_ROOT) ? readdirSync(AGENTS_ROOT) : [];
  for (const agent of agents) {
    const sessionsDir = join(AGENTS_ROOT, agent, "sessions");
    if (!existsSync(sessionsDir)) {
      continue;
    }
    for (const f of readdirSync(sessionsDir)) {
      if (!f.endsWith(".jsonl")) {
        continue;
      }
      if (f.includes(".deleted.")) {
        continue;
      }
      if (!f.includes("topic-") && !f.includes("telegram")) {
        continue;
      }
      const full = join(sessionsDir, f);
      try {
        if (statSync(full).isFile()) {
          out.push(full);
        }
      } catch {}
    }
  }
  return out;
}

function extractEventsFromLines(file: string, lines: string[]): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  const sessionId = basename(file).replace(/\.jsonl$/, "");
  const isTopic = /topic-([0-9]+)/.exec(sessionId);
  let contextMeta: Partial<TranscriptEvent> = {};

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
    const contents = Array.isArray(row.message.content) ? row.message.content : [];
    const text = contents
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n")
      .trim();

    if (!text) {
      continue;
    }
    const md = parseConversationMetadata(text);
    if (md.topicId || md.topicName || md.peerId || md.sender) {
      contextMeta = { ...contextMeta, ...md };
    }

    const event: TranscriptEvent = {
      ts: row.timestamp || new Date().toISOString(),
      channel: "telegram",
      peerKind: "group",
      peerId: md.peerId || contextMeta.peerId || "unknown",
      topicId: md.topicId || contextMeta.topicId || (isTopic ? isTopic[1] : undefined),
      topicName: md.topicName || contextMeta.topicName,
      sender: md.sender || contextMeta.sender,
      senderId: md.senderId || contextMeta.senderId,
      role,
      text,
      sourceFile: file,
      sessionId,
      messageId: md.messageId,
    };
    events.push(event);
  }
  return events;
}

function appendWorkspaceLog(ev: TranscriptEvent) {
  const day = ev.ts.slice(0, 10);
  const topic = slug(ev.topicName || `topic-${ev.topicId || "unknown"}`);
  const path = join(LOG_DIR, day, `${ev.channel}-${topic}.jsonl`);
  mkdirSync(join(LOG_DIR, day), { recursive: true });
  appendFileSync(path, JSON.stringify(ev) + "\n");
}

function appendVaultTranscript(ev: TranscriptEvent) {
  if (!existsSync(VAULT_ROOT)) {
    return;
  }
  const day = ev.ts.slice(0, 10);
  const topic = slug(ev.topicName || `topic-${ev.topicId || "unknown"}`);
  const path = join(VAULT_TRANSCRIPTS, `${day}-${ev.channel}-${topic}.md`);

  if (!existsSync(path)) {
    const frontmatter = [
      "---",
      `date: ${day}`,
      `channel: ${ev.channel}`,
      `topic_id: ${ev.topicId || "unknown"}`,
      `topic_name: ${ev.topicName || "unknown"}`,
      `source: openclaw-session-transcripts`,
      `append_only: true`,
      "---",
      "",
      `# Transcript ${day} — ${ev.topicName || `topic-${ev.topicId || "unknown"}`}`,
      "",
    ].join("\n");
    appendFileSync(path, frontmatter + "\n");
  }

  const line = `- ${ev.ts} | ${ev.role}${ev.sender ? ` | ${ev.sender}` : ""}: ${ev.text.replace(/\n+/g, " ").slice(0, 4000)}`;
  appendFileSync(path, line + "\n");
}

async function maybeWriteSupabase(events: TranscriptEvent[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_TABLE || events.length === 0) {
    return;
  }
  try {
    const payload = events.map((e) => ({
      ts: e.ts,
      channel: e.channel,
      peer_kind: e.peerKind,
      peer_id: e.peerId,
      topic_id: e.topicId || null,
      topic_name: e.topicName || null,
      sender: e.sender || null,
      sender_id: e.senderId || null,
      role: e.role,
      text: e.text,
      source_file: e.sourceFile,
      session_id: e.sessionId,
      message_id: e.messageId || null,
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
        `${new Date().toISOString()} supabase_write_error ${res.status} ${body.slice(0, 200)}\n`,
      );
    }
  } catch (err: any) {
    appendFileSync(
      INCIDENT_LOG,
      `${new Date().toISOString()} supabase_write_error ${String(err?.message || err)}\n`,
    );
  }
}

function rebuildIndex() {
  const days = existsSync(LOG_DIR) ? readdirSync(LOG_DIR).toSorted() : [];
  const topicMap: Record<string, { files: string[]; lastDay: string }> = {};

  for (const day of days) {
    const dayDir = join(LOG_DIR, day);
    if (!statSync(dayDir).isDirectory()) {
      continue;
    }
    const files = readdirSync(dayDir).filter((f) => f.endsWith(".jsonl"));
    for (const f of files) {
      const key = f.replace(/^telegram-/, "").replace(/\.jsonl$/, "");
      const rel = join(day, f);
      if (!topicMap[key]) {
        topicMap[key] = { files: [], lastDay: day };
      }
      topicMap[key].files.push(rel);
      topicMap[key].lastDay = day;
    }
  }

  writeFileSync(
    INDEX_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), topics: topicMap }, null, 2),
  );

  if (existsSync(VAULT_ROOT)) {
    const lines = [
      "# Chat Topic Index",
      "",
      `Updated: ${new Date().toISOString()}`,
      "",
      "| Topic | Last Day | Files |",
      "|---|---:|---:|",
      ...Object.entries(topicMap)
        .toSorted((a, b) => b[1].lastDay.localeCompare(a[1].lastDay))
        .map(([k, v]) => `| ${k} | ${v.lastDay} | ${v.files.length} |`),
      "",
      "Use `bun scripts/cross-chat-awareness.ts query --topic <name>` for quick lookup.",
    ];
    writeFileSync(VAULT_INDEX, lines.join("\n") + "\n");
  }
}

function runOnce() {
  ensureDirs();
  const state = loadState();
  let newEvents = 0;
  const supabaseBatch: TranscriptEvent[] = [];

  for (const file of listSessionFiles()) {
    const raw = readFileSync(file, "utf8");
    const lines = raw.split("\n");
    const prev = state.lineOffsets[file] || 0;
    if (lines.length <= prev) {
      continue;
    }

    const delta = lines.slice(prev);
    const events = extractEventsFromLines(file, delta);
    for (const ev of events) {
      appendWorkspaceLog(ev);
      appendVaultTranscript(ev);
      supabaseBatch.push(ev);
      newEvents++;
    }
    state.lineOffsets[file] = lines.length;
  }

  saveState(state);
  rebuildIndex();
  void maybeWriteSupabase(supabaseBatch);
  console.log(`[cross-chat-awareness] synced events=${newEvents}`);
}

function doQuery(topic: string, limit = 30) {
  const idx = existsSync(INDEX_PATH)
    ? JSON.parse(readFileSync(INDEX_PATH, "utf8"))
    : { topics: {} };
  const needle = slug(topic);
  const matches = Object.entries<any>(idx.topics || {}).filter(([k]) => k.includes(needle));
  if (matches.length === 0) {
    console.log(`No topics matched '${topic}'.`);
    return;
  }

  const chosen = matches[0];
  const files: string[] = chosen[1].files.slice(-5);
  const rows: any[] = [];
  for (const rel of files) {
    const p = join(LOG_DIR, rel);
    if (!existsSync(p)) {
      continue;
    }
    const lines = readFileSync(p, "utf8").trim().split("\n").slice(-200);
    for (const l of lines) {
      try {
        rows.push(JSON.parse(l));
      } catch {}
    }
  }
  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const recent = rows.slice(-limit);
  console.log(`Topic: ${chosen[0]} (showing ${recent.length})`);
  for (const r of recent) {
    console.log(
      `- ${r.ts} | ${r.role}${r.sender ? ` | ${r.sender}` : ""}: ${String(r.text).replace(/\n+/g, " ").slice(0, 240)}`,
    );
  }
}

function printStatus() {
  ensureDirs();
  const state = loadState();
  const tracked = Object.keys(state.lineOffsets).length;
  const idxExists = existsSync(INDEX_PATH);
  console.log("cross-chat-awareness status");
  console.log(`- state: ${STATE_PATH}`);
  console.log(`- tracked session files: ${tracked}`);
  console.log(`- workspace logs: ${LOG_DIR}`);
  console.log(
    `- obsidian vault: ${existsSync(VAULT_ROOT) ? VAULT_ROOT : "not found (set OBSIDIAN_VAULT_PATH)"}`,
  );
  console.log(`- index: ${idxExists ? INDEX_PATH : "missing"}`);
  console.log(
    `- supabase sink: ${SUPABASE_URL && SUPABASE_TABLE ? `${SUPABASE_TABLE} (enabled)` : "disabled"}`,
  );
  if (state.lastRunAt) {
    console.log(`- last run: ${state.lastRunAt}`);
  }
  if (state.lastError) {
    console.log(`- last error: ${state.lastError}`);
  }
}

async function main() {
  const cmd = process.argv[2] || "once";
  if (cmd === "status") {
    return printStatus();
  }
  if (cmd === "query") {
    const topic = process.argv[4] || process.argv[3] || "general";
    return doQuery(topic);
  }
  if (cmd === "watch") {
    ensureDirs();
    console.log(`[cross-chat-awareness] watch mode poll=${POLL_MS}ms`);
    runOnce();
    setInterval(() => {
      try {
        runOnce();
      } catch (err: any) {
        const state = loadState();
        state.lastError = String(err?.message || err);
        saveState(state);
        appendFileSync(INCIDENT_LOG, `${new Date().toISOString()} sync_error ${state.lastError}\n`);
      }
    }, POLL_MS);
    return;
  }
  runOnce();
}

main().catch((err) => {
  console.error("[cross-chat-awareness] fatal", err);
  process.exit(1);
});
