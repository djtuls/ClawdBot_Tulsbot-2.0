#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || "/Users/tulioferro";
const WORKSPACE = path.join(HOME, ".openclaw/workspace");
const DOSSIER_DIR = path.join(WORKSPACE, "context/projects");
const VAULT = path.join(HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault");
const OUT_DIR = path.join(VAULT, "projects");

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function extractTitle(md: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return (m?.[1] || "Untitled Project").trim();
}

function extractStatus(md: string): string {
  const m = md.match(/\*\*Status\*\*:\s*(.+)$/m);
  return (m?.[1] || "Unknown").trim();
}

function buildHub(code: string, title: string, status: string, sourceFile: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `---
title: "${code.toUpperCase()} ${title.replace(/"/g, "'")}"
source: manual
type: project
domain: openclaw
tags: [project-hub, imported-from-dossier]
status: active
---

# ${code.toUpperCase()} ${title}

## Status
- Lifecycle: ${status}
- Owner: 
- Last updated: ${today}
- Source dossier: [[${sourceFile.replace(/\.md$/, "")}]]

## Key People
- 

## Recent Signals
- 

## Open Items
- [ ] 

## Decisions
- 

## Drive / Resources
- Ops: 
- Finance: 
- Index: 
`;
}

function main() {
  if (!fs.existsSync(DOSSIER_DIR)) {
    console.error("No dossiers directory:", DOSSIER_DIR);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs
    .readdirSync(DOSSIER_DIR)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .slice(0, 200);

  let created = 0;
  let skipped = 0;
  for (const file of files) {
    const abs = path.join(DOSSIER_DIR, file);
    const body = fs.readFileSync(abs, "utf8");
    const code = file.replace(/\.md$/, "").split("-")[0] || "proj";
    const title = extractTitle(body);
    const status = extractStatus(body);
    const outName = `${code}-${sanitize(title)}.md`;
    const outPath = path.join(OUT_DIR, outName);
    if (fs.existsSync(outPath)) {
      skipped++;
      continue;
    }
    fs.writeFileSync(outPath, buildHub(code, title, status, file));
    created++;
  }

  console.log(
    JSON.stringify({ scanned: files.length, created, skipped, outDir: OUT_DIR }, null, 2),
  );
}

main();
