import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";

interface InboxItem {
  id?: string;
  source?: string;
  category?: string;
  subject?: string;
  from?: string;
  snippet?: string;
  commitment?: string;
  addedAt?: string;
  status?: string;
}

const HOME = process.env.HOME || "/Users/tulioferro";
const WORKSPACE = process.env.WORKSPACE_DIR || join(HOME, ".openclaw/workspace");
const VAULT = join(HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault");
const PENDING = join(WORKSPACE, "memory/inbox/pending.jsonl");
const REPORT_DIR = join(WORKSPACE, "reports");
const REPORT = join(REPORT_DIR, "vault-promotion-latest.md");

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "item"
  );
}

function readItems(): InboxItem[] {
  if (!existsSync(PENDING)) {
    return [];
  }
  return readFileSync(PENDING, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as InboxItem;
      } catch {
        return null;
      }
    })
    .filter((x): x is InboxItem => !!x && (x.status === "pending" || x.status === "routed"));
}

function shouldPromote(i: InboxItem): boolean {
  const c = (i.category || "").toLowerCase();
  if (["newsletter", "spam-noise", "receipt-transactional", "system-build"].includes(c)) {
    return false;
  }
  return (
    ["action-required", "client-communication", "inft-ops", "commitment"].includes(c) ||
    !!i.commitment
  );
}

function targetPath(i: InboxItem): string {
  const c = (i.category || "").toLowerCase();
  if (c === "client-communication") {
    return join(VAULT, "Tulio/commitments");
  }
  if (c === "inft-ops") {
    return join(VAULT, "Tulio/project-briefs");
  }
  return join(VAULT, "Tulio/decisions");
}

function writeNote(i: InboxItem): string {
  const dir = targetPath(i);
  mkdirSync(dir, { recursive: true });
  const title = i.subject || i.commitment || i.snippet || "Inbox Item";
  const file = join(
    dir,
    `${new Date(i.addedAt || Date.now()).toISOString().slice(0, 10)}-${slug(title)}.md`,
  );
  const content = `---\ntitle: "${title.replace(/"/g, "'")}"\nsource: ${i.source || "manual"}\ntype: note\ndomain: openclaw\ntags: [inbox, promoted]\nstatus: active\ncreated_at: ${i.addedAt || new Date().toISOString()}\nupdated_at: ${new Date().toISOString()}\nexternal_id: "${i.id || ""}"\n---\n\n## Summary\n${i.commitment || i.subject || "(no title)"}\n\n## Context\n- From: ${i.from || "unknown"}\n- Category: ${i.category || "unknown"}\n- Snippet: ${(i.snippet || "").slice(0, 800)}\n`;
  writeFileSync(file, content);
  return file;
}

function main() {
  const items = readItems();
  const promoted: string[] = [];
  let skipped = 0;
  for (const i of items) {
    if (!shouldPromote(i)) {
      skipped++;
      continue;
    }
    try {
      promoted.push(writeNote(i));
    } catch {
      skipped++;
    }
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const r = [
    `# Vault Promotion Report`,
    ``,
    `- Run: ${new Date().toISOString()}`,
    `- Inbox items scanned: ${items.length}`,
    `- Promoted notes: ${promoted.length}`,
    `- Suppressed/skipped: ${skipped}`,
    ``,
    `## Promoted files`,
    ...promoted.map((p) => `- ${p}`),
    ``,
  ].join("\n");
  writeFileSync(REPORT, r);
  console.log(`promoted=${promoted.length} skipped=${skipped} report=${REPORT}`);
}

main();
