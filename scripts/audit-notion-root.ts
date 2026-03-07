import dotenv from "dotenv";
// Fallback: use raw fetch if package missing (which it seems to be in this env, despite my assumption)
import fs from "fs";

// Load env manually if needed
const envConfig = dotenv.parse(fs.readFileSync(".env"));
for (const k in envConfig) {
  process.env[k] = envConfig[k];
}

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const ROOT_ID = "2ff51bf9-731e-806b-81a3-f4046740fac7";

const headers = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

async function fetchNotion(endpoint: string, method = "GET", body: unknown = null) {
  const url = `https://api.notion.com/v1${endpoint}`;
  const options: RequestInit = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    await res.text();
    return null;
  }
  return await res.json();
}

async function getBlockChildren(blockId: string) {
  const res = await fetchNotion(`/blocks/${blockId}/children?page_size=100`);
  return res?.results || [];
}

async function getDatabase(databaseId: string) {
  return await fetchNotion(`/databases/${databaseId}`);
}

async function getPage(pageId: string) {
  return await fetchNotion(`/pages/${pageId}`);
}

async function audit(blockId: string, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) {
    return;
  }

  const indent = "  ".repeat(depth);
  const children = await getBlockChildren(blockId);

  for (const block of children) {
    if (block.type === "child_page") {
      console.log(`${indent}📄 [Page] ${block.child_page.title} (${block.id})`);
      if (depth < maxDepth) {
        await audit(block.id, depth + 1, maxDepth);
      }
    } else if (block.type === "child_database") {
      const db = await getDatabase(block.id);
      if (db) {
        const title = db.title?.[0]?.plain_text || "Untitled";
        const props = Object.keys(db.properties).join(", ");
        console.log(`${indent}🗄️ [DB] ${title} (${block.id})`);
        console.log(`${indent}   Schema: ${props}`);
      } else {
        console.log(`${indent}🗄️ [DB] ${block.child_database.title} (Error fetching)`);
      }
    } else if (block.type === "link_to_page") {
      const type = block.link_to_page.type; // page_id or database_id
      const id = block.link_to_page[type];
      // Fetch title
      let title = "Unknown";
      if (type === "page_id") {
        const p = await getPage(id);
        title = p?.properties?.title?.title?.[0]?.plain_text || "Linked Page";
        console.log(`${indent}↗️ [Link] Page: ${title} (${id})`);
      } else {
        const d = await getDatabase(id);
        title = d?.title?.[0]?.plain_text || "Linked DB";
        console.log(`${indent}↗️ [Link] DB: ${title} (${id})`);
      }
    }
  }
}

console.log(`🔍 Auditing Root Page: ${ROOT_ID}`);
audit(ROOT_ID).catch(console.error);
