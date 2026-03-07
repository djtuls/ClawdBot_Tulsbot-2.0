#!/usr/bin/env tsx
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

interface JsonlRecord {
  type: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string; thinking?: string }>;
    timestamp?: string;
  };
}

interface ChannelMeta {
  channel?: string;
  chatId?: string;
  sender?: string;
  messageId?: string;
  [key: string]: unknown;
}

interface ContextEntry {
  timestamp: string;
  timestampLocal: string;
  channel: string;
  sender?: string;
  role?: string;
  agent: string;
  sessionId: string;
  text: string;
}

const DEFAULT_WINDOW_MINUTES = 240; // 4 hours
const DEFAULT_MAX_MESSAGES = 200;
const DEFAULT_TIMEZONE = process.env.CONTEXT_TIMEZONE ?? "America/Sao_Paulo";

const agentRoot = process.env.CONTEXT_AGENT_ROOT ?? path.join(os.homedir(), ".openclaw/agents");
const outputDir = path.resolve(
  process.env.CONTEXT_OUTPUT_DIR ?? path.join(process.cwd(), "reports"),
);
const windowMinutes = Number(process.env.CONTEXT_WINDOW_MINUTES ?? DEFAULT_WINDOW_MINUTES);
const maxMessages = Number(process.env.CONTEXT_WINDOW_LIMIT ?? DEFAULT_MAX_MESSAGES);

const windowStartMs = Date.now() - windowMinutes * 60 * 1000;
const entries: ContextEntry[] = [];

const localFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function flattenContent(
  content?: Array<{ type: string; text?: string; thinking?: string }>,
): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      if (block.type === "thinking" && typeof block.thinking === "string") {
        return `[[thinking]] ${block.thinking}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractMetadata(text: string) {
  const metadataRegex = /Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)```/i;
  const match = text.match(metadataRegex);
  if (!match) {
    return { cleanedText: text.trim(), metadata: undefined };
  }

  let parsed: ChannelMeta | undefined;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    parsed = undefined;
  }

  const cleanedText = text.replace(match[0], "").trim();
  return { cleanedText, metadata: parsed };
}

function normalizeChannel(meta?: ChannelMeta): string {
  if (!meta) {
    return "unknown";
  }
  return (
    (typeof meta.channel === "string" && meta.channel) ||
    (typeof meta.chat_id === "string" && meta.chat_id) ||
    (typeof meta.sender === "string" && meta.sender) ||
    "unknown"
  );
}

function stripAssistantPrefix(text: string): string {
  return text.replace(/^\[\[[^\]]+\]\]/, "").trim();
}

async function processSessionFile(agent: string, filePath: string) {
  const sessionId = path.basename(filePath, ".jsonl");
  const sessionMeta: { channel?: ChannelMeta } = {};

  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    let record: JsonlRecord;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type !== "message") {
      continue;
    }

    const role = record.message?.role;
    if (!role) {
      continue;
    }
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const rawText = flattenContent(record.message?.content ?? []);
    if (!rawText) {
      continue;
    }

    const { cleanedText, metadata } = extractMetadata(rawText);
    if (metadata) {
      sessionMeta.channel = { ...sessionMeta.channel, ...metadata };
    }

    const text = stripAssistantPrefix(cleanedText);
    if (!text) {
      continue;
    }

    const rawMessageTimestamp = record.message?.timestamp ?? record.timestamp;
    let timestampMs: number | undefined;
    if (typeof rawMessageTimestamp === "number") {
      timestampMs = rawMessageTimestamp;
    } else if (typeof rawMessageTimestamp === "string") {
      const parsed = Date.parse(rawMessageTimestamp);
      if (!Number.isNaN(parsed)) {
        timestampMs = parsed;
      }
    }
    if (typeof timestampMs !== "number" || Number.isNaN(timestampMs)) {
      continue;
    }
    if (timestampMs < windowStartMs) {
      continue;
    }

    const entry: ContextEntry = {
      timestamp: new Date(timestampMs).toISOString(),
      timestampLocal: localFormatter.format(timestampMs),
      channel: normalizeChannel(sessionMeta.channel),
      sender: sessionMeta.channel?.sender,
      role,
      agent,
      sessionId,
      text: text.length > 2000 ? `${text.slice(0, 2000)}…` : text,
    };

    entries.push(entry);
  }
}

async function collectEntries() {
  if (!fs.existsSync(agentRoot)) {
    console.warn(`[context-window] Agent root not found at ${agentRoot}`);
    return;
  }

  const agents = fs.readdirSync(agentRoot);
  for (const agent of agents) {
    const sessionsDir = path.join(agentRoot, agent, "sessions");
    if (!fs.existsSync(sessionsDir)) {
      continue;
    }

    const files = fs
      .readdirSync(sessionsDir)
      .filter((file) => file.endsWith(".jsonl") && !file.includes(".deleted"));
    for (const file of files) {
      await processSessionFile(agent, path.join(sessionsDir, file));
    }
  }
}

function summarize(entriesList: ContextEntry[]) {
  const sorted = entriesList.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
  const limited = sorted.slice(-maxMessages);

  const channelCounts: Record<string, number> = {};
  for (const entry of limited) {
    channelCounts[entry.channel] = (channelCounts[entry.channel] ?? 0) + 1;
  }

  const start = limited[0]?.timestamp ?? null;
  const end = limited[limited.length - 1]?.timestamp ?? null;

  return { limited, start, end, channelCounts };
}

function writeOutputs(summary: ReturnType<typeof summarize>) {
  ensureDir(outputDir);

  const jsonPath = path.join(outputDir, "context-window.json");
  const mdPath = path.join(outputDir, "context-window.md");

  const payload = {
    generated_at: new Date().toISOString(),
    window_minutes: windowMinutes,
    max_messages: maxMessages,
    range: { start: summary.start, end: summary.end },
    total_messages: summary.limited.length,
    channel_counts: summary.channelCounts,
    items: summary.limited,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  const lines: string[] = [];
  lines.push("# Tulsbot Context Window");
  lines.push("");
  lines.push(`- Generated at: ${payload.generated_at}`);
  lines.push(`- Window: last ${windowMinutes} minutes`);
  lines.push(`- Messages included: ${payload.total_messages}`);
  lines.push("");
  lines.push("## Channel breakdown");
  const channelEntries = Object.entries(summary.channelCounts);
  if (channelEntries.length === 0) {
    lines.push("- (no recent messages)");
  } else {
    for (const [channel, count] of channelEntries) {
      lines.push(`- ${channel}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Entries");
  lines.push("");

  summary.limited.forEach((entry, idx) => {
    lines.push(`### ${idx + 1}. ${entry.timestampLocal} (${entry.timestamp}) — ${entry.channel}`);
    const senderInfo = entry.sender ? ` • sender: ${entry.sender}` : "";
    lines.push(`- Role: ${entry.role ?? "unknown"}${senderInfo}`);
    lines.push(`- Agent: ${entry.agent} • Session: ${entry.sessionId}`);
    lines.push("");
    lines.push("> " + entry.text.replace(/\n/g, "\n> "));
    lines.push("");
  });

  fs.writeFileSync(mdPath, lines.join("\n"));

  console.log(`[context-window] Updated ${jsonPath} and ${mdPath}`);
}

(async () => {
  await collectEntries();
  const summary = summarize(entries);
  writeOutputs(summary);
})().catch(console.error);
