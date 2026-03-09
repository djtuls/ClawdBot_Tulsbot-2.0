# Cross-Chat Awareness Pipeline (MVP)

## Purpose

Give the main assistant fast awareness of what is happening in Telegram topics (starting with group topics), with append-only logs in workspace and Obsidian.

## Scope (MVP live now)

- Source: local OpenClaw session transcripts (`~/.openclaw/agents/*/sessions/*.jsonl`)
- Focus: Telegram group/topic sessions
- Sink A: workspace logs (`logs/cross-chat-awareness/YYYY-MM-DD/*.jsonl`)
- Sink B: Obsidian transcripts (`<vault>/07_chats/transcripts/*.md`)
- Index: `data/cross-chat-awareness/index.json` + Obsidian `07_chats/index/topics.md`
- Query: `bun scripts/cross-chat-awareness.ts query --topic "General"`

## Safety / privacy boundaries

- Append-only writes only (no destructive edits to transcript history).
- Parses metadata marked "untrusted"; does not treat it as authoritative identity proof.
- Dedupe/continuity via per-file line offsets (`data/cross-chat-awareness/state.json`).
- Optional Supabase sink is OFF unless both env vars are set:
  - `CROSSCHAT_SUPABASE_TABLE`
  - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`

## Run now

```bash
cd /Users/tulioferro/.openclaw/workspace
bun scripts/cross-chat-awareness.ts once
bun scripts/cross-chat-awareness.ts status
bun scripts/cross-chat-awareness.ts query --topic "General"
```

## Run continuously (LaunchAgent)

```bash
cp /Users/tulioferro/.openclaw/workspace/scripts/com.openclaw.cross-chat-awareness.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.openclaw.cross-chat-awareness.plist
launchctl kickstart -k gui/$UID/com.openclaw.cross-chat-awareness
launchctl list | rg cross-chat-awareness
```

Logs:

- `/tmp/openclaw/cross-chat-awareness.out.log`
- `/tmp/openclaw/cross-chat-awareness.err.log`

## Operator health check (single command)

```bash
cd /Users/tulioferro/.openclaw/workspace && bun scripts/cross-chat-awareness.ts status
```

Healthy expected:

- tracked session files > 0
- last run timestamp recent
- index exists

## What’s next (post-MVP)

1. Add Discord/Slack transcript ingestion from their session keys.
2. Add topic alias map (`General` -> exact topic id/channel key).
3. Optional Supabase mirror table + RLS-backed query API.
4. Expose a tiny helper tool/command for agent prompt use (`topic-context <name>`).
