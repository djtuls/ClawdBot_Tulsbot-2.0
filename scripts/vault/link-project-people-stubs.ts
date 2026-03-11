#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || "/Users/tulioferro";
const VAULT = path.join(HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault");
const PROJECTS_DIR = path.join(VAULT, "projects");

function main() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error("Missing projects dir", PROJECTS_DIR);
    process.exit(1);
  }

  const files = fs
    .readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "_project-hub-template.md");

  let updated = 0;
  for (const f of files) {
    const p = path.join(PROJECTS_DIR, f);
    const raw = fs.readFileSync(p, "utf8");
    if (raw.includes("[[people/_index]]") || raw.includes("[[people-index]]")) {
      continue;
    }

    const next = raw.replace(/## Key People\n([\s\S]*?)\n## Recent Signals/m, (m, block) => {
      let b = String(block || "").trimEnd();
      if (!b.includes("[[people/_index]]")) {
        b = `${b}\n- [[people/_index]] — routing stub; replace with confirmed contacts`;
      }
      return `## Key People\n${b}\n\n## Recent Signals`;
    });

    if (next !== raw) {
      fs.writeFileSync(p, next);
      updated++;
    }
  }

  console.log(JSON.stringify({ scanned: files.length, updated }, null, 2));
}

main();
