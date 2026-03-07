import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const SEEN_PATH = join(WORKSPACE, "data/inbox-seen.json");

let cache: Record<string, { source: string; seenAt: string; meta?: string }> | null = null;

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
