import "dotenv/config";
/**
 * Build Drive Map — auto-maps Google Drive project folders to Project Grid entries
 *
 * Reads Active Financials and Recon Financials from the Financial root folder,
 * matches project codes (e.g., 2603) to Notion Project Grid entries,
 * and writes the mapping to data/project-drive-map.json.
 */
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DATA_DIR = join(WORKSPACE, "data");
const GOG_ACCOUNT = "tulio@weareliveengine.com";

const FINANCIAL_ROOT = "1VuRzudS1M2SutxS1u6fUSa6e06HuSBlq";
const ACTIVE_FINANCIALS = "1qYlhVbQzeeGLgqy-_qrlf5ao0hFv6TCH";
const RECON_FINANCIALS = "1r38BKm9rzciwywEchh3PmLfrzxzw3nRE";

const OPS_ROOT = "1GoTS-xbB2AGa9BQnq9ah2FL3SeXfOuAt";
const WIP_OPS = "10RBgjhgeQ9kF9BS92TYZAbWYgP5lq056";

function gogDriveLs(
  parentId: string,
): Array<{
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
}> {
  try {
    const result = execFileSync(
      "gog",
      ["-a", GOG_ACCOUNT, "drive", "ls", "--parent", parentId, "--json", "--max", "100"],
      {
        timeout: 30_000,
        encoding: "utf-8",
        env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
      },
    );
    const data = JSON.parse(result);
    return data.files || [];
  } catch (err: any) {
    console.error(`[drive-map] Failed to list ${parentId}:`, err.message);
    return [];
  }
}

function extractCode(name: string): string | null {
  const m = name.match(/<(\d{4})>/);
  if (m) {
    return m[1];
  }
  const m2 = name.match(/^(\d{4})[_\s]/);
  if (m2) {
    return m2[1];
  }
  return null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

async function main() {
  console.log("[drive-map] Building project drive map...");

  // Load Project Grid from notion-summary
  const notionPath = join(DATA_DIR, "notion-summary.json");
  if (!existsSync(notionPath)) {
    console.error("[drive-map] notion-summary.json not found. Run notion-sync first.");
    process.exit(1);
  }
  const notion = JSON.parse(readFileSync(notionPath, "utf-8"));
  const grid: any[] = notion.projectGrid || [];

  // Build code -> project mapping
  const codeToProject: Record<string, { title: string; slug: string }> = {};
  for (const p of grid) {
    const title = p.title || "";
    const code = p.properties?.Code || "";
    const extractedCode = code || extractCode(title);
    if (extractedCode) {
      codeToProject[extractedCode] = { title, slug: slugify(title) };
    }
  }
  console.log(`[drive-map] ${Object.keys(codeToProject).length} project codes from Notion Grid`);

  // Load existing map to preserve OPS links
  const mapPath = join(DATA_DIR, "project-drive-map.json");
  let existing: Record<string, any> = {};
  if (existsSync(mapPath)) {
    try {
      existing = JSON.parse(readFileSync(mapPath, "utf-8"));
    } catch {}
  }

  const driveMap: Record<string, any> = {
    _readme: "Auto-mapped from Google Drive Financial + OPS folders to Notion Project Grid.",
    _financialRoot: `https://drive.google.com/drive/folders/${FINANCIAL_ROOT}`,
    _opsRoot: `https://drive.google.com/drive/folders/${OPS_ROOT}`,
    _lastUpdated: new Date().toISOString(),
  };

  // Scan Financial folders (Active + Recon)
  const financialFolders = [
    ...gogDriveLs(ACTIVE_FINANCIALS).map((f) => ({ ...f, section: "Active" })),
    ...gogDriveLs(RECON_FINANCIALS).map((f) => ({ ...f, section: "Recon" })),
  ];
  console.log(`[drive-map] Found ${financialFolders.length} Financial folders`);

  // Scan OPS folders (WIP)
  const opsFolders = gogDriveLs(WIP_OPS);
  console.log(`[drive-map] Found ${opsFolders.length} OPS folders`);

  // Build intermediate map keyed by project code
  const byCode: Record<
    string,
    { financial?: string; ops?: string; section?: string; title?: string; lastModified?: string }
  > = {};

  let matchedFin = 0;
  for (const folder of financialFolders) {
    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      continue;
    }
    const code = extractCode(folder.name);
    if (!code) {
      continue;
    }
    const folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
    if (!byCode[code]) {
      byCode[code] = {};
    }
    byCode[code].financial = folderUrl;
    byCode[code].section = folder.section;
    byCode[code].lastModified = folder.modifiedTime;
    if (codeToProject[code]) {
      matchedFin++;
    }
  }

  let matchedOps = 0;
  for (const folder of opsFolders) {
    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      continue;
    }
    const code = extractCode(folder.name);
    if (!code) {
      continue;
    }
    const folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
    if (!byCode[code]) {
      byCode[code] = {};
    }
    byCode[code].ops = folderUrl;
    if (!byCode[code].lastModified || folder.modifiedTime > byCode[code].lastModified) {
      byCode[code].lastModified = folder.modifiedTime;
    }
    if (codeToProject[code]) {
      matchedOps++;
    }
  }

  // Write to drive map
  for (const [code, info] of Object.entries(byCode)) {
    let slug: string;
    let title: string;

    if (codeToProject[code]) {
      slug = codeToProject[code].slug;
      title = codeToProject[code].title;
    } else {
      slug = `project-${code}`;
      title = `Project ${code}`;
    }

    driveMap[slug] = {
      code,
      title,
      financial: info.financial || undefined,
      ops: info.ops || undefined,
      section: info.section || undefined,
      lastModified: info.lastModified,
    };
  }

  // Also handle non-code financial/ops folders
  for (const folder of [...financialFolders, ...opsFolders]) {
    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      continue;
    }
    const code = extractCode(folder.name);
    if (code) {
      continue;
    } // already handled
    const slug = slugify(folder.name);
    if (driveMap[slug]) {
      continue;
    }
    const folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
    const isOps = opsFolders.some((f) => f.id === folder.id);
    driveMap[slug] = {
      title: folder.name,
      financial: isOps ? undefined : folderUrl,
      ops: isOps ? folderUrl : undefined,
      lastModified: folder.modifiedTime,
    };
  }

  writeFileSync(mapPath, JSON.stringify(driveMap, null, 2));
  const totalCodes = Object.keys(byCode).length;
  console.log(
    `[drive-map] Done. ${totalCodes} projects by code (Fin matched: ${matchedFin}, OPS matched: ${matchedOps}). Saved to ${mapPath}`,
  );
}

main().catch((err) => {
  console.error("[drive-map] Fatal:", err);
  process.exit(1);
});
