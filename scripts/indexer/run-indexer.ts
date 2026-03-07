#!/usr/bin/env tsx
/**
 * run-indexer.ts — Master Indexer entry point
 *
 * Usage:
 *   npx tsx scripts/indexer/run-indexer.ts [--dry-run] [--purge-stale]
 *
 * Flags:
 *   --dry-run      Scan and report without writing to Supabase
 *   --purge-stale  Delete items not seen in this run (older than 7 days)
 *   --quiet        Suppress verbose output (still logs summary)
 */

import "dotenv/config";
import type { IndexItem } from "./types.js";
import { scanDatabases } from "./scan-databases.js";
import { scanTools } from "./scan-tools.js";
import { scanWorkspace } from "./scan-workspace.js";
import { syncToSupabase, purgeStaleItems, checkTableExists } from "./sync-supabase.js";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const PURGE_STALE = args.has("--purge-stale");
const QUIET = args.has("--quiet");

function log(...msg: unknown[]) {
  if (!QUIET) {
    console.log(...msg);
  }
}

async function main() {
  const startedAt = Date.now();
  log("🔍 Master Indexer starting...");
  if (DRY_RUN) {
    log("   (dry-run mode — no writes to Supabase)");
  }

  // Run all scanners
  const [workspaceResult, toolsResult, dbResult] = await Promise.all([
    scanWorkspace(),
    scanTools(),
    scanDatabases(),
  ]);

  const allResults = [workspaceResult, toolsResult, dbResult];
  const allItems: IndexItem[] = allResults.flatMap((r) => r.items);
  const allErrors: string[] = allResults.flatMap((r) => r.errors);

  // Deduplicate by item_key (last write wins — later scanners take precedence)
  const dedupMap = new Map<string, IndexItem>();
  for (const item of allItems) {
    dedupMap.set(item.item_key, item);
  }
  const dedupedItems = [...dedupMap.values()];

  // Summary by type and status
  const byType = dedupedItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.source_type] = (acc[item.source_type] ?? 0) + 1;
    return acc;
  }, {});
  const byStatus = dedupedItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  log("\n📊 Scan results:");
  for (const [scanner, result] of allResults.map((r) => [r.scanner, r] as const)) {
    log(`   ${scanner}: ${result.items.length} items, ${result.errors.length} errors`);
  }
  log(`\n   Total unique items: ${dedupedItems.length}`);
  log(`   By type:   ${JSON.stringify(byType)}`);
  log(`   By status: ${JSON.stringify(byStatus)}`);

  if (allErrors.length > 0) {
    console.warn(`\n⚠️  Scan errors (${allErrors.length}):`);
    for (const err of allErrors) {
      console.warn(`   • ${err}`);
    }
  }

  // Sync to Supabase
  if (!DRY_RUN) {
    const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
    const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();

    if (!supabaseUrl || !serviceKey) {
      console.warn(
        "\n⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping Supabase sync.",
      );
      console.warn("   Run: source .env && npx tsx scripts/indexer/run-indexer.ts");
    } else {
      // Verify table exists before syncing
      const tableReady = await checkTableExists(supabaseUrl, serviceKey);
      if (!tableReady) {
        console.warn("\n⚠️  master_index table not found in Supabase.");
        console.warn("   Apply the migration first:");
        console.warn("   npx supabase db push --project-ref zjdsdzndyobixzboegvz");
        console.warn(
          "   OR paste supabase/migrations/20260222_master_index.sql into the Supabase SQL editor.",
        );
      } else {
        log("\n⬆️  Syncing to Supabase...");
        const stats = await syncToSupabase(dedupedItems);
        log(`   Synced: ${stats.total} items in ${stats.batches} batches`);

        if (stats.errors.length > 0) {
          console.error(`\n❌ Sync errors (${stats.errors.length}):`);
          for (const err of stats.errors) {
            console.error(`   • ${err}`);
          }
        }

        if (PURGE_STALE) {
          log("\n🧹 Purging stale items...");
          const activeKeys = new Set(dedupedItems.map((i) => i.item_key));
          await purgeStaleItems(activeKeys);
          log("   Purge complete.");
        }
      }
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const exitCode = allErrors.length > 0 ? 1 : 0;

  console.log(
    `\n✅ Master Indexer done in ${elapsed}s — ${dedupedItems.length} items indexed` +
      (DRY_RUN ? " (dry-run)" : "") +
      (allErrors.length > 0 ? ` | ${allErrors.length} errors` : ""),
  );

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Master Indexer crashed:", err);
  process.exit(1);
});
