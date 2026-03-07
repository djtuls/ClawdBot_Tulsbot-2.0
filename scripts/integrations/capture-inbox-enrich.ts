import "dotenv/config";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createNotionClient, extractPlainText, richText } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

type PendingItem = {
  id?: string;
  threadId?: string;
  source?: string;
  category?: string;
  subject?: string;
  from?: string;
  snippet?: string;
  date?: string;
  account?: string;
  labels?: string[];
  addedAt?: string;
  hash?: string;
  notionUrl?: string;
};

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const CONFIG_PATH = join(WORKSPACE, "config/notion-control-plane.json");
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");
const REPORT_DIR = join(WORKSPACE, "reports/notion");

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as {
    notion: { captureInboxDatabaseId: string };
  };
}

function sourceLink(item: PendingItem): string | null {
  const likelyEmail = item.source === "email" || (!!item.account && !!(item.threadId || item.id));
  if (likelyEmail && (item.threadId || item.id)) {
    const ref = encodeURIComponent(item.threadId || item.id || "");
    if (item.account) {
      return `https://mail.google.com/mail/u/${encodeURIComponent(item.account)}/#inbox/${ref}`;
    }
    return `https://mail.google.com/mail/#inbox/${ref}`;
  }
  return null;
}

function loadPending(): PendingItem[] {
  if (!existsSync(PENDING_PATH)) {
    return [];
  }
  return readFileSync(PENDING_PATH, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function indexPending(items: PendingItem[]) {
  const m = new Map<string, PendingItem>();
  for (const it of items) {
    const keys = [it.threadId, it.id, it.hash].filter(Boolean) as string[];
    for (const k of keys) {
      m.set(String(k), it);
    }
    if (it.notionUrl) {
      const idPart = (it.notionUrl.match(/([a-f0-9]{32})$/i) || [])[1];
      if (idPart) {
        const dashed = idPart
          .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5")
          .toLowerCase();
        m.set(`page:${dashed}`, it);
      }
    }
  }
  return m;
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

function collectBodies(payload: any, out: string[]) {
  if (!payload) {
    return;
  }
  const mime = String(payload.mimeType || "");
  const bodyData = payload.body?.data;
  if (bodyData && (mime.includes("text/plain") || mime === "text/html" || !mime)) {
    const txt = decodeBase64Url(bodyData)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (txt) {
      out.push(txt);
    }
  }
  for (const p of payload.parts || []) {
    collectBodies(p, out);
  }
}

function fetchEmailBody(threadId: string, account: string): string {
  try {
    const raw = execFileSync(
      "gog",
      ["gmail", "thread", "get", threadId, "--account", account, "--json", "--results-only"],
      {
        encoding: "utf8",
        timeout: 45000,
        env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      },
    );
    const t = JSON.parse(raw);
    const chunks: string[] = [];
    for (const msg of t.messages || []) {
      collectBodies(msg.payload, chunks);
    }
    const joined = chunks
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return joined.slice(0, 8000);
  } catch {
    return "";
  }
}

function chunkText(text: string, max = 1700): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + max));
    i += max;
  }
  return out;
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION token missing");
  }

  const cfg = loadConfig();
  const notion = createNotionClient(token);
  const pending = loadPending();
  const pIndex = indexPending(pending);

  let cursor: string | undefined;
  const pages: any[] = [];
  do {
    const q: any = notion.request("POST", `/databases/${cfg.notion.captureInboxDatabaseId}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...(q.results || []));
    cursor = q.has_more ? q.next_cursor : undefined;
  } while (cursor);

  const report: any = {
    generatedAt: new Date().toISOString(),
    scanned: pages.length,
    updated: 0,
    emailBodiesAppended: 0,
    failed: 0,
    items: [] as any[],
  };

  let bodyFetches = 0;
  const BODY_FETCH_LIMIT = 120;

  for (const p of pages) {
    try {
      const props = p.properties || {};
      const source = extractPlainText(props["Source"]);
      const sourceId = extractPlainText(props["Source ID"]);
      const metadata = extractPlainText(props["Metadata"]);
      const summary = extractPlainText(props["Summary"]);
      const sender = extractPlainText(props["Sender"]);
      const rawContent = extractPlainText(props["Raw Content"]);
      const title = extractPlainText(props["Title"]);
      const receivedAt = props["Received At"]?.date?.start || "";
      const sourceUrl = props["Source URL"]?.url || "";

      const pi = pIndex.get(sourceId) || pIndex.get(`page:${String(p.id).toLowerCase()}`);
      const patchProps: Record<string, any> = {};

      if (!summary && pi?.snippet) {
        patchProps["Summary"] = richText(pi.snippet);
      }
      if (!sender && pi?.from) {
        patchProps["Sender"] = richText(pi.from.slice(0, 300));
      }
      if (!receivedAt && (pi?.addedAt || pi?.date)) {
        patchProps["Received At"] = { date: { start: pi.addedAt || pi.date } };
      }
      if (!sourceUrl) {
        const link = pi ? sourceLink(pi) : null;
        if (link) {
          patchProps["Source URL"] = { url: link };
        }
      }
      if (!metadata && pi) {
        patchProps["Metadata"] = richText(
          JSON.stringify({
            category: pi.category || "",
            account: pi.account || "",
            labels: pi.labels || [],
            hash: pi.hash || "",
          }).slice(0, 1800),
        );
      }

      let bodyText = "";
      const looksEmail = source === "Email" || !!(pi?.account && (pi?.threadId || pi?.id));
      if (
        looksEmail &&
        !rawContent &&
        pi?.account &&
        (pi.threadId || pi.id) &&
        bodyFetches < BODY_FETCH_LIMIT
      ) {
        bodyFetches++;
        bodyText = fetchEmailBody(pi.threadId || pi.id || sourceId, pi.account);
        if (bodyText) {
          patchProps["Raw Content"] = richText(bodyText);
        }
      }

      if (Object.keys(patchProps).length > 0) {
        notion.request("PATCH", `/pages/${p.id}`, { properties: patchProps });
        report.updated++;
      }

      if (bodyText) {
        const marker = "[Auto] Email Body";
        const existing: any = notion.request("GET", `/blocks/${p.id}/children?page_size=100`);
        const hasMarker = (existing.results || []).some((b: any) => {
          const txt = JSON.stringify(b);
          return txt.includes(marker);
        });

        if (!hasMarker) {
          const chunks = chunkText(bodyText, 1700);
          const children: any[] = [
            {
              object: "block",
              type: "heading_3",
              heading_3: { rich_text: [{ type: "text", text: { content: marker } }] },
            },
          ];
          for (const c of chunks.slice(0, 8)) {
            children.push({
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: [{ type: "text", text: { content: c } }] },
            });
          }
          notion.request("PATCH", `/blocks/${p.id}/children`, { children });
          report.emailBodiesAppended++;
        }
      }

      if (Object.keys(patchProps).length > 0 || bodyText) {
        report.items.push({
          pageId: p.id,
          title,
          source,
          sourceId,
          patchedFields: Object.keys(patchProps),
          bodyAdded: !!bodyText,
        });
      }
    } catch (e: any) {
      report.failed++;
      report.items.push({ pageId: p.id, error: String(e?.message || e) });
    }
  }

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  const rp = join(REPORT_DIR, `capture-inbox-enrich-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(rp, JSON.stringify(report, null, 2));
  console.log(
    `[capture-inbox-enrich] scanned=${report.scanned} updated=${report.updated} bodies=${report.emailBodiesAppended} failed=${report.failed} report=${rp}`,
  );
}

main().catch((e) => {
  console.error("[capture-inbox-enrich] fatal", e);
  process.exit(1);
});
