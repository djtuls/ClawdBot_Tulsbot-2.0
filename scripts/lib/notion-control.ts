import { execFileSync } from "child_process";

export const NOTION_VERSION = "2022-06-28";

export interface NotionClient {
  request<T = any>(method: "GET" | "POST" | "PATCH", endpoint: string, body?: unknown): T;
}

export function createNotionClient(token: string): NotionClient {
  if (!token) {
    throw new Error("Notion token missing");
  }

  return {
    request<T = any>(method: "GET" | "POST" | "PATCH", endpoint: string, body?: unknown): T {
      const args = [
        "-s",
        "-X",
        method,
        `https://api.notion.com/v1${endpoint}`,
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        "Content-Type: application/json",
        "-H",
        `Notion-Version: ${NOTION_VERSION}`,
      ];

      if (body !== undefined) {
        args.push("-d", JSON.stringify(body));
      }

      const raw = execFileSync("curl", args, { timeout: 30_000, encoding: "utf-8" });
      const parsed = JSON.parse(raw);
      if (parsed?.object === "error") {
        throw new Error(`${parsed.code || "notion_error"}: ${parsed.message || "unknown"}`);
      }
      return parsed as T;
    },
  };
}

export function extractPlainText(prop: any): string {
  if (!prop || typeof prop !== "object") {
    return "";
  }
  if (prop.type === "title") {
    return (prop.title || []).map((t: any) => t.plain_text || "").join("");
  }
  if (prop.type === "rich_text") {
    return (prop.rich_text || []).map((t: any) => t.plain_text || "").join("");
  }
  if (prop.type === "select") {
    return prop.select?.name || "";
  }
  if (prop.type === "status") {
    return prop.status?.name || "";
  }
  if (prop.type === "url") {
    return prop.url || "";
  }
  if (prop.type === "date") {
    return prop.date?.start || "";
  }
  return "";
}

export function richText(content: string) {
  return {
    rich_text: [{ text: { content: content.slice(0, 1900) } }],
  };
}
