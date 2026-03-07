#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const OUT_DIR = join(WORKSPACE, "memory", "email-governance");
const GOG = process.env.GOG_BIN || "/opt/homebrew/bin/gog";

const accounts = [
  "ferro.tulio@gmail.com",
  "tulio@weareliveengine.com",
  "tuliof@creativetoolsagency.com",
  "tulsbot@gmail.com",
];

const canonical = {
  behavior: [
    "🚨 Action Items",
    "Follow Up",
    "Reply",
    "Waiting",
    "In progress",
    "Done",
    "To-Be-Sorted",
  ],
  domain: [
    "INFT_HUB",
    "PERSONAL",
    "PERSONAL-ADMIN",
    "PERSONAL-HEALTH",
    "PERSONAL-TRAVEL",
    "PERSONAL-FAMILY",
    "DJTULS",
    "FINANCE",
    "SYSTEM-BUILD",
    "BIZ-LEADS",
    "VENDORS",
  ],
  noise: ["Promotions", "Social", "Forums", "Updates", "Receipts", "Subscriptions", "Spam-Noise"],
};

function getLabels(account) {
  try {
    const out = execFileSync(GOG, ["gmail", "labels", "list", "--account", account, "--json"], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
    });
    const data = JSON.parse(out);
    const labels = Array.isArray(data?.labels) ? data.labels : Array.isArray(data) ? data : [];
    return labels.map((l) => (typeof l === "string" ? l : l?.name || l?.id || "")).filter(Boolean);
  } catch (e) {
    return { error: String(e) };
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const generatedAt = new Date().toISOString();
const snapshot = { generatedAt, accounts: {}, canonical };

for (const account of accounts) {
  snapshot.accounts[account] = getLabels(account);
}

const canonicalSet = new Set(
  [...canonical.behavior, ...canonical.domain, ...canonical.noise].map((s) => s.toLowerCase()),
);
const drift = {};
for (const [account, labels] of Object.entries(snapshot.accounts)) {
  if (!Array.isArray(labels)) {
    drift[account] = { error: labels.error || "unknown" };
    continue;
  }
  const custom = labels.filter(
    (l) =>
      ![
        "INBOX",
        "STARRED",
        "UNREAD",
        "IMPORTANT",
        "SENT",
        "DRAFT",
        "TRASH",
        "CATEGORY_PROMOTIONS",
        "CATEGORY_SOCIAL",
        "CATEGORY_UPDATES",
        "CATEGORY_FORUMS",
      ].includes(String(l).toUpperCase()),
  );
  const unknown = custom.filter((l) => !canonicalSet.has(String(l).toLowerCase()));
  drift[account] = { total: labels.length, custom: custom.length, unknown };
}

const jsonPath = join(OUT_DIR, `drift-baseline-${generatedAt.replace(/[:.]/g, "-")}.json`);
const latestPath = join(OUT_DIR, "drift-baseline-latest.json");
writeFileSync(jsonPath, JSON.stringify({ snapshot, drift }, null, 2));
writeFileSync(latestPath, JSON.stringify({ snapshot, drift }, null, 2));

const lines = [
  "# Email Governance Drift Baseline",
  "",
  `Generated: ${generatedAt}`,
  "",
  "## Drift summary",
];
for (const [account, stats] of Object.entries(drift)) {
  if (stats.error) {
    lines.push(`- ${account}: ERROR ${stats.error}`);
  } else {
    lines.push(
      `- ${account}: unknown labels=${stats.unknown.length} (${stats.unknown.join(", ") || "none"})`,
    );
  }
}
const mdPath = join(OUT_DIR, "drift-baseline-latest.md");
writeFileSync(mdPath, lines.join("\n") + "\n");

console.log(`Wrote baseline: ${latestPath}`);
console.log(`Wrote report: ${mdPath}`);
