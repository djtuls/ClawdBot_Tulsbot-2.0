#!/usr/bin/env npx tsx
/**
 * update-rule.ts — Append a rule/policy to the correct workspace file.
 *
 * Called by Tulsbot after the user confirms the classification.
 *
 * Usage:
 *   npx tsx scripts/update-rule.ts --target <target> --section <section> --rule "<rule text>"
 *
 * Targets:
 *   runbook          → RUNBOOK.md (general SOP, all agents)
 *   agents           → AGENTS.md (general safety/style rules)
 *   soul             → SOUL.md (personality/boundaries)
 *   identity         → IDENTITY.md (Tulsbot-specific modes/persona)
 *   agent-guidelines → .agent/AGENTS.md (Tulsbot-specific domain/scope)
 *   commands         → COMMANDS.md (Telegram command handlers)
 *
 * Section: the markdown heading to append under (e.g. "## 9. Guardrails" or "## Safety Rules")
 *          If not found, appends at the end of the file.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const WORKSPACE = join(import.meta.dirname, "..");

const TARGET_MAP: Record<string, string> = {
  runbook: "RUNBOOK.md",
  agents: "AGENTS.md",
  soul: "SOUL.md",
  identity: "IDENTITY.md",
  "agent-guidelines": ".agent/AGENTS.md",
  commands: "COMMANDS.md",
};

function parseArgs(): { target: string; section: string; rule: string } {
  const args = process.argv.slice(2);
  let target = "";
  let section = "";
  let rule = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && args[i + 1]) {
      target = args[++i];
    } else if (args[i] === "--section" && args[i + 1]) {
      section = args[++i];
    } else if (args[i] === "--rule" && args[i + 1]) {
      rule = args[++i];
    }
  }

  if (!target || !rule) {
    console.error(
      "Usage: npx tsx scripts/update-rule.ts --target <target> --section <section> --rule '<rule>'",
    );
    console.error(`Targets: ${Object.keys(TARGET_MAP).join(", ")}`);
    process.exit(1);
  }

  return { target, section, rule };
}

function appendRule(
  filePath: string,
  section: string,
  rule: string,
): { success: boolean; message: string } {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return { success: false, message: `File not found: ${filePath}` };
  }

  const bulletRule = rule.startsWith("- ") ? rule : `- ${rule}`;
  const timestamp = new Date().toISOString().slice(0, 10);
  const ruleWithMeta = `${bulletRule} _(added ${timestamp})_`;

  if (section) {
    const sectionIdx = content.indexOf(section);
    if (sectionIdx !== -1) {
      const sectionLevel = (section.match(/^#+/) ?? ["#"])[0].length;
      const afterSection = content.indexOf("\n", sectionIdx);
      if (afterSection === -1) {
        content += `\n${ruleWithMeta}\n`;
      } else {
        const rest = content.slice(afterSection + 1);
        const headingPattern = new RegExp(`^#{1,${sectionLevel}} [^#]|^---$`, "m");
        const nextBoundary = rest.search(headingPattern);
        const insertAt = nextBoundary === -1 ? content.length : afterSection + 1 + nextBoundary;

        let before = content.slice(0, insertAt).replace(/\n+$/, "\n");
        const after = content.slice(insertAt);
        content = before + ruleWithMeta + "\n" + (after.startsWith("\n") ? "" : "\n") + after;
      }
    } else {
      content = content.trimEnd() + `\n\n${ruleWithMeta}\n`;
    }
  } else {
    content = content.trimEnd() + `\n${ruleWithMeta}\n`;
  }

  writeFileSync(filePath, content, "utf-8");
  return {
    success: true,
    message: `Rule appended to ${filePath} under "${section || "end of file"}"`,
  };
}

const { target, section, rule } = parseArgs();
const relativePath = TARGET_MAP[target];

if (!relativePath) {
  console.error(`Unknown target: "${target}". Valid: ${Object.keys(TARGET_MAP).join(", ")}`);
  process.exit(1);
}

const fullPath = join(WORKSPACE, relativePath);
const result = appendRule(fullPath, section, rule);

if (result.success) {
  console.log(
    JSON.stringify({
      ok: true,
      target,
      section,
      rule,
      file: relativePath,
      message: result.message,
    }),
  );
} else {
  console.error(
    JSON.stringify({
      ok: false,
      target,
      section,
      rule,
      file: relativePath,
      message: result.message,
    }),
  );
  process.exit(1);
}
