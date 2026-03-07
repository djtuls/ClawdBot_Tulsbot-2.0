import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";
const pageId = (process.argv[2] || "").trim();
const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("missing");
}
const notion = createNotionClient(token);
const p = notion.request("GET", `/pages/${pageId}`);
console.log(JSON.stringify(p.parent, null, 2));
