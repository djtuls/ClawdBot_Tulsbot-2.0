#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || "/Users/tulioferro";
const WORKSPACE = path.join(HOME, ".openclaw/workspace");
const DOSSIERS_DIR = path.join(WORKSPACE, "context/projects");
const VAULT_PROJECTS = path.join(
  HOME,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault/projects",
);

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function section(md: string, name: string): string[] {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`## ${esc}\\n([\\s\\S]*?)(\\n## |$)`, "m");
  const m = md.match(re);
  if (!m) {
    return [];
  }
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
}

function inferHealth(
  blockers: string[],
  openItems: string[],
  recentSignals: string[],
): "GREEN" | "AMBER" | "RED" {
  const blockerCount = blockers.filter((b) => !/none/i.test(b)).length;
  const openCount = openItems.length;
  const hasSignals = recentSignals.length > 0;

  if (blockerCount >= 2) {
    return "RED";
  }
  if (blockerCount === 1) {
    return "AMBER";
  }
  if (!hasSignals && openCount > 3) {
    return "AMBER";
  }
  return "GREEN";
}

function lastInteractionFromSignals(signals: string[]): string {
  const dates = signals
    .map((s) => {
      const m = s.match(/(20\d{2}-\d{2}-\d{2})/);
      return m?.[1] || "";
    })
    .filter(Boolean)
    .toSorted()
    .toReversed();
  return dates[0] || "unknown";
}

function enrichOne(dossierPath: string, hubPath: string): boolean {
  const dossier = read(dossierPath);
  const hub = read(hubPath);

  const people = section(hub, "Key People").filter((l) => !l.includes("people/_index"));
  const signals = section(hub, "Recent Signals");
  const open = section(hub, "Open Items");
  const decisions = section(hub, "Decisions");

  const blockers: string[] = [];
  if (open.length >= 5) {
    blockers.push("- High open item load (5+)");
  }
  if (signals.length === 0) {
    blockers.push("- No recent signals linked");
  }
  if (people.length === 0) {
    blockers.push("- No confirmed key people linked");
  }

  const health = inferHealth(blockers, open, signals);
  const lastInteraction = lastInteractionFromSignals(signals);

  let next = dossier;

  // Status enrichment
  next = next.replace(/## Status[\s\S]*?## People/m, (chunk) => {
    const base = chunk.replace(/\n## People[\s\S]*/m, "");
    const extra = [`- Health: ${health}`, `- Last interaction: ${lastInteraction}`];
    return `${base}\n${extra.join("\n")}\n\n## People`;
  });

  // People
  const peopleBlock = people.length ? people.join("\n") : "- No contacts linked yet";
  next = next.replace(
    /## People[\s\S]*?## Open Items/m,
    `## People\n\n${peopleBlock}\n\n## Open Items`,
  );

  // Open items
  const openBlock = open.length ? open.join("\n") : "- No tasks linked";
  next = next.replace(
    /## Open Items[\s\S]*?## Recent Activity \(7 days\)/m,
    `## Open Items\n\n${openBlock}\n\n## Recent Activity (7 days)`,
  );

  // Recent activity
  const sigBlock = signals.length ? signals.join("\n") : "- No recent activity logged";
  next = next.replace(
    /## Recent Activity \(7 days\)[\s\S]*?## Drive Folders/m,
    `## Recent Activity (7 days)\n\n${sigBlock}\n\n## Drive Folders`,
  );

  // Blockers
  const blockerBlock = blockers.length ? blockers.join("\n") : "- None identified";
  next = next.replace(
    /## Blockers[\s\S]*$/m,
    `## Blockers\n\n${blockerBlock}\n\n## Decisions\n\n${decisions.length ? decisions.join("\n") : "- None logged"}`,
  );

  if (next !== dossier) {
    fs.writeFileSync(dossierPath, next);
    return true;
  }
  return false;
}

function main() {
  if (!fs.existsSync(DOSSIERS_DIR) || !fs.existsSync(VAULT_PROJECTS)) {
    console.error("Missing dossier/vault dirs");
    process.exit(1);
  }

  const hubs = fs.readdirSync(VAULT_PROJECTS).filter((f) => /^2\d{3}-.*\.md$/.test(f));
  const hubByCode = new Map<string, string>();
  for (const h of hubs) {
    hubByCode.set(h.slice(0, 4), path.join(VAULT_PROJECTS, h));
  }

  const dossiers = fs.readdirSync(DOSSIERS_DIR).filter((f) => /^2\d{3}-.*\.md$/.test(f));
  let updated = 0;
  let scanned = 0;

  for (const d of dossiers) {
    scanned++;
    const code = d.slice(0, 4);
    const hub = hubByCode.get(code);
    if (!hub) {
      continue;
    }
    const ok = enrichOne(path.join(DOSSIERS_DIR, d), hub);
    if (ok) {
      updated++;
    }
  }

  console.log(JSON.stringify({ scanned, updated }, null, 2));
}

main();
