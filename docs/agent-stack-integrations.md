# Agent Stack Integrations (Tavily + Firecrawl + here.now + AgentMail + Remotion)

This workspace now includes a runnable demo orchestrator:

- `scripts/agent-stack-demo.ts`

It wires five tools from a single command.

## What is production-ready now

- **Tavily** search integration (`https://api.tavily.com/search`)
- **Firecrawl** scrape integration (`https://api.firecrawl.dev/v1/scrape`)

## What is configurable by endpoint

Because different accounts/plans expose different API surfaces, these are implemented via configurable base URLs:

- **here.now** (`$HERE_NOW_BASE_URL/deploy`)
- **AgentMail** (`$AGENTMAIL_BASE_URL/messages/send`)
- **Remotion** (`$REMOTION_BASE_URL/renders`)

If your endpoints differ, only the route strings in `scripts/agent-stack-demo.ts` need adjustment.

## Environment variables

Add to `.env`:

```bash
TAVILY_API_KEY=
FIRECRAWL_API_KEY=

HERE_NOW_API_KEY=
HERE_NOW_BASE_URL=

AGENTMAIL_API_KEY=
AGENTMAIL_BASE_URL=

REMOTION_API_KEY=
REMOTION_BASE_URL=
```

## Run

Dry run (search + scrape only, skips external writes):

```bash
pnpm agent:stack -- --dry-run --query "sports presentation AI workflow" --url "https://docs.openclaw.ai"
```

Full run:

```bash
pnpm agent:stack -- --query "sports presentation AI workflow" --url "https://docs.openclaw.ai" --email-to "you@example.com"
```

## Output flow

1. Tavily search
2. Firecrawl scrape
3. Build markdown digest
4. Deploy digest (here.now)
5. Send notification email (AgentMail)
6. Trigger promo render (Remotion)
