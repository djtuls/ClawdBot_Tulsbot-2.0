import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const ROOT = "2ff51bf9731e806b81a3f4046740fac7";
const MARKER = "TULSBOT_ROOT_REFRESH_V3_2026-03-07";

const IDS = {
  captureInbox: "30351bf9731e81f2bc24dca63220f567",
  superInbox: "61efc873884b4c11925bc096ba38ec55",
  projectGrid: "4bd8a8b2563747c78ebd33b0fb2f80ee",
  inftContext: "af146921faad430681b35a31dcdc202f",
  tasks: "30051bf9731e804c92b1c8ae7b76ee0f",
  crmContacts: "f3c32b0d5b7d4a0582da7ac306b64cf8",
  knowledge: "9bb61f681fad4f90afe9a8c2bf6fcbae",
  meetings: "e28c94210e9b4471a18515c92bb394a4",
  sopDb: "31b51bf9731e81c08fc7f9094914e501",
  tulsbotCrmPage: "31351bf9731e819fb6e1c9ff2c7f4e3f",
  aboutLePage: "31551bf9731e80bc9a93e6a3e5d8c3f9",
  brandingBookPage: "32f0ab236f7145c5bbb60e151d4cdb61",
  archivePage: "30f51bf9731e819c9908e0e484d658d0",
};

const legacyPages: Record<string, string> = {
  "30f51bf9731e8118a6f8c11ab53b6dd2": "LEGACY — Operations (read-only)",
  "30f51bf9731e811a995cdb64066e5003": "LEGACY — Databases (read-only)",
  "31551bf9731e80bc9a93e6a3e5d8c3f9": "LEGACY — About LE (read-only)",
  "30551bf9731e8182b3bff6129001dd04": "LEGACY — 03_CAPTURE_INBOX (read-only)",
  "30051bf9731e816392b8d2fcd576a09a": "LEGACY — Tulsbot_Discord.md (read-only)",
  "30451bf9731e81759e4ad6e16550bc60": "LEGACY — 07_AGENTS (read-only)",
  "31351bf9731e819fb6e1c9ff2c7f4e3f": "LEGACY — Tulsbot CRM seed page (read-only)",
};

function rt(content: string) {
  return [{ type: "text", text: { content } }];
}
function lrt(content: string, url: string) {
  return [{ type: "text", text: { content, link: { url } } }];
}
function pageUrl(id: string) {
  return `https://www.notion.so/${id}`;
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("missing notion token");
  }
  const notion = createNotionClient(token);

  const evidence: any = {
    rootId: ROOT,
    timestamp: new Date().toISOString(),
    before: [],
    archivedBlocks: [],
    pageTitleUpdates: [],
    pageCalloutsAdded: [],
    appended: false,
  };

  const before = notion.request("GET", `/blocks/${ROOT}/children?page_size=100`);
  evidence.before = (before.results || []).map((b: any) => ({
    id: b.id,
    type: b.type,
    has_children: b.has_children,
  }));

  const already = (before.results || []).some(
    (b: any) =>
      b.type === "paragraph" &&
      (b.paragraph?.rich_text || []).some((r: any) => r?.plain_text?.includes(MARKER)),
  );
  if (already) {
    evidence.skipped = "marker already exists";
  }

  // Archive empty root paragraphs + previous V2 homepage blocks
  for (const b of before.results || []) {
    const text = b[b.type]?.rich_text
      ? (b[b.type].rich_text || []).map((r: any) => r.plain_text).join("")
      : "";
    const isEmptyParagraph = b.type === "paragraph" && !text.trim();
    const isOldHomepage = [
      "🦞 Tulsbot Home",
      "Open toggles below. Each contains direct database links + instructions.",
      "📥 Inbox",
      "📂 Projects",
      "🤖 Tulsbot Execution",
      "👤 CRM & Knowledge",
      "📘 How to use",
      "TULSBOT_ROOT_HOMEPAGE_V2_2026-03-07",
    ].includes(text.trim());

    if (isEmptyParagraph || isOldHomepage) {
      try {
        notion.request("PATCH", `/blocks/${String(b.id).replace(/-/g, "")}`, { archived: true });
        evidence.archivedBlocks.push({
          id: b.id,
          reason: isEmptyParagraph ? "empty paragraph" : "old v2 homepage block",
        });
      } catch (e: any) {
        evidence.archivedBlocks.push({ id: b.id, error: String(e?.message || e) });
      }
    }
  }

  // Mark legacy pages as read-only
  for (const [pageId, newTitle] of Object.entries(legacyPages)) {
    try {
      notion.request("PATCH", `/pages/${pageId}`, {
        properties: { title: { title: [{ text: { content: newTitle } }] } },
      });
      evidence.pageTitleUpdates.push({ pageId, newTitle });

      notion.request("PATCH", `/blocks/${pageId}/children`, {
        children: [
          {
            object: "block",
            type: "callout",
            callout: {
              icon: { emoji: "🗄️" },
              rich_text: rt(
                "LEGACY PAGE — read-only reference. Canonical navigation now starts at root Tulsbot Home.",
              ),
            },
          },
        ],
      });
      evidence.pageCalloutsAdded.push({ pageId });
    } catch (e: any) {
      evidence.pageTitleUpdates.push({ pageId, error: String(e?.message || e) });
    }
  }

  // Archive accidental duplicate control center page
  try {
    notion.request("PATCH", `/pages/31c51bf9731e8148b389dd94bed04235`, { archived: true });
    evidence.archivedBlocks.push({
      id: "31c51bf9731e8148b389dd94bed04235",
      reason: "accidental duplicate child page",
    });
  } catch (e: any) {
    evidence.archivedBlocks.push({
      id: "31c51bf9731e8148b389dd94bed04235",
      error: String(e?.message || e),
    });
  }

  if (!already) {
    notion.request("PATCH", `/blocks/${ROOT}/children`, {
      children: [
        { object: "block", type: "heading_1", heading_1: { rich_text: rt("🦞 Tulsbot Home") } },
        {
          object: "block",
          type: "callout",
          callout: {
            icon: { emoji: "🧭" },
            rich_text: rt(
              "This is the primary home. Open sections below for canonical databases and operating rules.",
            ),
          },
        },
        {
          object: "block",
          type: "callout",
          callout: {
            icon: { emoji: "⚖️" },
            rich_text: rt(
              "Policy lock: Capture Inbox pre-screen first → Super Inbox post-routing queue. Project Grid + Meetings are visibility/read-only. CRM drives routing. Log interactions inside each contact page.",
            ),
          },
        },
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: rt("📥 Inbox"),
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: rt(
                    "Use Capture Inbox for intake/pre-screen. Only routed items should land in Super Inbox.",
                  ),
                },
              },
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: lrt("Open Capture Inbox (pre-screen)", pageUrl(IDS.captureInbox)),
                },
              },
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: lrt(
                    "Open Super Inbox (post-routing human queue)",
                    pageUrl(IDS.superInbox),
                  ),
                },
              },
            ],
          },
        },
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: rt("📂 Projects"),
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: lrt("Open INFT Project Context", pageUrl(IDS.inftContext)),
                },
              },
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: lrt("Open Project Grid (read-only)", pageUrl(IDS.projectGrid)),
                },
              },
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: lrt("Open Meetings (visibility/read-only)", pageUrl(IDS.meetings)),
                },
              },
            ],
          },
        },
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: rt("🤖 Tulsbot Execution"),
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: lrt("Open Tulsbot Tasks", pageUrl(IDS.tasks)) },
              },
              {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: { rich_text: rt("Set AI Command = Tulsbot Action Requested.") },
              },
              {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: { rich_text: rt("Write prompt in Tulio's Notes.") },
              },
              {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: {
                  rich_text: rt(
                    "Review Tulsbot Notes + AI Evidence Links for completion/evidence.",
                  ),
                },
              },
            ],
          },
        },
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: rt("👤 CRM"),
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: lrt(
                    "Open CRM Contacts (routing source of truth)",
                    pageUrl(IDS.crmContacts),
                  ),
                },
              },
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: rt(
                    "Capture relationship metadata in contact properties; keep interaction notes/summaries inside each contact page body.",
                  ),
                },
              },
            ],
          },
        },
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: rt("📚 Docs"),
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: lrt("Open CTA/LE SOP database", pageUrl(IDS.sopDb)) },
              },
              {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: lrt("Open Branding Book", pageUrl(IDS.brandingBookPage)) },
              },
              {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: lrt("Open About LE reference", pageUrl(IDS.aboutLePage)) },
              },
            ],
          },
        },
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: rt("🧠 Knowledge"),
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: lrt("Open Knowledge Index", pageUrl(IDS.knowledge)) },
              },
              {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: lrt("Open Archive", pageUrl(IDS.archivePage)) },
              },
            ],
          },
        },
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: rt("📘 How to Use"),
            children: [
              {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: { rich_text: rt("Capture first in Capture Inbox.") },
              },
              {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: {
                  rich_text: rt("Use AI Command + Tulio's Notes for execution requests."),
                },
              },
              {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: {
                  rich_text: rt("Review outputs/evidence before marking done."),
                },
              },
              {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: {
                  rich_text: rt(
                    "Use legacy pages as reference only; do not build new operating flow there.",
                  ),
                },
              },
            ],
          },
        },
        { object: "block", type: "paragraph", paragraph: { rich_text: rt(MARKER) } },
      ],
    });
    evidence.appended = true;
  }

  const after = notion.request("GET", `/blocks/${ROOT}/children?page_size=100`);
  evidence.after = (after.results || []).map((b: any) => ({ id: b.id, type: b.type }));

  mkdirSync("reports/notion", { recursive: true });
  writeFileSync("reports/notion/root-refresh-2026-03-07.json", JSON.stringify(evidence, null, 2));
  console.log("ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
