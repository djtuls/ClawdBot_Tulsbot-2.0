import "dotenv/config";
/**
 * Project Dossier Builder
 *
 * Reads synced data from HubSpot, Notion, Todoist, and inbox.
 * Generates/updates project dossier files in context/projects/.
 * Runs after each sync cycle.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { logEvent } from "./lib/event-logger.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DOSSIER_DIR = join(WORKSPACE, "context/projects");
const DATA_DIR = join(WORKSPACE, "data");

interface DealInfo {
  id: string;
  name: string;
  stage: string;
  amount?: string;
  closeDate?: string;
  lastModified?: string;
}

interface ContactInfo {
  name: string;
  email?: string;
  company?: string;
}

interface TodoistTask {
  content: string;
  priority: number;
  due?: string;
}

function readJsonSafe(path: string): any {
  try {
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function generateDossier(
  dealName: string,
  deal: DealInfo | null,
  contacts: ContactInfo[],
  notionProject: any | null,
  tasks: TodoistTask[],
  recentEvents: any[],
  driveFolders?: { financial?: string; ops?: string },
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# Project: ${dealName}`);
  lines.push(`Updated: ${now}`);

  const sources: string[] = [];
  if (deal) {
    sources.push("HubSpot");
  }
  if (notionProject) {
    sources.push("Notion");
  }
  if (tasks.length > 0) {
    sources.push("Todoist");
  }
  if (recentEvents.length > 0) {
    sources.push("Event Log");
  }
  lines.push(`Sources: ${sources.join(", ") || "none"}`);
  lines.push("");

  // Status
  lines.push("## Status");
  if (deal) {
    lines.push(`- Deal stage: ${deal.stage}`);
    if (deal.amount) {
      lines.push(`- Amount: $${deal.amount}`);
    }
    if (deal.closeDate) {
      lines.push(`- Close date: ${deal.closeDate}`);
    }
    if (deal.lastModified) {
      lines.push(`- Last modified: ${deal.lastModified}`);
    }
  }
  if (notionProject) {
    lines.push(`- Notion status: ${notionProject.status || "Unknown"}`);
    lines.push(`- Last edited: ${notionProject.lastEdited || "Unknown"}`);
  }
  if (!deal && !notionProject) {
    lines.push("- No platform data available yet");
  }
  lines.push("");

  // People
  lines.push("## People");
  if (contacts.length > 0) {
    contacts.forEach((c) => {
      lines.push(
        `- ${c.name}${c.email ? ` (${c.email})` : ""}${c.company ? ` — ${c.company}` : ""}`,
      );
    });
  } else {
    lines.push("- No contacts linked yet");
  }
  lines.push("");

  // Open Items
  lines.push("## Open Items");
  if (tasks.length > 0) {
    tasks.forEach((t) => {
      const priority = t.priority >= 4 ? "🔴" : t.priority >= 3 ? "🟡" : "⚪";
      lines.push(`- ${priority} ${t.content}${t.due ? ` (due: ${t.due})` : ""}`);
    });
  } else {
    lines.push("- No tasks linked");
  }
  lines.push("");

  // Recent Activity
  lines.push("## Recent Activity (7 days)");
  if (recentEvents.length > 0) {
    recentEvents.slice(0, 10).forEach((e) => {
      lines.push(`- [${e.ts?.split("T")[0] || "unknown"}] [${e.source}] ${e.detail || e.action}`);
    });
  } else {
    lines.push("- No recent activity logged");
  }
  lines.push("");

  // Drive Folders
  if (driveFolders && (driveFolders.financial || driveFolders.ops)) {
    lines.push("## Drive Folders");
    if (driveFolders.financial) {
      lines.push(`- Financial: ${driveFolders.financial} (internal only)`);
    }
    if (driveFolders.ops) {
      lines.push(`- OPS: ${driveFolders.ops} (team-shared)`);
    }
    lines.push("");
  }

  // Blockers
  lines.push("## Blockers");
  const staleThreshold = 14 * 24 * 60 * 60 * 1000;
  if (deal?.lastModified) {
    const daysSince = (Date.now() - new Date(deal.lastModified).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) {
      lines.push(`- ⚠️ Deal stale: no activity for ${Math.floor(daysSince)} days`);
    }
  }
  const overdueTasks = tasks.filter((t) => t.due && new Date(t.due) < new Date());
  overdueTasks.forEach((t) => {
    lines.push(`- ⚠️ Overdue: ${t.content} (was due: ${t.due})`);
  });
  if (
    !overdueTasks.length &&
    !(deal?.lastModified && Date.now() - new Date(deal.lastModified).getTime() > staleThreshold)
  ) {
    lines.push("- None identified");
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  console.log("[dossier-builder] Starting dossier generation...");

  if (!existsSync(DOSSIER_DIR)) {
    mkdirSync(DOSSIER_DIR, { recursive: true });
  }

  const hubspot = readJsonSafe(join(DATA_DIR, "hubspot-summary.json"));
  const notion = readJsonSafe(join(DATA_DIR, "notion-summary.json"));
  const todoist = readJsonSafe(join(DATA_DIR, "todoist-summary.json"));

  // Read drive folder map
  const driveMap = readJsonSafe(join(DATA_DIR, "project-drive-map.json")) || {};

  // Read recent events
  let recentEvents: any[] = [];
  const eventLogPath = join(WORKSPACE, "memory/event-log.jsonl");
  if (existsSync(eventLogPath)) {
    const lines = readFileSync(eventLogPath, "utf-8").trim().split("\n");
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    recentEvents = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((e) => e && new Date(e.ts).getTime() > weekAgo);
  }

  // Build dossiers from HubSpot deals
  const deals: DealInfo[] = hubspot?.deals || [];
  let generated = 0;

  for (const deal of deals) {
    if (!deal.name) {
      continue;
    }
    const slug = slugify(deal.name);

    // Find matching contacts
    const contacts: ContactInfo[] = (hubspot?.contacts || [])
      .filter((c: any) => {
        const company = (c.company || "").toLowerCase();
        const dealNameLower = deal.name.toLowerCase();
        return company && dealNameLower.includes(company.split(" ")[0]);
      })
      .slice(0, 5);

    // Find matching Notion project (check both old format and V2 format)
    const notionProject = (notion?.inftProjects || notion?.projects || []).find((p: any) => {
      const title = (p.title || "").toLowerCase();
      return title.includes(deal.name.toLowerCase().split(" ")[0]);
    });

    // Find matching Todoist tasks
    const tasks: TodoistTask[] = (todoist?.highPriority || []).filter((t: any) => {
      const content = (t.content || "").toLowerCase();
      return content.includes(deal.name.toLowerCase().split(" ")[0]);
    });

    // Find matching events
    const dealEvents = recentEvents.filter((e) => {
      const detail = ((e.detail || "") + (e.target || "")).toLowerCase();
      return detail.includes(deal.name.toLowerCase().split(" ")[0]);
    });

    const driveFolders = driveMap[slug] || driveMap[deal.name] || undefined;
    const dossier = generateDossier(
      deal.name,
      deal,
      contacts,
      notionProject,
      tasks,
      dealEvents,
      driveFolders,
    );
    writeFileSync(join(DOSSIER_DIR, `${slug}.md`), dossier);
    generated++;
  }

  // Create dossiers from Project Grid (master INFT-Hub tracker — richest source)
  const gridProjects: any[] = notion?.projectGrid || [];
  const dossierSlugs = new Set(deals.map((d) => slugify(d.name)));

  for (const gp of gridProjects) {
    const title = gp.title || gp.properties?.["Project name"] || "";
    if (!title || title === "Untitled") {
      continue;
    }
    const slug = slugify(title);
    if (dossierSlugs.has(slug)) {
      continue;
    }
    dossierSlugs.add(slug);

    const props = gp.properties || {};
    const code = props["Code"] || "";
    const status = props["Status"] || gp.status || "Unknown";
    const client = (props["Client"] || []).length > 0 ? `(linked)` : "";
    const projectType = props["Type"] || "";
    const pm = props["PM"] || "";
    const scope = props["Scope"] || "";
    const dates = props["Official Dates"] || "";
    const teams = props["No. of Teams"] || "";
    const stadiums = props["No. of Stadiums"] || "";
    const tech = props["Tech"] || "";
    const location = (props["Location"] || []).length > 0 ? `(linked)` : "";
    const tags = (props["Tags (Events)"] || []).join(", ");

    const lines: string[] = [];
    lines.push(`# Project: ${title}`);
    lines.push(`Updated: ${new Date().toISOString()}`);
    lines.push(`Sources: Notion Project Grid${gp.url ? ` ([link](${gp.url}))` : ""}`);
    lines.push("");
    lines.push("## Status");
    lines.push(`- Status: ${status}`);
    if (code) {
      lines.push(`- Code: ${code}`);
    }
    if (projectType) {
      lines.push(`- Type: ${projectType}`);
    }
    if (dates) {
      lines.push(`- Official Dates: ${dates}`);
    }
    if (pm) {
      lines.push(`- PM: ${pm}`);
    }
    if (scope) {
      lines.push(`- Scope: ${scope}`);
    }
    if (client) {
      lines.push(`- Client: ${client}`);
    }
    lines.push(`- Last edited: ${gp.lastEdited || "Unknown"}`);
    lines.push("");

    if (teams || stadiums || tech) {
      lines.push("## Logistics");
      if (teams) {
        lines.push(`- Teams: ${teams}`);
      }
      if (stadiums) {
        lines.push(`- Stadiums: ${stadiums}`);
      }
      if (tech) {
        lines.push(`- Tech: ${tech}`);
      }
      if (location) {
        lines.push(`- Location: ${location}`);
      }
      if (tags) {
        lines.push(`- Tags: ${tags}`);
      }
      lines.push("");
    }

    const driveFolders = driveMap[slug] || driveMap[title] || undefined;
    if (driveFolders && (driveFolders.financial || driveFolders.ops)) {
      lines.push("## Drive Folders");
      if (driveFolders.financial) {
        lines.push(`- Financial: ${driveFolders.financial} (internal only)`);
      }
      if (driveFolders.ops) {
        lines.push(`- OPS: ${driveFolders.ops} (team-shared)`);
      }
      lines.push("");
    }

    // Match events
    const projectEvents = recentEvents.filter((e) => {
      const detail = ((e.detail || "") + (e.target || "")).toLowerCase();
      const firstWord = title.toLowerCase().split(/[_\s]/)[0];
      return firstWord.length > 3 && detail.includes(firstWord);
    });
    if (projectEvents.length > 0) {
      lines.push("## Recent Activity (7 days)");
      projectEvents.slice(0, 10).forEach((e) => {
        lines.push(`- [${e.ts?.split("T")[0] || "unknown"}] [${e.source}] ${e.detail || e.action}`);
      });
      lines.push("");
    }

    writeFileSync(join(DOSSIER_DIR, `${slug}.md`), lines.join("\n"));
    generated++;
  }

  // Also create dossiers for Notion context/PARA projects not already covered
  const allNotionProjects = [
    ...(notion?.inftProjects || []),
    ...(notion?.paraProjects || []),
    ...(notion?.projects || []),
  ];
  for (const project of allNotionProjects.slice(0, 40)) {
    const slug = slugify(project.title || "untitled");
    if (dossierSlugs.has(slug)) {
      continue;
    }
    if (!project.title || project.title === "Untitled") {
      continue;
    }
    dossierSlugs.add(slug);

    const driveFolders = driveMap[slug] || driveMap[project.title] || undefined;
    const dossier = generateDossier(
      project.title,
      null,
      [],
      project,
      [],
      recentEvents.filter((e) => {
        const detail = ((e.detail || "") + (e.target || "")).toLowerCase();
        return detail.includes((project.title || "").toLowerCase().split(" ")[0]);
      }),
      driveFolders,
    );
    writeFileSync(join(DOSSIER_DIR, `${slug}.md`), dossier);
    generated++;
  }

  console.log(`[dossier-builder] Done. Generated ${generated} project dossiers`);

  logEvent({
    source: "dossier-builder",
    action: "build",
    result: "ok",
    detail: `dossiers=${generated} deals=${deals.length} grid=${gridProjects.length} notionProjects=${allNotionProjects.length}`,
  });
}

main().catch((err) => {
  console.error("[dossier-builder] Fatal:", err);
  logEvent({ source: "dossier-builder", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
