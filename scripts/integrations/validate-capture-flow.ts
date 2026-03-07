import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const CFG_PATH = join(WORKSPACE, "config/notion-control-plane.json");
const ROUTER_PATH = join(WORKSPACE, "scripts/inbox/router.ts");
const REPORT_DIR = join(WORKSPACE, "reports/notion");

function main() {
  const issues: string[] = [];
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  if (!existsSync(CFG_PATH)) {
    issues.push("Missing config/notion-control-plane.json");
  }

  const cfg = existsSync(CFG_PATH) ? JSON.parse(readFileSync(CFG_PATH, "utf-8")) : {};
  const captureDb = cfg?.notion?.captureInboxDatabaseId || "";
  const superDb = cfg?.notion?.superInboxDatabaseId || "";
  const allowDirect = cfg?.policy?.allowDirectSuperInboxWrites === true;

  checks.push({
    name: "capture_db_configured",
    ok: Boolean(captureDb),
    detail: captureDb || "missing",
  });

  checks.push({
    name: "super_db_configured",
    ok: Boolean(superDb),
    detail: superDb || "missing",
  });

  checks.push({
    name: "capture_and_super_separated_or_explicitly_allowed",
    ok: captureDb !== superDb || allowDirect,
    detail:
      captureDb === superDb
        ? allowDirect
          ? "same DB but explicit allowDirectSuperInboxWrites=true"
          : "same DB and writes not allowed"
        : "different DBs",
  });

  const routerCode = existsSync(ROUTER_PATH) ? readFileSync(ROUTER_PATH, "utf-8") : "";
  checks.push({
    name: "router_has_super_inbox_guard",
    ok: routerCode.includes("blocked-direct-super-inbox-seed"),
    detail: "checks if protection event tag exists in router",
  });

  for (const c of checks) {
    if (!c.ok) {
      issues.push(`${c.name}: ${c.detail}`);
    }
  }

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  const outPath = join(
    REPORT_DIR,
    `capture-flow-validation-${new Date().toISOString().slice(0, 10)}.json`,
  );
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        result: issues.length === 0 ? "ok" : "error",
        checks,
        issues,
      },
      null,
      2,
    ),
  );

  console.log(`[validate-capture-flow] ${issues.length === 0 ? "ok" : "error"} report=${outPath}`);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(` - ${issue}`);
    }
    process.exit(2);
  }
}

main();
