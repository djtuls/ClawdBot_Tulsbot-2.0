#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const reqFiles = [
  "memory/STATUS-INDEX.md",
  "memory/DEPRECATED-REGISTRY.md",
  "memory/OPERATING-RULES.md",
  "memory/INDEXING-RULES.md",
  "memory/index-refresh-report.md",
  "memory/drift-alert-report.md",
].map((p) => path.join(ROOT, p));

const failures = [];

for (const f of reqFiles) {
  if (!fs.existsSync(f)) {
    failures.push(`Missing required artifact: ${path.relative(ROOT, f)}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

if (!failures.length) {
  const status = read("memory/STATUS-INDEX.md");
  const rules = read("memory/INDEXING-RULES.md");
  const hygiene = read("memory/index-refresh-report.md");

  if (
    !/1\. Read `memory\/STATUS-INDEX\.md`[\s\S]*2\. Read `memory\/DEPRECATED-REGISTRY\.md`/m.test(
      status,
    )
  ) {
    failures.push("STATUS-INDEX morning gate ordering missing/invalid");
  }
  if (
    !/\|\s*1\s*\|\s*`memory\/STATUS-INDEX\.md`\s*\|/m.test(rules) ||
    !/\|\s*2\s*\|\s*`memory\/DEPRECATED-REGISTRY\.md`\s*\|/m.test(rules)
  ) {
    failures.push("INDEXING-RULES canonical retrieval order missing/invalid");
  }
  if (!/Overall:\s*\*\*PASS\*\*/.test(hygiene)) {
    failures.push("index-refresh-report is not PASS");
  }
}

if (failures.length) {
  console.error("MORNING-GATE: FAIL");
  for (const f of failures) {
    console.error(`- ${f}`);
  }
  process.exit(2);
}

console.log("MORNING-GATE: PASS");
console.log("- Canonical files and reports present");
console.log("- Retrieval order checks valid");
console.log("- Hygiene report status PASS");
