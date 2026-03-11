#!/usr/bin/env tsx
import { execSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const WORKSPACE =
  process.env.WORKSPACE_DIR ||
  path.join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const SCRIPTS_DIR = path.join(WORKSPACE, "scripts");
const STATE_DIR = path.join(WORKSPACE, "state");
const OUT_PATH = path.join(STATE_DIR, "service-health.json");

interface ServiceHealth {
  name: string;
  label: string;
  loaded: boolean;
  lastRan: string | null;
  status: "ok" | "warn" | "error";
  recentErrors: string[];
  stdoutPath?: string;
  stderrPath?: string;
}

function parsePlistValue(content: string, key: string): string | undefined {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`);
  const m = content.match(re);
  return m?.[1];
}

function listPlists(): string[] {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter(
      (f) =>
        (f.startsWith("com.openclaw.") || f.startsWith("com.tulsbot.")) && f.endsWith(".plist"),
    )
    .map((f) => path.join(SCRIPTS_DIR, f));
}

function isLoaded(label: string): boolean {
  try {
    const out = execSync(`launchctl list | grep -F "${label}" || true`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function tailErrors(filePath?: string): string[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  try {
    const out = execSync(`tail -n 8 "${filePath}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => /error|fatal|exception|failed|traceback/i.test(l))
      .slice(-5);
  } catch {
    return [];
  }
}

function getLastRan(...pathsToCheck: Array<string | undefined>): string | null {
  const stats = pathsToCheck
    .filter((p): p is string => Boolean(p))
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.statSync(p).mtimeMs)
    .toSorted((a, b) => b - a);
  if (!stats.length) {
    return null;
  }
  return new Date(stats[0]).toISOString();
}

async function main() {
  const plists = listPlists();
  const services: ServiceHealth[] = [];

  for (const plistPath of plists) {
    const content = fs.readFileSync(plistPath, "utf8");
    const label = parsePlistValue(content, "Label") || path.basename(plistPath, ".plist");
    const stdoutPath = parsePlistValue(content, "StandardOutPath");
    const stderrPath = parsePlistValue(content, "StandardErrorPath");

    const loaded = isLoaded(label);
    const recentErrors = tailErrors(stderrPath);
    const lastRan = getLastRan(stdoutPath, stderrPath);

    let status: ServiceHealth["status"] = "ok";
    if (!loaded) {
      status = "warn";
    }
    if (recentErrors.length > 0) {
      status = "error";
    }

    services.push({
      name: path.basename(plistPath),
      label,
      loaded,
      lastRan,
      status,
      recentErrors,
      stdoutPath,
      stderrPath,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    total: services.length,
    ok: services.filter((s) => s.status === "ok").length,
    warn: services.filter((s) => s.status === "warn").length,
    error: services.filter((s) => s.status === "error").length,
    services,
  };

  await fsp.mkdir(STATE_DIR, { recursive: true });
  await fsp.writeFile(OUT_PATH, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(
    `service-health: total=${summary.total} ok=${summary.ok} warn=${summary.warn} error=${summary.error}`,
  );
}

main().catch((err) => {
  console.error("service-health fatal:", err);
  process.exit(1);
});
