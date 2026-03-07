#!/usr/bin/env tsx

/**
 * Session Transcript Recovery
 *
 * Recovers the previous session's transcript for context after a "/new" or "/reset".
 * This ensures continuity even when starting fresh.
 *
 * Usage:
 *   bun scripts/recover-session-transcript.ts [--lines N]
 *
 * Output: JSON with previous session messages
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SESSIONS_DIR = path.join(process.env.HOME || "~", ".openclaw/agents/main/sessions");
const TRANSCRIPT_CACHE = path.join(PROJECT_ROOT, "memory", "last-session-transcript.json");

interface SessionMessage {
  type: string;
  id: string;
  timestamp: string;
  message?: {
    role: string;
    content: Array<{ type: string; text: string }>;
  };
  [key: string]: unknown;
}

interface RecoveryResult {
  previousSessionId: string | null;
  messageCount: number;
  messages: SessionMessage[];
  recoveredAt: string;
}

/**
 * Find the most recent session file (excluding current if provided)
 */
async function findPreviousSession(currentSessionId?: string): Promise<string | null> {
  const files = await fs.readdir(SESSIONS_DIR);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  if (jsonlFiles.length === 0) {
    return null;
  }

  // Get file stats and sort by mtime
  const fileStats = await Promise.all(
    jsonlFiles.map(async (f) => {
      const stats = await fs.stat(path.join(SESSIONS_DIR, f));
      return { name: f, mtime: stats.mtime.getTime() };
    }),
  );

  // Sort by modification time, newest first
  fileStats.sort((a, b) => b.mtime - a.mtime);

  // Find the previous session (skip current if provided)
  for (const file of fileStats) {
    const sessionId = file.name.replace(".jsonl", "");
    if (sessionId !== currentSessionId) {
      return file.name;
    }
  }

  return null;
}

/**
 * Load last N messages from a session file
 */
async function loadRecentMessages(
  sessionFile: string,
  lines: number = 50,
): Promise<SessionMessage[]> {
  const content = await fs.readFile(path.join(SESSIONS_DIR, sessionFile), "utf-8");
  const allLines = content.trim().split("\n");

  // Get last N lines
  const recentLines = allLines.slice(-lines);

  const messages: SessionMessage[] = [];

  for (const line of recentLines) {
    try {
      const entry = JSON.parse(line) as SessionMessage;
      if (entry.type === "message" && entry.message) {
        messages.push(entry);
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return messages;
}

/**
 * Main recovery function
 */
async function recoverSessionTranscript(lines: number = 50): Promise<RecoveryResult> {
  // First, try to load from cached transcript (freshest from last shift end)
  try {
    const cachedContent = await fs.readFile(TRANSCRIPT_CACHE, "utf-8");
    const cached = JSON.parse(cachedContent);

    return {
      previousSessionId: cached.sessionId || "cached",
      messageCount: cached.messageCount || 0,
      messages: cached.messages || [],
      recoveredAt: new Date().toISOString(),
    };
  } catch {
    // No cached transcript, fall back to session file
  }

  const currentSessionId = process.env.OPENCLAW_SESSION_ID;

  const previousSessionFile = await findPreviousSession(currentSessionId || undefined);

  if (!previousSessionFile) {
    return {
      previousSessionId: null,
      messageCount: 0,
      messages: [],
      recoveredAt: new Date().toISOString(),
    };
  }

  const previousSessionId = previousSessionFile.replace(".jsonl", "");
  const messages = await loadRecentMessages(previousSessionFile, lines);

  return {
    previousSessionId,
    messageCount: messages.length,
    messages,
    recoveredAt: new Date().toISOString(),
  };
}

// CLI handler
const args = process.argv.slice(2);
const linesArg = args.find((a) => a.startsWith("--lines="));
const lines = linesArg ? parseInt(linesArg.split("=")[1], 10) : 50;

const result = await recoverSessionTranscript(lines);

if (result.messageCount > 0) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(JSON.stringify({ error: "No previous session found", ...result }, null, 2));
}
