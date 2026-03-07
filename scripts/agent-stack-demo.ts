#!/usr/bin/env tsx
import "dotenv/config";
import { z } from "zod";

type JsonRecord = Record<string, unknown>;

const envSchema = z.object({
  TAVILY_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  HERE_NOW_API_KEY: z.string().optional(),
  HERE_NOW_BASE_URL: z.string().url().optional(),
  AGENTMAIL_API_KEY: z.string().optional(),
  AGENTMAIL_BASE_URL: z.string().url().optional(),
  REMOTION_API_KEY: z.string().optional(),
  REMOTION_BASE_URL: z.string().url().optional(),
});

const env = envSchema.parse(process.env);

function getArg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.findIndex((x) => x === flag);
  if (idx === -1) {
    return fallback;
  }
  return process.argv[idx + 1] ?? fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function postJson<T>(
  url: string,
  body: JsonRecord,
  opts?: { apiKey?: string; apiKeyHeader?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (opts?.apiKey) {
    headers[opts.apiKeyHeader ?? "Authorization"] = opts.apiKeyHeader
      ? opts.apiKey
      : `Bearer ${opts.apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText} :: ${text}`);
  }

  return (await response.json()) as T;
}

async function tavilySearch(query: string): Promise<JsonRecord | undefined> {
  if (!env.TAVILY_API_KEY) {
    return undefined;
  }

  return postJson<JsonRecord>(
    "https://api.tavily.com/search",
    {
      query,
      search_depth: "advanced",
      max_results: 5,
      include_answer: true,
      include_raw_content: false,
    },
    { apiKey: env.TAVILY_API_KEY, apiKeyHeader: "x-api-key" },
  );
}

async function firecrawlScrape(url: string): Promise<JsonRecord | undefined> {
  if (!env.FIRECRAWL_API_KEY) {
    return undefined;
  }

  return postJson<JsonRecord>(
    "https://api.firecrawl.dev/v1/scrape",
    {
      url,
      formats: ["markdown", "html"],
      onlyMainContent: true,
    },
    { apiKey: env.FIRECRAWL_API_KEY },
  );
}

/**
 * here.now endpoint shape is kept configurable because API variants exist.
 * Expected endpoint: POST {baseUrl}/deploy with payload below.
 */
async function hereNowDeploy(content: string, title: string): Promise<JsonRecord | undefined> {
  if (!env.HERE_NOW_API_KEY || !env.HERE_NOW_BASE_URL) {
    return undefined;
  }

  return postJson<JsonRecord>(
    `${env.HERE_NOW_BASE_URL.replace(/\/$/, "")}/deploy`,
    {
      title,
      content,
      contentType: "text/markdown",
      visibility: "public",
    },
    { apiKey: env.HERE_NOW_API_KEY },
  );
}

/**
 * AgentMail endpoint shape is configurable. Expected endpoint:
 * POST {baseUrl}/messages/send
 */
async function agentMailSend(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<JsonRecord | undefined> {
  if (!env.AGENTMAIL_API_KEY || !env.AGENTMAIL_BASE_URL) {
    return undefined;
  }

  return postJson<JsonRecord>(
    `${env.AGENTMAIL_BASE_URL.replace(/\/$/, "")}/messages/send`,
    {
      to: params.to,
      subject: params.subject,
      text: params.text,
    },
    { apiKey: env.AGENTMAIL_API_KEY },
  );
}

/**
 * Remotion endpoint shape is configurable. Expected endpoint:
 * POST {baseUrl}/renders
 */
async function remotionRender(params: {
  title: string;
  script: string;
}): Promise<JsonRecord | undefined> {
  if (!env.REMOTION_API_KEY || !env.REMOTION_BASE_URL) {
    return undefined;
  }

  return postJson<JsonRecord>(
    `${env.REMOTION_BASE_URL.replace(/\/$/, "")}/renders`,
    {
      template: "agent-promo",
      inputProps: {
        title: params.title,
        script: params.script,
      },
      format: "mp4",
    },
    { apiKey: env.REMOTION_API_KEY },
  );
}

function brief(obj: unknown, max = 700): string {
  const text = JSON.stringify(obj, null, 2);
  return text.length <= max ? text : `${text.slice(0, max)}\n...<truncated>`;
}

async function run(): Promise<void> {
  const query = getArg("--query", "OpenClaw agent tools")!;
  const scrapeUrl = getArg("--url", "https://docs.openclaw.ai")!;
  const emailTo = getArg("--email-to");
  const dryRun = hasFlag("--dry-run");

  console.log("\n🦞 Agent Stack Demo — starting\n");

  try {
    const search = await tavilySearch(query);
    console.log(
      search ? "✅ Tavily search complete" : "⏭️ Tavily search skipped (missing TAVILY_API_KEY)",
    );

    const scrape = await firecrawlScrape(scrapeUrl);
    console.log(
      scrape
        ? "✅ Firecrawl scrape complete"
        : "⏭️ Firecrawl scrape skipped (missing FIRECRAWL_API_KEY)",
    );

    if (!search && !scrape) {
      throw new Error(
        "No tool credentials configured. Set at least TAVILY_API_KEY or FIRECRAWL_API_KEY in .env",
      );
    }

    const summary = [
      `# Agent Research Digest`,
      ``,
      `Query: ${query}`,
      `Source URL: ${scrapeUrl}`,
      ``,
      `## Search (Tavily)`,
      "```json",
      brief(search, 500),
      "```",
      ``,
      `## Scrape (Firecrawl)`,
      "```json",
      brief(scrape, 500),
      "```",
    ].join("\n");

    let deployResult: JsonRecord | undefined;
    if (!dryRun) {
      deployResult = await hereNowDeploy(summary, "Agent Research Digest");
      console.log(
        deployResult
          ? "✅ here.now deploy complete"
          : "⏭️ here.now deploy skipped (missing HERE_NOW_* config)",
      );
    } else {
      console.log("⏭️ here.now deploy skipped (dry-run)");
    }

    if (emailTo && !dryRun) {
      const sent = await agentMailSend({
        to: emailTo,
        subject: "Agent Research Digest",
        text: `Your digest is ready. Deploy response:\n${brief(deployResult, 800)}`,
      });
      console.log(
        sent
          ? "✅ AgentMail send complete"
          : "⏭️ AgentMail send skipped (missing AGENTMAIL_* config)",
      );
    } else {
      console.log("⏭️ AgentMail send skipped (missing --email-to or dry-run)");
    }

    if (!dryRun) {
      const render = await remotionRender({
        title: "Agent Stack Update",
        script:
          "We searched, scraped, deployed a public brief, and dispatched an email update. This is the baseline autonomous research loop.",
      });
      console.log(
        render
          ? "✅ Remotion render requested"
          : "⏭️ Remotion render skipped (missing REMOTION_* config)",
      );
      if (render) {
        console.log(brief(render, 700));
      }
    } else {
      console.log("⏭️ Remotion render skipped (dry-run)");
    }

    console.log("\n🎯 Done");
  } catch (error) {
    console.error("\n❌ Agent stack failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await run();
