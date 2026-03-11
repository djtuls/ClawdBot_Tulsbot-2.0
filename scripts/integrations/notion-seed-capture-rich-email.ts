import "dotenv/config";
import { execFileSync } from "child_process";
import { logEvent } from "../lib/event-logger.js";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const DB = "30351bf9-731e-81f2-bc24-dca63220f567";
const ACCOUNTS = [
  "ferro.tulio@gmail.com",
  "tulio@weareliveengine.com",
  "tuliof@creativetoolsagency.com",
  "tulsbot@gmail.com",
];

const CONTEXT_ONLY_KEYWORDS = [
  "guadalajara",
  "monterrey",
  "play off tournament mexico",
  "playoff tournament",
  "javier siguero",
  "wccc infotainment poc",
  "2616",
];

const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("Missing Notion token");
}
const notion = createNotionClient(token);

type EmailItem = {
  threadId: string;
  account: string;
  reason: "starred" | "action_item" | "sent_followup_candidate";
  subject: string;
  from: string;
  date: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function search(account: string, query: string, max = "20"): any[] {
  try {
    const raw = execFileSync(
      "/opt/homebrew/bin/gog",
      ["gmail", "search", query, "--max", max, "--account", account, "--json"],
      { encoding: "utf-8", timeout: 45_000 },
    );
    const d = JSON.parse(raw);
    return d.threads || d.messages || [];
  } catch {
    return [];
  }
}

function decodeBase64Url(data: string): string {
  if (!data) {
    return "";
  }
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + pad, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function collectParts(part: any, out: any[]) {
  if (!part) {
    return;
  }
  out.push(part);
  if (Array.isArray(part.parts)) {
    for (const p of part.parts) {
      collectParts(p, out);
    }
  }
}

function extractBodyAndAttachments(message: any): { body: string; attachments: string[] } {
  const payload = message?.payload || {};
  const parts: any[] = [];
  collectParts(payload, parts);

  let textPlain = "";
  let textHtml = "";
  const attachments: string[] = [];

  for (const p of parts) {
    const mime = (p?.mimeType || "").toLowerCase();
    const filename = p?.filename || "";
    const bodyData = p?.body?.data || "";

    if (mime === "text/plain" && bodyData) {
      textPlain += "\n" + decodeBase64Url(bodyData);
    } else if (mime === "text/html" && bodyData) {
      textHtml += "\n" + decodeBase64Url(bodyData);
    }

    if (filename) {
      const size = p?.body?.size || 0;
      attachments.push(`${filename}${size ? ` (${size} bytes)` : ""}`);
    }
  }

  const body = (textPlain || stripHtml(textHtml) || message?.snippet || "").trim();
  return {
    body: body.length > 2000 ? body.slice(0, 2000) + "... (truncated)" : body,
    attachments: Array.from(new Set(attachments)).slice(0, 30),
  };
}

function richText(content: string) {
  return { rich_text: [{ text: { content: (content || "").slice(0, 1800) } }] };
}

function findBySourceId(sourceId: string): any | null {
  try {
    const q: any = notion.request("POST", `/databases/${DB}/query`, {
      filter: { property: "Source ID", rich_text: { equals: sourceId } },
      page_size: 1,
    });
    return q.results?.[0] || null;
  } catch {
    return null;
  }
}

function clearAndAppendBlocks(
  pageId: string,
  body: string,
  attachments: string[],
  gmailUrl: string,
) {
  const blocks: any[] = [
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Email Body" } }] },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: body || "(empty body)" } }] },
    },
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Attachments" } }] },
    },
  ];

  if (attachments.length === 0) {
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: "No attachments detected." } }] },
    });
  } else {
    for (const a of attachments) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: a } }],
        },
      });
    }
  }

  blocks.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { type: "text", text: { content: "Open in Gmail: " } },
        { type: "text", text: { content: gmailUrl, link: { url: gmailUrl } } },
      ],
    },
  });

  notion.request("PATCH", `/blocks/${pageId}/children`, { children: blocks });
}

function getThreadLatestMessage(account: string, threadId: string): any | null {
  try {
    const raw = execFileSync(
      "/opt/homebrew/bin/gog",
      ["gmail", "thread", "get", threadId, "--account", account, "--json", "--full"],
      { encoding: "utf-8", timeout: 60_000 },
    );
    const obj = JSON.parse(raw);
    const messages = obj?.thread?.messages || [];
    if (!messages.length) {
      return null;
    }
    return messages[messages.length - 1];
  } catch {
    return null;
  }
}

async function main() {
  const collected: EmailItem[] = [];
  for (const account of ACCOUNTS) {
    const buckets: Array<[EmailItem["reason"], string, string]> = [
      ["starred", "in:inbox is:starred newer_than:7d", "30"],
      ["action_item", 'in:inbox label:"🚨 Action Items" newer_than:14d', "40"],
      ["sent_followup_candidate", "in:sent newer_than:5d", "20"],
    ];

    for (const [reason, query, max] of buckets) {
      const found = search(account, query, max);
      for (const x of found) {
        const threadId = String(x.threadId || x.id || "");
        if (!threadId) {
          continue;
        }
        collected.push({
          threadId,
          account,
          reason,
          subject: String(x.subject || "(no subject)"),
          from: String(x.from || "unknown"),
          date: String(x.date || ""),
        });
      }
    }
  }

  const rank: Record<string, number> = {
    action_item: 3,
    starred: 2,
    sent_followup_candidate: 1,
  };
  const byThread = new Map<string, EmailItem>();
  for (const it of collected) {
    const k = `${it.account}:${it.threadId}`;
    const prev = byThread.get(k);
    if (!prev || rank[it.reason] > rank[prev.reason]) {
      byThread.set(k, it);
    }
  }

  const items = [...byThread.values()]
    .toSorted((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 60);

  let created = 0;
  let updated = 0;
  let failed = 0;
  let skippedContextOnly = 0;

  for (const it of items) {
    const s = (it.subject || "").toLowerCase();
    if (CONTEXT_ONLY_KEYWORDS.some((k) => s.includes(k))) {
      skippedContextOnly++;
      logEvent({
        source: "notion-seed",
        action: "skip-context-only",
        target: `${it.account}:${it.threadId}`,
        result: "ok",
        detail: it.subject.slice(0, 120),
      });
      continue;
    }
    try {
      const sourceId = `${it.account}:${it.threadId}`;
      const gmailUrl = `https://mail.google.com/mail/u/${encodeURIComponent(it.account)}/#all/${encodeURIComponent(it.threadId)}`;
      const message = getThreadLatestMessage(it.account, it.threadId);
      const bodyAndAttachments = extractBodyAndAttachments(message || {});
      const snippet = (message?.snippet || "").slice(0, 500);

      const payload = {
        Title: { title: [{ text: { content: it.subject.slice(0, 180) } }] },
        Status: { select: { name: "To Review" } },
        "Received At": { date: { start: new Date().toISOString() } },
        Source: { select: { name: "Email" } },
        Sender: richText(it.from),
        Summary: richText(snippet || bodyAndAttachments.body.slice(0, 450)),
        "AI Status": { select: { name: "Pending" } },
        "Tulio's Notes": richText(""),
        "Tulsbot Notes": richText(`include_reason=${it.reason}`),
        "Source ID": richText(sourceId),
        Metadata: richText(
          JSON.stringify({
            account: it.account,
            reason: it.reason,
            email_date: it.date,
            attachment_count: bodyAndAttachments.attachments.length,
          }),
        ),
        "Source URL": { url: gmailUrl },
        "Suggested Routing": { select: { name: "Super Inbox" } },
        "Raw Content": richText(bodyAndAttachments.body),
      };

      const existing = findBySourceId(sourceId);
      let pageId = "";
      if (existing?.id) {
        pageId = existing.id;
        notion.request("PATCH", `/pages/${pageId}`, { properties: payload });
        updated++;
      } else {
        const p: any = notion.request("POST", "/pages", {
          parent: { database_id: DB },
          properties: payload,
        });
        pageId = p.id;
        created++;
      }

      clearAndAppendBlocks(
        pageId,
        bodyAndAttachments.body,
        bodyAndAttachments.attachments,
        gmailUrl,
      );
      await sleep(300);
    } catch {
      failed++;
    }
  }

  console.log(
    JSON.stringify(
      { scanned: items.length, created, updated, failed, skippedContextOnly, database: DB },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("[notion-seed-capture-rich-email] fatal", e);
  process.exit(1);
});
