import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { join } from "path";

const BUILDS_DIR = process.env.HOME
  ? join(process.env.HOME, ".openclaw/builds")
  : "/Users/tulioferro/.openclaw/builds";

function readDir(dir: string): { name: string; content: string; mtime: number }[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".spec.md") || f.endsWith(".md"))
    .map((f) => {
      const full = join(dir, f);
      const stat = statSync(full);
      return {
        name: f,
        content: readFileSync(full, "utf-8").slice(0, 500),
        mtime: stat.mtimeMs,
      };
    })
    .toSorted((a, b) => b.mtime - a.mtime);
}

export async function GET() {
  const queue = readDir(join(BUILDS_DIR, "queue"));
  const active = readDir(join(BUILDS_DIR, "active"));
  const done = readDir(join(BUILDS_DIR, "done")).slice(0, 10);

  return NextResponse.json({ queue, active, done });
}
