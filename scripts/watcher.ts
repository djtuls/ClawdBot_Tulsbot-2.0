#!/usr/bin/env bun
/**
 * Tulsbot Watcher (Passive Perception)
 * Tails zsh_history to observe user commands in real-time.
 *
 * Usage: ./scripts/watcher.ts
 */

import { spawn } from "child_process";
import { appendFileSync } from "fs";
import { join } from "path";

const HISTORY_FILE = join(process.env.HOME || "", ".zsh_history");
const LOG_FILE = join(process.cwd(), "memory", "watcher.log");

// Sanitization patterns (mask these)
const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI keys
  /ghp_[a-zA-Z0-9]{20,}/g, // GitHub tokens
  /--token\s+[^\s]+/g,
  /-p\s+[^\s]+/g,
  /password/i,
];

function sanitize(text: string): string {
  let clean = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    clean = clean.replace(pattern, "[REDACTED]");
  }
  return clean;
}

function log(msg: string) {
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${msg}\n`;
  appendFileSync(LOG_FILE, entry);
  // Also output to stdout for the parent process to see
  process.stdout.write(entry);
}

async function start() {
  log(`👀 Watcher started. Tailing ${HISTORY_FILE}`);

  // Use 'tail -f' to watch the file
  const tail = spawn("tail", ["-f", "-n", "0", HISTORY_FILE]);

  tail.stdout.on("data", (data) => {
    const raw = data.toString().trim();
    if (!raw) {
      return;
    }

    // zsh_history format is often: : 167899999:0;command
    // We try to extract just the command
    const parts = raw.split(";");
    const commandRaw = parts.length > 1 ? parts.slice(1).join(";") : raw;

    const cleanCommand = sanitize(commandRaw);

    log(`DETECTED: ${cleanCommand}`);

    // Simple triggers (Proof of Concept)
    if (cleanCommand.startsWith("git status")) {
      log("--> TRIGGER: User checking git. I could offer to commit changes.");
    }
    if (cleanCommand.includes("fly deploy")) {
      log("--> TRIGGER: Deployment detected. I could monitor the release.");
    }
    if (cleanCommand.includes("Error") || cleanCommand.includes("fail")) {
      log("--> TRIGGER: Potential failure detected.");
    }
  });

  tail.stderr.on("data", (data) => {
    log(`ERROR: ${data}`);
  });
}

void start();
