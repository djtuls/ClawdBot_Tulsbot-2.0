#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Event = {
  id: string;
  source: "email" | "whatsapp" | "notes" | "notion" | "plaud";
  sender?: string;
  email?: string;
  phone?: string;
  subject?: string;
  text: string;
  ts: string;
  // Email-specific enrichments (optional)
  starred?: boolean;
  direction?: "received" | "sent";
};

type Config = {
  sources: Record<string, boolean>;
  flow: { autoArchive: boolean; hitlThreshold: number };
  routing: {
    hubspot: boolean;
    notionTasks: boolean;
    notes: boolean;
    plaud: boolean;
    meetingBriefs: boolean;
  };
  rules: Array<{
    id: string;
    enabled: boolean;
    confidence: number;
    condition: string;
    action: string;
  }>;
  contexts: Array<{ project: string; keywords: string; destination: string; enabled: boolean }>;
};

const WS = process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw/workspace");
const MEM = join(WS, "memory");
const CONFIG_PATH = join(MEM, "capture-inbox-config.json");
const EVENTS_PATH = join(MEM, "capture-inbox-events.jsonl");
const HITL_PATH = join(MEM, "capture-inbox-hitl.jsonl");
const ROUTED_PATH = join(MEM, "capture-inbox-routed.jsonl");

function readConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function classify(ev: Event, cfg: Config) {
  const txt = `${ev.subject || ""} ${ev.text}`.toLowerCase();

  // Hard-priority signals
  if (ev.source === "email" && ev.starred) {
    return { label: "starred", confidence: 0.99 };
  }

  // Action commitments / asks (received or sent)
  const actionRegex =
    /\b(please|can you|could you|need you to|follow up|action required|todo|to-do|next step|by\s+\w+day|by\s+\d{1,2}[/.-]\d{1,2}|i('ll| will)|we('ll| will)|i can|i can do|i'll send|i'll share|let me|i owe you|promis(e|ed)|commit(ed|ment)?)\b/;
  if (actionRegex.test(txt)) {
    return { label: "action", confidence: 0.95 };
  }

  if (/unsubscribe|newsletter|digest/.test(txt)) {
    return { label: "subscription", confidence: 0.92 };
  }
  if (/receipt|invoice|payment|paid/.test(txt)) {
    return { label: "receipt", confidence: 0.9 };
  }
  if (/proposal|quote|budget|scope|contract/.test(txt)) {
    return { label: "opportunity", confidence: 0.82 };
  }
  if (/urgent|asap|today|approve/.test(txt)) {
    return { label: "priority", confidence: 0.78 };
  }
  return { label: "unknown", confidence: 0.52 };
}

function projectContext(ev: Event, cfg: Config) {
  const txt = `${ev.subject || ""} ${ev.text}`.toLowerCase();
  for (const c of cfg.contexts.filter((x) => x.enabled)) {
    const kws = c.keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (kws.some((kw) => txt.includes(kw))) {
      return c;
    }
  }
  return null;
}

async function hubspotPing(): Promise<boolean> {
  const envPath = join(homedir(), ".openclaw/.env");
  if (!existsSync(envPath)) {
    return false;
  }
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("HUBSPOT_PRIVATE_APP_TOKEN="));
  if (!line) {
    return false;
  }
  const token = line.split("=", 2)[1];
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function main() {
  if (!existsSync(MEM)) {
    mkdirSync(MEM, { recursive: true });
  }
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Missing config: ${CONFIG_PATH}`);
  }
  if (!existsSync(EVENTS_PATH)) {
    writeFileSync(EVENTS_PATH, "");
    console.log("No events yet. Created:", EVENTS_PATH);
    return;
  }

  const cfg = readConfig();
  const lines = readFileSync(EVENTS_PATH, "utf8").split("\n").filter(Boolean);
  const events: Event[] = lines.map((l) => JSON.parse(l));

  let hitl = 0;
  let routed = 0;

  for (const ev of events) {
    if (!cfg.sources[ev.source]) {
      continue;
    }

    const cls = classify(ev, cfg);
    const ctx = projectContext(ev, cfg);

    const record = {
      ...ev,
      classification: cls,
      context: ctx?.project || "unassigned",
      destination: ctx?.destination || "HITL",
      processedAt: new Date().toISOString(),
    };

    const mustReview = cls.label === "starred" || cls.label === "action";

    if (mustReview || cls.confidence < cfg.flow.hitlThreshold || cls.label === "unknown") {
      appendFileSync(
        HITL_PATH,
        JSON.stringify({ ...record, reason: mustReview ? "forced-review" : "low-confidence" }) +
          "\n",
      );
      hitl++;
    } else {
      appendFileSync(ROUTED_PATH, JSON.stringify(record) + "\n");
      routed++;
    }
  }

  const hs = cfg.routing.hubspot ? await hubspotPing() : false;

  console.log(`Processed ${events.length} events`);
  console.log(`Routed: ${routed}`);
  console.log(`HITL: ${hitl}`);
  console.log(`HubSpot ready: ${hs ? "yes" : "no"}`);
  console.log(`Output: ${ROUTED_PATH}`);
  console.log(`HITL: ${HITL_PATH}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
