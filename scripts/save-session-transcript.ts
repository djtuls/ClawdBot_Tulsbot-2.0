#!/usr/bin/env tsx

/**
 * Save Session Transcript
 *
 * Saves the current session's messages to a file for recovery on next boot.
 * This ensures continuity even when the user starts a "/new" session.
 *
 * Usage:
 *   bun scripts/save-session-transcript.ts [--quiet]
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

interface TranscriptData {
  sessionId: string;
  savedAt: string;
  messageCount: number;
  messages: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
}

/**
 * Find the current session file
 */
async function findCurrentSession(): Promise<string | null> {
  const currentSessionId = process.env.OPENCLAW_SESSION_ID;

  if (!currentSessionId) {
    // Try to find the most recently modified session
    const files = await fs.readdir(SESSIONS_DIR).catch(() => []);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    if (jsonlFiles.length === 0) {
      return null;
    }

    const fileStats = await Promise.all(
      jsonlFiles.map(async (f) => {
        const stats = await fs.stat(path.join(SESSIONS_DIR, f));
        return { name: f, mtime: stats.mtime.getTime() };
      }),
    );

    fileStats.sort((a, b) => b.mtime - a.mtime);
    return fileStats[0]?.name || null;
  }

  return `${currentSessionId}.jsonl`;
}

/**
 * Load all messages from a session file
 */
async function loadAllMessages(sessionFile: string): Promise<SessionMessage[]> {
  const content = await fs.readFile(path.join(SESSIONS_DIR, sessionFile), "utf-8");
  const allLines = content.trim().split("\n");

  const messages: SessionMessage[] = [];

  for (const line of allLines) {
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
 * Main save function
 */
async function saveSessionTranscript(quiet: boolean = false): Promise<void> {
  const sessionFile = await findCurrentSession();

  if (!sessionFile) {
    if (!quiet) {
      console.log("No session file found");
    }
    return;
  }

  const sessionId = sessionFile.replace(".jsonl", "");
  const messages = await loadAllMessages(sessionFile);

  // Format messages for storage
  const formattedMessages = messages
    .filter((m) => m.message?.content)
    .map((m) => ({
      role: m.message?.role || "unknown",
      content:
        m.message?.content?.map((c: { type: string; text: string }) => c.text || "").join("") || "",
      timestamp: m.timestamp || "",
    }));

  const transcriptData: TranscriptData = {
    sessionId,
    savedAt: new Date().toISOString(),
    messageCount: formattedMessages.length,
    messages: formattedMessages,
  };

  await fs.writeFile(TRANSCRIPT_CACHE, JSON.stringify(transcriptData, null, 2));

  if (!quiet) {
    console.log(`✅ Saved ${formattedMessages.length} messages from session ${sessionId}`);
  }
}

// CLI handler
const quiet = process.argv.includes("--quiet");

saveSessionTranscript(quiet).catch((err) => {
  console.error("Failed to save transcript:", err);
  process.exit(1);
});
