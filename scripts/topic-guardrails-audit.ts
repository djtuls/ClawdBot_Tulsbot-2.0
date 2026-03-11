#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

type TopicStatus = "active" | "deprecated" | "archived";
type OwnerMode = "tulsday" | "builder" | "shared";

type Topic = {
  topicId: string;
  name: string;
  status: TopicStatus;
  ownerMode: OwnerMode;
  purpose: string;
  routingPolicy: string;
  notifyPolicy: string;
  deprecatedReason?: string;
};

type TopicModel = {
  version: string;
  scope: { channel: string; groupId: string; groupName: string };
  topics: Topic[];
};

type Finding = {
  type:
    | "mode-ownership-violation"
    | "wrong-topic-posting-risk"
    | "deprecated-topic-usage"
    | "missing-cross-chat-refresh";
  severity: "low" | "medium" | "high";
  message: string;
};

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function safeRead(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function statAgeHours(p: string): number | null {
  try {
    const s = fs.statSync(p);
    return (Date.now() - s.mtimeMs) / (1000 * 60 * 60);
  } catch {
    return null;
  }
}

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function main() {
  const cwd = process.cwd();
  const modelPath = path.resolve(cwd, "config/topic-operating-model.json");
  const reportPath = path.resolve(cwd, "reports/topic-guardrails-snapshot.md");
  const statusUpdatePath = path.resolve(cwd, "reports/topic-status-update.md");
  const statePath = path.resolve(cwd, "state/topic-guardrails-audit.json");
  const crossChatPath = path.resolve(cwd, "reports/cross-chat-delta.md");
  const handoffPath = path.resolve(cwd, "memory/session-handoff.md");
  const eventLogPath = path.resolve(cwd, "memory/event-log.jsonl");

  const model = readJson<TopicModel>(modelPath);
  const active = model.topics.filter((t) => t.status === "active");
  const deprecated = model.topics.filter((t) => t.status === "deprecated");

  const findings: Finding[] = [];

  // 1) Mode ownership violations
  for (const t of active) {
    if (t.ownerMode === "shared") {
      continue;
    }
    if (!includesCI(t.routingPolicy, t.ownerMode)) {
      findings.push({
        type: "mode-ownership-violation",
        severity: "high",
        message: `${t.name}: routingPolicy does not explicitly anchor owner mode '${t.ownerMode}'.`,
      });
    }
  }

  // 2) Wrong-topic posting risk: overlapping active purposes or missing negative scope statements
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (a.purpose.trim().toLowerCase() === b.purpose.trim().toLowerCase()) {
        findings.push({
          type: "wrong-topic-posting-risk",
          severity: "medium",
          message: `${a.name} and ${b.name}: purpose text is identical; this increases routing ambiguity.`,
        });
      }
    }
  }

  // 3) Deprecated topic usage: detect references in recent operational docs/logs
  const searchCorpus = [
    safeRead(crossChatPath),
    safeRead(handoffPath),
    safeRead(eventLogPath),
  ].join("\n");
  for (const t of deprecated) {
    const nameHits = includesCI(searchCorpus, t.name) ? 1 : 0;
    const idHits = includesCI(searchCorpus, t.topicId) ? 1 : 0;
    if (nameHits + idHits > 0) {
      findings.push({
        type: "deprecated-topic-usage",
        severity: "medium",
        message: `${t.name}: referenced in recent context/log corpus. Validate if this was historical-only or an active posting regression.`,
      });
    }
  }

  // 4) Missing cross-chat awareness refresh
  const ageHours = statAgeHours(crossChatPath);
  if (ageHours === null) {
    findings.push({
      type: "missing-cross-chat-refresh",
      severity: "high",
      message:
        "reports/cross-chat-delta.md missing; cross-chat awareness refresh cannot be validated.",
    });
  } else if (ageHours > 26) {
    findings.push({
      type: "missing-cross-chat-refresh",
      severity: "high",
      message: `reports/cross-chat-delta.md is stale (${ageHours.toFixed(1)}h old). Refresh required.`,
    });
  }

  const risk = findings.some((f) => f.severity === "high")
    ? "high"
    : findings.some((f) => f.severity === "medium")
      ? "medium"
      : "low";

  const snapshot = {
    generatedAt: new Date().toISOString(),
    scope: model.scope,
    counts: {
      total: model.topics.length,
      active: active.length,
      deprecated: deprecated.length,
      archived: model.topics.filter((t) => t.status === "archived").length,
    },
    findings,
    overallRisk: risk,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  fs.writeFileSync(statePath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const lines: string[] = [];
  lines.push(`# Topic Guardrails Snapshot`);
  lines.push("");
  lines.push(`Generated: ${snapshot.generatedAt}`);
  lines.push(`Scope: ${model.scope.groupName} (${model.scope.groupId})`);
  lines.push("");
  lines.push(`- Active: ${snapshot.counts.active}`);
  lines.push(`- Deprecated: ${snapshot.counts.deprecated}`);
  lines.push(`- Archived: ${snapshot.counts.archived}`);
  lines.push(`- Overall risk: **${snapshot.overallRisk.toUpperCase()}**`);
  lines.push("");
  lines.push(`## Findings`);
  lines.push("");

  if (findings.length === 0) {
    lines.push(`- ✅ No guardrail violations detected.`);
  } else {
    for (const f of findings) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.type}: ${f.message}`);
    }
  }

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`);

  const migrationNotes = deprecated.map(
    (t) => `- ${t.name} -> route new posts to owner-mode active topics.`,
  );
  const statusUpdate: string[] = [];
  statusUpdate.push("# Topic Status Update (Tulio)");
  statusUpdate.push("");
  statusUpdate.push(`Generated: ${snapshot.generatedAt}`);
  statusUpdate.push("");
  statusUpdate.push("## Active topics");
  for (const t of active) {
    statusUpdate.push(`- ${t.name} (${t.ownerMode}) — ${t.purpose}`);
  }
  statusUpdate.push("");
  statusUpdate.push("## Deprecated topics");
  for (const t of deprecated) {
    statusUpdate.push(`- ${t.name} — ${t.deprecatedReason || "Deprecated"}`);
  }
  statusUpdate.push("");
  statusUpdate.push("## Migration notes");
  if (migrationNotes.length === 0) {
    statusUpdate.push("- No migrations pending.");
  } else {
    statusUpdate.push(...migrationNotes);
  }
  statusUpdate.push("");
  statusUpdate.push("## Current risks and mitigations");
  if (findings.length === 0) {
    statusUpdate.push(
      "- Risk: Low. Mitigation: keep daily guardrail snapshot and enforce owner-mode routing.",
    );
  } else {
    for (const f of findings) {
      statusUpdate.push(
        `- Risk: ${f.message} | Mitigation: address ${f.type} in next routing cycle.`,
      );
    }
  }

  fs.writeFileSync(statusUpdatePath, `${statusUpdate.join("\n")}\n`);

  console.log(`Wrote ${statePath}`);
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${statusUpdatePath}`);
}

main();
