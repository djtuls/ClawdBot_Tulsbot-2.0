#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const memoryDir = path.join(ROOT, "memory");

const files = {
  status: path.join(memoryDir, "STATUS-INDEX.md"),
  deprecated: path.join(memoryDir, "DEPRECATED-REGISTRY.md"),
  rules: path.join(memoryDir, "INDEXING-RULES.md"),
  operating: path.join(memoryDir, "OPERATING-RULES.md"),
  canonical: path.join(memoryDir, "CANONICAL-DECISIONS.md"),
};

const reportPath = path.join(memoryDir, "index-refresh-report.md");
const driftPath = path.join(memoryDir, "drift-alert-report.md");

const issues = [];
const warnings = [];
const checks = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

function parseIsoDate(s) {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseMdTable(md, marker) {
  const idx = md.indexOf(marker);
  if (idx < 0) {
    return [];
  }
  const lines = md.slice(idx).split(/\r?\n/).slice(1);
  const rows = [];
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (started) {
        break;
      }
      continue;
    }
    if (!t.startsWith("|")) {
      if (started) {
        break;
      }
      continue;
    }
    started = true;
    if (line.includes("---")) {
      continue;
    }
    const cols = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    rows.push(cols);
  }
  return rows;
}

function isPlaceholder(v = "") {
  return !v || /^(UNKNOWN|\[TO_VERIFY\]|TBD|N\/A)$/i.test(v.trim());
}

const txt = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, read(v)]));

for (const [name, filePath] of Object.entries(files)) {
  const ok = fs.existsSync(filePath);
  addCheck(`required file exists: memory/${path.basename(filePath)}`, ok);
  if (!ok) {
    issues.push(`Missing required file: memory/${path.basename(filePath)}`);
  }

  const body = txt[name] || "";
  if (!body) {
    continue;
  }
  const m = body.match(/Last\s+updated:\s*(\d{4}-\d{2}-\d{2})/i);
  if (!m) {
    warnings.push(`memory/${path.basename(filePath)}: missing Last updated header`);
    continue;
  }
  const d = parseIsoDate(m[1]);
  if (!d) {
    issues.push(`memory/${path.basename(filePath)}: invalid Last updated date (${m[1]})`);
  }
}

const priorityRows = parseMdTable(txt.status, "## Priority Queue (Morning Recovery)");
const additionalRows = parseMdTable(txt.status, "## Additional Canonical Work Items");
const statusRows = [...priorityRows, ...additionalRows];

// Expected columns:
// Key | Priority | Status | Owner | PRD Decision | Canonical Artifact | Last Evidence | Next Action | Notes
const caps = { P0: 3, P1: 5 };
const activeByPriority = { P0: 0, P1: 0 };

for (const row of statusRows) {
  if (row.length < 9) {
    continue;
  }
  const [key, priority, status, owner, prdDecision, canonicalArtifact, lastEvidence, nextAction] =
    row;

  if (status === "ACTIVE" && (priority === "P0" || priority === "P1")) {
    activeByPriority[priority]++;
  }

  const requiresOwner = ["ACTIVE", "BLOCKED", "DONE"].includes(status);
  const requiresNextAction = ["ACTIVE", "BLOCKED"].includes(status);
  const requiresEvidence = ["DONE"].includes(status);

  if (requiresOwner && isPlaceholder(owner)) {
    issues.push(`${key}: ${status} missing owner`);
  }
  if (requiresNextAction && isPlaceholder(nextAction)) {
    issues.push(`${key}: ${status} missing actionable next action`);
  }
  if (requiresEvidence) {
    const hasPath =
      /`[^`]+`/.test(lastEvidence) || /\b[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+\b/.test(lastEvidence);
    if (isPlaceholder(lastEvidence) || !hasPath) {
      issues.push(`${key}: DONE missing evidence artifact path`);
    }
  }

  if (status === "ACTIVE") {
    const validPrd = /^(none|lite|full)\s*:/i.test(prdDecision);
    if (!validPrd) {
      issues.push(
        `${key}: ACTIVE missing PRD decision marker/rationale (expected 'none|lite|full: ...')`,
      );
    }
  }

  if (!canonicalArtifact || isPlaceholder(canonicalArtifact)) {
    warnings.push(`${key}: missing canonical artifact path`);
  }
}

for (const prio of ["P0", "P1"]) {
  const ok = activeByPriority[prio] <= caps[prio];
  addCheck(`WIP cap ${prio} ACTIVE <= ${caps[prio]}`, ok, `found ${activeByPriority[prio]}`);
  if (!ok) {
    issues.push(`WIP cap violation: ${prio} ACTIVE ${activeByPriority[prio]} > ${caps[prio]}`);
  }
}

const hasStatusFirstInRules = /\|\s*1\s*\|\s*`?memory\/STATUS-INDEX\.md`?/i.test(txt.rules);
const hasDeprecatedSecondInRules = /\|\s*2\s*\|\s*`?memory\/DEPRECATED-REGISTRY\.md`?/i.test(
  txt.rules,
);
addCheck(
  "retrieval order rules present (STATUS first, DEPRECATED second)",
  hasStatusFirstInRules && hasDeprecatedSecondInRules,
);
if (!hasStatusFirstInRules || !hasDeprecatedSecondInRules) {
  issues.push("Retrieval-order violation in INDEXING-RULES.md");
}

// Drift alert report generation
const driftFindings = [];
const orderViolations = [];

if (!hasStatusFirstInRules || !hasDeprecatedSecondInRules) {
  orderViolations.push("INDEXING-RULES retrieval order invalid");
}
if (
  !/1\. Read `memory\/STATUS-INDEX\.md`[\s\S]*2\. Read `memory\/DEPRECATED-REGISTRY\.md`/m.test(
    txt.status,
  )
) {
  orderViolations.push("STATUS-INDEX recovery gate ordering invalid/missing");
}
if (!/1\. Check this registry[\s\S]*2\. If a deprecated item matches/m.test(txt.deprecated)) {
  orderViolations.push("DEPRECATED-REGISTRY recovery gate ordering invalid/missing");
}

if (
  /notebooklm-primary-backbone/i.test(txt.deprecated) &&
  !/AnythingLLM \+ Supabase/i.test(txt.canonical)
) {
  driftFindings.push(
    "Deprecated registry marks NotebookLM-primary deprecated, but canonical decisions do not assert AnythingLLM + Supabase primary.",
  );
}
if (
  /NotebookLM is legacy/i.test(txt.canonical) &&
  !/Knowledge default is AnythingLLM \+ Supabase; NotebookLM is legacy\/non-primary\./i.test(
    txt.operating,
  )
) {
  driftFindings.push(
    "Canonical conflict: OPERATING-RULES does not explicitly enforce AnythingLLM + Supabase as primary and NotebookLM as legacy.",
  );
}

const driftReport = [
  "# Drift Alert Report",
  "",
  `- Generated at: ${new Date().toISOString()}`,
  `- Workspace: ${ROOT}`,
  "",
  `## Deprecated/Current Conflicts (${driftFindings.length})`,
  ...(driftFindings.length ? driftFindings.map((f) => `- ${f}`) : ["- None detected"]),
  "",
  `## Canonical-Order Violations (${orderViolations.length})`,
  ...(orderViolations.length ? orderViolations.map((v) => `- ${v}`) : ["- None detected"]),
  "",
  "## Verdict",
  driftFindings.length || orderViolations.length
    ? "- DRIFT-ALERT: investigate and correct before relying on memory outputs."
    : "- Clean: no drift conflicts or canonical-order violations detected.",
  "",
].join("\n");
fs.writeFileSync(driftPath, driftReport);

const status = issues.length ? "FAIL" : "PASS";
const report = [
  "# Index Hygiene Refresh Report",
  "",
  `- Generated at: ${new Date().toISOString()}`,
  `- Workspace: ${ROOT}`,
  `- Overall: **${status}**`,
  "",
  "## Check Summary",
  ...checks.map((c) => `- ${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`),
  "",
  `## Issues (${issues.length})`,
  ...(issues.length ? issues.map((i) => `- ${i}`) : ["- None"]),
  "",
  `## Warnings (${warnings.length})`,
  ...(warnings.length ? warnings.map((w) => `- ${w}`) : ["- None"]),
  "",
  `## Generated Artifacts`,
  `- memory/${path.basename(driftPath)}`,
  "",
  "## Deterministic Verdict",
  issues.length
    ? "- Blocking issues found. Do not treat index hygiene as clean until fixed."
    : "- No blocking issues found. Index hygiene check is clean.",
  "",
].join("\n");

fs.writeFileSync(reportPath, report);
console.log(`Wrote memory/${path.basename(reportPath)} (${status})`);
console.log(`Wrote memory/${path.basename(driftPath)}`);
process.exit(issues.length ? 2 : 0);
