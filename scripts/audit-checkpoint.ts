import dotenv from "dotenv";
import fs from "fs";

const envConfig = dotenv.parse(fs.readFileSync(".env"));
for (const k in envConfig) {
  process.env[k] = envConfig[k];
}

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const TARGET_ID = "30e51bf9-731e-8091-8eb1-efa7bce68cde"; // Tulsbot_pre echosystem

const headers = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

async function fetchNotion(endpoint) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, { headers });
  return res.ok ? await res.json() : null;
}

async function audit(blockId, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) {
    return;
  }
  const indent = "  ".repeat(depth);

  const children = await fetchNotion(`/blocks/${blockId}/children?page_size=100`);
  if (!children?.results) {
    return;
  }

  for (const block of children.results) {
    if (block.type === "child_page") {
      console.log(`${indent}📄 ${block.child_page.title} (${block.id})`);
      await audit(block.id, depth + 1, maxDepth);
    } else if (block.type === "child_database") {
      const db = await fetchNotion(`/databases/${block.id}`);
      const title = db?.title?.[0]?.plain_text || block.child_database.title;
      console.log(`${indent}🗄️ ${title} (${block.id})`);
      // Log basic schema keys
      if (db?.properties) {
        console.log(`${indent}   Schema: ${Object.keys(db.properties).join(", ")}`);
      }
    } else if (["heading_1", "heading_2", "heading_3"].includes(block.type)) {
      const text = block[block.type].rich_text.map((t) => t.plain_text).join("");
      console.log(`${indent}# ${text}`);
    }
  }
}

console.log(`🔍 Deep Auditing: Tulsbot_pre echosystem (${TARGET_ID})`);
void audit(TARGET_ID);
