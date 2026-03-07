import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const ROOT = "2ff51bf9731e806b81a3f4046740fac7";
const CONTROL_CENTER_PAGE = "31c51bf9731e8148b389dd94bed04235";
const V1_IDS = [
  "31c51bf9-731e-81aa-8874-eb0abe9ce2a5",
  "31c51bf9-731e-815e-bdf8-cf6182801f09",
  "31c51bf9-731e-81e1-be4e-cd74b7b297f3",
  "31c51bf9-731e-81f1-af4d-e9590beb263d",
  "31c51bf9-731e-8163-b3a2-dbc41fc880bb",
  "31c51bf9-731e-8140-9bcb-ecabdbb0a497",
  "31c51bf9-731e-81b8-ac69-e6af60be266e",
  "31c51bf9-731e-8133-a9c2-f69104bfef33",
  "31c51bf9-731e-81f8-abe3-d8d345e7192c",
  "31c51bf9-731e-813c-a119-fc23bb396aac",
  "31c51bf9-731e-8180-baf7-c147fef60467",
  "31c51bf9-731e-8173-9ff1-ff568270b59b",
  "31c51bf9-731e-8128-95c7-dc9f453ae7bf",
  "31c51bf9-731e-812d-b5f2-c876dfd9c182",
  "31c51bf9-731e-8151-9edf-d6de93de2585",
  "31c51bf9-731e-81d5-acfb-d17482a638d8",
  "31c51bf9-731e-815a-835f-f956580c63f4",
  "31c51bf9-731e-81fd-9d4a-f745b2d018d8",
  "31c51bf9-731e-8175-9c70-f883f5c32c72",
  "31c51bf9-731e-811e-865f-c7f747b33b1d",
  "31c51bf9-731e-814e-99ec-c84e59e01c7a",
  "31c51bf9-731e-81fe-8a7e-da1bc22823eb",
  "31c51bf9-731e-81b8-85fc-f0dc9bfd9b23",
  "31c51bf9-731e-81d0-912d-fb7bb0eba183",
  "31c51bf9-731e-81e9-9b67-df541f3c8604",
  "31c51bf9-731e-81a3-8165-e1bbc8b4b16f",
  "31c51bf9-731e-815f-a1f7-e07b0d6e3556",
  "31c51bf9-731e-81d2-ab24-f090039a9fe6",
];

const DB = {
  captureInbox: "30351bf9731e81f2bc24dca63220f567",
  superInbox: "61efc873884b4c11925bc096ba38ec55",
  projectGrid: "4bd8a8b2563747c78ebd33b0fb2f80ee",
  inftContext: "af146921faad430681b35a31dcdc202f",
  tasks: "30051bf9731e804c92b1c8ae7b76ee0f",
  crm: "f3c32b0d5b7d4a0582da7ac306b64cf8",
  knowledge: "9bb61f681fad4f90afe9a8c2bf6fcbae",
  meetings: "e28c94210e9b4471a18515c92bb394a4",
};

function txt(content: string) {
  return [{ type: "text", text: { content } }];
}
function ltxt(content: string, url: string) {
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

  // archive old v1 blocks
  for (const id of V1_IDS) {
    try {
      notion.request("PATCH", `/blocks/${id.replace(/-/g, "")}`, { archived: true });
    } catch {}
  }
  // archive accidental child page
  try {
    notion.request("PATCH", `/blocks/${CONTROL_CENTER_PAGE}`, { archived: true });
  } catch {}

  const marker = "TULSBOT_ROOT_HOMEPAGE_V2_2026-03-07";
  const res = notion.request("GET", `/blocks/${ROOT}/children?page_size=100`);
  const has = (res.results || []).some(
    (b: any) =>
      b.type === "paragraph" &&
      (b.paragraph?.rich_text || []).some((r: any) => r?.plain_text?.includes(marker)),
  );
  if (has) {
    console.log("already applied");
    return;
  }

  notion.request("PATCH", `/blocks/${ROOT}/children`, {
    children: [
      { object: "block", type: "heading_1", heading_1: { rich_text: txt("🦞 Tulsbot Home") } },
      {
        object: "block",
        type: "callout",
        callout: {
          icon: { emoji: "🧭" },
          rich_text: txt("Open toggles below. Each contains direct database links + instructions."),
        },
      },
      {
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: txt("📥 Inbox"),
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: txt(
                  "Capture first, then route. Super Inbox is post-screen human queue.",
                ),
              },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: ltxt("Open Capture Inbox (pre-screen)", pageUrl(DB.captureInbox)),
              },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: ltxt("Open Super Inbox (human queue)", pageUrl(DB.superInbox)),
              },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: txt("For tabbed linked views: open DB menu → Add view (Capture/Super)."),
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: txt("📂 Projects"),
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: ltxt("Open INFT Project Context", pageUrl(DB.inftContext)) },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: ltxt("Open Project Grid (read-only)", pageUrl(DB.projectGrid)),
              },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: ltxt("Open Meetings (read-only visibility)", pageUrl(DB.meetings)),
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: txt("🤖 Tulsbot Execution"),
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: ltxt("Open Tulsbot Tasks", pageUrl(DB.tasks)) },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: txt(
                  "Workflow: set AI Command → write prompt in Tulio's Notes → review Tulsbot Notes.",
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
          rich_text: txt("👤 CRM & Knowledge"),
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: ltxt("Open CRM Contacts", pageUrl(DB.crm)) },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: ltxt("Open Knowledge Index", pageUrl(DB.knowledge)) },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: txt(
                  "Interaction summaries stay inside each contact page (no separate interactions DB).",
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
          rich_text: txt("📘 How to use"),
          children: [
            {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: { rich_text: txt("Go to Inbox toggle and open Capture Inbox.") },
            },
            {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: {
                rich_text: txt("Set AI Command = Tulsbot Action Requested on an item."),
              },
            },
            {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: { rich_text: txt("Write your request in Tulio's Notes.") },
            },
            {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: {
                rich_text: txt("Review Tulsbot Notes + AI Evidence Links after execution."),
              },
            },
          ],
        },
      },
      { object: "block", type: "paragraph", paragraph: { rich_text: txt(marker) } },
    ],
  });

  console.log("applied v2");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
