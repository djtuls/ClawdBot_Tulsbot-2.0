#!/usr/bin/env npx tsx
/**
 * Secret Store — Write API keys and secrets to workspace .env
 *
 * Usage:
 *   npx tsx scripts/secrets/store-secret.ts NAME VALUE
 *
 * Example:
 *   npx tsx scripts/secrets/store-secret.ts TODOIST_API_TOKEN abc123...
 */

import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { setSecret } from "../lib/secrets.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");

async function main() {
  const [, , name, value] = process.argv;

  if (!name || !value) {
    console.error("Usage: npx tsx scripts/secrets/store-secret.ts NAME VALUE");
    process.exit(1);
  }

  setSecret(name, value);

  const suffix = value.length >= 4 ? value.slice(-4) : "****";

  logEvent({
    source: "secrets-store",
    action: "set-secret",
    target: name,
    result: "ok",
    detail: `ending-with=${suffix}`,
    rationale: "requested-via-chat-or-cli",
    rollback: "update value via store-secret or edit workspace .env",
  });

  console.log(`Stored secret ${name} (ending with ...${suffix}).`);
}

main().catch((err) => {
  console.error("[secrets-store] Fatal:", err);
  logEvent({
    source: "secrets-store",
    action: "fatal",
    result: "error",
    detail: String(err),
  });
  process.exit(1);
});
