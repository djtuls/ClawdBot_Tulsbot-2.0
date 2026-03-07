#!/usr/bin/env tsx
/**
 * NotebookLM History Ingestion — one-time extraction with deduplication
 *
 * Extracts raw content from all relevant NotebookLM notebooks, cross-references
 * against what's already in local memory, and ingests only genuinely new content
 * into AnythingLLM + Supabase. Safe to run multiple times (idempotent).
 *
 * Notebooks scanned:
 *  - tulsbot (66452b2b) — 300 sources, main memory mirror
 *  - OpenClaw Master (bdc9ce06) — 12 sources, codebase snapshots
 *  - OpenClaw Debugging (2f6cf3da) — 6 sources, debug docs
 *  - OpenClaw Security (ed48b6e5) — 4 sources, security docs
 *
 * Usage:
 *   npx tsx scripts/ingest-notebooklm-history.ts             # full run
 *   npx tsx scripts/ingest-notebooklm-history.ts --dry-run   # show plan only
 *   npx tsx scripts/ingest-notebooklm-history.ts --status    # show state
 */

import { config as loadEnv } from "dotenv";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
loadEnv({ path: path.join(PROJECT_ROOT, ".env") });

const ANYTHINGLLM_BASE_URL = process.env.ANYTHINGLLM_BASE_URL ?? "http://localhost:3001";
const ANYTHINGLLM_API_KEY = process.env.ANYTHINGLLM_API_KEY ?? "";
const WORKSPACE_SLUG = process.env.ANYTHINGLLM_WORKSPACE_SLUG ?? "tulsbot-brain";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const EXPORT_DIR = path.join(PROJECT_ROOT, "memory", "notebooklm-export");
const STATE_FILE = path.join(PROJECT_ROOT, ".notebooklm-ingest-state.json");

const DRY_RUN = process.argv.includes("--dry-run");
const STATUS_ONLY = process.argv.includes("--status");

// Notebooks to scan (only Tulsbot-relevant ones)
const NOTEBOOKS = [
  { id: "66452b2b-b63f-48a3-8f3b-91b8af372f1d", name: "tulsbot" },
  { id: "bdc9ce06-cc71-4ea0-8181-d84a2a2e9a31", name: "OpenClaw Master" },
  { id: "2f6cf3da-f70b-41d3-b6e5-0073d0922fa7", name: "OpenClaw Debugging" },
  { id: "ed48b6e5-4424-4a2f-b594-e68fa9ed2ab8", name: "OpenClaw Security" },
];

type IngestState = {
  lastRun: string;
  extracted: Record<string, { contentHash: string; savedTo: string; ingested: boolean }>;
};

async function loadState(): Promise<IngestState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf-8"));
  } catch {
    return { lastRun: "", extracted: {} };
  }
}

function hashContent(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

// ─── nlm CLI wrappers ──────────────────────────────────────────────────────

type NlmSource = { id: string; title: string; type: string; url: string | null };

async function listSources(notebookId: string): Promise<NlmSource[]> {
  const { stdout, error } = await execFileNoThrow("nlm", ["source", "list", notebookId, "--json"]);
  if (error) {
    return [];
  }
  try {
    return JSON.parse(stdout.trim()) as NlmSource[];
  } catch {
    return [];
  }
}

async function getSourceContent(
  sourceId: string,
): Promise<{ content: string; title: string; charCount: number } | null> {
  const { stdout, error } = await execFileNoThrow("nlm", ["source", "content", sourceId, "--json"]);
  if (error) {
    return null;
  }
  try {
    const data = JSON.parse(stdout.trim()) as {
      value?: { content?: string; title?: string; char_count?: number };
    };
    const v = data.value ?? {};
    if (!v.content || v.char_count === 0) {
      return null;
    }
    return { content: v.content, title: v.title ?? "", charCount: v.char_count ?? 0 };
  } catch {
    return null;
  }
}

// ─── Local file index ──────────────────────────────────────────────────────

async function buildLocalIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>(); // contentHash → filePath

  const scanDir = async (dir: string) => {
    try {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        if (![".md", ".txt"].some((e) => entry.name.endsWith(e))) {
          continue;
        }
        const fp = path.join(dir, entry.name);
        try {
          const content = await fs.readFile(fp, "utf-8");
          index.set(hashContent(content), fp);
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  };

  await scanDir(path.join(PROJECT_ROOT, "memory"));
  await scanDir(path.join(PROJECT_ROOT, "docs"));
  await scanDir(path.join(PROJECT_ROOT, "reports"));
  await scanDir(path.join(PROJECT_ROOT, "sessions"));
  await scanDir(path.join(PROJECT_ROOT, "archive"));

  return index;
}

// ─── AnythingLLM upload ───────────────────────────────────────────────────

async function uploadToAnythingLLM(
  title: string,
  content: string,
  label: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${ANYTHINGLLM_BASE_URL}/api/v1/document/raw-text`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANYTHINGLLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        textContent: content,
        metadata: {
          title: `[nlm-${label}] ${title}`,
          docAuthor: "openclaw-nlm-ingest",
          description: `Extracted from NotebookLM ${label} notebook`,
          source: `notebooklm:${label}`,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { documents?: Array<{ location?: string }> };
    const location = data?.documents?.[0]?.location;

    if (location) {
      await fetch(`${ANYTHINGLLM_BASE_URL}/api/v1/workspace/${WORKSPACE_SLUG}/update-embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ANYTHINGLLM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adds: [location], deletes: [] }),
        signal: AbortSignal.timeout(60_000),
      });
    }

    return location ?? null;
  } catch {
    return null;
  }
}

// ─── Supabase upload ──────────────────────────────────────────────────────

async function uploadToSupabase(
  title: string,
  content: string,
  hash: string,
  label: string,
  filePath: string,
): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return false;
  }
  try {
    const uri = `nlm://${label}/${title}`;
    const chunks = content.match(/.{1,1500}/gs) ?? [content];

    const docRes = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_documents?on_conflict=uri`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        uri,
        source_type: `nlm-${label}`,
        title: `[nlm-${label}] ${title}`,
        content_hash: hash,
        chunk_count: chunks.length,
        status: "indexed",
        last_indexed_at: new Date().toISOString(),
        metadata: { notebookLabel: label, filePath, extractedAt: new Date().toISOString() },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!docRes.ok) {
      return false;
    }
    const docData = (await docRes.json()) as Array<{ id: string }>;
    const docId = docData?.[0]?.id;
    if (!docId) {
      return false;
    }

    await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks?document_id=eq.${docId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });

    const chunkRecords = chunks.map((text, i) => ({
      document_id: docId,
      chunk_index: i,
      content: text,
      content_hash: hashContent(text),
      token_count: Math.ceil(text.split(/\s+/).length * 1.3),
    }));

    await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(chunkRecords),
    });

    return true;
  } catch {
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("📚 NotebookLM History Ingestion\n");

  const state = await loadState();

  if (STATUS_ONLY) {
    const extracted = Object.keys(state.extracted).length;
    const ingested = Object.values(state.extracted).filter((v) => v.ingested).length;
    console.log(`Extracted: ${extracted} sources`);
    console.log(`Ingested:  ${ingested} into AnythingLLM + Supabase`);
    console.log(`Last run:  ${state.lastRun || "never"}`);
    return;
  }

  // Build index of local content hashes
  console.log("🗂  Building local content index...");
  const localIndex = await buildLocalIndex();
  console.log(`   ${localIndex.size} local files indexed\n`);

  await fs.mkdir(EXPORT_DIR, { recursive: true });

  let totalExtracted = 0;
  let totalNew = 0;
  let totalDuplicates = 0;
  let totalIngested = 0;

  // Track unique content across notebooks (title → best content hash)
  const seenTitles = new Map<string, string>(); // title → contentHash

  for (const notebook of NOTEBOOKS) {
    console.log(`\n📓 Scanning: ${notebook.name}`);

    const sources = await listSources(notebook.id);
    console.log(`   ${sources.length} sources found`);

    for (const source of sources) {
      const title = source.title;
      const stateKey = `${notebook.id}:${source.id}`;

      // Skip if already extracted in a previous run
      if (state.extracted[stateKey]) {
        totalDuplicates++;
        process.stdout.write(".");
        continue;
      }

      // Skip if we've already seen a source with the same title this run
      if (seenTitles.has(title)) {
        totalDuplicates++;
        process.stdout.write("="); // same title, skip
        continue;
      }

      // Extract content
      const result = await getSourceContent(source.id);
      if (!result || result.charCount === 0) {
        process.stdout.write("_"); // empty
        seenTitles.set(title, "empty");
        continue;
      }

      totalExtracted++;
      const contentHash = hashContent(result.content);
      seenTitles.set(title, contentHash);

      // Check against local file index
      if (localIndex.has(contentHash)) {
        process.stdout.write("~"); // identical to local file
        state.extracted[stateKey] = {
          contentHash,
          savedTo: localIndex.get(contentHash) ?? "local",
          ingested: true, // already in local, so already backfilled
        };
        totalDuplicates++;
        continue;
      }

      // Genuinely new content — save it
      totalNew++;
      const filename = title.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-") + ".md";
      const savePath = path.join(EXPORT_DIR, `${notebook.name.replace(/\s+/g, "-")}-${filename}`);

      if (DRY_RUN) {
        console.log(
          `\n  📄 NEW: ${title} (${result.charCount} chars) → ${path.basename(savePath)}`,
        );
        // Do NOT update state in dry-run mode — avoids poisoning real runs
        continue;
      }

      // Save to export dir
      const fileContent = `---\ntitle: "${title}"\nsource: "notebooklm:${notebook.name}"\nextracted_at: "${new Date().toISOString()}"\ncontent_hash: "${contentHash}"\n---\n\n${result.content}`;
      await fs.writeFile(savePath, fileContent, "utf-8");

      // Ingest into AnythingLLM + Supabase
      process.stdout.write(`\n  ⬆️  ${title} (${result.charCount} chars)... `);
      const [allmlResult, sbResult] = await Promise.all([
        uploadToAnythingLLM(title, result.content, notebook.name),
        uploadToSupabase(title, result.content, contentHash, notebook.name, savePath),
      ]);

      const ok = allmlResult !== null || sbResult;
      process.stdout.write(ok ? "✅\n" : "⚠️  (saved locally)\n");
      if (ok) {
        totalIngested++;
      }

      state.extracted[stateKey] = { contentHash, savedTo: savePath, ingested: ok };

      // Save state after each new ingestion
      await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    }
    console.log();
  }

  if (!DRY_RUN) {
    state.lastRun = new Date().toISOString();
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  }

  console.log("\n──────────────────────────────────────────");
  console.log(`📊 Summary:`);
  console.log(`   Sources processed : ${totalExtracted + totalDuplicates}`);
  console.log(`   Duplicates skipped: ${totalDuplicates} (already local or seen this run)`);
  console.log(`   Genuinely new     : ${totalNew}`);
  console.log(`   Ingested          : ${totalIngested}`);

  if (totalNew === 0) {
    console.log(`\n✅ All NotebookLM content is already present locally.`);
    console.log(`   Memory is 100% complete from day one.`);
  } else {
    console.log(`\n✅ ${totalNew} new sources saved to memory/notebooklm-export/`);
    if (DRY_RUN) {
      console.log(`   (dry-run — no files written)`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
