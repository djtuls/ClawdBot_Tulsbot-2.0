import { execFileSync } from "child_process";
/**
 * vault-promote.ts — Tier 3 Memory Promotion
 *
 * Consolidates daily memory notes (memory/daily/*.md) into curated
 * Obsidian vault notes. Runs nightly after councils.
 *
 * Process:
 * 1. Reads daily notes older than 1 day (already processed by evening report)
 * 2. Extracts key decisions, learnings, project updates
 * 3. Creates/updates vault notes organized by project or topic
 * 4. Appends to memory/learnings.md for operational wisdom
 * 5. Re-indexes QMD vault collection
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "fs";
import { join, basename } from "path";
import { logEvent } from "./lib/event-logger.ts";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const DAILY_DIR = join(WORKSPACE, "memory/daily");
const VAULT = join(
  process.env.HOME!,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault",
);
const VAULT_PROJECTS = join(VAULT, "04_projects");
const VAULT_SYSTEM = join(VAULT, "08_system");
const VAULT_THINKING = join(VAULT, "01_thinking");
const LEARNINGS_PATH = join(WORKSPACE, "memory/learnings.md");
const STATE_PATH = join(WORKSPACE, "data/vault-promote-state.json");

interface PromoteState {
  lastProcessedDate: string;
  totalPromoted: number;
}

function readState(): PromoteState {
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    } catch {}
  }
  return { lastProcessedDate: "2026-01-01", totalPromoted: 0 };
}

function writeState(state: PromoteState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

interface DailySection {
  heading: string;
  content: string;
}

function parseDailyNote(content: string): DailySection[] {
  const sections: DailySection[] = [];
  const lines = content.split("\n");
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ") || line.startsWith("### ")) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
      }
      currentHeading = line.replace(/^#+\s*/, "");
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
  }
  return sections;
}

function extractProjectMentions(content: string): string[] {
  const projectPatterns = [
    /\b(\d{4}_[A-Za-z_-]+)/g,
    /\bINFT[- ](\w+)/gi,
    /project[: ]+([A-Za-z0-9_-]+)/gi,
  ];
  const mentions = new Set<string>();
  for (const pattern of projectPatterns) {
    const matches = content.matchAll(pattern);
    for (const m of matches) {
      mentions.add(m[1] || m[0]);
    }
  }
  return [...mentions];
}

function extractLearnings(sections: DailySection[]): string[] {
  const learnings: string[] = [];
  const learningKeywords = [
    "learned",
    "lesson",
    "fixed",
    "root cause",
    "mistake",
    "insight",
    "realization",
    "pattern",
  ];

  for (const section of sections) {
    const lower = section.content.toLowerCase();
    if (learningKeywords.some((k) => lower.includes(k))) {
      const bullets = section.content
        .split("\n")
        .filter((l) => l.trim().startsWith("- ") || l.trim().startsWith("* "));
      for (const bullet of bullets) {
        if (learningKeywords.some((k) => bullet.toLowerCase().includes(k))) {
          learnings.push(bullet.trim());
        }
      }
      if (bullets.length === 0 && section.content.length < 500) {
        learnings.push(`- ${section.heading}: ${section.content.slice(0, 200)}`);
      }
    }
  }
  return learnings;
}

function appendToVaultNote(filePath: string, date: string, content: string): void {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    if (existing.includes(date)) {
      return;
    }
    appendFileSync(filePath, `\n\n---\n### ${date}\n${content}\n`);
  } else {
    writeFileSync(filePath, `# ${basename(filePath, ".md")}\n\n### ${date}\n${content}\n`);
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function promoteDaily(
  dateStr: string,
  content: string,
): { projects: number; learnings: number; system: number } {
  const sections = parseDailyNote(content);
  let projectCount = 0;
  let learningCount = 0;
  let systemCount = 0;

  const projectMentions = extractProjectMentions(content);
  for (const project of projectMentions) {
    const projectSections = sections.filter(
      (s) => s.content.includes(project) || s.heading.includes(project),
    );
    if (projectSections.length > 0) {
      const slug = slugify(project);
      const vaultPath = join(VAULT_PROJECTS, `${slug}.md`);
      const summary = projectSections
        .map((s) => `- **${s.heading}**: ${s.content.slice(0, 200)}`)
        .join("\n");
      appendToVaultNote(vaultPath, dateStr, summary);
      projectCount++;
    }
  }

  const learnings = extractLearnings(sections);
  if (learnings.length > 0) {
    if (!existsSync(LEARNINGS_PATH)) {
      writeFileSync(
        LEARNINGS_PATH,
        "# Learnings & Operational Wisdom\n\nCaptures from daily operations.\n\n",
      );
    }
    const block = `\n### ${dateStr}\n${learnings.join("\n")}\n`;
    const existing = readFileSync(LEARNINGS_PATH, "utf-8");
    if (!existing.includes(dateStr)) {
      appendFileSync(LEARNINGS_PATH, block);
      learningCount = learnings.length;
    }
  }

  const systemSections = sections.filter((s) => {
    const h = s.heading.toLowerCase();
    return (
      h.includes("system") ||
      h.includes("cron") ||
      h.includes("deploy") ||
      h.includes("infra") ||
      h.includes("build")
    );
  });
  if (systemSections.length > 0) {
    const vaultPath = join(VAULT_SYSTEM, `operations-log.md`);
    const summary = systemSections
      .map((s) => `- **${s.heading}**: ${s.content.slice(0, 200)}`)
      .join("\n");
    appendToVaultNote(vaultPath, dateStr, summary);
    systemCount = systemSections.length;
  }

  return { projects: projectCount, learnings: learningCount, system: systemCount };
}

async function main() {
  console.log("[vault-promote] Starting Tier 3 memory promotion...");

  if (!existsSync(VAULT)) {
    console.error("[vault-promote] Vault not found at", VAULT);
    logEvent({
      source: "vault-promote",
      action: "error",
      result: "error",
      detail: "Vault not found",
    });
    return;
  }

  if (!existsSync(DAILY_DIR)) {
    console.log("[vault-promote] No daily memory directory");
    return;
  }

  const state = readState();
  const files = readdirSync(DAILY_DIR)
    .filter((f) => f.endsWith(".md") && f > state.lastProcessedDate)
    .toSorted();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 1);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const eligibleFiles = files.filter((f) => f.replace(".md", "") <= cutoffStr);

  if (eligibleFiles.length === 0) {
    console.log("[vault-promote] No eligible daily notes to promote");
    return;
  }

  let totalProjects = 0;
  let totalLearnings = 0;
  let totalSystem = 0;
  let lastDate = state.lastProcessedDate;

  for (const file of eligibleFiles) {
    const dateStr = file.replace(".md", "");
    const content = readFileSync(join(DAILY_DIR, file), "utf-8");
    if (content.trim().length < 50) {
      continue;
    }

    const { projects, learnings, system } = promoteDaily(dateStr, content);
    totalProjects += projects;
    totalLearnings += learnings;
    totalSystem += system;
    lastDate = dateStr;

    console.log(
      `[vault-promote] ${dateStr}: ${projects} project notes, ${learnings} learnings, ${system} system entries`,
    );
  }

  writeState({
    lastProcessedDate: lastDate,
    totalPromoted: state.totalPromoted + eligibleFiles.length,
  });

  try {
    execFileSync("/opt/homebrew/bin/qmd", ["update", "--collection", "vault"], { timeout: 60_000 });
    execFileSync("/opt/homebrew/bin/qmd", ["embed", "--collection", "vault"], { timeout: 120_000 });
    console.log("[vault-promote] QMD vault re-indexed");
  } catch (err: any) {
    console.error("[vault-promote] QMD re-index failed:", err.message);
  }

  console.log(
    `[vault-promote] Done. Promoted ${eligibleFiles.length} daily notes: ${totalProjects} project entries, ${totalLearnings} learnings, ${totalSystem} system entries`,
  );

  logEvent({
    source: "vault-promote",
    action: "promote-complete",
    result: "ok",
    detail: `files=${eligibleFiles.length} projects=${totalProjects} learnings=${totalLearnings} system=${totalSystem}`,
  });
}

main().catch((err) => {
  console.error("[vault-promote] Fatal:", err);
  logEvent({ source: "vault-promote", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
