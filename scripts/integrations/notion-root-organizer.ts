import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const ROOT_PAGE_ID = (
  process.env.NOTION_TULSBOT_ROOT_PAGE_ID || "2ff51bf9-731e-806b-81a3-f4046740fac7"
).replace(/-/g, "");

const DB = {
  captureInbox: "30351bf9-731e-81f2-bc24-dca63220f567",
  superInbox: "61efc873-884b-4c11-925b-c096ba38ec55",
  tulsbotTasks: "30051bf9-731e-804c-92b1-c8ae7b76ee0f",
  projectGrid: "4bd8a8b2-5637-47c7-8ebd-33b0fb2f80ee",
  inftContext: "af146921-faad-4306-81b3-5a31dcdc202f",
  crmContacts: "f3c32b0d-5b7d-4a05-82da-7ac306b64cf8",
  knowledge: "9bb61f68-1fad-4f90-afe9-a8c2bf6fcbae",
};

function text(content: string) {
  return [{ type: "text", text: { content } }];
}

function notionUrl(id: string) {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}

async function main() {
  const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
  if (!token) {
    throw new Error("NOTION_API_KEY/NOTION_KEY missing");
  }
  const notion = createNotionClient(token);

  const marker = "TULSBOT_CONTROL_CENTER_V1_2026-03-07";

  const rootChildren = notion.request("GET", `/blocks/${ROOT_PAGE_ID}/children?page_size=100`);
  let controlPage = (rootChildren.results || []).find((b: any) => {
    if (b.type !== "child_page") {
      return false;
    }
    const t = (b.child_page?.title || "").toLowerCase();
    return t.includes("tulsbot control center");
  });

  if (!controlPage) {
    const created = notion.request("POST", `/pages`, {
      parent: { page_id: ROOT_PAGE_ID },
      properties: {
        title: {
          title: [{ type: "text", text: { content: "🦞 Tulsbot Control Center" } }],
        },
      },
    });
    controlPage = {
      id: created.id,
      type: "child_page",
      child_page: { title: "🦞 Tulsbot Control Center" },
    };
  }

  const pageId = controlPage.id;
  const pageChildren = notion.request("GET", `/blocks/${pageId}/children?page_size=100`);
  const already = (pageChildren.results || []).some((b: any) => {
    if (b.type !== "paragraph") {
      return false;
    }
    const rt = b.paragraph?.rich_text || [];
    return rt.some((r: any) => r?.plain_text?.includes(marker));
  });

  if (already) {
    console.log("[notion-root-organizer] Control Center already initialized.");
    return;
  }

  notion.request("PATCH", `/blocks/${pageId}/children`, {
    children: [
      {
        object: "block",
        type: "heading_1",
        heading_1: { rich_text: text("🦞 Tulsbot Control Center") },
      },
      {
        object: "block",
        type: "quote",
        quote: {
          rich_text: text(
            "Use this page as your operating dashboard: capture → command → execution → review.",
          ),
        },
      },
      { object: "block", type: "heading_2", heading_2: { rich_text: text("Start Here") } },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: text("Open Capture Inbox first and triage new items.") },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: text("For any item, set AI Command = Tulsbot Action Requested."),
        },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: text("Write your prompt in Tulio's Notes.") },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: text("After execution, review Tulsbot Notes + AI Evidence Links."),
        },
      },
      { object: "block", type: "heading_2", heading_2: { rich_text: text("Core Databases") } },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: "Capture Inbox (Pre-screen)",
                link: { url: notionUrl(DB.captureInbox) },
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: "Super Inbox (Human queue)",
                link: { url: notionUrl(DB.superInbox) },
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: "Tulsbot Tasks (Approved initiatives)",
                link: { url: notionUrl(DB.tulsbotTasks) },
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: "CRM Contacts (routing control plane)",
                link: { url: notionUrl(DB.crmContacts) },
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: { content: "INFT Project Context", link: { url: notionUrl(DB.inftContext) } },
            },
          ],
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: "Project Grid (Read-only)",
                link: { url: notionUrl(DB.projectGrid) },
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: { content: "Knowledge Index", link: { url: notionUrl(DB.knowledge) } },
            },
          ],
        },
      },
      { object: "block", type: "heading_2", heading_2: { rich_text: text("Guiding Notes") } },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: text(
            "• Capture flow policy: Capture Inbox first. Super Inbox only after routing decision.",
          ),
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: text("• Project Grid is read-only for Tulsbot.") },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: text(
            "• CRM tags drive automation routing (sales/hubspot, ignore/suppress, etc.).",
          ),
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: text(
            "• Interactions are summarized inside each contact page (no separate interactions DB).",
          ),
        },
      },
      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "paragraph", paragraph: { rich_text: text(marker) } },
    ],
  });

  console.log(`[notion-root-organizer] Organized root page via control center: ${pageId}`);
}

main().catch((e) => {
  console.error("[notion-root-organizer] fatal", e);
  process.exit(1);
});
