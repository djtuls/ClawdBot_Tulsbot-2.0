#!/usr/bin/env tsx
/**
 * setup-master-index.ts — One-time setup: apply master_index schema to Supabase
 *
 * Usage:
 *   npx tsx scripts/indexer/setup-master-index.ts
 *
 * Tries (in order):
 *   1. SUPABASE_DB_URL env var → direct postgres connection via pg
 *   2. SUPABASE_ACCESS_TOKEN env var → Management API (requires PAT, not service key)
 *   3. Prints the SQL with instructions to paste into Supabase SQL editor
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const MIGRATION_PATH = path.join(REPO_ROOT, "supabase/migrations/20260222_master_index.sql");

const SUPABASE_URL = process.env["SUPABASE_URL"]?.trim() ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() ?? "";
const SUPABASE_DB_URL = process.env["SUPABASE_DB_URL"]?.trim() ?? "";
const SUPABASE_ACCESS_TOKEN = process.env["SUPABASE_ACCESS_TOKEN"]?.trim() ?? "";

// Derive project ref from URL
const projectRef = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "";

async function checkAlreadyExists(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/master_index?limit=1&select=id`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    return res.status === 200 || res.status === 204;
  } catch {
    return false;
  }
}

async function tryManagementApi(sql: string): Promise<boolean> {
  if (!SUPABASE_ACCESS_TOKEN || !projectRef) {
    return false;
  }
  console.log("   → Trying Management API...");
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (res.ok) {
      console.log("✅ Migration applied via Management API.");
      return true;
    }
    const body = await res.text();
    console.warn(`   Management API failed (${res.status}): ${body.slice(0, 200)}`);
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`   Management API error: ${message}`);
    return false;
  }
}

async function tryDirectPg(sql: string): Promise<boolean> {
  if (!SUPABASE_DB_URL) {
    return false;
  }
  console.log("   → Trying direct postgres connection...");
  try {
    // Dynamic import so it doesn't fail if pg is not installed
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: SUPABASE_DB_URL });
    await client.connect();
    await client.query(sql);
    await client.end();
    console.log("✅ Migration applied via direct postgres connection.");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`   Direct pg failed: ${message}`);
    return false;
  }
}

async function main() {
  console.log("🔧 Master Index Setup\n");

  const sql = await fs.readFile(MIGRATION_PATH, "utf8");

  // Already applied?
  if (await checkAlreadyExists()) {
    console.log("✅ master_index table already exists — nothing to do.");
    return;
  }

  console.log("📋 master_index table not found. Attempting to apply migration...\n");

  if (await tryManagementApi(sql)) {
    return;
  }
  if (await tryDirectPg(sql)) {
    return;
  }

  // Fallback: print instructions
  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log("⚡ MANUAL STEP REQUIRED");
  console.log("──────────────────────────────────────────────────────────────────");
  console.log(`\nOpen the Supabase SQL editor for project: ${projectRef || SUPABASE_URL}`);
  console.log(
    "  → https://supabase.com/dashboard/project/" + (projectRef || "<project-ref>") + "/sql/new",
  );
  console.log("\nPaste and run the following SQL:\n");
  console.log("──────────────────────────────────────────────────────────────────");
  console.log(sql);
  console.log("──────────────────────────────────────────────────────────────────");
  console.log("\nOr set SUPABASE_ACCESS_TOKEN (Supabase PAT) or SUPABASE_DB_URL in .env");
  console.log("and re-run: npx tsx scripts/indexer/setup-master-index.ts");
  console.log("\nAfter applying the migration, run the indexer:");
  console.log("  npx tsx scripts/indexer/run-indexer.ts");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
