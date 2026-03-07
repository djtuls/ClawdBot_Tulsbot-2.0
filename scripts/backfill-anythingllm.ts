#!/usr/bin/env tsx

/**
 * Backfill AnythingLLM with full ecosystem history
 *
 * Collects all memory, docs, reports, sessions, knowledge slices,
 * and core workspace files then uploads them to the local AnythingLLM
 * instance, tracking state to avoid re-uploading unchanged files.
 *
 * Usage:
 *   npx tsx scripts/backfill-anythingllm.ts         # full backfill
 *   npx tsx scripts/backfill-anythingllm.ts --reset  # clear state and re-upload everything
 *   npx tsx scripts/backfill-anythingllm.ts --status # show current state
 */

import { config as loadEnv } from "dotenv";
import FormData from "form-data";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

loadEnv({ path: path.join(PROJECT_ROOT, ".env") });

const ANYTHINGLLM_BASE_URL = process.env.ANYTHINGLLM_BASE_URL || "http://localhost:3001";
const ANYTHINGLLM_API_KEY = process.env.ANYTHINGLLM_API_KEY || "";
const WORKSPACE_SLUG = process.env.ANYTHINGLLM_WORKSPACE_SLUG || "tulsbot-brain";
const STATE_FILE = path.join(PROJECT_ROOT, ".anythingllm-backfill-state.json");

const RESET = process.argv.includes("--reset");
const STATUS_ONLY = process.argv.includes("--status");

type BackfillState = {
  lastRun: string;
  uploaded: Record<string, { hash: string; docPath: string; uploadedAt: string }>;
};

async function loadState(): Promise<BackfillState> {
  if (RESET) {
    return { lastRun: "", uploaded: {} };
  }
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastRun: "", uploaded: {} };
  }
}

async function saveState(state: BackfillState) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function hashContent(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

async function collectFiles(): Promise<{ filePath: string; label: string }[]> {
  const files: { filePath: string; label: string }[] = [];

  const scanDir = async (dir: string, label: string, ext = [".md", ".txt", ".json"]) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        // Skip very large json files and binary
        if (ext.some((e) => entry.name.endsWith(e))) {
          // Skip files > 2MB
          const stat = await fs.stat(fullPath).catch(() => null);
          if (stat && stat.size > 2 * 1024 * 1024) {
            continue;
          }
          files.push({ filePath: fullPath, label });
        }
      }
    } catch {
      // dir doesn't exist, skip
    }
  };

  // Core workspace files (highest priority)
  const coreFiles = [
    "RUNBOOK.md",
    "STATE.md",
    "ROADMAP.md",
    "TODO.md",
    "SOUL.md",
    "IDENTITY.md",
    "USER.md",
    "AGENTS.md",
    "TOOLS.md",
    "CHANGELOG.md",
    "HEARTBEAT.md",
    "MASTER_INDEX.md",
    "SECURITY.md",
  ];
  for (const f of coreFiles) {
    const fp = path.join(PROJECT_ROOT, f);
    try {
      await fs.access(fp);
      files.push({ filePath: fp, label: "core" });
    } catch {
      /* skip */
    }
  }

  // Memory files
  await scanDir(path.join(PROJECT_ROOT, "memory"), "memory", [".md", ".txt"]);

  // Docs
  await scanDir(path.join(PROJECT_ROOT, "docs"), "docs", [".md", ".txt"]);

  // Reports
  await scanDir(path.join(PROJECT_ROOT, "reports"), "reports", [".md", ".json", ".txt"]);

  // Sessions
  await scanDir(path.join(PROJECT_ROOT, "sessions"), "sessions", [".md", ".txt"]);

  // Knowledge slices
  await scanDir(path.join(PROJECT_ROOT, "knowledge-slices"), "knowledge", [".md", ".txt"]);

  // Archive (historical decisions)
  await scanDir(path.join(PROJECT_ROOT, "archive"), "archive", [".md", ".txt"]);

  // Workspace docs
  await scanDir(path.join(PROJECT_ROOT, "workspace"), "workspace-docs", [".md", ".txt"]);

  // Agent transcripts (in openclaw config dir)
  await scanDir(path.join(PROJECT_ROOT, "..", "session-archives"), "transcripts", [".md", ".txt"]);

  return files;
}

async function apiRequest(method: string, endpoint: string, body?: unknown) {
  const res = await fetch(`${ANYTHINGLLM_BASE_URL}/api/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${ANYTHINGLLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${endpoint} failed: ${res.status} ${text.substring(0, 200)}`);
  }
  return res.json();
}

async function uploadDocument(
  filePath: string,
  label: string,
): Promise<{ docPath: string } | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    const title = `[${label}] ${relativePath}`;

    // Use raw-text upload endpoint
    const res = await fetch(`${ANYTHINGLLM_BASE_URL}/api/v1/document/raw-text`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANYTHINGLLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        textContent: content,
        metadata: {
          title,
          docAuthor: "openclaw",
          description: `OpenClaw ecosystem - ${label}`,
          source: relativePath,
          url: relativePath,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      // Fallback: try /document/create-folder and upload as text file
      if (res.status === 404) {
        return await uploadAsTextFile(filePath, content, relativePath, label);
      }
      throw new Error(`Upload failed: ${res.status} ${text.substring(0, 150)}`);
    }

    const data = (await res.json()) as {
      success?: boolean;
      documents?: Array<{ location?: string }>;
      document?: { location?: string };
      docPath?: string;
    };
    const docPath =
      data?.documents?.[0]?.location || data?.document?.location || data?.docPath || relativePath;
    return { docPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠️  Upload failed for ${filePath}: ${msg.substring(0, 100)}`);
    return null;
  }
}

async function uploadAsTextFile(
  filePath: string,
  content: string,
  relativePath: string,
  label: string,
): Promise<{ docPath: string } | null> {
  try {
    const form = new FormData();
    const filename = path.basename(filePath);
    form.append("file", Buffer.from(content, "utf-8"), {
      filename: filename.endsWith(".md") ? filename : `${filename}.txt`,
      contentType: "text/plain",
    });

    const res = await fetch(`${ANYTHINGLLM_BASE_URL}/api/v1/document/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANYTHINGLLM_API_KEY}`,
        ...form.getHeaders(),
      },
      body: form.getBuffer(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`File upload failed: ${res.status} ${text.substring(0, 150)}`);
    }

    const data = (await res.json()) as {
      documents?: Array<{ location?: string }>;
      document?: { location?: string };
    };
    const docPath =
      data?.documents?.[0]?.location ||
      data?.document?.location ||
      `custom-documents/${path.basename(filePath)}`;
    return { docPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠️  File upload also failed for ${relativePath}: ${msg.substring(0, 100)}`);
    return null;
  }
}

async function embedDocsInWorkspace(docPaths: string[]) {
  if (docPaths.length === 0) {
    return;
  }
  const chunks = [];
  for (let i = 0; i < docPaths.length; i += 50) {
    chunks.push(docPaths.slice(i, i + 50));
  }
  for (const chunk of chunks) {
    try {
      await apiRequest("POST", `/workspace/${WORKSPACE_SLUG}/update-embeddings`, {
        adds: chunk,
        deletes: [],
      });
      process.stdout.write(".");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`\n  ⚠️  Embedding batch failed: ${msg.substring(0, 100)}`);
    }
  }
  console.log();
}

async function main() {
  console.log("🧠 AnythingLLM Backfill — OpenClaw Ecosystem\n");
  console.log(`  Target: ${ANYTHINGLLM_BASE_URL}`);
  console.log(`  Workspace: ${WORKSPACE_SLUG}`);

  // Check connectivity
  try {
    const auth = await apiRequest("GET", "/auth");
    if (!(auth as { authenticated: boolean }).authenticated) {
      throw new Error("Not authenticated");
    }
    console.log("  Auth: ✅\n");
  } catch (err) {
    console.error("❌ Cannot connect to AnythingLLM:", err);
    console.error("   Make sure AnythingLLM is running: docker start anythingllm");
    process.exit(1);
  }

  const state = await loadState();

  if (STATUS_ONLY) {
    const count = Object.keys(state.uploaded).length;
    console.log(`📊 State: ${count} files uploaded`);
    console.log(`   Last run: ${state.lastRun || "never"}`);
    const byLabel: Record<string, number> = {};
    for (const [k] of Object.entries(state.uploaded)) {
      const label = k.split("/")[0] || "unknown";
      byLabel[label] = (byLabel[label] || 0) + 1;
    }
    console.log("\n  By category:");
    for (const [l, c] of Object.entries(byLabel)) {
      console.log(`    ${l}: ${c}`);
    }
    return;
  }

  console.log("📂 Collecting files...");
  const files = await collectFiles();
  console.log(`   Found ${files.length} files\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const newDocPaths: string[] = [];

  console.log("⬆️  Uploading documents...");

  for (const { filePath, label } of files) {
    const key = path.relative(PROJECT_ROOT, filePath);
    let content: string;

    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const hash = hashContent(content);
    const existing = state.uploaded[key];

    if (existing && existing.hash === hash) {
      skipped++;
      continue;
    }

    process.stdout.write(`  [${label}] ${path.basename(filePath)}... `);
    const result = await uploadDocument(filePath, label);

    if (result) {
      state.uploaded[key] = {
        hash,
        docPath: result.docPath,
        uploadedAt: new Date().toISOString(),
      };
      newDocPaths.push(result.docPath);
      console.log("✅");
      uploaded++;

      // Save state periodically
      if (uploaded % 20 === 0) {
        await saveState(state);
      }
    } else {
      failed++;
    }
  }

  console.log(
    `\n📈 Upload summary: ${uploaded} uploaded, ${skipped} skipped (unchanged), ${failed} failed\n`,
  );

  if (newDocPaths.length > 0) {
    console.log(
      `🔗 Embedding ${newDocPaths.length} new docs into workspace "${WORKSPACE_SLUG}"...`,
    );
    await embedDocsInWorkspace(newDocPaths);
    console.log("✅ Embedding complete\n");
  } else {
    console.log("ℹ️  No new docs to embed (all up to date)\n");
  }

  state.lastRun = new Date().toISOString();
  await saveState(state);

  console.log(`✅ Backfill complete. State saved to .anythingllm-backfill-state.json`);
  console.log(`\n🔍 Query your brain at: ${ANYTHINGLLM_BASE_URL}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
