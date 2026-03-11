import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || "/Users/tulioferro";
const VAULT = path.join(HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault");
const SIGNALS_DIR = path.join(VAULT, "signals");
const PROJECTS_DIR = path.join(VAULT, "projects");
const PEOPLE_DIR = path.join(VAULT, "people");

export interface PendingSignal {
  id?: string;
  threadId?: string;
  source: string;
  subject?: string;
  commitment?: string;
  from?: string;
  snippet?: string;
  account?: string;
  addedAt?: string;
  category?: string;
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function detectProjectCode(text: string): string | null {
  const m = text.match(/\b(2\d{3})\b/);
  return m?.[1] || null;
}

function parseSender(from?: string): { name: string; email: string } {
  const raw = from || "unknown";
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = (emailMatch?.[0] || "").toLowerCase();
  const name =
    raw
      .replace(/<[^>]+>/g, "")
      .replace(email, "")
      .trim() || (email ? email.split("@")[0] : "unknown");
  return { name, email };
}

function findProjectHubByCode(code: string): string | null {
  if (!fs.existsSync(PROJECTS_DIR)) {
    return null;
  }
  const files = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".md"));
  const hit = files.find((f) => f.startsWith(`${code}-`));
  return hit ? path.join(PROJECTS_DIR, hit) : null;
}

function ensurePeopleNote(name: string, email: string): string {
  ensureDir(PEOPLE_DIR);
  const file = path.join(PEOPLE_DIR, `${slug(name)}.md`);
  if (!fs.existsSync(file)) {
    const body = `---\ntitle: "${name.replace(/"/g, "'")}"\nsource: capture\ntype: note\ndomain: openclaw\ntags: [people]\nstatus: active\n---\n\n# ${name}\n\n## Active Projects\n- \n\n## Recent Interactions\n- \n\n## Contact Info\n${email ? `- Email: ${email}\n` : ""}`;
    fs.writeFileSync(file, body);
  }
  return file;
}

function appendIfMissing(file: string, marker: string, line: string) {
  const raw = fs.readFileSync(file, "utf8");
  if (raw.includes(line)) {
    return;
  }
  const re = new RegExp(`${marker}\\n`, "m");
  if (re.test(raw)) {
    fs.writeFileSync(file, raw.replace(re, `${marker}\n${line}\n`));
  } else {
    fs.writeFileSync(file, `${raw}\n${marker}\n${line}\n`);
  }
}

export function linkSignalFromPending(item: PendingSignal): {
  signalPath: string;
  linkedProject?: string;
  linkedPerson?: string;
} {
  ensureDir(SIGNALS_DIR);
  const dt = item.addedAt ? new Date(item.addedAt) : new Date();
  const day = dt.toISOString().slice(0, 10);
  const title = item.subject || item.commitment || "signal";
  const signalFile = `${day}-${slug(title)}-${slug(String(item.id || item.threadId || "sig")).slice(0, 12)}.md`;
  const signalPath = path.join(SIGNALS_DIR, signalFile);

  const sender = parseSender(item.from);
  const projectCode = detectProjectCode(
    `${item.subject || ""} ${item.commitment || ""} ${item.snippet || ""}`,
  );
  const projectPath = projectCode ? findProjectHubByCode(projectCode) : null;
  const peoplePath = ensurePeopleNote(sender.name, sender.email);

  if (!fs.existsSync(signalPath)) {
    const body = `---\ntitle: "${title.replace(/"/g, "'")}"\nsource: ${item.source || "capture"}\ntype: note\ndomain: openclaw\ntags: [signal]\nstatus: active\n---\n\n# ${title}\n\n- Date: ${day}\n- Source: ${item.source || "unknown"}\n- Sender: [[${path.basename(peoplePath, ".md")}]]\n${projectPath ? `- Project: [[${path.basename(projectPath, ".md")}]]\n` : ""}\n\n## Summary\n${(item.snippet || "").slice(0, 1200)}\n`;
    fs.writeFileSync(signalPath, body);
  }

  const signalRef = `[[${path.basename(signalPath, ".md")}]]`;
  const oneLine = `- ${day}: ${signalRef} — ${(item.subject || item.commitment || "signal").slice(0, 100)}`;

  appendIfMissing(peoplePath, "## Recent Interactions", oneLine);

  if (projectPath) {
    appendIfMissing(projectPath, "## Recent Signals", oneLine);
  }

  return {
    signalPath,
    linkedProject: projectPath || undefined,
    linkedPerson: peoplePath,
  };
}
