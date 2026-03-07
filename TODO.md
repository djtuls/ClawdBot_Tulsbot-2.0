# TODO — IOS V2

**Updated:** 2026-03-05 (post-audit — every component tested and verified)

## Active — Discord Governance & Migration (approved 2026-03-07)

### Discord-first Operating Model (Telegram fallback)

- [x] Phase 0 health gate: snapshot current Discord IA, validate permissions, freeze protected channels (`daily-standup`, `inbox-capture`, `builder`, `research`, `daily-reports`, `tulsday`)
- [x] Phase 1 IA cleanup: hard-archive duplicate/legacy categories/channels while preserving lock list
- [x] Phase 2 policy pass: enforce one-context-per-channel/thread and prepare pinned channel contracts (purpose, model tier, approval rules); live publish queued via `DC-CONTRACT-*`
- [x] Phase 3 migration: define Discord-first daily operations model; Telegram retained as ingress/backup path
- [x] Phase 4 automation: map briefing/reporting/enrichment/maintenance flows to canonical Discord channels and propose cron/system-event remap (`DC-AUTO-001`)
- [x] Governance controls: enforce draft-only outbound + explicit `APPROVE <id>` / `REJECT <id>` gates
- [x] Publish before/after architecture map + rollback notes (see `memory/discord/audit-log-*`)
- [x] Apply queued cross-surface Discord publish/pin actions after explicit approvals

## Active — API Integration Rollout (OpenClaw API List recommendations, approved 2026-03-07)

### Phase A — Core Operating Integrations (Now)

- [ ] HubSpot MCP integration (contacts/deals create-update from agent workflows)
- [ ] Notion MCP integration (project notes/briefs sync for INFT Hub)
- [ ] Gmail MCP integration (draft-first outbound + thread triage)
- [ ] Credential inventory + secret checks for all 3 integrations
- [ ] Governance validation: draft-only outbound + approval gates intact

### Phase B — Ops Backbone

- [ ] Google Calendar MCP integration (scheduling from chat)
- [ ] Google Sheets MCP integration (operational logs + lead/report append)
- [ ] Firecrawl/Website crawl integration for knowledge ingestion
- [ ] Markitdown/Doc-to-Markdown integration for document normalization

### Phase C — Research Pipeline

- [ ] Tavily MCP (primary web research)
- [ ] Exa MCP (semantic research, optional)
- [ ] RSS parser workflow for daily/weekly digests
- [ ] YouTube transcript ingestion flow

### Phase D — Growth Analytics

- [ ] GSC MCP integration
- [ ] GA4 MCP integration
- [ ] FetchSERP rank monitoring

## Active — Capture Inbox Governance (new)

### Unified Governance Control Plane (WhatsApp + Email + Meetings + Calls/Plaud)

- [x] Design Notion schema for `Capture Governance` (source-level rules, monitor modes, routing, retention, sensitivity)
- [x] Add/confirm `Contacts` DB as canonical people registry for governance relations
- [x] Create `WhatsApp Groups` DB (group id, members, monitor mode: Monitor/Archive/Ignore, priority, owner)
- [x] Create `Capture Highlights` DB (key updates, decisions, actions, risks) linked to group/contact/project
- [ ] Add `Calls/Plaud` governance properties (processing depth, confidentiality, routing targets)
- [ ] Implement inbox-router gating logic so `Archive/Ignore` sources are skipped automatically
- [ ] Pilot with top 3 WhatsApp groups + 1 Plaud call flow, then tune extraction/routing rules
- [ ] Document runbook/SOP for ongoing governance maintenance

## Active (requires user action)

### HITL — Mac Mini Login Required

- [ ] Re-auth `gog` for `tulsbot@gmail.com` on Mac Mini (browser consent) so outbound Gmail sends resume without keyring prompt.
- [ ] After re-auth, run a send smoke test: `gog gmail send --account tulsbot@gmail.com --to ferro.tulio@gmail.com --subject "GOG auth test" --body "Auth OK" --no-input`.

### Notion — Additional Databases

Only 6 databases are verified and connected. To add more, share the Notion URL.

- [ ] PARA structure (01-Projects, 02-Areas, 03-Resources, 04-Archive)
- [ ] Finance Inbox
- [ ] CRM Companies
- [ ] CRM Interactions

### Mac Mini Hardware

- [x] `pmset` policy applied (`disksleep 0`, `powernap 0`) and verified via `pmset -g custom`.
- [x] Codex Pro OAuth/profile configured (`openai-codex:default` present in auth profiles; usage stats active).

### Security

- [ ] Google OAuth client secret rotation — **deferred by policy** (only rotate if/when a concrete security issue is detected).

### Plaud

- [ ] Locate Plaud export directory on Mac Mini
- [ ] Connect Plaud device to Mac Mini for automatic exports

## IOS V2 — Verified Status (tested 2026-03-05)

### Syncs — ALL VERIFIED

| Script          | Status | Details                                                                                                 |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Notion sync     | ✅     | 315 items across 6 DBs (INFT Projects 50, Grid 80, Super Inbox 100, Tasks 47, Contacts 8, Knowledge 30) |
| HubSpot sync    | ✅     | 1 deal, 100 contacts                                                                                    |
| Todoist sync    | ✅     | 34 active tasks, 10 high-pri, 1 due today                                                               |
| Dossier builder | ✅     | 82 project dossiers generated                                                                           |
| Drive map       | ✅     | 23 projects mapped (21 Financial, 14 OPS)                                                               |

### Capture Inbox — ALL VERIFIED

| Script        | Status | Details                                                   |
| ------------- | ------ | --------------------------------------------------------- |
| Email scan    | ✅     | 4 Gmail accounts scanned, items classified + routed       |
| WhatsApp scan | ✅     | Via openclaw agent + wacli skill, 4 commitments extracted |
| Inbox router  | ✅     | Routes to Todoist + Notion Super Inbox + Telegram         |
| Inbox dedup   | ✅     | SHA-256 file-backed cache working                         |

### Councils — ALL VERIFIED

| Script             | Status | Details                                         |
| ------------------ | ------ | ----------------------------------------------- |
| Operations council | ✅     | Stale deals detected, recommendations generated |
| Finance council    | ✅     | Report saved to memory/councils/                |
| INFT-Hub council   | ✅     | Report saved to memory/councils/                |
| Platform council   | ✅     | 0 issues — all systems healthy                  |

### Notifications — ALL VERIFIED

| Script          | Status | Details                                   |
| --------------- | ------ | ----------------------------------------- |
| Morning brief   | ✅     | Sends to Daily Briefs topic               |
| Evening report  | ✅     | Sends to Daily Briefs topic               |
| Telegram topics | ✅     | All 9 topics active, sendToTopic verified |

### Infrastructure — ALL VERIFIED

| Component       | Status | Details                                                 |
| --------------- | ------ | ------------------------------------------------------- |
| Gateway         | ✅     | Port 18891, pid 79753, runtime active                   |
| Heartbeat       | ✅     | 7 invariants checked, heartbeat-state.json written      |
| Crontab         | ✅     | All jobs have correct PATH + env vars, shebangs removed |
| Memory (3-tier) | ✅     | Daily, handoff, tulsday-context all fresh               |
| Event log       | ✅     | 134 entries, writing actively                           |

### Obsidian/Vault — ALL VERIFIED (NEW)

| Component                | Status | Details                                                            |
| ------------------------ | ------ | ------------------------------------------------------------------ |
| qmd                      | ✅     | v1.0.7 installed, vault collection: 209 files indexed, 224 vectors |
| obsidian-cli             | ✅     | v0.2.3 installed, default vault: tuls-vault                        |
| Vault inbox processor    | ✅     | process-inbox.ts fixed, runs in nightly maintenance                |
| Vault promotion (Tier 3) | ✅     | vault-promote.ts: daily notes → vault consolidation + QMD re-index |
| Nightly maintenance      | ✅     | Cleaned: shebangs, npx paths, vault-promote + qmd steps added      |

### Remaining Cron Scripts — ALL VERIFIED

| Script        | Status | Details                              |
| ------------- | ------ | ------------------------------------ |
| Security scan | ✅     | Secrets=0, tunnel=true, gateway=true |
| Log rotation  | ✅     | 134 entries, none older than 7 days  |
| Midday sync   | ✅     | State refresh working                |
| Backup        | ✅     | Daily workspace backup to Drive      |

## Fixes Applied This Session

1. **Crontab env vars**: Added HUBSPOT_ACCESS_TOKEN, TODOIST_API_TOKEN, NOTION_API_KEY to crontab header
2. **NOTION_API_KEY**: Uncommented in workspace/.env (was previously commented out)
3. **Shebangs removed**: All 20+ cron-invoked scripts had #!/usr/bin/env node/npx/tsx shebangs causing "env: node: No such file or directory" in cron
4. **nightly-maintenance.ts**: Fixed bare `npx` → `/opt/homebrew/bin/npx`, added vault-promote step, QMD uses full paths
5. **Heartbeat**: Added 7 invariant checks (workspace, daily memory, handoff, event log, cron, gateway, tulsday), writes heartbeat-state.json
6. **Vault tooling**: Installed qmd + obsidian-cli on Mac Mini, configured vault collection
7. **vault-promote.ts**: New script — promotes daily notes to Obsidian vault, extracts learnings, re-indexes QMD
8. **Hallucinated Notion DBs**: Removed 3 fake database IDs from notion-sync.ts and VISION.md
9. **Gateway**: Restarted to fix token mismatch

## Deferred

- [ ] GoDaddy CNAME: mc.tulsbot.com → tunnel (verify DNS)
- [ ] Bidirectional HubSpot <-> Notion sync (after V1 one-way is proven)
- [ ] Meeting intelligence (when meeting volume justifies)
- [ ] Financial tracking (QuickBooks integration)
- [ ] Tulsbot root page in Notion (when writes to Notion are needed)
- [ ] Tailscale ACLs hardening
- [ ] UptimeRobot monitoring
