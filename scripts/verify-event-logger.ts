#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logEvent } from "./lib/event-logger.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const EVENT_LOG = join(WORKSPACE, "memory/event-log.jsonl");

logEvent({ source: "verify-event-logger", action: "valid-check", result: "ok", detail: "valid" });
// @ts-expect-error intentional invalid payload for validation path
logEvent({ source: "", action: "", result: "ok", detail: "invalid" });

const lines = readFileSync(EVENT_LOG, "utf8").trim().split("\n");
const last = JSON.parse(lines[lines.length - 1] || "{}");
const prev = JSON.parse(lines[lines.length - 2] || "{}");

console.log(
  JSON.stringify(
    {
      prevAction: prev.action,
      lastAction: last.action,
      invalidCaptured: last.action === "invalid-event",
    },
    null,
    2,
  ),
);
