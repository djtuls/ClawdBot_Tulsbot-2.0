#!/usr/bin/env node
/**
 * mcp-zapier — Stdio MCP proxy to the Zapier MCP HTTP server.
 *
 * Exposes Zapier actions to any MCP client (Claude Code, Tulsbot) via stdio.
 * Proxies tool discovery (tools/list) and execution (tools/call) to the
 * Zapier MCP endpoint using a Bearer token.
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ZAPIER_MCP_URL = requireEnv("ZAPIER_MCP_URL");
const ZAPIER_MCP_TOKEN = requireEnv("ZAPIER_MCP_TOKEN");

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

let _requestId = 1;
function nextId(): number {
  return _requestId++;
}

interface ZapierTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ZapierMcpResult {
  tools?: ZapierTool[];
  content?: Array<{ type: string; text: string }>;
  error?: { message: string; code?: number };
}

async function callZapier(
  method: string,
  params: Record<string, unknown> = {},
): Promise<ZapierMcpResult> {
  const response = await fetch(ZAPIER_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ZAPIER_MCP_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Zapier MCP HTTP ${response.status}: ${await response.text()}`);
  }

  const raw = await response.text();

  // Handle SSE responses (text/event-stream) — extract the last data: line
  if (raw.includes("data: ")) {
    const lines = raw.split("\n").filter((l) => l.startsWith("data: "));
    const lastLine = lines.at(-1);
    if (lastLine) {
      const parsed = JSON.parse(lastLine.slice(6)) as { result?: ZapierMcpResult };
      if (parsed.result) {
        return parsed.result;
      }
    }
    throw new Error("No result in Zapier SSE response");
  }

  const json = JSON.parse(raw) as { result?: ZapierMcpResult; error?: { message: string } };
  if (json.error) {
    throw new Error(`Zapier MCP error: ${json.error.message}`);
  }
  return json.result ?? {};
}

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

const server = new McpServer({
  name: "mcp-zapier",
  version: "1.0.0",
});

// ─── zapier_list_actions ─────────────────────────────────────────────────────

server.registerTool(
  "zapier_list_actions",
  {
    title: "List Zapier actions",
    description:
      "List all available Zapier actions configured in your Zapier MCP server. Use this first to discover what automations are available before running one.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const result = await callZapier("tools/list");
      const actions = (result.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
      }));
      return textResult({ actions });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult({ error: message });
    }
  },
);

// ─── zapier_run ──────────────────────────────────────────────────────────────

server.registerTool(
  "zapier_run",
  {
    title: "Run a Zapier action",
    description:
      "Execute a Zapier action by name. Use zapier_list_actions first to get the exact action name and required parameters. Can trigger any automation you have set up in Zapier (Slack messages, Google Sheets, Gmail, Notion, etc.).",
    inputSchema: z.object({
      action: z.string().describe("The exact Zapier action name (from zapier_list_actions)"),
      args: z.record(z.string(), z.unknown()).optional().describe("Arguments for the action"),
    }),
  },
  async ({ action, args = {} }) => {
    try {
      const result = await callZapier("tools/call", { name: action, arguments: args });
      if (result.content) {
        const text = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        return textResult({ result: text || result });
      }
      return textResult({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult({ error: message });
    }
  },
);

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[mcp-zapier] fatal", err);
  process.exit(1);
});
