import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface LifecycleEntry {
  code: string;
  title: string;
  lifecycle: "biz-dev" | "pre-production" | "on-site" | "recon" | "done" | "unknown";
  health: string;
  keySignal: string;
}

function inferLifecycle(md: string): LifecycleEntry["lifecycle"] {
  const deal = (md.match(/- Deal stage:\s*(.+)$/m)?.[1] || "").trim();
  const title = (md.match(/^#\s+Project:\s*(.+)$/m)?.[1] || "").toLowerCase();
  if (title.includes("final") || title.includes("cup") || title.includes("world cup")) {
    return "pre-production";
  }
  if (deal === "2702332376") {
    return "biz-dev";
  }
  if (deal === "2702332377" || deal === "2702332379") {
    return "pre-production";
  }
  return "unknown";
}

export function loadLifecycleSummary(workspace: string, limit = 12): LifecycleEntry[] {
  const dir = join(workspace, "context/projects");
  if (!existsSync(dir)) {
    return [];
  }
  const files = readdirSync(dir)
    .filter((f) => /^2\d{3}-.*\.md$/.test(f))
    .slice(0, 200);
  const rows: LifecycleEntry[] = [];

  for (const f of files) {
    const md = readFileSync(join(dir, f), "utf8");
    const code = f.slice(0, 4);
    const title = (md.match(/^#\s+Project:\s*(.+)$/m)?.[1] || f.replace(/\.md$/, "")).trim();
    const health = (md.match(/- Health:\s*(.+)$/m)?.[1] || "Unknown").trim();
    const signal = (
      md.match(/## Recent Activity \(7 days\)\n\n-\s+(.+)$/m)?.[1] || "No recent signal"
    ).trim();
    rows.push({ code, title, lifecycle: inferLifecycle(md), health, keySignal: signal });
  }

  const order: Record<string, number> = {
    "biz-dev": 0,
    "pre-production": 1,
    "on-site": 2,
    recon: 3,
    done: 4,
    unknown: 5,
  };

  return rows.toSorted((a, b) => order[a.lifecycle] - order[b.lifecycle]).slice(0, limit);
}
