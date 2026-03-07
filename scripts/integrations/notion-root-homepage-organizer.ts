import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const ROOT_PAGE_ID = "2ff51bf9731e806b81a3f4046740fac7";
const ACCIDENTAL_CHILD_PAGE_ID = "31c51bf9-731e-8148-b389-dd94bed04235";
const MARKER = "TULSBOT_ROOT_HOMEPAGE_V1_2026-03-07";

const DB = {
  captureInbox: "30351bf9731e81f2bc24dca63220f567",
  superInbox: "61efc873884b4c11925bc096ba38ec55",
  tulsbotTasks: "30051bf9731e804c92b1c8ae7b76ee0f",
  projectGrid: "4bd8a8b2563747c78ebd33b0fb2f80ee",
  inftContext: "af146921faad430681b35a31dcdc202f",
  crmContacts: "f3c32b0d5b7d4a0582da7ac306b64cf8",
  knowledge: "9bb61f681fad4f90afe9a8c2bf6fcbae",
};

function rt(content: string) {
  return [{ type: "text", text: { content } }];
}

function link(content: string, url: string) {
  return [{ type: "text", text: { content, link: { url } } }];
}

function notionUrl(id: string) {
  return `https://www.notion.so/${id}`;
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION_API_KEY/NOTION_KEY missing");
  }
  const notion = createNotionClient(token);

  // Archive the accidental child page created earlier.
  try {
    notion.request("PATCH", `/blocks/${ACCIDENTAL_CHILD_PAGE_ID}`, { archived: true });
  } catch {
    // ignore if already archived / missing
  }

  const children = notion.request("GET", `/blocks/${ROOT_PAGE_ID}/children?page_size=100`);
  const already = (children.results || []).some((b: any) => {
    if (b.type !== "paragraph") {
      return false;
    }
    return (b.paragraph?.rich_text || []).some((r: any) => r?.plain_text?.includes(MARKER));
  });

  if (already) {
    console.log("[notion-root-homepage-organizer] Root homepage already organized.");
    return;
  }

  notion.request("PATCH", `/blocks/${ROOT_PAGE_ID}/children`, {
    children: [
      { object: "block", type: "heading_1", heading_1: { rich_text: rt("🦞 Tulsbot Home") } },
      {
        object: "block",
        type: "callout",
        callout: {
          icon: { emoji: "🎯" },
          rich_text: rt(
            "This is your operations home page. Start with Capture Inbox, then trigger AI actions from each item.",
          ),
        },
      },

      { object: "block", type: "heading_2", heading_2: { rich_text: rt("Quick Start") } },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: rt("Open Capture Inbox and triage new items.") },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: rt("Set AI Command = Tulsbot Action Requested on the item you want executed."),
        },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: rt("Write your exact prompt in Tulio's Notes.") },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: rt("Review Tulsbot Notes + AI Evidence Links when done."),
        },
      },

      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "heading_2", heading_2: { rich_text: rt("Core Databases") } },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: link("Capture Inbox (Pre-screen)", notionUrl(DB.captureInbox)),
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: link("Super Inbox (Human queue after routing)", notionUrl(DB.superInbox)),
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: link("Tulsbot Tasks (Approved initiatives)", notionUrl(DB.tulsbotTasks)),
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: link("CRM Contacts (routing control plane)", notionUrl(DB.crmContacts)),
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: link("INFT Project Context", notionUrl(DB.inftContext)) },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: link("Project Grid (Read-only)", notionUrl(DB.projectGrid)),
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: link("Knowledge Index", notionUrl(DB.knowledge)) },
      },

      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "heading_2", heading_2: { rich_text: rt("Operating Rules") } },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: rt(
            "• Capture flow: Capture Inbox first, then routing, then Super Inbox only when appropriate.",
          ),
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: rt("• Project Grid is read-only for Tulsbot.") },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: rt("• Meetings DB is visibility-only unless explicitly approved otherwise."),
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: rt(
            "• CRM tags define routing behavior (sales/hubspot, ignore/suppress, etc.).",
          ),
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: rt(
            "• Interaction logs stay inside each contact page (no separate interactions DB).",
          ),
        },
      },

      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "heading_2", heading_2: { rich_text: rt("AI Command Legend") } },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: rt(
            "AI Command: None | Tulsbot Action Requested | Waiting Clarification | Blocked | Done",
          ),
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: rt("AI Status: Idle | Queued | In Progress | Completed | Failed"),
        },
      },

      { object: "block", type: "paragraph", paragraph: { rich_text: rt(MARKER) } },
    ],
  });

  console.log("[notion-root-homepage-organizer] Root page organized successfully.");
}

main().catch((e) => {
  console.error("[notion-root-homepage-organizer] fatal", e);
  process.exit(1);
});
