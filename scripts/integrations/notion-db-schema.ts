import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";
const db = (process.argv[2] || "").trim();
const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("missing");
}
const notion = createNotionClient(token);
const r = notion.request("GET", `/databases/${db}`);
console.log("title", (r.title || []).map((t: any) => t.plain_text).join(""));
for (const [k, v] of Object.entries<any>(r.properties || {})) {
  console.log(k, v.type);
}
