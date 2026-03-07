import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { getSecret } from "../lib/secrets.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DATA_DIR = join(WORKSPACE, "data");

const INACTIVE = new Set([
  "Done",
  "Postmortem",
  "Cancelled",
  "Did Not Engage",
  "Archive",
  "Archived",
]);

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function main() {
  const token = getSecret("HUBSPOT_ACCESS_TOKEN") || "";
  if (!token) {
    console.error("[hubspot-prune-inactive] Missing HUBSPOT_ACCESS_TOKEN");
    logEvent({
      source: "hubspot-prune-inactive",
      action: "run",
      result: "skipped",
      detail: "missing token",
    });
    return;
  }

  const notionPath = join(DATA_DIR, "notion-summary.json");
  const notion = JSON.parse(readFileSync(notionPath, "utf-8"));
  const grid = notion.projectGrid || [];

  const statusByTitle = new Map<string, string>();
  for (const r of grid) {
    const title = r.title || r?.properties?.["Project name"] || "";
    const status = (r.status || r?.properties?.Status || "").trim();
    if (title) {
      statusByTitle.set(norm(title), status);
    }
  }

  async function hsGet(url: string): Promise<any> {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  }

  async function hsDelete(id: string): Promise<number> {
    const r = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.status;
  }

  let after: string | undefined;
  const deals: any[] = [];
  do {
    const q = new URLSearchParams({ limit: "100", properties: "dealname,dealstage,pipeline" });
    if (after) {
      q.set("after", after);
    }
    const data = await hsGet(`https://api.hubapi.com/crm/v3/objects/deals?${q.toString()}`);
    deals.push(...(data.results || []));
    after = data?.paging?.next?.after;
  } while (after);

  const candidates: { id: string; name: string; reason: string }[] = [];
  for (const d of deals) {
    const name = d?.properties?.dealname || "";
    const status = statusByTitle.get(norm(name));
    if (/sample deal/i.test(name)) {
      candidates.push({ id: d.id, name, reason: "sample" });
      continue;
    }
    if (status && INACTIVE.has(status)) {
      candidates.push({ id: d.id, name, reason: `inactive:${status}` });
    }
  }

  let deleted = 0;
  let failed = 0;
  for (const c of candidates) {
    const code = await hsDelete(c.id);
    if (code === 204) {
      deleted++;
    } else {
      failed++;
    }
  }

  const summary = {
    runAt: new Date().toISOString(),
    totalDeals: deals.length,
    candidates: candidates.length,
    deleted,
    failed,
    examples: candidates.slice(0, 25),
  };

  writeFileSync(join(DATA_DIR, "hubspot-prune-summary.json"), JSON.stringify(summary, null, 2));
  console.log(
    `[hubspot-prune-inactive] deals=${deals.length} candidates=${candidates.length} deleted=${deleted} failed=${failed}`,
  );
  logEvent({
    source: "hubspot-prune-inactive",
    action: "run",
    result: failed ? "error" : "ok",
    detail: `deals=${deals.length} deleted=${deleted} failed=${failed}`,
  });
}

main().catch((err) => {
  console.error("[hubspot-prune-inactive] Fatal:", err);
  logEvent({
    source: "hubspot-prune-inactive",
    action: "fatal",
    result: "error",
    detail: String(err),
  });
  process.exit(1);
});
