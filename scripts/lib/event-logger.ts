import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const EVENT_LOG = join(WORKSPACE, "memory/event-log.jsonl");

export interface EventEntry {
  ts: string;
  source: string;
  action: string;
  target?: string;
  result: "ok" | "error" | "skipped";
  detail?: string;
  rationale?: string;
  rollback?: string;
}

export function logEvent(entry: Omit<EventEntry, "ts">): void {
  const dir = dirname(EVENT_LOG);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const line: EventEntry = { ts: new Date().toISOString(), ...entry };
  appendFileSync(EVENT_LOG, JSON.stringify(line) + "\n");
}
