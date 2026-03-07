import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const SEEN_PATH = join(WORKSPACE, "data/inbox-seen.json");
const THREAD_INDEX_PATH = join(WORKSPACE, "data/inbox-thread-index.json");
const MESSAGE_INDEX_PATH = join(WORKSPACE, "data/inbox-message-index.json");

let cache: Record<string, { source: string; seenAt: string; meta?: string }> | null = null;
let threadIndex: Record<string, { seenAt: string }> | null = null;
let messageIndex: Record<string, { seenAt: string; threadKey?: string }> | null = null;

function getCache() {
  if (cache) {
    return cache;
  }
  const dir = dirname(SEEN_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (existsSync(SEEN_PATH)) {
    try {
      cache = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
    } catch {
      cache = {};
    }
  } else {
    cache = {};
  }
  return cache!;
}

function saveCache() {
  if (!cache) {
    return;
  }
  const dir = dirname(SEEN_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(SEEN_PATH, JSON.stringify(cache, null, 2));
}

export function hashItem(source: string, id: string): string {
  return createHash("sha256").update(`${source}:${id}`).digest("hex").slice(0, 16);
}

export function isSeen(hash: string): boolean {
  return !!getCache()[hash];
}

export function markSeen(hash: string, source: string, meta?: string): void {
  getCache()[hash] = { source, seenAt: new Date().toISOString(), meta };
  saveCache();
}

function readJsonMap<T>(path: string): Record<string, T> {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function saveJsonMap(path: string, value: Record<string, unknown>) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function getThreadIndex() {
  if (!threadIndex) {
    threadIndex = readJsonMap<{ seenAt: string }>(THREAD_INDEX_PATH);
  }
  return threadIndex;
}

function getMessageIndex() {
  if (!messageIndex) {
    messageIndex = readJsonMap<{ seenAt: string; threadKey?: string }>(MESSAGE_INDEX_PATH);
  }
  return messageIndex;
}

export function buildThreadKey(provider: string, account: string, threadId: string): string {
  return `${provider}:${account}:${threadId}`.toLowerCase().trim();
}

export function buildMessageKey(provider: string, account: string, messageId: string): string {
  return `${provider}:${account}:${messageId}`.toLowerCase().trim();
}

export function registerThreadKey(threadKey: string): { exists: boolean } {
  const db = getThreadIndex();
  const exists = Boolean(db[threadKey]);
  if (!exists) {
    db[threadKey] = { seenAt: new Date().toISOString() };
    saveJsonMap(THREAD_INDEX_PATH, db);
  }
  return { exists };
}

export function registerMessageKey(messageKey: string, threadKey?: string): { exists: boolean } {
  const db = getMessageIndex();
  const exists = Boolean(db[messageKey]);
  if (!exists) {
    db[messageKey] = { seenAt: new Date().toISOString(), threadKey };
    saveJsonMap(MESSAGE_INDEX_PATH, db);
  }
  return { exists };
}
