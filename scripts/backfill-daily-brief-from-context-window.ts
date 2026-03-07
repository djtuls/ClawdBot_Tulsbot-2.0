#!/usr/bin/env node
/**
 * Backfill daily-brief related messages from reports/context-window.json into memory/*.md.
 *
 * Goal: if the user requested/approved “daily briefs” in a live chat surface, we persist that
 * instruction into durable memory so it survives model/session resets.
 */
import fs from "node:fs/promises";
import path from "node:path";

type ContextWindowItem = {
  text?: string;
  role?: string;
  // other fields exist, but we only need the rendered text.
};

type ContextWindow = {
  items?: ContextWindowItem[];
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const contextWindowPath = path.join(repoRoot, "reports", "context-window.json");
const memoryDir = path.join(repoRoot, "memory");
const markerPath = path.join(repoRoot, "reports", "daily-brief-backfill.state.json");

function extractDailyBriefSnippets(text: string): string[] {
  const out: string[] = [];
  const needles = [
    "daily brief",
    "morning brief",
    "end of the day",
    "day planner",
    "start of the day",
    "wrap & next steps",
  ];

  const lower = text.toLowerCase();
  if (!needles.some((n) => lower.includes(n))) {
    return out;
  }

  out.push(text.trim());
  return out;
}

async function readJson<T>(p: string): Promise<T> {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw) as T;
}

async function main() {
  await fs.mkdir(memoryDir, { recursive: true });

  const cw = await readJson<ContextWindow>(contextWindowPath);
  const items = cw.items ?? [];

  const snippets: string[] = [];
  for (const it of items) {
    if (!it.text) {
      continue;
    }
    snippets.push(...extractDailyBriefSnippets(it.text));
  }

  if (snippets.length === 0) {
    // Still write state so we don't thrash.
    await fs.writeFile(
      markerPath,
      JSON.stringify({ lastRun: new Date().toISOString(), wrote: false }, null, 2),
    );
    return;
  }

  // De-dupe while preserving order.
  const seen = new Set<string>();
  const unique = snippets.filter((s) => {
    if (seen.has(s)) {
      return false;
    }
    seen.add(s);
    return true;
  });

  const yyyyMmDd = new Date().toISOString().slice(0, 10);
  const outPath = path.join(memoryDir, `${yyyyMmDd}-daily-briefs-from-context-window.md`);

  const content = `# Daily briefs (backfilled from context-window)\n\n- **Date:** ${yyyyMmDd}\n- **Source:** reports/context-window.json\n- **Purpose:** Persist daily-brief requirements so they are searchable in memory.\n\n## Captured snippets\n\n${unique.map((s) => `---\n\n${s}\n`).join("\n")}\n`;

  await fs.writeFile(outPath, content);
  await fs.writeFile(
    markerPath,
    JSON.stringify(
      {
        lastRun: new Date().toISOString(),
        wrote: true,
        output: path.relative(repoRoot, outPath),
        snippetCount: unique.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[daily-brief-backfill] failed:", err);
  process.exit(1);
});
