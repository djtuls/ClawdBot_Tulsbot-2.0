import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const ROOT = "2ff51bf9731e806b81a3f4046740fac7";
const MARKER = "TULSBOT_ROOT_REFRESH_V3_REPAIR_2026-03-07";
const IDS = {
  captureInbox: "30351bf9731e81f2bc24dca63220f567",
  superInbox: "61efc873884b4c11925bc096ba38ec55",
  projectGrid: "4bd8a8b2563747c78ebd33b0fb2f80ee",
  inftContext: "af146921faad430681b35a31dcdc202f",
  tasks: "30051bf9731e804c92b1c8ae7b76ee0f",
  meetings: "e28c94210e9b4471a18515c92bb394a4",
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

const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("missing notion token");
}
const notion = createNotionClient(token);
const res = notion.request("GET", `/blocks/${ROOT}/children?page_size=100`);
const has = (txt: string) =>
  (res.results || []).some((b: any) =>
    (b[b.type]?.rich_text || []).some((r: any) => r.plain_text === txt),
  );

const children: any[] = [];
if (!has("🦞 Tulsbot Home")) {
  children.push({
    object: "block",
    type: "heading_1",
    heading_1: { rich_text: rt("🦞 Tulsbot Home") },
  });
}
if (!has("📥 Inbox")) {
  children.push({
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
            rich_text: lrt("Open Super Inbox (post-routing human queue)", pageUrl(IDS.superInbox)),
          },
        },
      ],
    },
  });
}
if (!has("📂 Projects")) {
  children.push({
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: rt("📂 Projects"),
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: lrt("Open INFT Project Context", pageUrl(IDS.inftContext)) },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: lrt("Open Project Grid (read-only)", pageUrl(IDS.projectGrid)) },
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
  });
}
if (!has("🤖 Tulsbot Execution")) {
  children.push({
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
            rich_text: rt("Review Tulsbot Notes + AI Evidence Links for completion/evidence."),
          },
        },
      ],
    },
  });
}
if (!has(MARKER)) {
  children.push({ object: "block", type: "paragraph", paragraph: { rich_text: rt(MARKER) } });
}
if (children.length) {
  notion.request("PATCH", `/blocks/${ROOT}/children`, { children });
}
console.log(`appended=${children.length}`);
