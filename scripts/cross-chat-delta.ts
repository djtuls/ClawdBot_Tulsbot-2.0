#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const WORKSPACE = process.env.WORKSPACE_DIR || "/Users/tulioferro/.openclaw/workspace";
const INDEX = path.join(WORKSPACE, "data/cross-chat-awareness/index.json");
const OUT_MD = path.join(WORKSPACE, "reports/cross-chat-delta.md");
const OUT_JSON = path.join(WORKSPACE, "state/cross-chat-delta.json");

interface TopicRow {
  count: number;
  lastTs: string;
  channel: string;
  topic: string;
}

function parseIndex(): TopicRow[] {
  if (!fs.existsSync(INDEX)) {
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(INDEX, "utf8"));
  const rows = Array.isArray(raw?.topics) ? raw.topics : [];
  return rows
    .map((r: any) => {
      // supports both [key,obj] and plain object shapes
      const obj = Array.isArray(r) ? r[1] : r;
      return {
        count: Number(obj?.count || 0),
        lastTs: String(obj?.lastTs || ""),
        channel: String(obj?.channel || "unknown"),
        topic: String(obj?.topic || "unknown"),
      } as TopicRow;
    })
    .filter((r: TopicRow) => r.lastTs)
    .toSorted((a: TopicRow, b: TopicRow) => String(b.lastTs).localeCompare(String(a.lastTs)));
}

function hoursAgo(iso: string): number {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return 9999;
  }
  return (Date.now() - ts) / 3600000;
}

function main() {
  const rows = parseIndex();
  const top = rows.slice(0, 25);

  const payload = {
    generatedAt: new Date().toISOString(),
    topicsTotal: rows.length,
    activeLast24h: rows.filter((r) => hoursAgo(r.lastTs) <= 24).length,
    top,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`);

  const lines: string[] = [];
  lines.push("# Cross-chat delta");
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`Topics total: ${payload.topicsTotal}`);
  lines.push(`Active in last 24h: ${payload.activeLast24h}`);
  lines.push("");
  lines.push("| Channel | Topic | Entries | Last message | Age(h) |");
  lines.push("|---|---|---:|---|---:|");
  for (const r of top) {
    lines.push(
      `| ${r.channel} | ${r.topic} | ${r.count} | ${r.lastTs} | ${hoursAgo(r.lastTs).toFixed(1)} |`,
    );
  }
  lines.push("");
  lines.push("Use this file at session start for cross-channel situational awareness.");

  fs.writeFileSync(OUT_MD, `${lines.join("\n")}\n`);

  console.log(
    JSON.stringify({ ok: true, topics: rows.length, active24h: payload.activeLast24h }, null, 2),
  );
}

main();
