import { readFileSync, existsSync, statSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { wsPath } from "@/lib/workspace";

const OS_DOCS = [
  "RUNBOOK.md",
  "SOUL.md",
  "STATE.md",
  "TODO.md",
  "ROADMAP.md",
  "COMMANDS.md",
  "AGENTS.md",
  "IDENTITY.md",
  "USER.md",
];

export interface DocEntry {
  filename: string;
  size: number;
  modifiedAt: string;
  content?: string;
}

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");

  if (file) {
    if (!OS_DOCS.includes(file)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const fp = wsPath(file);
    if (!existsSync(fp)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const stat = statSync(fp);
    return NextResponse.json({
      filename: file,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      content: readFileSync(fp, "utf-8"),
    });
  }

  const docs: DocEntry[] = [];
  for (const d of OS_DOCS) {
    const fp = wsPath(d);
    if (existsSync(fp)) {
      const stat = statSync(fp);
      docs.push({
        filename: d,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }
  return NextResponse.json(docs);
}
