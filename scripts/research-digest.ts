#!/usr/bin/env tsx
/**
 * research-digest.ts — Automated research for active projects
 *
 * Reads TODO.md and STATE.md to extract active project topics, then
 * uses Gemini with grounding to search for recent updates, releases,
 * breaking changes, and security advisories. Writes a digest to
 * reports/research-digest.md.
 *
 * Usage:
 *   npx tsx scripts/research-digest.ts
 *   npx tsx scripts/research-digest.ts --quiet
 *   npx tsx scripts/research-digest.ts --topics "Supabase,Fly.io"  (override)
 */

import { config as loadEnv } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");
loadEnv({ path: path.join(WORKSPACE, ".env") });

const QUIET = process.argv.includes("--quiet");
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const DIGEST_PATH = path.join(WORKSPACE, "reports", "research-digest.md");
const DIGEST_JSON_PATH = path.join(WORKSPACE, "reports", "research-digest.json");

if (!GEMINI_KEY) {
  console.error("❌ Missing GEMINI_API_KEY");
  process.exit(1);
}

function log(...args: unknown[]) {
  if (!QUIET) {
    console.log(...args);
  }
}

// ─── Topic extraction ────────────────────────────────────────────────────────

const ALWAYS_TRACK = [
  "OpenClaw AI agent framework",
  "Supabase updates releases",
  "Notion API changes",
  "Fly.io platform updates",
  "TypeScript runtime Bun Node updates",
];

async function extractTopicsFromWorkspace(): Promise<string[]> {
  const topics = new Set(ALWAYS_TRACK);

  const topicOverride = process.argv.find((a) => a.startsWith("--topics="));
  if (topicOverride) {
    const custom = topicOverride
      .split("=")[1]
      .split(",")
      .map((t) => t.trim());
    return [...custom, ...ALWAYS_TRACK];
  }

  try {
    const todo = await fs.readFile(path.join(WORKSPACE, "TODO.md"), "utf8");
    const state = await fs.readFile(path.join(WORKSPACE, "STATE.md"), "utf8");
    const combined = todo + "\n" + state;

    const projectKeywords: Record<string, string> = {
      Nostr: "Nostr protocol relay updates",
      Tailscale: "Tailscale VPN updates",
      NotebookLM: "Google NotebookLM updates features",
      "Mission Control": "Fly.io deployment dashboard patterns",
      "Mac Mini": "Mac Mini server headless setup",
      Gemini: "Google Gemini API updates models",
      pgvector: "pgvector Postgres vector search updates",
    };

    for (const [keyword, searchTopic] of Object.entries(projectKeywords)) {
      if (combined.includes(keyword)) {
        topics.add(searchTopic);
      }
    }
  } catch {
    log("  ⚠ Could not read TODO.md or STATE.md, using default topics");
  }

  return [...topics];
}

// ─── Gemini search ───────────────────────────────────────────────────────────

interface SearchResult {
  topic: string;
  summary: string;
  error?: string;
}

async function searchTopic(topic: string): Promise<SearchResult> {
  const prompt = `You are a technical research assistant. Search for the most recent updates, releases, breaking changes, and security advisories related to: "${topic}".

Focus on the last 7 days. Return a concise summary (3-5 bullet points) of what's new or important. If nothing notable happened in the last 7 days, say "No significant updates this week." Include version numbers and dates when available.

Format as markdown bullet points.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.3,
          },
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return { topic, summary: "", error: `Gemini ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts
      .map((p: unknown) => p.text || "")
      .join("\n")
      .trim();

    return { topic, summary: text || "No results returned." };
  } catch (err: unknown) {
    return { topic, summary: "", error: err.message };
  }
}

// ─── Digest builder ──────────────────────────────────────────────────────────

async function buildDigest(topics: string[], results: SearchResult[]): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
  });

  const lines: string[] = [
    `# Research Digest — ${dateStr}`,
    "",
    `> Auto-generated at ${timeStr} AEDT by \`scripts/research-digest.ts\``,
    `> Topics tracked: ${topics.length} | Successful searches: ${results.filter((r) => !r.error).length}/${results.length}`,
    "",
    "---",
    "",
  ];

  for (const r of results) {
    lines.push(`## ${r.topic}`);
    lines.push("");
    if (r.error) {
      lines.push(`> ⚠️ Search failed: ${r.error}`);
    } else {
      lines.push(r.summary);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("*End of digest. Next run: tomorrow at 2:30 AM AEDT.*");
  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log("🔍 Research Digest\n");

  log("1/3 Extracting topics from workspace...");
  const topics = await extractTopicsFromWorkspace();
  log(`   Found ${topics.length} topics: ${topics.join(", ")}\n`);

  log("2/3 Searching for updates (Gemini grounded search)...");
  const results: SearchResult[] = [];
  // Run in batches of 3 to avoid rate limits
  for (let i = 0; i < topics.length; i += 3) {
    const batch = topics.slice(i, i + 3);
    const batchResults = await Promise.all(batch.map(searchTopic));
    results.push(...batchResults);

    for (const r of batchResults) {
      if (r.error) {
        log(`   ❌ ${r.topic}: ${r.error}`);
      } else {
        log(`   ✓ ${r.topic}`);
      }
    }

    if (i + 3 < topics.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  log("\n3/3 Writing digest...");
  const digest = await buildDigest(topics, results);

  await fs.mkdir(path.dirname(DIGEST_PATH), { recursive: true });
  await fs.writeFile(DIGEST_PATH, digest);
  await fs.writeFile(
    DIGEST_JSON_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        topicCount: topics.length,
        successCount: results.filter((r) => !r.error).length,
        errorCount: results.filter((r) => r.error).length,
        topics,
        results,
      },
      null,
      2,
    ),
  );

  log(`\n✅ Digest written to reports/research-digest.md (${topics.length} topics)`);

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    log(`⚠  ${errors.length} topic(s) had search errors`);
  }
}

main().catch((err) => {
  console.error("⚠️  research-digest failed:", err.message);
  process.exit(QUIET ? 0 : 1);
});
