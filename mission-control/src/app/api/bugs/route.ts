import { existsSync, mkdirSync, readFileSync, appendFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { wsPath } from "@/lib/workspace";

export interface BugRecord {
  id: string;
  ts: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved";
  source: string;
  title: string;
  details?: string;
  needsHuman?: boolean;
}

function bugPath() {
  return wsPath("memory", "bug-log.jsonl");
}

function ensureDir() {
  const dir = wsPath("memory");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function GET(req: NextRequest) {
  ensureDir();
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "100", 10);
  const path = bugPath();
  if (!existsSync(path)) {
    return NextResponse.json([]);
  }

  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  const out: BugRecord[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return NextResponse.json(out.toReversed());
}

export async function POST(req: NextRequest) {
  ensureDir();
  const body = await req.json();
  const rec: BugRecord = {
    id: body.id || `bug-${Date.now()}`,
    ts: body.ts || new Date().toISOString(),
    severity: body.severity || "medium",
    status: body.status || "open",
    source: body.source || "system",
    title: body.title || "Untitled bug",
    details: body.details || "",
    needsHuman: Boolean(body.needsHuman),
  };

  appendFileSync(bugPath(), JSON.stringify(rec) + "\n");

  // mirror critical/high into event stream for dashboard visibility
  if (rec.severity === "high" || rec.severity === "critical") {
    const evPath = wsPath("memory", "event-log.jsonl");
    const ev = {
      ts: rec.ts,
      type: "bug",
      status: rec.severity === "critical" ? "error" : "warn",
      source: rec.source,
      details: { bugId: rec.id, title: rec.title, needsHuman: rec.needsHuman },
    };
    appendFileSync(evPath, JSON.stringify(ev) + "\n");
  }

  return NextResponse.json(rec, { status: 201 });
}
