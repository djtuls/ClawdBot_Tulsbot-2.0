#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || "/Users/tulioferro";
const VAULT = path.join(HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault");
const PROJECTS = path.join(VAULT, "projects");
const SIGNALS = path.join(VAULT, "signals");
const DOSSIERS = path.join(HOME, ".openclaw/workspace/context/projects");

function topProjects(limit = 10): string[] {
  return fs
    .readdirSync(PROJECTS)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((f) => ({ f, m: fs.statSync(path.join(PROJECTS, f)).mtimeMs }))
    .toSorted((a, b) => b.m - a.m)
    .slice(0, limit)
    .map((x) => x.f);
}

function projectCode(file: string): string | null {
  const m = file.match(/^(2\d{3})-/);
  return m?.[1] || null;
}

function extractSenderLinks(signalMd: string): string[] {
  const hits = [...signalMd.matchAll(/- Sender:\s*\[\[([^\]]+)\]\]/g)];
  return hits.map((m) => m[1]).filter(Boolean);
}

function ensurePeopleFromEmail(email: string): string {
  const local = email.split("@")[0] || "unknown";
  const name =
    local
      .split(/[._-]/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || "Unknown";
  const file = path.join(VAULT, "people", `${name.toLowerCase().replace(/\s+/g, "-")}.md`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      `---\ntitle: "${name}"\nsource: capture\ntype: note\ndomain: openclaw\ntags: [people]\nstatus: active\n---\n\n# ${name}\n\n## Active Projects\n- \n\n## Recent Interactions\n- Seeded from dossier email inference.\n\n## Contact Info\n- Email: ${email}\n`,
    );
  }
  return path.basename(file, ".md");
}

function enrichProject(projectFile: string): { updated: boolean; people: string[] } {
  const p = path.join(PROJECTS, projectFile);
  const raw = fs.readFileSync(p, "utf8");
  const code = projectCode(projectFile);
  if (!code) {
    return { updated: false, people: [] };
  }

  const sigFiles = fs.readdirSync(SIGNALS).filter((f) => f.endsWith(".md"));
  const inferred = new Set<string>();

  for (const s of sigFiles) {
    const sp = path.join(SIGNALS, s);
    const body = fs.readFileSync(sp, "utf8");
    if (
      !body.includes(`[[${projectFile.replace(/\.md$/, "")}]]`) &&
      !s.includes(code) &&
      !body.includes(code)
    ) {
      continue;
    }
    for (const sender of extractSenderLinks(body)) {
      inferred.add(sender);
    }
  }

  // Fallback: infer from matching dossier emails when no signal links yet
  if (!inferred.size && code && fs.existsSync(DOSSIERS)) {
    const ds = fs.readdirSync(DOSSIERS).find((f) => f.startsWith(`${code}-`) && f.endsWith(".md"));
    if (ds) {
      const body = fs.readFileSync(path.join(DOSSIERS, ds), "utf8");
      const emails = [...body.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) =>
        m[0].toLowerCase(),
      );
      for (const e of emails.slice(0, 6)) {
        inferred.add(ensurePeopleFromEmail(e));
      }
    }
  }

  const people = [...inferred].slice(0, 8);
  if (!people.length) {
    return { updated: false, people: [] };
  }

  let next = raw;
  const keyPeopleSection = /## Key People\n([\s\S]*?)\n## Recent Signals/m;
  const m = raw.match(keyPeopleSection);
  if (!m) {
    return { updated: false, people: [] };
  }

  const currentBlock = m[1] || "";
  const lines = currentBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.includes("people/_index"));

  const existingPeople = new Set(
    lines
      .map((l) => {
        const mm = l.match(/\[\[([^\]]+)\]\]/);
        return mm?.[1];
      })
      .filter(Boolean) as string[],
  );

  for (const person of people) {
    if (!existingPeople.has(person)) {
      lines.push(`- [[${person}]] — inferred from linked signals`);
      existingPeople.add(person);
    }
  }

  const rebuilt = `## Key People\n${lines.join("\n")}\n\n## Recent Signals`;
  next = raw.replace(keyPeopleSection, rebuilt);

  if (next !== raw) {
    fs.writeFileSync(p, next);
    return { updated: true, people };
  }

  return { updated: false, people };
}

function main() {
  const targets = topProjects(10);
  const report: Array<{ file: string; updated: boolean; people: string[] }> = [];

  for (const f of targets) {
    report.push({ file: f, ...enrichProject(f) });
  }

  console.log(
    JSON.stringify(
      { scanned: targets.length, updated: report.filter((r) => r.updated).length, report },
      null,
      2,
    ),
  );
}

main();
