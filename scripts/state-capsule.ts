#!/usr/bin/env bun
/**
 * State Capsule Generator — Mini-Handoff on Model Switch
 *
 * Called by the watchdog when a tier drop or context threshold triggers.
 * Reads the active session, generates a compact context capsule, and
 * injects it into the session to preserve continuity.
 *
 * Usage:
 *   bun scripts/state-capsule.ts --session <sessionId> --reason <reason> [--from <model>] [--to <model>]
 */

import fs from "fs";
import path from "path";

const HOME = process.env.HOME ?? "/Users/tulioferro";
const SESSIONS_DIR = path.join(HOME, ".openclaw/agents/main/sessions");
const CAPSULE_LOG = path.join(HOME, ".openclaw/workspace/memory/state-capsules.jsonl");
const GATEWAY_PORT = 18891;
const GATEWAY_TOKEN = "bd184b3c0f36128cdb6afaf6df88b746da952313a63f97b4";

// ─── Args ───────────────────────────────────────────────────────────────────

function parseArgs(): { session: string; reason: string; from?: string; to?: string } {
  const args = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      map[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  if (!map.session || !map.reason) {
    console.error(
      "Usage: state-capsule.ts --session <id> --reason <reason> [--from <m>] [--to <m>]",
    );
    process.exit(1);
  }
  return { session: map.session, reason: map.reason, from: map.from, to: map.to };
}

// ─── Session Reader ─────────────────────────────────────────────────────────

interface SessionMessage {
  role: string;
  content: string;
  ts?: string;
}

function readRecentMessages(sessionId: string, count = 20): SessionMessage[] {
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionFile)) {
    // Try to find by prefix match
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.startsWith(sessionId.slice(0, 8)));
    if (files.length === 0) {
      return [];
    }
    const file = path.join(SESSIONS_DIR, files[0]);
    return parseSessionFile(file, count);
  }
  return parseSessionFile(sessionFile, count);
}

function parseSessionFile(file: string, count: number): SessionMessage[] {
  const lines = fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  const messages: SessionMessage[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.role && parsed.content) {
        messages.push({
          role: parsed.role,
          content:
            typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed.content),
          ts: parsed.ts || parsed.timestamp,
        });
      }
    } catch {
      continue;
    }
  }

  return messages.slice(-count);
}

// ─── Capsule Builder ────────────────────────────────────────────────────────

function buildCapsule(messages: SessionMessage[], args: ReturnType<typeof parseArgs>): string {
  const recent = messages.slice(-10);
  const userMsgs = recent.filter((m) => m.role === "user").map((m) => m.content.slice(0, 300));
  const assistantMsgs = recent
    .filter((m) => m.role === "assistant")
    .map((m) => m.content.slice(0, 500));
  const lastAssistant = assistantMsgs[assistantMsgs.length - 1] ?? "(none)";
  const lastUser = userMsgs[userMsgs.length - 1] ?? "(none)";

  // Extract potential goals, constraints, decisions from content
  const allContent = messages.map((m) => m.content).join("\n");
  const todoMatches = allContent.match(/(?:TODO|NEXT|PENDING|ACTION)[:]\s*(.+)/gi) ?? [];
  const constraintMatches =
    allContent.match(/(?:MUST|NEVER|ALWAYS|RULE|CONSTRAINT)[:]\s*(.+)/gi) ?? [];

  return [
    `═══ MODEL SWITCH — STATE CAPSULE ═══`,
    `Time: ${new Date().toISOString()}`,
    `Reason: ${args.reason}`,
    args.from ? `Previous model: ${args.from}` : "",
    args.to ? `Current model: ${args.to}` : "",
    ``,
    `── Last user request ──`,
    lastUser,
    ``,
    `── Last assistant state ──`,
    lastAssistant.slice(0, 800),
    ``,
    `── Open loops / TODOs ──`,
    todoMatches.length > 0 ? todoMatches.slice(-5).join("\n") : "(none detected)",
    ``,
    `── Hard constraints in session ──`,
    constraintMatches.length > 0 ? constraintMatches.slice(-5).join("\n") : "(none detected)",
    ``,
    `── Do-not-regress ──`,
    `- Maintain consistency with prior decisions in this session`,
    `- Do not re-ask questions the user already answered`,
    `- Preserve formatting/style established earlier`,
    `═══ END STATE CAPSULE ═══`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Gateway Injection ──────────────────────────────────────────────────────

async function injectToSession(sessionId: string, capsule: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/sessions/${sessionId}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        role: "system",
        content: capsule,
        meta: { type: "state_capsule", injected: true },
      }),
    });

    if (res.ok) {
      console.log(`[capsule] Injected into session ${sessionId.slice(0, 8)}…`);
      return true;
    }
    console.warn(`[capsule] Gateway returned ${res.status} — capsule saved to log only`);
    return false;
  } catch (e) {
    console.warn(`[capsule] Gateway unreachable — capsule saved to log only:`, e);
    return false;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `[capsule] Generating for session=${args.session.slice(0, 8)}… reason=${args.reason}`,
  );

  const messages = readRecentMessages(args.session);
  if (messages.length === 0) {
    console.warn("[capsule] No messages found in session — skipping");
    process.exit(0);
  }

  const capsule = buildCapsule(messages, args);
  console.log(`[capsule] Generated ${capsule.length} chars`);

  const injected = await injectToSession(args.session, capsule);

  // Always log to capsule history
  const dir = path.dirname(CAPSULE_LOG);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(
    CAPSULE_LOG,
    JSON.stringify({
      ts: new Date().toISOString(),
      session: args.session,
      reason: args.reason,
      from: args.from,
      to: args.to,
      capsule_length: capsule.length,
      injected,
    }) + "\n",
  );

  console.log(`[capsule] Done. Injected: ${injected}`);
}

main().catch(console.error);
