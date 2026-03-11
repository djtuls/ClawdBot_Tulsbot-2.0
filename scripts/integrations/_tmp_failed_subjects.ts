import { execFileSync } from "child_process";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const DB = "30351bf9-731e-81f2-bc24-dca63220f567";
const ACCOUNTS = [
  "ferro.tulio@gmail.com",
  "tulio@weareliveengine.com",
  "tuliof@creativetoolsagency.com",
  "tulsbot@gmail.com",
];
const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("Missing Notion token");
}
const notion = createNotionClient(token);

type EmailItem = {
  threadId: string;
  account: string;
  reason: string;
  subject: string;
  from: string;
  date: string;
};
const search = (account: string, query: string, max = "20") => {
  try {
    const raw = execFileSync(
      "/opt/homebrew/bin/gog",
      ["gmail", "search", query, "--max", max, "--account", account, "--json"],
      { encoding: "utf-8", timeout: 45000 },
    );
    const d = JSON.parse(raw);
    return d.threads || d.messages || [];
  } catch {
    return [];
  }
};
const decode = (d: string) => {
  if (!d) {
    return "";
  }
  try {
    const n = d.replace(/-/g, "+").replace(/_/g, "/");
    const p = n.length % 4 === 0 ? "" : "=".repeat(4 - (n.length % 4));
    return Buffer.from(n + p, "base64").toString("utf-8");
  } catch {
    return "";
  }
};
const strip = (h: string) =>
  (h || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const parts = (p: any, o: any[]) => {
  if (!p) {
    return;
  }
  o.push(p);
  if (Array.isArray(p.parts)) {
    for (const x of p.parts) parts(x, o);
  }
};
const extract = (m: any) => {
  const all: any[] = [];
  parts(m?.payload || {}, all);
  let t1 = "",
    t2 = "";
  const at: string[] = [];
  for (const p of all) {
    const mime = (p?.mimeType || "").toLowerCase();
    const fn = p?.filename || "";
    const bd = p?.body?.data || "";
    if (mime === "text/plain" && bd) {
      t1 += "\n" + decode(bd);
    } else if (mime === "text/html" && bd) {
      t2 += "\n" + decode(bd);
    }
    if (fn) {
      at.push(fn);
    }
  }
  const b = (t1 || strip(t2) || m?.snippet || "").trim();
  return {
    body: b.length > 2000 ? b.slice(0, 2000) + "... (truncated)" : b,
    attachments: [...new Set(at)].slice(0, 30),
  };
};
const rich = (c: string) => ({ rich_text: [{ text: { content: (c || "").slice(0, 1800) } }] });
const find = (sid: string) => {
  try {
    const q: any = notion.request("POST", `/databases/${DB}/query`, {
      filter: { property: "Source ID", rich_text: { equals: sid } },
      page_size: 1,
    });
    return q.results?.[0] || null;
  } catch {
    return null;
  }
};
const latest = (a: string, t: string) => {
  try {
    const raw = execFileSync(
      "/opt/homebrew/bin/gog",
      ["gmail", "thread", "get", t, "--account", a, "--json", "--full"],
      { encoding: "utf-8", timeout: 60000 },
    );
    const o = JSON.parse(raw);
    const ms = o?.thread?.messages || [];
    return ms.length ? ms[ms.length - 1] : null;
  } catch {
    return null;
  }
};
const append = (pid: string, b: string, ats: string[], url: string) => {
  const ch: any[] = [
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Email Body" } }] },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: b || "(empty body)" } }] },
    },
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Attachments" } }] },
    },
  ];
  if (!ats.length) {
    ch.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: "No attachments detected." } }] },
    });
  } else {
    for (const a of ats)
      ch.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: a } }] },
      });
  }
  ch.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { type: "text", text: { content: "Open in Gmail: " } },
        { type: "text", text: { content: url, link: { url } } },
      ],
    },
  });
  notion.request("PATCH", `/blocks/${pid}/children`, { children: ch });
};

const c: EmailItem[] = [];
for (const a of ACCOUNTS) {
  for (const [r, q, m] of [
    ["starred", "in:inbox is:starred newer_than:7d", "30"],
    ["action_item", 'in:inbox label:"🚨 Action Items" newer_than:14d', "40"],
    ["sent_followup_candidate", "in:sent newer_than:5d", "20"],
  ] as any) {
    for (const x of search(a, q, m)) {
      const t = String(x.threadId || x.id || "");
      if (!t) {
        continue;
      }
      c.push({
        threadId: t,
        account: a,
        reason: r,
        subject: String(x.subject || "(no subject)"),
        from: String(x.from || "unknown"),
        date: String(x.date || ""),
      });
    }
  }
}
const rank: any = { action_item: 3, starred: 2, sent_followup_candidate: 1 };
const mp = new Map<string, EmailItem>();
for (const it of c) {
  const k = `${it.account}:${it.threadId}`;
  const p = mp.get(k);
  if (!p || rank[it.reason] > rank[p.reason]) {
    mp.set(k, it);
  }
}
const items = [...mp.values()]
  .toSorted((a, b) => String(b.date).localeCompare(String(a.date)))
  .slice(0, 60);
const failed: { subject: string; sourceId: string }[] = [];
for (const it of items) {
  const sid = `${it.account}:${it.threadId}`;
  try {
    const url = `https://mail.google.com/mail/u/${encodeURIComponent(it.account)}/#all/${encodeURIComponent(it.threadId)}`;
    const msg = latest(it.account, it.threadId);
    const ea = extract(msg || {});
    const payload: any = {
      Title: { title: [{ text: { content: it.subject.slice(0, 180) } }] },
      Status: { select: { name: "To Review" } },
      "Received At": { date: { start: new Date().toISOString() } },
      Source: { select: { name: "Email" } },
      Sender: rich(it.from),
      Summary: rich((msg?.snippet || "").slice(0, 500) || ea.body.slice(0, 450)),
      "AI Status": { select: { name: "Pending" } },
      "Tulio's Notes": rich(""),
      "Tulsbot Notes": rich(`include_reason=${it.reason}`),
      "Source ID": rich(sid),
      Metadata: rich(
        JSON.stringify({
          account: it.account,
          reason: it.reason,
          email_date: it.date,
          attachment_count: ea.attachments.length,
        }),
      ),
      "Source URL": { url },
      "Suggested Routing": { select: { name: "Super Inbox" } },
      "Raw Content": rich(ea.body),
    };
    const ex = find(sid);
    let pid = "";
    if (ex?.id) {
      pid = ex.id;
      notion.request("PATCH", `/pages/${pid}`, { properties: payload });
    } else {
      const p: any = notion.request("POST", "/pages", {
        parent: { database_id: DB },
        properties: payload,
      });
      pid = p.id;
    }
    append(pid, ea.body, ea.attachments, url);
  } catch {
    failed.push({ subject: it.subject, sourceId: sid });
  }
}
console.log(JSON.stringify({ failedCount: failed.length, failed }, null, 2));
