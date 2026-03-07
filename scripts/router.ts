#!/usr/bin/env npx tsx
import "dotenv/config";
import { execFileSync } from "child_process";
/**
 * Inbox Router — Routes pending inbox items to their target systems
 *
 * Reads memory/inbox/pending.jsonl, applies routing rules,
 * and dispatches to Todoist, HubSpot, Notion, or vault.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");

interface PendingItem {
  id: string;
  source: string;
  category: string;
  subject?: string;
  from?: string;
  snippet?: string;
  account?: string;
  addedAt: string;
  status: string;
  commitment?: string;
  hash: string;
}

function readPending(): PendingItem[] {
  if (!existsSync(PENDING_PATH)) {
    return [];
  }
  return readFileSync(PENDING_PATH, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((item): item is PendingItem => item !== null && item.status === "pending");
}

function writePending(items: PendingItem[]): void {
  writeFileSync(PENDING_PATH, items.map((i) => JSON.stringify(i)).join("\n") + "\n");
}

function routeToTodoist(item: PendingItem): boolean {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    console.error("[router] TODOIST_API_TOKEN not set");
    return false;
  }

  try {
    const content = item.commitment || item.subject || "Inbox item";
    const description = [
      item.from ? `From: ${item.from}` : "",
      item.snippet ? `Context: ${item.snippet.slice(0, 200)}` : "",
      `Source: ${item.source} (${item.account || "unknown"})`,
    ]
      .filter(Boolean)
      .join("\n");

    execFileSync(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        "https://todoist.com/api/v1/tasks",
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify({ content, description, priority: 3 }),
      ],
      { timeout: 10_000, encoding: "utf-8" },
    );

    logEvent({
      source: "inbox-router",
      action: "route-todoist",
      target: content.slice(0, 60),
      result: "ok",
      rationale: `category=${item.category}`,
      rollback: "Delete task from Todoist",
    });
    return true;
  } catch (err: any) {
    console.error("[router] Todoist route failed:", err.message);
    return false;
  }
}

function routeToEventLog(item: PendingItem): void {
  logEvent({
    source: "inbox-router",
    action: `route-${item.category}`,
    target: (item.subject || item.commitment || "").slice(0, 60),
    result: "ok",
    detail: `from=${item.from || "unknown"} account=${item.account || "unknown"}`,
    rationale: `Classification: ${item.category}`,
  });
}

async function main() {
  console.log("[router] Processing pending inbox items...");
  const items = readPending();
  if (items.length === 0) {
    console.log("[router] No pending items.");
    return;
  }

  console.log(`[router] ${items.length} pending items`);
  const remaining: PendingItem[] = [];

  for (const item of items) {
    switch (item.category) {
      case "action-required": {
        const ok = routeToTodoist(item);
        if (ok) {
          item.status = "routed";
          routeToEventLog(item);
        } else {
          remaining.push(item);
        }
        break;
      }
      case "client-communication": {
        // V1: Log and notify — HubSpot write comes in V2
        routeToEventLog(item);
        item.status = "routed";
        console.log(`[router] Client comm logged: ${item.subject}`);
        break;
      }
      case "inft-ops": {
        // V1: Log and notify — Notion write comes in V2
        routeToEventLog(item);
        item.status = "routed";
        console.log(`[router] INFT ops logged: ${item.subject}`);
        break;
      }
      default: {
        routeToEventLog(item);
        item.status = "routed";
        break;
      }
    }
  }

  writePending(remaining);
  const routed = items.length - remaining.length;
  console.log(`[router] Done. Routed: ${routed}, Remaining: ${remaining.length}`);
}

main().catch((err) => {
  console.error("[router] Fatal error:", err);
  logEvent({ source: "inbox-router", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
