#!/usr/bin/env npx tsx

import { execFileSync } from "child_process";
import crypto from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const envPath = join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace/.env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    if (line && !line.startsWith("#")) {
      const [key, ...val] = line.split("=");
      if (key && val.length) {
        process.env[key.trim()] = val.join("=").replace(/^"|"$/g, "").trim();
      }
    }
  }
} catch (e) {
  console.log("No .env found or loaded manually:", e.message);
}

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const GOG = process.env.GOG_BIN || "/opt/homebrew/bin/gog";
const NOTION_API_KEY = process.env.NOTION_API_KEY;

const GOVERNANCE_DB = "31c51bf9-731e-8146-a3f6-ec0560767141";
const INBOX_DB = "30351bf9-731e-81f2-bc24-dca63220f567";
const ACCOUNT = "tulio@weareliveengine.com";

const DEDUP_FILE = join(WORKSPACE, "memory", "email_dedup.json");
if (!existsSync(join(WORKSPACE, "memory"))) {
  mkdirSync(join(WORKSPACE, "memory"), { recursive: true });
}

function loadDedup(): Set<string> {
  if (existsSync(DEDUP_FILE)) {
    try {
      return new Set(JSON.parse(readFileSync(DEDUP_FILE, "utf-8")));
    } catch {
      return new Set();
    }
  }
  return new Set();
}

function saveDedup(set: Set<string>) {
  writeFileSync(DEDUP_FILE, JSON.stringify(Array.from(set)), "utf-8");
}

interface Rule {
  name: string;
  sourceType: string;
  monitorMode: string;
  id: string;
}

async function fetchRules(): Promise<{ senders: Map<string, Rule>; domains: Map<string, Rule> }> {
  console.log("[governance] Fetching Capture Governance rules from Notion...");
  const senders = new Map<string, Rule>();
  const domains = new Map<string, Rule>();

  const res = await fetch(`https://api.notion.com/v1/databases/${GOVERNANCE_DB}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        or: [
          { property: "Source Type", select: { equals: "Email Sender" } },
          { property: "Source Type", select: { equals: "Email Domain" } },
        ],
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Governance DB: ${res.statusText}`);
  }

  const data = await res.json();
  for (const page of data.results) {
    const props = page.properties;
    const name = props.Name?.title?.[0]?.plain_text?.toLowerCase().trim();
    const sourceType = props["Source Type"]?.select?.name;
    const monitorMode = props["Monitor Mode"]?.select?.name || "Monitor";
    const status = props.Status?.status?.name || props.Status?.select?.name || "Active";

    if (!name || status === "Deprecated" || status === "Paused") {
      continue;
    }

    const rule: Rule = { name, sourceType, monitorMode, id: page.id };

    if (sourceType === "Email Sender") {
      senders.set(name, rule);
    } else if (sourceType === "Email Domain") {
      const cleanDomain = name.startsWith("@") ? name.substring(1) : name;
      domains.set(cleanDomain, rule);
    }
  }

  console.log(`[governance] Loaded ${senders.size} sender rules and ${domains.size} domain rules.`);
  return { senders, domains };
}

async function addToNotionInbox(msg: any, status: string, suggestion: string = "To-Be-Sorted") {
  const textBody = (msg.snippet || msg.body || "(No snippet available)").slice(0, 1500);

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: INBOX_DB },
      properties: {
        Title: { title: [{ text: { content: (msg.subject || "(No Subject)").slice(0, 200) } }] },
        Sender: { rich_text: [{ text: { content: msg.from.slice(0, 200) } }] },
        Source: { select: { name: "Email" } },
        "Source ID": { rich_text: [{ text: { content: msg.id } }] },
        Status: { status: { name: "Pending" } },
        "Suggested Routing": { rich_text: [{ text: { content: suggestion } }] },
        "Received At": { date: { start: new Date(msg.date || Date.now()).toISOString() } },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ text: { content: textBody } }] },
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error(`[notion] Failed to push message ${msg.id} to Notion:`, await res.text());
  } else {
    console.log(`[notion] Pushed message ${msg.id} to Notion Capture Inbox.`);
  }
}

function removeInboxLabel(msgId: string) {
  try {
    execFileSync(GOG, ["gmail", "modify", msgId, "--account", ACCOUNT, "--remove-label", "INBOX"], {
      encoding: "utf-8",
      timeout: 15_000,
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
    });
    console.log(`[gmail] Removed INBOX label for ${msgId} (Archived)`);
  } catch (err: any) {
    console.error(`[gmail] Failed to remove INBOX label for ${msgId}:`, err.message);
  }
}

function markRead(msgId: string) {
  try {
    execFileSync(
      GOG,
      ["gmail", "modify", msgId, "--account", ACCOUNT, "--remove-label", "UNREAD"],
      {
        encoding: "utf-8",
        timeout: 15_000,
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );
    console.log(`[gmail] Marked read for ${msgId}`);
  } catch (err: any) {
    console.error(`[gmail] Failed to mark read for ${msgId}:`, err.message);
  }
}

async function run() {
  console.log(`[scan] Scanning inbox for ${ACCOUNT}...`);
  const { senders, domains } = await fetchRules();
  const dedupSet = loadDedup();

  const result = execFileSync(
    GOG,
    ["gmail", "list", "in:inbox is:unread", "--limit", "20", "--account", ACCOUNT, "--json"],
    {
      encoding: "utf-8",
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
    },
  );

  const parsed = JSON.parse(result);
  const messages = Array.isArray(parsed) ? parsed : parsed.messages || [parsed];
  if (!messages || messages.length === 0 || !messages[0].id) {
    console.log("[scan] No unread messages found in inbox.");
    return;
  }

  let newItems = 0;
  for (const msg of messages) {
    if (!msg.id) {
      continue;
    }
    const hash = crypto.createHash("md5").update(`${ACCOUNT}:${msg.id}`).digest("hex");
    if (dedupSet.has(hash)) {
      continue;
    }

    newItems++;
    const fromStr = msg.from || msg.sender || "";
    const emailMatch = fromStr.match(/<([^>]+)>/);
    const emailAddress = emailMatch
      ? emailMatch[1].toLowerCase().trim()
      : fromStr.toLowerCase().trim();
    const domainPart = emailAddress.split("@")[1] || "";

    console.log(`\n[process] Processing: ${msg.subject} (From: ${emailAddress})`);

    let rule = senders.get(emailAddress);
    if (!rule) {
      rule = domains.get(domainPart);
    }

    if (rule) {
      console.log(`[governance] Matched Rule: ${rule.name} -> ${rule.monitorMode}`);
      if (rule.monitorMode === "Archive") {
        removeInboxLabel(msg.id);
        markRead(msg.id);
      } else if (rule.monitorMode === "Monitor") {
        await addToNotionInbox(msg, "Pending", rule.name);
      } else if (rule.monitorMode === "Ignore") {
        console.log(`[governance] Ignoring per rule.`);
        markRead(msg.id);
      }
    } else {
      console.log(`[governance] No rule found. Suggesting To-Be-Sorted.`);
      await addToNotionInbox(msg, "Pending", "To-Be-Sorted");
    }

    dedupSet.add(hash);
  }

  saveDedup(dedupSet);
  console.log(`\n[done] Finished processing ${newItems} new emails.`);
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
