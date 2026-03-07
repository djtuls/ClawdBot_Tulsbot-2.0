#!/usr/bin/env tsx

/**
 * Tulsday Context Processor
 *
 * Processes the context window at shift start:
 * - Reads from reports/context-window.json and reports/context-window.md
 * - Summarizes: plan vs actual, changes, what's now true
 * - Loads active priorities, open threads, blockers
 *
 * Usage:
 *   bun scripts/tulsday-context.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MEMORY_DIR = path.join(PROJECT_ROOT, "memory");
const REPORTS_DIR = path.join(PROJECT_ROOT, "reports");

interface ContextWindowJSON {
  current_plan?: string;
  active_tasks?: Array<{
    id: string;
    status: string;
    priority: string;
    description: string;
  }>;
  blockers?: Array<{
    id: string;
    description: string;
    severity: string;
  }>;
  recent_changes?: Array<{
    timestamp: string;
    description: string;
  }>;
  [key: string]: unknown;
}

interface ProcessedContext {
  summary: string;
  planVsActual: string[];
  changes: string[];
  activePriorities: string[];
  openThreads: string[];
  blockers: string[];
  processedAt: string;
}

/**
 * Process context-window.json
 */
async function processContextJSON(): Promise<Partial<ProcessedContext>> {
  const jsonPath = path.join(REPORTS_DIR, "context-window.json");

  try {
    const content = await fs.readFile(jsonPath, "utf-8");
    const data: ContextWindowJSON = JSON.parse(content);

    const result: Partial<ProcessedContext> = {
      activePriorities: [],
      openThreads: [],
      blockers: [],
      planVsActual: [],
      changes: [],
    };

    // Extract active tasks as priorities
    if (data.active_tasks) {
      result.activePriorities = data.active_tasks
        .filter((t) => t.status !== "completed")
        .map((t) => `[${t.priority}] ${t.description}`);

      result.openThreads = data.active_tasks.map((t) => t.id);
    }

    // Extract blockers
    if (data.blockers) {
      result.blockers = data.blockers.map((b) => `[${b.severity}] ${b.description}`);
    }

    // Extract recent changes
    if (data.recent_changes) {
      result.changes = data.recent_changes.map((c) => c.description);
    }

    return result;
  } catch (error) {
    console.error("Error reading context-window.json:", error);
    return {};
  }
}

/**
 * Process context-window.md for narrative context
 */
async function processContextMarkdown(): Promise<Partial<ProcessedContext>> {
  const mdPath = path.join(REPORTS_DIR, "context-window.md");

  try {
    const content = await fs.readFile(mdPath, "utf-8");

    const result: Partial<ProcessedContext> = {
      summary: "",
      planVsActual: [],
      changes: [],
    };

    // Extract key sections from markdown
    const lines = content.split("\n");
    let currentSection = "";

    for (const line of lines) {
      // Detect section headers
      if (line.startsWith("## ")) {
        currentSection = line.replace("## ", "").toLowerCase();
      }

      // Extract plan/goal mentions
      if (currentSection.includes("plan") || currentSection.includes("goal")) {
        if (line.startsWith("- ") || line.match(/^\d+\./)) {
          result.planVsActual?.push(line);
        }
      }

      // Extract recent activity
      if (currentSection.includes("recent") || currentSection.includes("current")) {
        if (line.startsWith("- ") || line.match(/^\d+\./)) {
          result.changes?.push(line);
        }
      }
    }

    // Use first 500 chars as summary
    result.summary = content.slice(0, 500) + (content.length > 500 ? "..." : "");

    return result;
  } catch (error) {
    console.error("Error reading context-window.md:", error);
    return {};
  }
}

/**
 * Main processing function
 */
async function processContextWindow(): Promise<ProcessedContext> {
  console.log("📋 Processing context window for shift start...");

  const [jsonResult, mdResult] = await Promise.all([
    processContextJSON(),
    processContextMarkdown(),
  ]);

  const processed: ProcessedContext = {
    summary: mdResult.summary || "No context available",
    planVsActual: jsonResult.planVsActual || mdResult.planVsActual || [],
    changes: jsonResult.changes || mdResult.changes || [],
    activePriorities: jsonResult.activePriorities || [],
    openThreads: jsonResult.openThreads || [],
    blockers: jsonResult.blockers || [],
    processedAt: new Date().toISOString(),
  };

  // Write processed context to memory for Tulsday
  const outputPath = path.join(MEMORY_DIR, "tulsday-processed-context.json");
  await fs.writeFile(outputPath, JSON.stringify(processed, null, 2));
  console.log(`✅ Context processed and saved to ${outputPath}`);

  // Print summary
  console.log("\n📊 Context Summary:");
  console.log(`  - Active priorities: ${processed.activePriorities.length}`);
  console.log(`  - Open threads: ${processed.openThreads.length}`);
  console.log(`  - Blockers: ${processed.blockers.length}`);
  console.log(`  - Plan vs actual items: ${processed.planVsActual.length}`);
  console.log(`  - Recent changes: ${processed.changes.length}`);

  return processed;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  processContextWindow()
    .then(() => {
      console.log("\n✅ Context window processing complete");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error processing context:", error);
      process.exit(1);
    });
}

export { processContextWindow, ProcessedContext };
