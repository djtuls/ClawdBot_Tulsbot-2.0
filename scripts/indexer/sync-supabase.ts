/**
 * sync-supabase.ts
 * Upserts IndexItem[] into the master_index table via PostgREST.
 * Uses the same raw-fetch pattern as mcp-sync-server.ts.
 */

import type { IndexItem } from "./types.js";

const BATCH_SIZE = 100;

function mustEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function postgrestHeaders(url: string, key: string): Record<string, string> {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates,return=minimal",
  };
}

export interface SyncStats {
  total: number;
  batches: number;
  errors: string[];
  skipped?: boolean;
}

/** Returns true if the master_index table exists and is reachable */
export async function checkTableExists(supabaseUrl: string, serviceKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/master_index?limit=1&select=id`, {
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
    });
    // 200 = table exists, 404 or 406 = table doesn't exist
    return response.status === 200 || response.status === 204;
  } catch {
    return false;
  }
}

export async function syncToSupabase(items: IndexItem[]): Promise<SyncStats> {
  const SUPABASE_URL = mustEnv("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = postgrestHeaders(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const stats: SyncStats = { total: 0, batches: 0, errors: [] };

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const payload = batch.map((item) => ({
      item_key: item.item_key,
      name: item.name,
      source_type: item.source_type,
      status: item.status,
      path: item.path ?? null,
      content_summary: item.content_summary ?? null,
      tags: item.tags,
      source_repo: item.source_repo,
      metadata: item.metadata,
      last_synced_at: new Date().toISOString(),
    }));

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/master_index?on_conflict=item_key`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        stats.errors.push(
          `batch ${stats.batches + 1} failed (${response.status}): ${body.slice(0, 200)}`,
        );
      } else {
        stats.total += batch.length;
      }
    } catch (err) {
      stats.errors.push(
        `batch ${stats.batches + 1} network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    stats.batches++;
  }

  return stats;
}

/** Mark items that are no longer found as stale (optional cleanup pass) */
export async function purgeStaleItems(activeKeys: Set<string>): Promise<void> {
  if (activeKeys.size === 0) {
    return;
  }

  const SUPABASE_URL = mustEnv("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Find all items last_synced_at older than 7 days that are not in activeKeys
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/master_index?last_synced_at=lt.${cutoff}&select=item_key`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
    },
  );

  if (!response.ok) {
    return;
  }

  const stale = (await response.json()) as { item_key: string }[];
  const toDelete = stale.filter((row) => !activeKeys.has(row.item_key)).map((row) => row.item_key);

  if (toDelete.length === 0) {
    return;
  }

  // Delete in batches of 50
  for (let i = 0; i < toDelete.length; i += 50) {
    const chunk = toDelete.slice(i, i + 50);
    const inClause = chunk.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(",");
    await fetch(`${SUPABASE_URL}/rest/v1/master_index?item_key=in.(${inClause})`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
    });
  }
}
