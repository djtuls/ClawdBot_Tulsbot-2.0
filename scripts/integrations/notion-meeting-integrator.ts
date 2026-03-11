#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logEvent } from "../lib/event-logger.js";
import { getSecret } from "../lib/secrets.js";
import { linkSignalFromPending } from "../vault/link-signal.js";

const HOME = process.env.HOME || "/Users/tulioferro";
const WORKSPACE = process.env.WORKSPACE_DIR || path.join(HOME, ".openclaw/workspace");
const NOTION_SUMMARY = path.join(WORKSPACE, "data/notion-summary.json");
const STATE_FILE = path.join(WORKSPACE, "state/meeting-notes-integrated.json");

type Seen = Record<string, string>; // pageId -> lastEdited

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
}

function isMeetingLike(item: any): boolean {
  const title = String(item?.title || "").toLowerCase();
  const tags = Array.isArray(item?.properties?.Tags)
    ? item.properties.Tags.join(" ").toLowerCase()
    : "";
  const notesTf = Array.isArray(item?.properties?.["🗓️ Notes_TF"])
    ? item.properties["🗓️ Notes_TF"]
    : [];
  const crmInt = Array.isArray(item?.properties?.["CRM Interactions"])
    ? item.properties["CRM Interactions"]
    : [];
  return (
    /meeting|call|sync|minutes|standup/.test(title) ||
    /meeting|call|sync|minutes/.test(tags) ||
    notesTf.length > 0 ||
    crmInt.length > 0
  );
}

function normalizeOwner(ownerField: unknown): string[] {
  if (!Array.isArray(ownerField)) {
    return [];
  }
  return ownerField.map((x) => String(x || "").trim()).filter(Boolean);
}

function maybeCreateTodoist(nextAction: string, title: string): boolean {
  const token = getSecret("TODOIST_API_TOKEN");
  if (!token || !nextAction.trim()) {
    return false;
  }
  try {
    execFileSync(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        "https://todoist.com/api/v1/tasks",
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify({
          content: nextAction.slice(0, 240),
          description: `From Notion meeting note: ${title}`,
          priority: 3,
        }),
      ],
      { timeout: 15000, encoding: "utf8" },
    );
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (!fs.existsSync(NOTION_SUMMARY)) {
    console.log("no notion summary; skip");
    return;
  }

  const summary = readJson<any>(NOTION_SUMMARY, {});
  const pages = Array.isArray(summary.inftProjects) ? summary.inftProjects : [];
  const seen = readJson<Seen>(STATE_FILE, {});

  let scanned = 0;
  let integrated = 0;
  let todoistCreated = 0;

  for (const p of pages) {
    if (!isMeetingLike(p)) {
      continue;
    }
    scanned++;

    const id = String(p.id || "");
    const lastEdited = String(p.lastEdited || "");
    if (!id || !lastEdited) {
      continue;
    }
    if (seen[id] === lastEdited) {
      continue;
    }

    const title = String(p.title || "Meeting Note");
    const sourceCode = String(p?.properties?.["Source Project Code"] || "").trim();
    const nextAction = String(p?.properties?.["Next Action"] || "").trim();
    const owners = normalizeOwner(p?.properties?.Owner);

    const synthetic = {
      id,
      source: "notion-meeting",
      subject: sourceCode ? `${sourceCode} ${title}` : title,
      from: owners.length ? owners.join(", ") : "Notion Meeting",
      snippet: [
        p?.properties?.Notes ? String(p.properties.Notes) : "",
        p?.url ? `Notion: ${p.url}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1200),
      addedAt: new Date().toISOString(),
      category: "context-only",
    };

    try {
      linkSignalFromPending(synthetic);
      integrated++;
    } catch (err: any) {
      logEvent({
        source: "notion-meeting-integrator",
        action: "link-failed",
        result: "error",
        target: title.slice(0, 80),
        detail: String(err?.message || err),
      });
    }

    if (nextAction) {
      if (maybeCreateTodoist(nextAction, title)) {
        todoistCreated++;
      }
    }

    seen[id] = lastEdited;
  }

  writeJson(STATE_FILE, seen);

  logEvent({
    source: "notion-meeting-integrator",
    action: "sync",
    result: "ok",
    detail: `scanned=${scanned} integrated=${integrated} todoist=${todoistCreated}`,
  });

  console.log(JSON.stringify({ scanned, integrated, todoistCreated }, null, 2));
}

main();
