import "dotenv/config";
import { createNotionClient, extractPlainText } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";

const DB = "30351bf9-731e-81f2-bc24-dca63220f567";
const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("missing token");
}
const notion = createNotionClient(token);
const q = notion.request("POST", `/databases/${DB}/query`, {
  page_size: 20,
  sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
});
console.log("count_returned", q.results?.length || 0);
for (const p of q.results || []) {
  const props = p.properties || {};
  const name = extractPlainText(props["Name"] || props["title"] || {});
  const status = extractPlainText(props["Status"] || {});
  const ai = extractPlainText(props["AI Status"] || {});
  console.log(
    `- ${p.last_edited_time} | ${status || "no-status"} | ${ai || "no-ai"} | ${name.slice(0, 90)}`,
  );
}
