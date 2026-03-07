import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const ROOT = "2ff51bf9731e806b81a3f4046740fac7";
const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("missing token");
}
const notion = createNotionClient(token);
const res = notion.request("GET", `/blocks/${ROOT}/children?page_size=100`);
for (const b of res.results || []) {
  let label = "";
  if (b.type === "child_page") {
    label = b.child_page?.title || "";
  } else if (b.type === "child_database") {
    label = b.child_database?.title || "";
  } else if (b[b.type]?.rich_text) {
    label = (b[b.type].rich_text || []).map((r: any) => r.plain_text).join("");
  } else if (b.type === "link_to_page") {
    label = JSON.stringify(b.link_to_page);
  }
  console.log(`${b.id}\t${b.type}\t${label}`);
}
