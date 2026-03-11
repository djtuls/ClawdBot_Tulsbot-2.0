import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { z } from "zod";

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

const EventEntrySchema = z.object({
  ts: z.string().datetime(),
  source: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1).optional(),
  result: z.enum(["ok", "error", "skipped"]),
  detail: z.string().optional(),
  rationale: z.string().optional(),
  rollback: z.string().optional(),
});

function ensureLogDir() {
  const dir = dirname(EVENT_LOG);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function appendRaw(payload: Record<string, unknown>) {
  ensureLogDir();
  appendFileSync(EVENT_LOG, `${JSON.stringify(payload)}\n`);
}

export function logEvent(entry: Omit<EventEntry, "ts">): void {
  const candidate: EventEntry = { ts: new Date().toISOString(), ...entry };
  const parsed = EventEntrySchema.safeParse(candidate);

  if (parsed.success) {
    appendRaw(parsed.data);
    return;
  }

  const issues = parsed.error.issues
    .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
    .join("; ");

  // Non-breaking fallback: never throw from logger in production paths.
  appendRaw({
    ts: new Date().toISOString(),
    source: "event-logger",
    action: "invalid-event",
    result: "error",
    detail: issues,
    rationale: "schema-validation-failed",
    rollback: "caller-continues",
    invalidEvent: candidate,
  });
}
