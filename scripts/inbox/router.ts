import "dotenv/config";
import { execFileSync } from "child_process";
/**
 * Inbox Router — Pre-screen gateway + optional downstream routing
 *
 * Default behavior (PRE_SCREEN_ONLY=1):
 * - Move new pending items into awaiting-review
 * - Post decorated, itemized list to Telegram inbox_review topic
 * - DO NOT push to Todoist/Notion/etc until human review
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { shouldBlockDirectSuperInboxSeed } from "../../src/integrations/capture-flow-policy.js";
import { logEvent } from "../lib/event-logger.js";
import { getSecret } from "../lib/secrets.js";
import { sendToTopic, truncateForTelegram } from "../lib/telegram-notify.js";
import { decideGovernance, loadCaptureGovernance } from "./governance.js";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const PENDING_PATH = join(WORKSPACE, "memory/inbox/pending.jsonl");
const CONTROL_PLANE_PATH = join(WORKSPACE, "config/notion-control-plane.json");
const PRE_SCREEN_ONLY = (process.env.PRE_SCREEN_ONLY ?? "1") !== "0";

interface ControlPlaneConfig {
  notion?: {
    captureInboxDatabaseId?: string;
    superInboxDatabaseId?: string;
  };
  policy?: {
    allowDirectSuperInboxWrites?: boolean;
    requirePreScreenBeforeSuperInbox?: boolean;
  };
}

function loadControlPlane(): ControlPlaneConfig {
  if (!existsSync(CONTROL_PLANE_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONTROL_PLANE_PATH, "utf-8")) as ControlPlaneConfig;
  } catch {
    return {};
  }
}

const CONTROL = loadControlPlane();

interface PendingItem {
  id?: string;
  threadId?: string;
  source: string;
  category: string;
  subject?: string;
  from?: string;
  snippet?: string;
  account?: string;
  addedAt: string;
  status: string;
  commitment?: string;
  hash: string;
  reviewedAt?: string;
  notionUrl?: string;
}

function readPendingAll(): PendingItem[] {
  if (!existsSync(PENDING_PATH)) {
    return [];
  }
  const raw = readFileSync(PENDING_PATH, "utf-8").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((item): item is PendingItem => item !== null);
}

function writePending(items: PendingItem[]): void {
  writeFileSync(
    PENDING_PATH,
    items.length ? items.map((i) => JSON.stringify(i)).join("\n") + "\n" : "",
  );
}

function sourceLink(item: PendingItem): string | null {
  if (item.source === "email" && (item.threadId || item.id)) {
    const ref = encodeURIComponent(item.threadId || item.id || "");
    if (item.account) {
      return `https://mail.google.com/mail/u/${encodeURIComponent(item.account)}/#inbox/${ref}`;
    }
    return `https://mail.google.com/mail/#inbox/${ref}`;
  }
  return null;
}

function renderReviewList(items: PendingItem[]): string {
  const lines = items.map((item, idx) => {
    const title = (item.subject || item.commitment || "Inbox item")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const from = (item.from || "unknown").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const link = sourceLink(item);
    const linkLine = link ? `\n   🔗 <a href="${link}">source</a>` : "\n   🔗 source: n/a";
    const notionLine = item.notionUrl ? `\n   📝 <a href="${item.notionUrl}">notion item</a>` : "";
    return `${idx + 1}. <b>${title}</b>\n   • ${item.category} • ${item.source}${item.account ? ` (${item.account})` : ""}\n   • from: ${from}${linkLine}${notionLine}`;
  });

  return truncateForTelegram(
    `📥 <b>Inbox Pre-Screen Queue</b>\n${items.length} item(s) awaiting manual routing\n\n${lines.join("\n\n")}\n\nReply with item numbers + destination (Todoist / Notion / Archive).`,
  );
}

// Pre-screen inbox DB (stage-1 intake), NOT Super Inbox.
// Override with CAPTURE_INBOX_DATABASE_ID if needed.
const CAPTURE_INBOX_DB =
  process.env.CAPTURE_INBOX_DATABASE_ID ||
  CONTROL.notion?.captureInboxDatabaseId ||
  "30351bf9-731e-81f2-bc24-dca63220f567";
const SUPER_INBOX_DB =
  CONTROL.notion?.superInboxDatabaseId || "61efc873-884b-4c11-925b-c096ba38ec55";
const ALLOW_DIRECT_SUPER_INBOX_WRITES =
  CONTROL.policy?.allowDirectSuperInboxWrites === true ||
  process.env.ALLOW_DIRECT_SUPER_INBOX_WRITES === "1";

function routeToNotionReview(item: PendingItem): string | null {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    return null;
  }

  if (
    shouldBlockDirectSuperInboxSeed({
      captureInboxDatabaseId: CAPTURE_INBOX_DB,
      superInboxDatabaseId: SUPER_INBOX_DB,
      allowDirectSuperInboxWrites: ALLOW_DIRECT_SUPER_INBOX_WRITES,
    })
  ) {
    logEvent({
      source: "inbox-router",
      action: "blocked-direct-super-inbox-seed",
      result: "skipped",
      target: (item.subject || item.commitment || "Inbox item").slice(0, 80),
      rationale: "Capture flow hardening: direct writes to Super Inbox are disabled",
    });
    return null;
  }

  const title = (item.subject || item.commitment || "Inbox item").slice(0, 200);
  const aiSummary = (item.snippet || "").slice(0, 1800);
  const sourceUrl = sourceLink(item);

  const sourceSelect = (() => {
    if (item.source === "whatsapp") {
      return "WhatsApp";
    }
    if (item.source === "email") {
      const a = (item.account || "").toLowerCase();
      if (a.includes("weareliveengine")) {
        return "gmail-work";
      }
      if (a.includes("tulsbot")) {
        return "gmail-bot";
      }
      return "gmail-personal";
    }
    return "manual";
  })();

  const typeSelect = item.source === "whatsapp" ? "Whatsapp" : "Email";

  const rich = (text: string) => ({ rich_text: [{ text: { content: text } }] });
  const baseProps: Record<string, any> = {
    Name: { title: [{ text: { content: title } }] },
    Status: { status: { name: "To Review" } },
    "Captured At": { date: { start: item.addedAt || new Date().toISOString() } },
  };

  const fullProps: Record<string, any> = {
    ...baseProps,
    Source: { select: { name: sourceSelect } },
    Type: { select: { name: typeSelect } },
    Priority: { select: { name: item.category === "action-required" ? "High" : "Medium" } },
    "AI Notes": rich(aiSummary || "(no summary)"),
    Contact: rich((item.from || "unknown").slice(0, 300)),
    "AI Approval": { select: { name: "Pending" } },
    "Tulio's Notes": rich(""),
    " URL": sourceUrl ? { url: sourceUrl } : undefined,
  };

  const attempt = (properties: Record<string, any>) => {
    const clean = Object.fromEntries(
      Object.entries(properties).filter(([, v]) => typeof v !== "undefined"),
    );
    const body = JSON.stringify({ parent: { database_id: CAPTURE_INBOX_DB }, properties: clean });
    const result = execFileSync(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        "https://api.notion.com/v1/pages",
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        "Content-Type: application/json",
        "-H",
        "Notion-Version: 2022-06-28",
        "-d",
        body,
      ],
      { timeout: 20_000, encoding: "utf-8" },
    );
    return JSON.parse(result);
  };

  try {
    let data = attempt(fullProps);
    if (data?.object !== "page") {
      data = attempt(baseProps);
    }
    return data?.url || null;
  } catch {
    return null;
  }
}

function routeToTodoist(item: PendingItem): boolean {
  const token = getSecret("TODOIST_API_TOKEN");
  if (!token) {
    return false;
  }

  try {
    const content = item.commitment || item.subject || "Inbox item";
    const description = [
      item.from ? `From: ${item.from}` : "",
      item.snippet ? `Context: ${item.snippet.slice(0, 200)}` : "",
      `Source: ${item.source} (${item.account || "unknown"})`,
    ]
      .filter(Boolean)
      .join("\n");

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
        JSON.stringify({ content, description, priority: 3 }),
      ],
      { timeout: 10_000, encoding: "utf-8" },
    );

    logEvent({
      source: "inbox-router",
      action: "route-todoist",
      target: content.slice(0, 60),
      result: "ok",
      rationale: `category=${item.category}`,
    });
    return true;
  } catch {
    return false;
  }
}

function routeToEventLog(item: PendingItem): void {
  logEvent({
    source: "inbox-router",
    action: `route-${item.category}`,
    target: (item.subject || item.commitment || "").slice(0, 60),
    result: "ok",
    detail: `from=${item.from || "unknown"} account=${item.account || "unknown"}`,
    rationale: `Classification: ${item.category}`,
  });
}

async function main() {
  const all = readPendingAll();
  if (all.length === 0) {
    console.log("[router] No inbox items.");
    return;
  }

  const governance = loadCaptureGovernance(WORKSPACE);
  const newPending = all.filter((i) => i.status === "pending");

  if (PRE_SCREEN_ONLY) {
    if (newPending.length === 0) {
      console.log("[router] No new pending items for pre-screen.");
      return;
    }

    const routedToReview: PendingItem[] = [];
    for (const item of all) {
      if (item.status !== "pending") {
        continue;
      }

      const decision = decideGovernance({
        item: {
          source: item.source,
          from: item.from,
          account: item.account,
          threadId: item.threadId,
          id: item.id,
        },
        governance,
      });

      if (decision.skip) {
        item.status = "skipped-governance";
        item.reviewedAt = new Date().toISOString();
        logEvent({
          source: "inbox-router",
          action: "skip-governance",
          result: "ok",
          target: (item.subject || item.commitment || item.id || "item").slice(0, 80),
          detail: `mode=${decision.mode} match=${decision.matchedOn}`,
          rationale: "Capture Governance policy excludes source from inbox pipeline",
        });
        continue;
      }

      item.notionUrl = routeToNotionReview(item) || item.notionUrl;
      item.status = "awaiting-review";
      item.reviewedAt = new Date().toISOString();
      routedToReview.push(item);
    }
    writePending(all);

    if (routedToReview.length === 0) {
      console.log("[router] Governance skipped all pending items.");
      return;
    }

    const ok = sendToTopic("inbox_review", renderReviewList(routedToReview));
    logEvent({
      source: "inbox-router",
      action: "prescreen-publish",
      result: ok ? "ok" : "error",
      detail: `published=${routedToReview.length} mode=prescreen-only`,
      rationale: "Telegram topic is mandatory human gate before downstream routing",
    });
    return;
  }

  // Fallback: legacy direct routing mode
  const remaining: PendingItem[] = [];
  for (const item of all) {
    if (item.status !== "pending") {
      remaining.push(item);
      continue;
    }

    const decision = decideGovernance({
      item: {
        source: item.source,
        from: item.from,
        account: item.account,
        threadId: item.threadId,
        id: item.id,
      },
      governance,
    });

    if (decision.skip) {
      item.status = "skipped-governance";
      item.reviewedAt = new Date().toISOString();
      logEvent({
        source: "inbox-router",
        action: "skip-governance",
        result: "ok",
        target: (item.subject || item.commitment || item.id || "item").slice(0, 80),
        detail: `mode=${decision.mode} match=${decision.matchedOn}`,
        rationale: "Capture Governance policy excludes source from inbox pipeline",
      });
      continue;
    }

    if (item.category === "action-required") {
      const ok = routeToTodoist(item);
      if (ok) {
        item.status = "routed";
        routeToEventLog(item);
      } else {
        remaining.push(item);
      }
    } else {
      item.status = "routed";
      routeToEventLog(item);
    }
  }

  writePending(remaining);
  console.log(`[router] Legacy mode done. Remaining: ${remaining.length}`);
}

main().catch((err) => {
  console.error("[router] Fatal error:", err);
  logEvent({ source: "inbox-router", action: "fatal", result: "error", detail: String(err) });
  process.exit(1);
});
