import { readFileSync, existsSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { wsPath } from "@/lib/workspace";

export interface SystemEvent {
  ts: string;
  type: string;
  status: string;
  source: string;
  details: Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
  const logPath = wsPath("memory", "event-log.jsonl");

  if (!existsSync(logPath)) {
    return NextResponse.json([]);
  }

  try {
    const raw = readFileSync(logPath, "utf-8").trim();
    if (!raw) {
      return NextResponse.json([]);
    }

    const lines = raw.split("\n").filter(Boolean);
    const events: SystemEvent[] = [];

    for (const line of lines.slice(-limit)) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }

    return NextResponse.json(events.toReversed());
  } catch {
    return NextResponse.json([]);
  }
}
