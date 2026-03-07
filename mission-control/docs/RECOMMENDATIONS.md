# Mission Control — Dynamic Improvement Recommendations

## Summary of Changes Made

- **Areas**: Now fetches from `/api/notion/areas` — derived from Workspaces (Domain) or `NOTION_AREAS_DB` if set
- **Settings → Integrations**: Now fetches from `/api/settings/integrations` — real status for Supabase, Notion, Google, Telegram, Fly.io
- **Dashboard**: Added Areas quick link; Projects/Workspaces, Tasks, Inbox already wired to Notion
- **Chat**: Uses `openclaw` CLI (works when MC runs locally with gateway)

---

## Recommendations for Making MC More Dynamic

### 1. **Chat on Fly.io**

**Problem**: Chat API runs `openclaw agent --agent main` via `execFile`. On Fly, the openclaw CLI is not installed.

**Options**:

- **A)** Add an HTTP relay in the gateway that accepts `POST /api/agent` with `{ message, sessionId }` and returns the response (sync or streaming). MC would `fetch(GATEWAY_URL + "/api/agent", ...)` instead of exec.
- **B)** Run MC and gateway in the same Fly app (monorepo) so `openclaw` is available in the container.
- **C)** Document that Chat works only when MC runs locally; use Telegram or Control UI for remote chat.

### 2. **Profile & Notifications Persistence**

**Current**: Profile (name, email, timezone) and Notion notification toggles are static; changes don't persist.

**Recommendation**:

- Store profile in Supabase `tulsbot_user_preferences` or a config table
- Add `/api/settings/profile` GET/PATCH
- Store notification preferences in same table; add `/api/settings/notifications` GET/PATCH
- Wire Settings UI to these endpoints

### 3. **API Keys Tab**

**Current**: Mock data; Add/Delete only affect local state.

**Recommendation**:

- Either remove the tab (keys live in `.env` only) or
- Add a read-only "status" view that checks which env vars are set (masked) without exposing values
- Real key management belongs in a secrets manager (e.g. Fly secrets, 1Password)

### 4. **MCP Servers Tab**

**Current**: Static list; Start/Stop are UI-only.

**Recommendation**:

- Integrate with `mcporter` or similar if you use it
- Add `/api/mcp/status` that returns actual MCP server health
- Or document as "configured in Cursor/Claude, not managed by MC"

### 5. **Run Heartbeat Button**

**Current**: No-op.

**Recommendation**:

- Add `/api/heartbeat/run` that triggers the heartbeat script (if gateway or a worker exposes it)
- Or call the gateway's cron/heartbeat endpoint
- Show last run time from Supabase `tulsbot_context_snapshots` or similar

### 6. **Areas → Notion Areas DB**

**Current**: Areas derived from Workspaces Domain; fallback to static list.

**Recommendation**:

- Create a Notion "Areas" database with: Name, Description, Status, Domain, Color
- Set `NOTION_AREAS_DB` in env
- MC will use it as primary source; Workspaces Domain remains fallback

### 7. **Tasks ↔ Workspaces Linking**

**Current**: Tasks show `workspace` from Category/Phase; no direct relation to Workspaces DB.

**Recommendation**:

- Add a "Workspace" relation property in Tasks DB pointing to Workspaces
- Or ensure Category/Phase values match Workspace names for consistency
- Add filter by Area (Domain) on Tasks page

### 8. **Real-time Updates**

**Current**: All data is fetch-on-load; no live updates.

**Recommendation**:

- Add polling (e.g. refetch every 60s) for Inbox, Tasks, Ecosystem
- Or use Supabase Realtime for shift/HITL/snapshots if stored there
- Consider Server-Sent Events for chat streaming

### 9. **Config-driven DB IDs**

**Current**: Most DB IDs are hardcoded in `lib/notion.ts`; some use env.

**Recommendation**:

- Move all to env: `NOTION_TASKS_DB`, `NOTION_INBOX_DB`, `NOTION_WORKSPACES_DB`, `NOTION_AGENT_REGISTRY_DB`, `NOTION_HEARTBEAT_DB`, `NOTION_AREAS_DB`
- Add a Settings → Notion tab to view/configure (admin only)
- Enables multi-workspace or per-environment configs

### 10. **Error Boundaries & Offline**

**Current**: Failed fetches show generic errors or empty state.

**Recommendation**:

- Add React Error Boundaries for major sections
- Show "Retry" and "Offline" states when fetch fails
- Cache last successful response for offline viewing

---

## Quick Wins

| Item                              | Effort | Impact         |
| --------------------------------- | ------ | -------------- |
| Profile/Notifications persistence | Medium | High           |
| Config-driven DB IDs              | Low    | Medium         |
| Run Heartbeat API                 | Low    | Medium         |
| Chat HTTP fallback                | Medium | High (for Fly) |
| Polling for live data             | Low    | Medium         |
