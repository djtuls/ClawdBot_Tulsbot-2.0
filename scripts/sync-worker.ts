#!/usr/bin/env tsx
import "dotenv/config";
import { DriveAdapter } from "../src/sync/adapters/drive-adapter.js";
import { NotionAdapter } from "../src/sync/adapters/notion-adapter.js";
import { runReconcileWorker } from "../src/sync/reconcile-worker.js";
import { SupabaseSyncRepository } from "../src/sync/supabase-sync-repository.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const worker = process.argv[2]?.trim();
  if (!worker || (worker !== "notion" && worker !== "drive")) {
    console.error("Usage: pnpm tsx scripts/sync-worker.ts <notion|drive>");
    process.exit(1);
  }

  const repository = new SupabaseSyncRepository(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
  );
  const adapter =
    worker === "notion"
      ? new NotionAdapter(required("NOTION_KEY"))
      : new DriveAdapter(required("GOOGLE_DRIVE_ACCESS_TOKEN"));

  const targetPrefix = `${worker}.`;
  const result = await runReconcileWorker({
    targetPrefix,
    repository,
    adapter,
    limit: 200,
  });
  console.log(JSON.stringify({ worker, ...result }, null, 2));
}

main().catch((error) => {
  console.error("[sync-worker] failed", error);
  process.exit(1);
});
