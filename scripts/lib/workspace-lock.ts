import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

export interface WorkspaceLease {
  agent: string;
  acquiredAt: string;
  expiresAt: string;
  action: string;
}

const DEFAULT_LEASE_MS = 60_000;

function nowIso() {
  return new Date().toISOString();
}

function isExpired(iso: string): boolean {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return true;
  }
  return Date.now() > ts;
}

async function ensureFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "{}\n");
  }
}

export async function withWorkspaceLease<T>(
  repoRoot: string,
  agent: string,
  action: string,
  fn: () => Promise<T>,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  const ownerPath = path.join(repoRoot, "state", "workspace-owner.json");
  await ensureFile(ownerPath);

  const release = await lockfile.lock(ownerPath, {
    stale: leaseMs * 2,
    retries: 0,
    realpath: false,
  });

  try {
    let current: WorkspaceLease | null = null;
    try {
      current = JSON.parse(await fs.readFile(ownerPath, "utf8")) as WorkspaceLease;
    } catch {
      current = null;
    }

    if (
      current?.agent &&
      current.agent !== agent &&
      current.expiresAt &&
      !isExpired(current.expiresAt)
    ) {
      return {
        ok: false,
        reason: `workspace lease held by ${current.agent} until ${current.expiresAt}`,
      };
    }

    const lease: WorkspaceLease = {
      agent,
      action,
      acquiredAt: nowIso(),
      expiresAt: new Date(Date.now() + leaseMs).toISOString(),
    };
    await fs.writeFile(ownerPath, `${JSON.stringify(lease, null, 2)}\n`);

    const value = await fn();
    return { ok: true, value };
  } finally {
    await release();
  }
}
