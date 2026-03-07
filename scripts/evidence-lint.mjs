#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const statusPath = path.join(ROOT, "memory/STATUS-INDEX.md");

if (!fs.existsSync(statusPath)) {
  console.error("Missing memory/STATUS-INDEX.md");
  process.exit(2);
}

const txt = fs.readFileSync(statusPath, "utf8");
const sections = ["## Priority Queue (Morning Recovery)", "## Additional Canonical Work Items"];

function parseRows(md, marker) {
  const idx = md.indexOf(marker);
  if (idx < 0) {
    return [];
  }
  const rows = [];
  for (const line of md.slice(idx).split(/\r?\n/).slice(1)) {
    if (!line.trim().startsWith("|")) {
      break;
    }
    if (line.includes("---")) {
      continue;
    }
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  }
  return rows;
}

const rows = sections.flatMap((s) => parseRows(txt, s));
const failures = [];

for (const row of rows) {
  if (row.length < 9) {
    continue;
  }
  const [key, , status, , , , lastEvidence, , notes] = row;
  if (status !== "DONE") {
    continue;
  }

  const hasPath =
    /`[^`]+`/.test(lastEvidence) || /\b[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+\b/.test(lastEvidence);
  const timestamp = `${lastEvidence} ${notes}`.match(
    /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?\b/,
  );

  if (!hasPath || !timestamp) {
    failures.push(`${key}: DONE requires artifact path and verification timestamp`);
  }
}

if (failures.length) {
  console.error("EVIDENCE-LINT: FAIL");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(2);
}

console.log("EVIDENCE-LINT: PASS");
console.log(`- DONE rows checked: ${rows.filter((r) => r[2] === "DONE").length}`);
