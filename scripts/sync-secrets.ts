#!/usr/bin/env bun
/**
 * SECRETS-VAULT Sync
 *
 * Supabase api_keys table is the source of truth.
 * ~/.openclaw/.env is the offline mirror.
 * ~/.openclaw/secrets-meta.json is the per-key sidecar for conflict resolution.
 *
 * Conflict policy: latest updated_at wins (per-key, not whole-file mtime).
 *
 * Usage:
 *   bun scripts/sync-secrets.ts [status|reconcile|sync-to-cloud|sync-from-cloud|migrate-workspace-env]
 *
 *   reconcile (default):        pull cloud → merge (latest wins) → write .env → push local-newer keys
 *   sync-to-cloud:              push all .env keys to Supabase + Fly.io (no merge)
 *   sync-from-cloud:            pull vault-managed cloud keys, overwrite .env (no merge)
 *   migrate-workspace-env:      move vault-managed keys from workspace/.env → ~/.openclaw/.env
 *   status:                     show counts and diff
 *
 * Env / flags:
 *   FLY_APP   — Fly.io app to push secrets to (default: clawdbot-tulsbot)
 *   --no-fly  — skip Fly.io push even when fly CLI is present
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile, rename, mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zjdsdzndyobixzboegvz.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const OPENCLAW_DIR = join(homedir(), ".openclaw");
const ENV_PATH = join(OPENCLAW_DIR, ".env");
const META_PATH = join(OPENCLAW_DIR, "secrets-meta.json");
const WORKSPACE_ENV_PATH = join(homedir(), ".openclaw", "workspace", ".env");
const TABLE = "api_keys";

const DEFAULT_FLY_APP = "clawdbot-tulsbot";
const FLY_APP = process.env.FLY_APP ?? DEFAULT_FLY_APP;
const NO_FLY = process.argv.includes("--no-fly");

// Keys managed by vault. Only these are synced bidirectionally.
const VAULT_SERVICE_MAP: Record<string, string> = {
  ANTHROPIC_API_KEY: "anthropic",
  OPENAI_API_KEY: "openai",
  TELEGRAM_BOT_TOKEN: "telegram",
  DISCORD_BOT_TOKEN: "discord",
  NOTION_API_KEY: "notion",
  SUPABASE_URL: "supabase",
  SUPABASE_SERVICE_ROLE_KEY: "supabase",
  SUPABASE_SERVICE_KEY: "supabase",
  NGROK_AUTH_TOKEN: "ngrok",
  OPENROUTER_API_KEY: "openrouter",
  BRAVE_API_KEY: "brave",
  GITHUB_TOKEN: "github",
  OPENCLAW_TELEGRAM_WEBHOOK_SECRET: "openclaw",
  OPENCLAW_LOCAL_HEALTH_URL: "openclaw",
  VENICE_API_KEY: "venice",
  OPENCLAW_GATEWAY_TOKEN: "openclaw",
  GOOGLE_CLIENT_ID: "google",
  GOOGLE_CLIENT_SECRET: "google",
  GOOGLE_REFRESH_TOKEN: "google",
  TULSBOT_GMAIL_CLIENT_ID: "google",
  TULSBOT_GMAIL_CLIENT_SECRET: "google",
  TULSBOT_GMAIL_REFRESH_TOKEN: "google",
  TULSBOT_GMAIL_ADDRESS: "google",
};

type ApiKey = {
  id: string;
  name: string;
  service: string;
  key_value: string;
  enabled: boolean;
  updated_at: string;
};

type KeyMeta = {
  valueHash: string;
  updated_at: string;
  source: "cloud" | "local";
};

type MetaStore = Record<string, KeyMeta>;

// ─── Utilities ───────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Supabase timestamps lack a `Z` suffix but are UTC — normalize so Date parsing is correct. */
function toUtcMs(ts: string): number {
  const normalized = ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z";
  return new Date(normalized).getTime();
}

function deterministicId(name: string): string {
  const hash = createHash("sha256").update(name).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function parseEnv(content: string): Map<string, { value: string; lineIdx: number }> {
  const map = new Map<string, { value: string; lineIdx: number }>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      map.set(match[1], { value: match[2].replace(/^["']|["']$/g, ""), lineIdx: i });
    }
  }
  return map;
}

/** Atomic write — preserves comments/ordering; updates in-place, appends new keys. */
async function writeEnvAtomic(
  envPath: string,
  updates: Record<string, string>,
): Promise<{ written: number; appended: number }> {
  const dir = join(envPath, "..");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const lines = existing.split("\n");
  const updatedKeys = new Set<string>();
  let written = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && match[1] in updates) {
      lines[i] = `${match[1]}=${updates[match[1]]}`;
      updatedKeys.add(match[1]);
      written++;
    }
  }

  let appended = 0;
  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      lines.push(`${key}=${val}`);
      appended++;
    }
  }

  const tmp = `${envPath}.sync-tmp`;
  await mkdir(dir, { recursive: true });
  await writeFile(tmp, lines.join("\n").trimEnd() + "\n", "utf-8");
  await rename(tmp, envPath);
  return { written, appended };
}

/** Replace specific keys in a .env file with a migration comment. */
async function removeKeysFromEnv(envPath: string, keysToRemove: Set<string>): Promise<number> {
  if (!existsSync(envPath)) {
    return 0;
  }
  const lines = readFileSync(envPath, "utf-8").split("\n");
  let removed = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && keysToRemove.has(match[1])) {
      lines[i] = `# ${match[1]}= (moved to ~/.openclaw/.env — vault-managed)`;
      removed++;
    }
  }

  const tmp = `${envPath}.sync-tmp`;
  await writeFile(tmp, lines.join("\n").trimEnd() + "\n", "utf-8");
  await rename(tmp, envPath);
  return removed;
}

// ─── Fly.io helpers ───────────────────────────────────────────────────────────

function flyBinPath(): string | null {
  // Use spawnSync to avoid shell injection — checks standard install locations
  for (const candidate of ["/opt/homebrew/bin/fly", "/usr/local/bin/fly", "/usr/bin/fly"]) {
    const r = spawnSync(candidate, ["version"], { encoding: "utf-8" });
    if (r.status === 0) {
      return candidate;
    }
  }
  // Try PATH-based lookup via `which` as last resort (shell-free spawnSync)
  const r = spawnSync("which", ["fly"], { encoding: "utf-8" });
  if (r.status === 0) {
    return r.stdout.trim() || null;
  }
  return null;
}

/**
 * Push vault-managed keys to a Fly.io app via `fly secrets import`.
 * Values are passed via stdin so they never appear in the process list.
 * Uses --stage to avoid triggering an immediate deploy on every sync.
 */
function pushToFly(
  keys: Record<string, string>,
  app: string,
): { pushed: number; skipped: boolean } {
  if (NO_FLY) {
    console.log("  ⏭️  Fly.io push skipped (--no-fly)");
    return { pushed: 0, skipped: true };
  }

  const flyPath = flyBinPath();
  if (!flyPath) {
    console.warn("  ⚠️  fly CLI not found — skipping Fly.io push");
    return { pushed: 0, skipped: true };
  }

  const keyCount = Object.keys(keys).length;
  if (keyCount === 0) {
    console.log("  ✅ Fly.io already up-to-date (no vault keys to push)");
    return { pushed: 0, skipped: false };
  }

  // Build KEY=VALUE pairs for stdin — values never passed as CLI args
  const stdin = Object.entries(keys)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const result = spawnSync(flyPath, ["secrets", "import", "--app", app, "--stage"], {
    input: stdin,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    const errMsg = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
    throw new Error(`fly secrets import failed: ${errMsg}`);
  }

  const keyNames = Object.keys(keys).join(", ");
  console.log(`  ✅ Fly.io staged ${keyCount} key(s) for '${app}' [${keyNames}]`);
  console.log(`     (run 'fly deploy --app ${app}' when ready to apply)`);
  return { pushed: keyCount, skipped: false };
}

// ─── Supabase helpers ────────────────────────────────────────────────────────

function supabaseHeaders(): HeadersInit {
  if (!SUPABASE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchCloudKeys(): Promise<ApiKey[]> {
  if (!SUPABASE_KEY) {
    console.warn("⚠️  SUPABASE_SERVICE_ROLE_KEY not set — skipping cloud fetch");
    return [];
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*`, {
    headers: supabaseHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase fetch failed: ${res.status} ${body}`);
  }
  return (await res.json()) as ApiKey[];
}

async function upsertCloudKey(key: ApiKey): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(key),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert failed for ${key.name}: ${res.status} ${body}`);
  }
}

// ─── Meta sidecar ────────────────────────────────────────────────────────────

function loadMeta(): MetaStore {
  if (!existsSync(META_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(META_PATH, "utf-8")) as MetaStore;
  } catch {
    return {};
  }
}

async function saveMeta(meta: MetaStore): Promise<void> {
  const tmp = `${META_PATH}.tmp`;
  await mkdir(OPENCLAW_DIR, { recursive: true });
  await writeFile(tmp, JSON.stringify(meta, null, 2) + "\n", "utf-8");
  await rename(tmp, META_PATH);
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function reconcile(): Promise<void> {
  console.log("🔄 Reconciling vault (latest-key-wins)…");

  const cloudKeys = await fetchCloudKeys();
  const cloudMap = new Map(cloudKeys.map((k) => [k.name, k]));
  const localEnv = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf-8")) : new Map();
  const meta = loadMeta();
  const now = new Date().toISOString();

  const envUpdates: Record<string, string> = {};
  const cloudPushes: ApiKey[] = [];
  const flyPushes: Record<string, string> = {};
  let localNewer = 0;
  let cloudNewer = 0;
  let newFromCloud = 0;
  let newFromLocal = 0;

  const allKeys = new Set([
    ...Object.keys(VAULT_SERVICE_MAP),
    ...[...cloudMap.keys()].filter((k) => k in VAULT_SERVICE_MAP),
    ...[...localEnv.keys()].filter((k) => k in VAULT_SERVICE_MAP),
  ]);

  for (const name of allKeys) {
    const cloud = cloudMap.get(name);
    const localEntry = localEnv.get(name);
    const localMeta = meta[name];

    if (cloud && localEntry) {
      const cloudTime = toUtcMs(cloud.updated_at);
      const localTime = localMeta ? toUtcMs(localMeta.updated_at) : 0;

      if (cloudTime >= localTime) {
        if (localEntry.value !== cloud.key_value) {
          envUpdates[name] = cloud.key_value;
          meta[name] = {
            valueHash: sha256(cloud.key_value),
            updated_at: cloud.updated_at,
            source: "cloud",
          };
          cloudNewer++;
        }
      } else {
        if (sha256(localEntry.value) !== (localMeta?.valueHash ?? "")) {
          cloudPushes.push({
            id: deterministicId(name),
            name,
            service: VAULT_SERVICE_MAP[name] ?? name.split("_")[0].toLowerCase(),
            key_value: localEntry.value,
            enabled: true,
            updated_at: now,
          });
          flyPushes[name] = localEntry.value;
          meta[name] = { valueHash: sha256(localEntry.value), updated_at: now, source: "local" };
          localNewer++;
        }
      }
    } else if (cloud && !localEntry) {
      envUpdates[name] = cloud.key_value;
      meta[name] = {
        valueHash: sha256(cloud.key_value),
        updated_at: cloud.updated_at,
        source: "cloud",
      };
      newFromCloud++;
    } else if (!cloud && localEntry && name in VAULT_SERVICE_MAP) {
      cloudPushes.push({
        id: deterministicId(name),
        name,
        service: VAULT_SERVICE_MAP[name] ?? name.split("_")[0].toLowerCase(),
        key_value: localEntry.value,
        enabled: true,
        updated_at: now,
      });
      flyPushes[name] = localEntry.value;
      meta[name] = { valueHash: sha256(localEntry.value), updated_at: now, source: "local" };
      newFromLocal++;
    }
  }

  if (Object.keys(envUpdates).length > 0) {
    const { written, appended } = await writeEnvAtomic(ENV_PATH, envUpdates);
    console.log(
      `  ✅ .env updated — ${written} replaced, ${appended} appended (cloud-newer: ${cloudNewer}, new-from-cloud: ${newFromCloud})`,
    );
  } else {
    console.log("  ✅ .env already up-to-date");
  }

  if (cloudPushes.length > 0) {
    for (const key of cloudPushes) {
      await upsertCloudKey(key);
    }
    console.log(
      `  ✅ Pushed ${cloudPushes.length} key(s) to Supabase (local-newer: ${localNewer}, new-from-local: ${newFromLocal})`,
    );
    pushToFly(flyPushes, FLY_APP);
  } else {
    console.log("  ✅ Cloud already up-to-date");
  }

  await saveMeta(meta);
  console.log("  ✅ Meta sidecar saved");
  warnWorkspaceEnv();
}

async function syncToCloud(): Promise<void> {
  console.log("☁️  Pushing all .env vault keys to Supabase + Fly.io…");
  const localEnv = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf-8")) : new Map();
  const meta = loadMeta();
  const now = new Date().toISOString();
  const flyKeys: Record<string, string> = {};
  let pushed = 0;

  for (const [name, { value }] of localEnv) {
    if (!(name in VAULT_SERVICE_MAP)) {
      continue;
    }
    await upsertCloudKey({
      id: deterministicId(name),
      name,
      service: VAULT_SERVICE_MAP[name] ?? name.split("_")[0].toLowerCase(),
      key_value: value,
      enabled: true,
      updated_at: now,
    });
    meta[name] = { valueHash: sha256(value), updated_at: now, source: "local" };
    flyKeys[name] = value;
    pushed++;
  }

  await saveMeta(meta);
  console.log(`  ✅ Pushed ${pushed} key(s) to Supabase`);
  pushToFly(flyKeys, FLY_APP);
  warnWorkspaceEnv();
}

async function syncFromCloud(): Promise<void> {
  console.log("📥 Pulling vault keys from cloud → .env (overwrite)…");
  const cloudKeys = await fetchCloudKeys();
  const meta = loadMeta();
  const updates: Record<string, string> = {};

  for (const key of cloudKeys) {
    if (!(key.name in VAULT_SERVICE_MAP)) {
      continue;
    }
    updates[key.name] = key.key_value;
    meta[key.name] = {
      valueHash: sha256(key.key_value),
      updated_at: key.updated_at,
      source: "cloud",
    };
  }

  const { written, appended } = await writeEnvAtomic(ENV_PATH, updates);
  await saveMeta(meta);
  console.log(
    `✅ Pulled ${Object.keys(updates).length} vault key(s) from cloud — ${written} updated, ${appended} new`,
  );
}

async function status(): Promise<void> {
  const localEnv = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf-8")) : new Map();
  const meta = loadMeta();
  let cloudKeys: ApiKey[] = [];
  try {
    cloudKeys = await fetchCloudKeys();
  } catch (err) {
    console.warn(`⚠️  Cloud fetch failed: ${String(err)}`);
  }

  const cloudMap = new Map(cloudKeys.map((k) => [k.name, k]));
  const vaultLocal = [...localEnv.keys()].filter((k) => k in VAULT_SERVICE_MAP);
  const vaultCloud = cloudKeys.filter((k) => k.name in VAULT_SERVICE_MAP);

  console.log(`
📊 Secrets-Vault Status
─────────────────────────────────────────
~/.openclaw/.env:      ${localEnv.size} total, ${vaultLocal.length} vault-managed
Cloud (api_keys):      ${vaultCloud.length} vault-managed (${cloudKeys.length} total rows)
Meta sidecar entries:  ${Object.keys(meta).length}
Fly.io app:            ${FLY_APP}
  `);

  const onlyLocal = vaultLocal.filter((k) => !cloudMap.has(k));
  const onlyCloud = vaultCloud.filter((k) => !localEnv.has(k.name)).map((k) => k.name);

  if (onlyLocal.length) {
    console.log(`  Local-only:  ${onlyLocal.join(", ")}`);
  }
  if (onlyCloud.length) {
    console.log(`  Cloud-only:  ${onlyCloud.join(", ")}`);
  }

  warnWorkspaceEnv();
}

/**
 * Move vault-managed keys from workspace/.env → ~/.openclaw/.env.
 * Backs up workspace/.env first, then replaces moved lines with comments.
 */
async function migrateWorkspaceEnv(): Promise<void> {
  if (!existsSync(WORKSPACE_ENV_PATH)) {
    console.log("✅ workspace/.env not found — nothing to migrate");
    return;
  }

  const workspaceEnv = parseEnv(readFileSync(WORKSPACE_ENV_PATH, "utf-8"));
  const vaultKeys = [...workspaceEnv.keys()].filter((k) => k in VAULT_SERVICE_MAP);

  if (vaultKeys.length === 0) {
    console.log("✅ workspace/.env has no vault-managed keys — nothing to migrate");
    return;
  }

  console.log(`🔀 Migrating ${vaultKeys.length} vault key(s): workspace/.env → ~/.openclaw/.env`);
  console.log(`   Keys: ${vaultKeys.join(", ")}`);

  // Backup workspace/.env before modifying
  const backupPath = `${WORKSPACE_ENV_PATH}.pre-migrate-${Date.now()}`;
  await copyFile(WORKSPACE_ENV_PATH, backupPath);
  console.log(`  📦 Backup: ${backupPath}`);

  // Only write keys not already in canonical .env
  const canonicalEnv = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf-8")) : new Map();
  const toAdd: Record<string, string> = {};
  const skipped: string[] = [];

  for (const key of vaultKeys) {
    if (canonicalEnv.has(key)) {
      skipped.push(key);
    } else {
      toAdd[key] = workspaceEnv.get(key)!.value;
    }
  }

  if (Object.keys(toAdd).length > 0) {
    await writeEnvAtomic(ENV_PATH, toAdd);
    console.log(`  ✅ Added ${Object.keys(toAdd).length} key(s) to ~/.openclaw/.env`);
  }
  if (skipped.length > 0) {
    console.log(`  ⏭️  Already in ~/.openclaw/.env (not overwritten): ${skipped.join(", ")}`);
  }

  const removed = await removeKeysFromEnv(WORKSPACE_ENV_PATH, new Set(vaultKeys));
  console.log(`  ✅ Replaced ${removed} key(s) in workspace/.env with migration comments`);
  console.log("\n💡 Run 'reconcile' next to sync the migrated keys to Supabase + Fly.io");
}

function warnWorkspaceEnv(): void {
  if (!existsSync(WORKSPACE_ENV_PATH)) {
    return;
  }
  const keys = [...parseEnv(readFileSync(WORKSPACE_ENV_PATH, "utf-8")).keys()];
  const secretKeys = keys.filter((k) => k in VAULT_SERVICE_MAP);
  if (secretKeys.length > 0) {
    console.warn(
      `\n⚠️  workspace/.env contains ${secretKeys.length} vault-managed key(s): ${secretKeys.join(", ")}\n   Run: npx tsx scripts/sync-secrets.ts migrate-workspace-env`,
    );
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const command = process.argv[2] ?? "reconcile";

const handlers: Record<string, () => Promise<void>> = {
  reconcile,
  "sync-to-cloud": syncToCloud,
  "sync-from-cloud": syncFromCloud,
  "sync-to-local": syncFromCloud,
  "migrate-workspace-env": migrateWorkspaceEnv,
  status,
};

const handler = handlers[command];
if (!handler) {
  console.error(`Unknown command: ${command}. Valid: ${Object.keys(handlers).join(", ")}`);
  process.exit(1);
}

await handler();
