import "dotenv/config";
/**
 * HubSpot Sync — Cross-Platform Integration (V1: One-Way Pull)
 *
 * Pulls contacts, companies, and deals from HubSpot.
 * Detects changes (new deals, stage changes, stale deals).
 * Feeds data into the project dossier builder.
 *
 * V1: Read-only. No writes back to HubSpot.
 * Cron: every 4 hours
 */
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { getSecret } from "../lib/secrets.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DATA_DIR = join(WORKSPACE, "data");
const CACHE_PATH = join(DATA_DIR, "hubspot-cache.json");

interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    dealstage: string;
    amount?: string;
    closedate?: string;
    pipeline?: string;
    hs_lastmodifieddate?: string;
    createdate?: string;
    [key: string]: string | undefined;
  };
}

interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    company?: string;
    phone?: string;
    hs_lastmodifieddate?: string;
    [key: string]: string | undefined;
  };
}

interface CacheState {
  lastSync: string;
  deals: HubSpotDeal[];
  contacts: HubSpotContact[];
  dealStages: Record<string, string>; // dealId -> previous stage
}

function readCache(): CacheState {
  if (existsSync(CACHE_PATH)) {
    try {
      return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    } catch {}
  }
  return { lastSync: "", deals: [], contacts: [], dealStages: {} };
}

function writeCache(cache: CacheState): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function hubspotGet(endpoint: string, token: string): any {
  try {
    const result = execFileSync(
      "curl",
      [
        "-s",
        `https://api.hubapi.com${endpoint}`,
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        "Content-Type: application/json",
      ],
      { timeout: 30_000, encoding: "utf-8" },
    );

    return JSON.parse(result);
  } catch (err: any) {
    console.error(`[hubspot-sync] API error for ${endpoint}:`, err.message);
    return null;
  }
}

async function main() {
  console.log("[hubspot-sync] Starting HubSpot sync...");

  const hubspotToken = getSecret("HUBSPOT_ACCESS_TOKEN") || "";
  if (!hubspotToken) {
    console.error("[hubspot-sync] HUBSPOT_ACCESS_TOKEN not set. Skipping.");
    logEvent({ source: "hubspot-sync", action: "sync", result: "skipped", detail: "No API token" });
    return;
  }

  const cache = readCache();
  const previousStages = cache.dealStages;
  const changes: string[] = [];

  // Fetch deals
  const dealsData = hubspotGet(
    "/crm/v3/objects/deals?limit=100&properties=dealname,dealstage,amount,closedate,pipeline,hs_lastmodifieddate,createdate",
    hubspotToken,
  );
  const deals: HubSpotDeal[] = dealsData?.results || [];

  // Detect deal changes
  const newStages: Record<string, string> = {};
  for (const deal of deals) {
    const name = deal.properties.dealname || deal.id;
    const stage = deal.properties.dealstage || "unknown";
    newStages[deal.id] = stage;

    if (!previousStages[deal.id]) {
      changes.push(`New deal: ${name} (stage: ${stage})`);
    } else if (previousStages[deal.id] !== stage) {
      changes.push(`Deal stage change: ${name}: ${previousStages[deal.id]} → ${stage}`);
    }

    // Check for stale deals (>14 days since last modified)
    const lastMod = deal.properties.hs_lastmodifieddate;
    if (lastMod) {
      const daysSince = (Date.now() - new Date(lastMod).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 14) {
        changes.push(`Stale deal (${Math.floor(daysSince)}d): ${name}`);
      }
    }
  }

  // Fetch contacts
  const contactsData = hubspotGet(
    "/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,email,company,phone,hs_lastmodifieddate",
    hubspotToken,
  );
  const contacts: HubSpotContact[] = contactsData?.results || [];

  // Write summary for dossier builder
  const summary = {
    lastSync: new Date().toISOString(),
    totalDeals: deals.length,
    totalContacts: contacts.length,
    changes,
    deals: deals.map((d) => ({
      id: d.id,
      name: d.properties.dealname,
      stage: d.properties.dealstage,
      amount: d.properties.amount,
      closeDate: d.properties.closedate,
      lastModified: d.properties.hs_lastmodifieddate,
    })),
    contacts: contacts.map((c) => ({
      id: c.id,
      name: `${c.properties.firstname || ""} ${c.properties.lastname || ""}`.trim(),
      email: c.properties.email,
      company: c.properties.company,
    })),
  };

  writeFileSync(join(DATA_DIR, "hubspot-summary.json"), JSON.stringify(summary, null, 2));

  // Update cache
  writeCache({
    lastSync: new Date().toISOString(),
    deals,
    contacts,
    dealStages: newStages,
  });

  console.log(
    `[hubspot-sync] Done. Deals: ${deals.length}, Contacts: ${contacts.length}, Changes: ${changes.length}`,
  );

  if (changes.length > 0) {
    console.log("[hubspot-sync] Changes detected:");
    changes.forEach((c) => console.log(`  • ${c}`));
  }

  logEvent({
    source: "hubspot-sync",
    action: "sync-complete",
    result: "ok",
    detail: `deals=${deals.length} contacts=${contacts.length} changes=${changes.length}`,
  });
}

main().catch((err) => {
  console.error("[hubspot-sync] Fatal:", err);
  logEvent({ source: "hubspot-sync", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
