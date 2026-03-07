import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");
const PREF_PATH = path.join(WORKSPACE, "memory", "operator-preferences.json");

export async function getOperatorTimeZone(): Promise<string> {
  try {
    const raw = await fs.readFile(PREF_PATH, "utf8");
    const parsed = JSON.parse(raw) as { timezone?: string };
    if (parsed.timezone && typeof parsed.timezone === "string") {
      return parsed.timezone;
    }
  } catch {
    // fallback below
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
