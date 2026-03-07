#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ws = process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw/workspace");
const mem = join(ws, "memory");
if (!existsSync(mem)) {
  mkdirSync(mem, { recursive: true });
}

const [severity = "medium", source = "system", title = "unspecified", ...rest] =
  process.argv.slice(2);
const details = rest.join(" ");

const rec = {
  id: `bug-${Date.now()}`,
  ts: new Date().toISOString(),
  severity,
  status: "open",
  source,
  title,
  details,
  needsHuman: severity === "critical",
};

appendFileSync(join(mem, "bug-log.jsonl"), JSON.stringify(rec) + "\n");

const ev = {
  ts: rec.ts,
  type: "bug",
  status: severity === "critical" ? "error" : severity === "high" ? "warn" : "ok",
  source,
  details: { bugId: rec.id, title, severity },
};
appendFileSync(join(mem, "event-log.jsonl"), JSON.stringify(ev) + "\n");

console.log(`logged ${rec.id}`);
