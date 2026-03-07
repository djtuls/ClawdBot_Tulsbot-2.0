import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { join } from "path";
import { wsPath } from "@/lib/workspace";

export interface MemoryEntry {
  type: "daily" | "handoff" | "learnings";
  filename: string;
  content: string;
  date?: string;
  size: number;
}

export async function GET() {
  const entries: MemoryEntry[] = [];

  const handoffPath = wsPath("memory", "session-handoff.md");
  if (existsSync(handoffPath)) {
    const stat = statSync(handoffPath);
    entries.push({
      type: "handoff",
      filename: "session-handoff.md",
      content: readFileSync(handoffPath, "utf-8"),
      size: stat.size,
    });
  }

  const learningsPath = wsPath("memory", "learnings.md");
  if (existsSync(learningsPath)) {
    const stat = statSync(learningsPath);
    entries.push({
      type: "learnings",
      filename: "learnings.md",
      content: readFileSync(learningsPath, "utf-8"),
      size: stat.size,
    });
  }

  const dailyDir = wsPath("memory", "daily");
  if (existsSync(dailyDir)) {
    const files = readdirSync(dailyDir)
      .filter((f) => f.endsWith(".md"))
      .toSorted()
      .toReversed();

    for (const f of files.slice(0, 30)) {
      const fp = join(dailyDir, f);
      const stat = statSync(fp);
      entries.push({
        type: "daily",
        filename: f,
        content: readFileSync(fp, "utf-8"),
        date: f.replace(".md", ""),
        size: stat.size,
      });
    }
  }

  return NextResponse.json(entries);
}
