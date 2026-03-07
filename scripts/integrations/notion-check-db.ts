import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";
const db = (process.argv[2] || "").trim();
if (!db) {
  console.error("db id arg");
  process.exit(1);
}
const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("missing token");
}
const notion = createNotionClient(token);
const q = notion.request("POST", `/databases/${db}/query`, { page_size: 1 });
console.log("results", q.results?.length || 0, "has_more", q.has_more);
