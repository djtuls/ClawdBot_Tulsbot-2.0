import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");
const REPORT_DIR = join(WORKSPACE, "reports/notion");
const CAPTURE_DB = "30351bf9-731e-81f2-bc24-dca63220f567";

function pageIdFromNotionUrl(url: string): string | null {
  const m = url.match(/([a-f0-9]{32})$/i);
  return m ? m[1] : null;
}

function normalizeId32ToUuid(id32: string): string {
  return `${id32.slice(0, 8)}-${id32.slice(8, 12)}-${id32.slice(12, 16)}-${id32.slice(16, 20)}-${id32.slice(20)}`;
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION token missing");
  }
  const notion = createNotionClient(token);

  if (!existsSync(PENDING_PATH)) {
    throw new Error(`pending file missing: ${PENDING_PATH}`);
  }
  const lines = readFileSync(PENDING_PATH, "utf-8").split("\n").filter(Boolean);
  const items = lines.map((l) => JSON.parse(l));

  const candidates = items.filter((i: any) => i.status === "awaiting-review" && i.notionUrl);
  let moved = 0;
  let failed = 0;
  const failures: Array<{ url: string; error: string }> = [];

  for (const item of candidates) {
    const id32 = pageIdFromNotionUrl(item.notionUrl);
    if (!id32) {
      continue;
    }
    const pageId = normalizeId32ToUuid(id32);
    try {
      notion.request("PATCH", `/pages/${pageId}`, { parent: { database_id: CAPTURE_DB } });
      moved++;
    } catch (e) {
      failed++;
      failures.push({ url: item.notionUrl, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  const reportPath = join(
    REPORT_DIR,
    `capture-inbox-migration-${new Date().toISOString().slice(0, 10)}.json`,
  );
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalPending: items.length,
        candidates: candidates.length,
        moved,
        failed,
        failures: failures.slice(0, 100),
      },
      null,
      2,
    ),
  );

  console.log(
    `[migration] candidates=${candidates.length} moved=${moved} failed=${failed} report=${reportPath}`,
  );
  if (failed > 0) {
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("[migration] fatal", e);
  process.exit(1);
});
