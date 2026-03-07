import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");

const ENV_PATH = join(WORKSPACE, ".env");

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1);
    if (!key) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

function serializeEnv(env: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n") + "\n";
}

export function getSecret(name: string): string | null {
  if (!name) {
    return null;
  }

  if (process.env[name] && process.env[name] !== "") {
    return process.env[name];
  }

  if (!existsSync(ENV_PATH)) {
    return null;
  }

  try {
    const content = readFileSync(ENV_PATH, "utf-8");
    const env = parseEnvFile(content);
    const value = env[name];
    return value !== undefined && value !== "" ? value : null;
  } catch {
    return null;
  }
}

export function setSecret(name: string, value: string): void {
  if (!name) {
    return;
  }

  let env: Record<string, string> = {};

  if (existsSync(ENV_PATH)) {
    try {
      const content = readFileSync(ENV_PATH, "utf-8");
      env = parseEnvFile(content);
    } catch {
      env = {};
    }
  } else {
    const dir = dirname(ENV_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  env[name] = value;

  writeFileSync(ENV_PATH, serializeEnv(env), { encoding: "utf-8" });

  // Keep current process in sync.
  process.env[name] = value;
}
