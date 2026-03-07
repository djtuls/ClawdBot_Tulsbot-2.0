/**
 * Weekly Review — Monday 9 AM BRT
 * Week summary, error trends, vault health report, improvement suggestions.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { logCron } from "./event-logger.js";

const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const EVENT_LOG = join(WORKSPACE, "memory/event-log.jsonl");
const VAULT = join(
  process.env.HOME!,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault",
);

interface VaultHealth {
  exists: boolean;
  totalNotes: number;
  inboxPending: number;
  orphanedNotes: number;
  sectionCounts: Record<string, number>;
  newThisWeek: number;
}

function getVaultHealth(): VaultHealth {
  const health: VaultHealth = {
    exists: false,
    totalNotes: 0,
    inboxPending: 0,
    orphanedNotes: 0,
    sectionCounts: {},
    newThisWeek: 0,
  };
  if (!existsSync(VAULT)) {
    return health;
  }
  health.exists = true;

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sections = [
    "00_inbox",
    "01_thinking",
    "02_reference",
    "03_openclaw",
    "04_projects",
    "05_djtuls",
    "06_archive",
    "07_personal",
  ];

  for (const section of sections) {
    const sectionPath = join(VAULT, section);
    if (!existsSync(sectionPath)) {
      health.sectionCounts[section] = 0;
      continue;
    }

    let count = 0;
    function walkCount(dir: string) {
      try {
        for (const entry of readdirSync(dir)) {
          if (entry.startsWith(".")) {
            continue;
          }
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walkCount(full);
          } else if (entry.endsWith(".md")) {
            count++;
            health.totalNotes++;
            if (stat.mtimeMs > weekAgo) {
              health.newThisWeek++;
            }
          }
        }
      } catch {}
    }
    walkCount(sectionPath);
    health.sectionCounts[section] = count;
    if (section === "00_inbox") {
      health.inboxPending = count;
    }
  }

  // Orphaned notes: notes with no outgoing [[links]] in their body
  const thinkingPath = join(VAULT, "01_thinking/notes");
  if (existsSync(thinkingPath)) {
    try {
      for (const entry of readdirSync(thinkingPath)) {
        if (!entry.endsWith(".md")) {
          continue;
        }
        const content = readFileSync(join(thinkingPath, entry), "utf-8");
        if (!content.includes("[[")) {
          health.orphanedNotes++;
        }
      }
    } catch {}
  }

  return health;
}

function main() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let events: { ts: string; type: string; status: string; source: string }[] = [];

  if (existsSync(EVENT_LOG)) {
    events = readFileSync(EVENT_LOG, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e) => e !== null && e.ts >= weekAgo);
  }

  const errors = events.filter((e) => e.status === "error");
  const byType: Record<string, number> = {};
  const errorSources: Record<string, number> = {};

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }
  for (const e of errors) {
    errorSources[e.source] = (errorSources[e.source] || 0) + 1;
  }

  const vault = getVaultHealth();

  const lines = [
    "📊 **Weekly Review**",
    "",
    `**This week:** ${events.length} events, ${errors.length} errors`,
    `**By type:** ${
      Object.entries(byType)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ") || "none"
    }`,
  ];

  if (errors.length > 0) {
    lines.push("", "**Top error sources:**");
    const sorted = Object.entries(errorSources)
      .toSorted(([, a], [, b]) => b - a)
      .slice(0, 5);
    for (const [source, count] of sorted) {
      lines.push(`- ${source}: ${count}x`);
    }
  }

  if (vault.exists) {
    lines.push("", "**📚 Vault Health:**");
    lines.push(`- Total notes: ${vault.totalNotes}`);
    lines.push(`- New this week: ${vault.newThisWeek}`);
    lines.push(
      `- Inbox pending: ${vault.inboxPending}${vault.inboxPending > 10 ? " ⚠️ backlog" : vault.inboxPending === 0 ? " ✓" : ""}`,
    );
    lines.push(
      `- Orphaned notes (no links): ${vault.orphanedNotes}${vault.orphanedNotes > 5 ? " — consider connecting" : ""}`,
    );

    const activeSections = Object.entries(vault.sectionCounts)
      .filter(([s, c]) => c > 0 && s !== "00_inbox" && s !== "03_openclaw")
      .map(([s, c]) => `${s.replace(/^\d+_/, "")}: ${c}`)
      .join(", ");
    if (activeSections) {
      lines.push(`- By section: ${activeSections}`);
    }

    if (vault.inboxPending > 0) {
      lines.push(`- Action: run \`npx tsx scripts/process-inbox.ts --auto\` to clear inbox`);
    }
  }

  console.log(lines.join("\n"));
  logCron("weekly-review", "ok", {
    totalEvents: events.length,
    totalErrors: errors.length,
    vaultNotes: vault.totalNotes,
    vaultInbox: vault.inboxPending,
    vaultNewThisWeek: vault.newThisWeek,
  });
}

main();
