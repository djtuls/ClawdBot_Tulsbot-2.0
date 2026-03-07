import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createNotionClient, extractPlainText, richText } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

type PendingItem = {
  id?: string;
  threadId?: string;
  from?: string;
  subject?: string;
  snippet?: string;
  date?: string;
  account?: string;
  category?: string;
  hash?: string;
  addedAt?: string;
  notionUrl?: string;
  labels?: string[];
};

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const CONFIG_PATH = join(WORKSPACE, "config/notion-control-plane.json");
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");
const REPORT_DIR = join(WORKSPACE, "reports/notion");

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
    notion: { captureInboxDatabaseId: string };
  };
}
function loadPending(): PendingItem[] {
  if (!existsSync(PENDING_PATH)) {
    return [];
  }
  return readFileSync(PENDING_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
function sourceLink(item: PendingItem): string | null {
  if (!(item.threadId || item.id)) {
    return null;
  }
  const ref = encodeURIComponent(item.threadId || item.id || "");
  if (item.account) {
    return `https://mail.google.com/mail/u/${encodeURIComponent(item.account)}/#inbox/${ref}`;
  }
  return `https://mail.google.com/mail/#inbox/${ref}`;
}
function indexPending(items: PendingItem[]) {
  const m = new Map<string, PendingItem>();
  for (const it of items) {
    for (const k of [it.threadId, it.id, it.hash].filter(Boolean) as string[]) {
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
function chunkText(text: string, max = 1700): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    out.push(text.slice(i, i + max));
  }
  return out;
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION token missing");
  }

  const notion = createNotionClient(token);
  const cfg = loadConfig();
  const pIndex = indexPending(loadPending());

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
    bodyPasted: 0,
    failed: 0,
    items: [] as any[],
  };

  for (const p of pages) {
    try {
      const props = p.properties || {};
      const sourceId = extractPlainText(props["Source ID"]);
      const source = extractPlainText(props["Source"]);
      const summary = extractPlainText(props["Summary"]);
      const sender = extractPlainText(props["Sender"]);
      const receivedAt = props["Received At"]?.date?.start || "";
      const sourceUrl = props["Source URL"]?.url || "";
      const metadata = extractPlainText(props["Metadata"]);
      const rawContent = extractPlainText(props["Raw Content"]);

      const pi = pIndex.get(sourceId) || pIndex.get(`page:${String(p.id).toLowerCase()}`);
      if (!pi) {
        continue;
      }

      const patchProps: Record<string, any> = {};
      if (!summary && pi.snippet) {
        patchProps["Summary"] = richText(pi.snippet);
      }
      if (!sender && pi.from) {
        patchProps["Sender"] = richText(pi.from.slice(0, 300));
      }
      if (!receivedAt && (pi.addedAt || pi.date)) {
        patchProps["Received At"] = { date: { start: pi.addedAt || pi.date } };
      }
      if (!sourceUrl) {
        const link = sourceLink(pi);
        if (link) {
          patchProps["Source URL"] = { url: link };
        }
      }
      if (!metadata) {
        patchProps["Metadata"] = richText(
          JSON.stringify({
            category: pi.category || "",
            account: pi.account || "",
            labels: pi.labels || [],
            hash: pi.hash || "",
          }).slice(0, 1800),
        );
      }
      if (!sourceId && (pi.threadId || pi.id)) {
        patchProps["Source ID"] = richText((pi.threadId || pi.id || "").slice(0, 250));
      }

      // Best-effort email content field (from snippet/subject when full body unavailable)
      const fallbackBody = [pi.subject || "", pi.snippet || ""].filter(Boolean).join("\n\n").trim();
      if (!rawContent && fallbackBody) {
        patchProps["Raw Content"] = richText(fallbackBody);
      }

      if (Object.keys(patchProps).length > 0) {
        notion.request("PATCH", `/pages/${p.id}`, { properties: patchProps });
        report.updated++;
      }

      // Paste content into page body for email items when absent
      const looksEmail = source === "Email" || !!pi.account;
      const bodyText = (rawContent || fallbackBody || "").trim();
      if (looksEmail && bodyText) {
        const existing: any = notion.request("GET", `/blocks/${p.id}/children?page_size=100`);
        const marker = "[Auto] Email Body";
        const hasMarker = (existing.results || []).some((b: any) =>
          JSON.stringify(b).includes(marker),
        );
        if (!hasMarker) {
          const chunks = chunkText(bodyText, 1700).slice(0, 8);
          const children: any[] = [
            {
              object: "block",
              type: "heading_3",
              heading_3: { rich_text: [{ type: "text", text: { content: marker } }] },
            },
            ...chunks.map((c) => ({
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: [{ type: "text", text: { content: c } }] },
            })),
          ];
          notion.request("PATCH", `/blocks/${p.id}/children`, { children });
          report.bodyPasted++;
        }
      }

      if (Object.keys(patchProps).length > 0 || bodyText) {
        report.items.push({
          pageId: p.id,
          sourceId,
          patched: Object.keys(patchProps),
          bodyCandidate: !!bodyText,
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
  const rp = join(
    REPORT_DIR,
    `capture-inbox-enrich-fast-${new Date().toISOString().slice(0, 10)}.json`,
  );
  writeFileSync(rp, JSON.stringify(report, null, 2));
  console.log(
    `[capture-inbox-enrich-fast] scanned=${report.scanned} updated=${report.updated} bodyPasted=${report.bodyPasted} failed=${report.failed} report=${rp}`,
  );
}

main().catch((e) => {
  console.error("[capture-inbox-enrich-fast] fatal", e);
  process.exit(1);
});
