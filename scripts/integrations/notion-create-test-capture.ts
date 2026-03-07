import "dotenv/config";
import { createNotionClient } from "../lib/notion-control.js";
import { getSecret } from "../lib/secrets.js";
const token = getSecret("NOTION_API_KEY") || getSecret("NOTION_KEY");
if (!token) {
  throw new Error("missing");
}
const notion = createNotionClient(token);
const db = "30351bf9-731e-81f2-bc24-dca63220f567";
const body = {
  parent: { database_id: db },
  properties: { Name: { title: [{ text: { content: "TEST capture write" } }] } },
};
const p = notion.request("POST", "/pages", body);
console.log("ok", p.id, p.url);
