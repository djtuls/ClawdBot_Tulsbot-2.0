import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { logEvent } from "./event-logger.js";

export interface MemoryTierHealth {
  name: string;
  ok: boolean;
  detail: string;
}

export interface MemoryHealthSnapshot {
  generatedAt: string;
  allGreen: boolean;
  tiers: MemoryTierHealth[];
}

function hoursAgo(ms: number): number {
  return (Date.now() - ms) / 3_600_000;
}

export async function assessAndHealMemory(repoRoot: string): Promise<MemoryHealthSnapshot> {
  const today = new Date().toISOString().slice(0, 10);
  const dailyPath = path.join(repoRoot, "memory", "daily", `${today}.md`);
  const handoffPath = path.join(repoRoot, "memory", "session-handoff.md");
  const eventLogPath = path.join(repoRoot, "memory", "event-log.jsonl");

  const tiers: MemoryTierHealth[] = [];

  // Tier 1: daily memory (heal missing/stale by append only, never overwrite)
  if (!fsSync.existsSync(dailyPath)) {
    await fs.mkdir(path.dirname(dailyPath), { recursive: true });
    await fs.writeFile(
      dailyPath,
      `# Daily Log — ${today}\n\n- ${new Date().toISOString()} Auto-created by heartbeat memory auto-heal.\n`,
    );
    logEvent({
      source: "heartbeat",
      action: "memory-auto-heal",
      target: "daily",
      result: "ok",
      detail: `${today}.md missing; created stub`,
    });
    tiers.push({ name: "daily", ok: true, detail: "missing -> auto-created" });
  } else {
    const dailyStat = await fs.stat(dailyPath);
    const h = hoursAgo(dailyStat.mtimeMs);
    if (h >= 4) {
      await fs.appendFile(
        dailyPath,
        `\n- ${new Date().toISOString()} Auto-refresh from heartbeat (stale>${h.toFixed(1)}h).\n`,
      );
      logEvent({
        source: "heartbeat",
        action: "memory-auto-heal",
        target: "daily",
        result: "ok",
        detail: `daily stale ${h.toFixed(1)}h; appended refresh line`,
      });
      tiers.push({ name: "daily", ok: true, detail: `stale ${h.toFixed(1)}h -> appended refresh` });
    } else {
      tiers.push({ name: "daily", ok: true, detail: `${h.toFixed(1)}h old` });
    }
  }

  // Tier 2: session handoff freshness (heal stale by appending regen section)
  if (!fsSync.existsSync(handoffPath)) {
    await fs.mkdir(path.dirname(handoffPath), { recursive: true });
    await fs.writeFile(
      handoffPath,
      `# Session Handoff\n\nGenerated: ${new Date().toISOString()}\n\n- Auto-generated fallback handoff by heartbeat.\n`,
    );
    logEvent({
      source: "heartbeat",
      action: "memory-auto-heal",
      target: "handoff",
      result: "ok",
      detail: "session-handoff missing; created fallback",
    });
    tiers.push({ name: "handoff", ok: true, detail: "missing -> auto-created" });
  } else {
    const handoffStat = await fs.stat(handoffPath);
    const h = hoursAgo(handoffStat.mtimeMs);
    if (h >= 24) {
      let focus = "";
      try {
        const stateMd = await fs.readFile(path.join(repoRoot, "STATE.md"), "utf8");
        const m = stateMd.match(/## Current Focus\n\n([\s\S]*?)\n\n##/);
        focus = (m?.[1] || "").trim().split("\n").slice(0, 3).join(" ");
      } catch {
        focus = "";
      }
      await fs.appendFile(
        handoffPath,
        `\n\n## Auto-heal update — ${new Date().toISOString()}\n- Handoff stale (${h.toFixed(1)}h); heartbeat appended freshness checkpoint.\n${focus ? `- Current focus snapshot: ${focus}\n` : ""}`,
      );
      logEvent({
        source: "heartbeat",
        action: "memory-auto-heal",
        target: "handoff",
        result: "ok",
        detail: `handoff stale ${h.toFixed(1)}h; appended checkpoint`,
      });
      tiers.push({
        name: "handoff",
        ok: true,
        detail: `stale ${h.toFixed(1)}h -> appended checkpoint`,
      });
    } else {
      tiers.push({ name: "handoff", ok: true, detail: `${h.toFixed(1)}h old` });
    }
  }

  // Tier 3: event log activity (no destructive heal)
  if (!fsSync.existsSync(eventLogPath)) {
    tiers.push({ name: "event-log", ok: false, detail: "event-log.jsonl missing" });
  } else {
    const content = await fs.readFile(eventLogPath, "utf8");
    const lines = content.trim().split("\n");
    const last = lines[lines.length - 1] || "";
    const hasToday = last.includes(today);
    tiers.push({
      name: "event-log",
      ok: hasToday,
      detail: hasToday ? "entries today" : "no entries today",
    });
  }

  const snapshot: MemoryHealthSnapshot = {
    generatedAt: new Date().toISOString(),
    allGreen: tiers.every((t) => t.ok),
    tiers,
  };

  await fs.mkdir(path.join(repoRoot, "state"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "state", "memory-health.json"),
    JSON.stringify(snapshot, null, 2),
  );

  return snapshot;
}
