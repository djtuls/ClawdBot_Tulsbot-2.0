import dotenv from "dotenv";
import fs from "fs";

// Load env manually
const envConfig = dotenv.parse(fs.readFileSync(".env"));
for (const k in envConfig) {
  process.env[k] = envConfig[k];
}

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PRE_ECO_ID = "30e51bf9-731e-8091-8eb1-efa7bce68cde";

const headers = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

async function fetchNotion(endpoint: string) {
  const url = `https://api.notion.com/v1${endpoint}`;
  try {
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    console.error("Fetch error", e);
    return null;
  }
}

async function getBlockChildren(blockId: string) {
  try {
    const res = await fetchNotion(`/blocks/${blockId}/children?page_size=100`);
    return res?.results || [];
  } catch {
    console.error(`Error fetching children for ${blockId}`, e);
    return [];
  }
}

async function getPage(pageId: string) {
  try {
    return await fetchNotion(`/pages/${pageId}`);
  } catch {
    return null;
  }
}

async function getDatabase(databaseId: string) {
  try {
    return await fetchNotion(`/databases/${databaseId}`);
  } catch {
    return null;
  }
}

async function deepAudit(blockId: string, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) {
    return;
  }
  const indent = "  ".repeat(depth);

  try {
    const children = await getBlockChildren(blockId);
    if (children.length === 0) {
      return;
    }

    for (const block of children) {
      if (block.type === "child_page") {
        console.log(`${indent}📄 [Page] ${block.child_page.title} (${block.id})`);
        await deepAudit(block.id, depth + 1, maxDepth);
      } else if (block.type === "child_database") {
        const db = await getDatabase(block.id);
        const title = db?.title?.[0]?.plain_text || block.child_database.title;
        console.log(`${indent}🗄️ [DB] ${title} (${block.id})`);
        if (db?.properties) {
          const props = Object.keys(db.properties).join(", ");
          console.log(`${indent}   Schema: ${props}`);
        }
      } else if (block.type === "link_to_page") {
        const type = block.link_to_page.type;
        const id = block.link_to_page[type];
        if (type === "page_id") {
          const p = await getPage(id);
          const t = p?.properties?.title?.title?.[0]?.plain_text || "Linked Page";
          console.log(`${indent}↗️ [Link] Page: ${t} (${id})`);
        } else {
          const d = await getDatabase(id);
          const t = d?.title?.[0]?.plain_text || "Linked DB";
          console.log(`${indent}↗️ [Link] DB: ${t} (${id})`);
        }
      } else if (block.type === "heading_1") {
        const text = block.heading_1.rich_text
          .map((t: unknown) => {
            if (!(typeof t === "object" && t && "plain_text" in t)) {
              return "";
            }
            const plainText = t.plain_text;
            return typeof plainText === "string" ? plainText : "";
          })
          .join("");
        console.log(`${indent}# ${text}`);
      } else if (block.type === "callout") {
        const text = block.callout.rich_text
          .map((t: unknown) => {
            if (!(typeof t === "object" && t && "plain_text" in t)) {
              return "";
            }
            const plainText = t.plain_text;
            return typeof plainText === "string" ? plainText : "";
          })
          .join("");
        console.log(`${indent}💡 ${text}`);
      }
    }
  } catch (e) {
    console.error(`Error auditing ${blockId}`, e);
  }
}

console.log(`🔍 Deep Auditing: Tulsbot_pre-echosystem (${PRE_ECO_ID})`);
deepAudit(PRE_ECO_ID).catch(console.error);
