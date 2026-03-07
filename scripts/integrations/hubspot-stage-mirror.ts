import "dotenv/config";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { logEvent } from "../lib/event-logger.js";
import { getSecret } from "../lib/secrets.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DATA_DIR = join(WORKSPACE, "data");
const NOTION_SUMMARY = join(DATA_DIR, "notion-summary.json");
const OUT_PATH = join(DATA_DIR, "hubspot-stage-mirror-summary.json");

const PIPELINE_ID = "default";

type StageDef = { label: string; probability: number; isClosed: boolean; displayOrder: number };

const DESIRED_STAGES: StageDef[] = [];

// Maps Notion Project Grid status -> existing HubSpot pipeline stage labels.
const STATUS_TO_HUBSPOT_STAGE_LABEL: Record<string, string> = {
  Lead: "Initial Inquiry",
  "Biz Dev / RFP": "Needs Assessment",
  Target: "Proposal Sent",
  Recon: "Negotiation",
  "Pre-production": "Contract Signed",
  Delivery: "Closed Won",
  Postmortem: "Closed Won",
  "Cancelled / Did Not Engage": "Closed Lost",
};

function req(method: string, endpoint: string, token: string, body?: any): any {
  const args = [
    "-s",
    "-X",
    method,
    `https://api.hubapi.com${endpoint}`,
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Content-Type: application/json",
  ];
  if (body) {
    args.push("-d", JSON.stringify(body));
  }
  const raw = execFileSync("curl", args, { encoding: "utf-8", timeout: 30000 });
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseDate(dateStr?: string | null): string | undefined {
  if (!dateStr) {
    return undefined;
  }
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  return d.toISOString();
}

function stageForNotionStatus(status: string): string {
  const s = (status || "").trim();
  if (s === "Biz Dev/RFP") {
    return "Biz Dev / RFP";
  }
  if (s === "Target" || s === "🔘 Target") {
    return "Target";
  }
  if (s === "Recon") {
    return "Recon";
  }
  if (s === "Pre-production") {
    return "Pre-production";
  }
  if (s === "Delivery" || s === "Done") {
    return "Delivery";
  }
  if (s === "Postmortem") {
    return "Postmortem";
  }
  if (s === "Cancelled" || s === "Did Not Engage") {
    return "Cancelled / Did Not Engage";
  }
  return "Lead";
}

function main() {
  const token = getSecret("HUBSPOT_ACCESS_TOKEN") || "";
  if (!token) {
    console.error("[hubspot-stage-mirror] HUBSPOT_ACCESS_TOKEN missing");
    logEvent({
      source: "hubspot-stage-mirror",
      action: "run",
      result: "skipped",
      detail: "Missing token",
    });
    return;
  }
  if (!existsSync(NOTION_SUMMARY)) {
    console.error("[hubspot-stage-mirror] notion-summary.json missing");
    logEvent({
      source: "hubspot-stage-mirror",
      action: "run",
      result: "skipped",
      detail: "Missing notion summary",
    });
    return;
  }

  const notion = JSON.parse(readFileSync(NOTION_SUMMARY, "utf-8"));
  const projectGrid = (notion.projectGrid || []) as any[];

  // Use existing pipeline stages and map Notion statuses onto them.
  const pipelineRes = req("GET", `/crm/v3/pipelines/deals/${PIPELINE_ID}`, token);
  const existingStages = (pipelineRes?.stages || []) as any[];
  const byLabel = new Map(existingStages.map((s: any) => [s.label, s]));

  const stageIdByLabel: Record<string, string> = {};
  const createdStages: string[] = [];
  for (const [canonical, hsLabel] of Object.entries(STATUS_TO_HUBSPOT_STAGE_LABEL)) {
    const st = byLabel.get(hsLabel);
    if (st?.id) {
      stageIdByLabel[canonical] = st.id;
    }
  }

  // refresh deals (up to 500)
  const deals: any[] = [];
  let after: string | undefined;
  do {
    const qs = new URLSearchParams({
      limit: "100",
      properties: "dealname,dealstage,pipeline,amount,closedate,hs_lastmodifieddate,createdate",
    });
    if (after) {
      qs.set("after", after);
    }
    const chunk = req("GET", `/crm/v3/objects/deals?${qs.toString()}`, token);
    deals.push(...(chunk?.results || []));
    after = chunk?.paging?.next?.after;
  } while (after && deals.length < 500);

  const dealByName = new Map<string, any>();
  for (const d of deals) {
    const n = norm(d?.properties?.dealname || "");
    if (n) {
      dealByName.set(n, d);
    }
  }

  const ACTIVE_STATUSES = new Set([
    "Lead",
    "Biz Dev/RFP",
    "🔘 Target",
    "Target",
    "Recon",
    "Pre-production",
  ]);
  const activeRows = projectGrid.filter((p: any) => {
    const title = p?.title || p?.properties?.["Project name"];
    const status = (p?.status || p?.properties?.Status || "").trim();
    return !!title && ACTIVE_STATUSES.has(status);
  });

  const createdDeals: string[] = [];
  const updatedDeals: string[] = [];
  const skipped: string[] = [];

  for (const p of activeRows) {
    const title = p.title || p?.properties?.["Project name"] || "Untitled";
    const status = p.status || p?.properties?.Status || "Lead";
    const stageLabel = stageForNotionStatus(status);
    const stageId = stageIdByLabel[stageLabel];

    if (!stageId) {
      skipped.push(`${title} (no stageId for ${stageLabel})`);
      continue;
    }

    const existing = dealByName.get(norm(title));
    const closeDate = parseDate(p?.properties?.["Official Dates"] || p?.properties?.Date || null);

    if (!existing) {
      const body: any = {
        properties: {
          dealname: title,
          pipeline: PIPELINE_ID,
          dealstage: stageId,
        },
      };
      if (closeDate) {
        body.properties.closedate = closeDate;
      }
      const created = req("POST", "/crm/v3/objects/deals", token, body);
      if (created?.id) {
        createdDeals.push(`${title} -> ${stageLabel}`);
      } else {
        skipped.push(`${title} (create failed)`);
      }
      continue;
    }

    const currentStage = existing?.properties?.dealstage;
    const patch: any = { properties: {} };
    let needs = false;
    if (currentStage !== stageId) {
      patch.properties.dealstage = stageId;
      needs = true;
    }
    if ((existing?.properties?.pipeline || "") !== PIPELINE_ID) {
      patch.properties.pipeline = PIPELINE_ID;
      needs = true;
    }
    if (closeDate && existing?.properties?.closedate !== closeDate) {
      patch.properties.closedate = closeDate;
      needs = true;
    }

    if (needs) {
      const updated = req("PATCH", `/crm/v3/objects/deals/${existing.id}`, token, patch);
      if (updated?.id) {
        updatedDeals.push(`${title} -> ${stageLabel}`);
      } else {
        skipped.push(`${title} (update failed)`);
      }
    }
  }

  const summary = {
    runAt: new Date().toISOString(),
    pipelineId: PIPELINE_ID,
    createdStages,
    stageIdByLabel,
    totalProjectRows: activeRows.length,
    existingDealsBefore: deals.length,
    createdDeals,
    updatedDeals,
    skipped,
  };

  writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));

  console.log(
    `[hubspot-stage-mirror] rows=${activeRows.length} stagesCreated=${createdStages.length} dealsCreated=${createdDeals.length} dealsUpdated=${updatedDeals.length} skipped=${skipped.length}`,
  );
  logEvent({
    source: "hubspot-stage-mirror",
    action: "sync",
    result: "ok",
    detail: `rows=${activeRows.length} createStages=${createdStages.length} createDeals=${createdDeals.length} updateDeals=${updatedDeals.length} skipped=${skipped.length}`,
  });
}

main();
