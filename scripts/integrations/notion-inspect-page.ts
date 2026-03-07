import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const PAGE = (process.argv[2] || "").trim().replace(/-/g, "");
if (!PAGE) {
  console.error("usage: notion-inspect-page <pageId>");
  process.exit(1);
}
const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("missing notion token");
}
const notion = createNotionClient(token);
const page = notion.request("GET", `/pages/${PAGE}`);
console.log(
  "title:",
  (page.properties?.title?.title || []).map((t: any) => t.plain_text).join("") || page.id,
);
console.log("last_edited_time:", page.last_edited_time);
console.log("archived:", page.archived);
const children = notion.request("GET", `/blocks/${PAGE}/children?page_size=100`);
for (const b of children.results || []) {
  let txt = "";
  if (b.type === "child_page") {
    txt = b.child_page?.title || "";
  } else if (b.type === "child_database") {
    txt = b.child_database?.title || "";
  } else if (b[b.type]?.rich_text) {
    txt = (b[b.type].rich_text || [])
      .map((r: any) => r.plain_text)
      .join("")
      .slice(0, 100);
  }
  console.log(`${b.type}\t${txt}`);
}
