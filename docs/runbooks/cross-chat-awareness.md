# Cross-Chat Awareness Pipeline (Telegram MVP)

## Required architecture (implemented)

1. **Live append logging** for every incoming/outgoing message seen in session transcripts.
2. **Hourly reconcile/backfill/dedupe** pass.
3. **Daily recap** summarizing key decisions/actions and refreshing `STATE.md`.

## Required Obsidian storage (implemented)

- `03_openclaw/chat-logs/daily/YYYY-MM-DD.md`
- `03_openclaw/chat-logs/by-channel/<channel>/<chat-or-topic-id>/YYYY-MM-DD.md`
- `03_openclaw/chat-logs/index.md`

## Log entry schema

Each appended item includes:

- timestamp
- channel + chat/topic
- sender
- message text/media reference
- action tags (if detected)
- links to project/contact when known (`#tag`, `@mention` heuristic)

## Safety / privacy boundaries

- Append-only logging (no transcript rewrites).
- No Keychain/Apple Password dependency.
- No destructive edits to source transcripts.
- Metadata parsed as untrusted hints.
- Dedupe via deterministic `id` + persisted `seenEventIds`.

## Commands

```bash
cd /Users/tulioferro/.openclaw/workspace

# live one-shot
bun scripts/cross-chat-awareness.ts once

# live daemon
bun scripts/cross-chat-awareness.ts watch

# hourly backfill/dedupe pass
bun scripts/cross-chat-awareness.ts reconcile

# daily recap + STATE.md refresh
bun scripts/cross-chat-awareness.ts daily-recap

# quick retrieval by topic/chat label
bun scripts/cross-chat-awareness.ts query "General"

# health/status
bun scripts/cross-chat-awareness.ts status
```

## LaunchAgent jobs

### 1) Live logger

- `scripts/com.openclaw.cross-chat-awareness.plist`
- KeepAlive + RunAtLoad + 15s poll loop (`watch` command)

### 2) Hourly reconcile

- `scripts/com.openclaw.cross-chat-awareness-reconcile.plist`
- `StartInterval=3600`

### 3) Daily recap

- `scripts/com.openclaw.cross-chat-awareness-daily-recap.plist`
- `StartCalendarInterval 23:40`

## Install/enable jobs

```bash
cp scripts/com.openclaw.cross-chat-awareness*.plist ~/Library/LaunchAgents/

launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.openclaw.cross-chat-awareness.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.openclaw.cross-chat-awareness-reconcile.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.openclaw.cross-chat-awareness-daily-recap.plist

launchctl kickstart -k gui/$UID/com.openclaw.cross-chat-awareness
launchctl kickstart -k gui/$UID/com.openclaw.cross-chat-awareness-reconcile
```

## Health checks (operator)

```bash
# process health
launchctl list | rg cross-chat-awareness

# pipeline status
bun scripts/cross-chat-awareness.ts status

# logs
tail -n 50 /tmp/openclaw/cross-chat-awareness.out.log
tail -n 50 /tmp/openclaw/cross-chat-awareness.err.log
tail -n 50 /tmp/openclaw/cross-chat-awareness-reconcile.err.log
tail -n 50 /tmp/openclaw/cross-chat-awareness-daily.err.log
```

Healthy expected:

- tracked session files > 0
- last live run recent
- last reconcile timestamp recent
- Obsidian index exists

## Rollback

```bash
launchctl bootout gui/$UID/com.openclaw.cross-chat-awareness
launchctl bootout gui/$UID/com.openclaw.cross-chat-awareness-reconcile
launchctl bootout gui/$UID/com.openclaw.cross-chat-awareness-daily-recap

rm -f ~/Library/LaunchAgents/com.openclaw.cross-chat-awareness.plist
rm -f ~/Library/LaunchAgents/com.openclaw.cross-chat-awareness-reconcile.plist
rm -f ~/Library/LaunchAgents/com.openclaw.cross-chat-awareness-daily-recap.plist
```

Data rollback policy:

- logs are append-only artifacts; do not delete by default.
- if needed, archive `logs/cross-chat-awareness/` and `03_openclaw/chat-logs/` before cleanup.

## Next step after MVP

1. Add explicit Discord/Slack channel parsing map.
2. Stronger project/contact linking from known directory sources.
3. Optional Supabase mirror (`CROSSCHAT_SUPABASE_TABLE`) for cross-device retrieval.
