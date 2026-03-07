import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export interface TulsbotEvent {
  ts: string;
  type:
    | "heartbeat"
    | "llm_call"
    | "cron"
    | "error"
    | "task"
    | "notification"
    | "security"
    | "system";
  status: "ok" | "warn" | "error";
  source: string;
  details: Record<string, unknown>;
}

const EVENT_LOG_PATH = join(
  process.env.OPENCLAW_WORKSPACE ||
    join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace"),
  "memory/event-log.jsonl",
);

export function logEvent(event: Omit<TulsbotEvent, "ts">): void {
  const fullEvent: TulsbotEvent = {
    ts: new Date().toISOString(),
    ...event,
  };

  const dir = dirname(EVENT_LOG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  appendFileSync(EVENT_LOG_PATH, JSON.stringify(fullEvent) + "\n");
}

export function logHeartbeat(
  source: string,
  status: "ok" | "warn" | "error",
  details: Record<string, unknown>,
): void {
  logEvent({ type: "heartbeat", status, source, details });
}

export function logCron(
  jobName: string,
  status: "ok" | "warn" | "error",
  details: Record<string, unknown> = {},
): void {
  logEvent({ type: "cron", status, source: jobName, details });
}

export function logError(
  source: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  logEvent({ type: "error", status: "error", source, details: { message, ...details } });
}

export function logSecurity(
  check: string,
  status: "ok" | "warn" | "error",
  details: Record<string, unknown> = {},
): void {
  logEvent({ type: "security", status, source: check, details });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , type, source, status, ...rest] = process.argv;
  if (!type || !source || !status) {
    console.log("Usage: event-logger.ts <type> <source> <status> [details-json]");
    process.exit(1);
  }
  const details = rest.length > 0 ? JSON.parse(rest.join(" ")) : {};
  logEvent({
    type: type as TulsbotEvent["type"],
    status: status as TulsbotEvent["status"],
    source,
    details,
  });
  console.log(`Logged ${type}/${status} from ${source}`);
}
