#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || "/Users/tulioferro";
const WORKSPACE = path.join(HOME, ".openclaw/workspace");
const HUBSPOT_SUMMARY = path.join(WORKSPACE, "data/hubspot-summary.json");
const VAULT = path.join(HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault");
const PEOPLE_DIR = path.join(VAULT, "people");

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function note(name: string, email: string, company?: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  return `---
title: "${name.replace(/"/g, "'")}"
source: hubspot
type: note
domain: openclaw
tags: [people]
status: active
---

# ${name}

## Role
- 

## Active Projects
- 

## Recent Interactions
- ${today}: Seeded from HubSpot contact list.

## Contact Info
- Email: ${email || ""}
${company ? `- Company: ${company}\n` : ""}`;
}

function main() {
  if (!fs.existsSync(HUBSPOT_SUMMARY)) {
    console.error("Missing hubspot summary:", HUBSPOT_SUMMARY);
    process.exit(1);
  }
  fs.mkdirSync(PEOPLE_DIR, { recursive: true });

  const data = JSON.parse(fs.readFileSync(HUBSPOT_SUMMARY, "utf8"));
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];

  let created = 0;
  let skipped = 0;
  const seeded: string[] = [];

  for (const c of contacts.slice(0, 60)) {
    const name = String(c?.name || "").trim();
    const email = String(c?.email || "").trim();
    if (!name || !email) {
      continue;
    }

    const out = path.join(PEOPLE_DIR, `${slug(name)}.md`);
    if (fs.existsSync(out)) {
      skipped++;
      continue;
    }

    fs.writeFileSync(out, note(name, email, c?.company || null));
    seeded.push(name);
    created++;
  }

  const indexPath = path.join(PEOPLE_DIR, "_index.md");
  const lines = [
    "# People Index",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Seeded Contacts",
    "",
  ];
  for (const n of seeded.toSorted()) {
    lines.push(`- [[${slug(n)}]]`);
  }
  fs.writeFileSync(indexPath, `${lines.join("\n")}\n`);

  console.log(JSON.stringify({ created, skipped, indexPath }, null, 2));
}

main();
