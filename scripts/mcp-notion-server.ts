#!/usr/bin/env node
/**
 * tulsbot-notion-mcp — Read-only MCP server for the Notion Agent Registry.
 *
 * Notion is a human-readable dashboard; Supabase is the source of truth.
 * Inter-agent coordination goes through the OpenClaw gateway, not Notion.
 * This server exposes a single read-only tool: agent_registry_list.
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type NotionRichText = {
  plain_text?: string;
};

type NotionPage = {
  id: string;
  properties: Record<string, unknown>;
};

type NotionQueryResponse = {
  results: NotionPage[];
};

const NOTION_VERSION = process.env.NOTION_VERSION ?? "2022-06-28";
const NOTION_KEY = requireEnv("NOTION_KEY");
const NOTION_AGENT_REGISTRY_DB = requireEnv("NOTION_AGENT_REGISTRY_DB");

const server = new McpServer({
  name: "tulsbot-notion-mcp",
  version: "0.2.0",
});

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

async function notionRequest<T>(
  path: string,
  init: RequestInit & { body?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${NOTION_KEY}`);
  headers.set("Notion-Version", NOTION_VERSION);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    ...init,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Notion request to ${path} failed: ${response.status} ${response.statusText} — ${text}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function richTextToPlainText(richText?: NotionRichText[]): string {
  if (!richText) {
    return "";
  }
  return richText.map((r) => r?.plain_text ?? "").join("");
}

function asToolResponse(payload: unknown) {
  const textPayload =
    typeof payload === "string" ? payload : `\n${JSON.stringify(payload, null, 2)}`;
  return {
    content: [
      {
        type: "text" as const,
        text: textPayload,
      },
    ],
  };
}

function mapAgent(page: NotionPage) {
  const props = page.properties ?? {};
  return {
    id: page.id,
    name: richTextToPlainText(props.Name?.title ?? []) || page.id,
    status: props.Status?.status?.name ?? null,
    operationalTags:
      props["Operational Tag"]?.multi_select
        ?.map((tag: unknown) => {
          if (typeof tag === "object" && tag && "name" in tag && typeof tag.name === "string") {
            return tag.name;
          }
          return "";
        })
        .filter(Boolean) ?? [],
    description: richTextToPlainText(props.Description?.rich_text ?? []),
    configNotes: richTextToPlainText(props["Config Notes"]?.rich_text ?? []),
  };
}

function notionFilter(filterClauses: Record<string, unknown>[]) {
  if (filterClauses.length === 0) {
    return undefined;
  }
  if (filterClauses.length === 1) {
    return filterClauses[0];
  }
  return { and: filterClauses };
}

server.registerTool(
  "agent_registry_list",
  {
    title: "List agents from Notion Agent Registry",
    description:
      "Returns entries from the Agent Registry database with optional filters. Read-only.",
    inputSchema: z.object({
      status: z.string().describe("Exact status value from the Status property.").optional(),
      operationalTag: z
        .string()
        .describe("Operational Tag multi-select value to filter by.")
        .optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
  },
  async ({ status, operationalTag, limit }) => {
    const filters: Record<string, unknown>[] = [];
    if (status) {
      filters.push({
        property: "Status",
        status: { equals: status },
      });
    }
    if (operationalTag) {
      filters.push({
        property: "Operational Tag",
        multi_select: { contains: operationalTag },
      });
    }

    const queryBody: Record<string, unknown> = {
      page_size: limit,
    };

    const filter = notionFilter(filters);
    if (filter) {
      queryBody.filter = filter;
    }

    const result = await notionRequest<NotionQueryResponse>(
      `databases/${NOTION_AGENT_REGISTRY_DB}/query`,
      {
        method: "POST",
        body: queryBody,
      },
    );

    const agents = result.results.map(mapAgent);
    return asToolResponse({ count: agents.length, agents });
  },
);

async function start() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

start().catch((error) => {
  console.error("[notion-mcp] Fatal error", error);
  process.exit(1);
});
