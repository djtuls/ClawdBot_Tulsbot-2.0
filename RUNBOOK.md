# RUNBOOK.md — Tulsbot Operating Procedures

> Single source of truth for all operating procedures. Updated 2026-03-05 (IOS V2).

---

## 1. Vision & Purpose

Tulsbot is an autonomous context engine and operational partner. See `VISION.md` for the full identity, architecture, and protocols.

| Pillar         | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| Context Engine | Ingests, organizes, and pre-loads context for every project    |
| Always Online  | Mac Mini hub running 24/7 via Cloudflare Tunnel                |
| Self-Healing   | Runtime invariants verified every heartbeat; auto-fix or alert |
| Proactive      | Capture inbox, sync pipelines, councils, notification batching |

| Service         | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| Discord         | Primary operations surface (canonical execution channels)   |
| Telegram        | Ingress + backup only; mirror to Discord canonical channels |
| HubSpot         | CRM source of truth — contacts, deals, pipeline             |
| Notion          | INFT_Hub operations — projects, team, deliverables          |
| Todoist         | Daily planning — priorities, quick capture, inbox           |
| Obsidian        | Long-term knowledge graph — vault with wiki links           |
| Mission Control | Custom dashboard (Next.js on Mac Mini :3000)                |
| Ollama          | Local models on Mac Mini                                    |

---

## 2. Architecture

```
Mac Mini (100.100.5.125) — PRIMARY HUB
├── OpenClaw Gateway (port 18891, bind: lan)
├── Cloudflare Tunnel (mc.tulsbot.com)
├── Mission Control (port 3000, via tunnel)
├── Ollama (qwen2.5-coder:14b, qwen3:8b, tulsbot:latest)
├── @djtulsbot Telegram bot (forum group with topics)
├── Capture Inbox Pipeline (email, WhatsApp, Plaud)
├── Cross-Platform Sync (HubSpot, Notion, Todoist)
├── Project Dossier Builder
├── Council System (Operations + Platform nightly)
├── Cron jobs (heartbeat, briefs, maintenance, sync, scan)
└── 3-Tier Memory System

Laptop (100.77.91.95) — THIN CLIENT
├── gateway.mode: remote → ws://100.100.5.125:18891
├── Cursor IDE + tulsCodex
└── CLI routes to Mac Mini gateway
```

---

## 3. Boot Sequence

On every restart:

1. Read `VISION.md` — context engine blueprint
2. Read `memory/session-handoff.md` — where we left off
3. Read `RUNBOOK.md` (this file) — how to operate
4. Read `STATE.md` — current system state
5. Read `TODO.md` — what to work on
6. Check `memory/heartbeat-state.json` — system health
7. Check `memory/event-log.jsonl` (last 50 entries) — overnight errors

If errors found: propose fixes. If idle: check task board for assigned work.

---

## 4. Modes

One agent, multiple behavioral modes. Switch via Telegram command.

| Command    | Mode    | Role                                                       |
| ---------- | ------- | ---------------------------------------------------------- |
| (default)  | Default | Context-aware assistant, loads project dossiers on request |
| `/builder` | Builder | Architecture, coding, system design. Spawns subagents.     |
| `/tulsday` | Tulsday | Context manager, state tracking, surfaces blockers         |
| `/report`  | Report  | Summaries, reviews, progress updates                       |

Subagent policy: up to 8 concurrent subagents. Use them freely for parallel work. Always report what subagents returned.

---

## 5. Discord-First Governance

Canonical policies:

- `config/discord-channel-contracts.md`
- `config/discord-context-isolation.md`
- `config/discord-routing-conventions.md`
- `config/discord-outbound-approval-gate.md`
- `config/discord-automation-wiring.md`

Operating rules:

1. One-context-per-channel/thread.
2. Cross-context references require explicit `context-link:` marker.
3. Protected channels (`daily-standup`, `inbox-capture`, `builder`, `research`, `daily-reports`, `tulsday`) are no-touch for move/rename/delete unless explicitly approved.
4. Risky outbound actions are draft-only using `APPROVE <id>` / `REJECT <id>`.
5. Telegram is ingress/backup path; operational execution routes to Discord canonical channels.

### 5.1 Email Send Governance (Operator Directive — 2026-03-07)

Hard rule:

- **Only `tulsbot@gmail.com` is authorized for outbound email sends.**
- **Outbound email is allowed only when Tulio gives an explicit command to send.**

Operational enforcement:

- Default `gog` sender account must be `GOG_ACCOUNT=tulsbot@gmail.com`.
- If a send command references any other mailbox (`ferro.tulio@gmail.com`, `tulio@weareliveengine.com`, `tuliof@creativetoolsagency.com`), block and request explicit policy override from Tulio.
- For non-explicit asks (drafting, brainstorming, “prepare email”), generate draft text only; do not send.
- Log every outbound send command and result to daily memory.

---

## 6. Memory Protocol

### 3-Tier System

| Tier       | Files                                                                          | Updated By                               |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| Working    | `session-handoff.md`, `heartbeat-state.json`, `tulsday-processed-context.json` | Shift-manager, heartbeat                 |
| Short-term | `daily/YYYY-MM-DD.md`, `event-log.jsonl`, `inbox/pending.jsonl`                | Evening report, heartbeat, capture inbox |
| Long-term  | Obsidian vault, project dossiers, `learnings.md`                               | Nightly consolidation, dossier builder   |

### Memory Freshness SLA

Verified every heartbeat:

- `daily/<today>.md` exists and updated within 4h → if not, generate stub from event log
- `session-handoff.md` updated within 24h → if not, generate from current state
- `tulsday-processed-context.json` regenerated within 2h → if not, regenerate

Stale memory is a P1 issue.

---

## 6. Cron Schedule (all times America/Sao_Paulo BRT)

| Schedule             | Job                   | Script                           | Output                                              |
| -------------------- | --------------------- | -------------------------------- | --------------------------------------------------- |
| Every 60 min         | Heartbeat hourly      | `run-heartbeat-hourly.ts`        | Invariant checks, state refresh                     |
| Every 30 min (7-20h) | Email scan            | `inbox/email-scan.ts`            | → Inbox Review topic                                |
| Every 60 min         | Todoist sync          | `integrations/todoist-sync.ts`   | Daily memory update                                 |
| Every 4 hours        | HubSpot sync          | `integrations/hubspot-sync.ts`   | → CRM topic (changes)                               |
| Every 4 hours        | Notion sync           | `integrations/notion-sync.ts`    | → INFT Ops topic (changes)                          |
| 4:00 AM              | Heartbeat daily       | `run-heartbeat-daily.ts`         | Memory sync, backup                                 |
| 6:00 AM              | Morning brief         | `morning-brief.ts`               | → Discord `#daily-standup` (Telegram backup mirror) |
| 6:15 AM              | Provider health check | `provider-health-check.ts`       | → Discord `#system-status` (issues only)            |
| 9:00 AM              | WhatsApp scan         | `inbox/whatsapp-scan.ts`         | → Discord `#inbox-capture` (triage to `#requests`)  |
| 12:00 PM             | Midday sync           | `midday-sync.ts`                 | → Discord `#daily-standup`                          |
| 6:00 PM              | Evening report        | `evening-report.ts`              | → Discord `#daily-reports`                          |
| 10:00 PM             | Plaud processing      | `inbox/plaud-process.ts`         | → Discord `#research`/`#tasks` by routing policy    |
| 10:00 PM             | Nightly maintenance   | `nightly-maintenance.ts`         | → Discord `#heartbeat-reports`                      |
| 11:00 PM             | Security scan         | `security-scan.ts`               | → Discord `#system-status` (issues only)            |
| 1:00 AM              | Master indexer        | `indexer/run-indexer.ts`         | KB indexing + summary to `#heartbeat-reports`       |
| 2:00 AM              | Log rotation          | `rotate-event-log.ts`            | Rotate event-log.jsonl                              |
| 3:00 AM              | Operations Council    | `councils/operations-council.ts` | → Discord `#daily-reports`                          |
| 4:00 AM              | Platform Council      | `councils/platform-council.ts`   | → Discord `#heartbeat-reports`                      |
| Mon 9 AM             | Weekly review         | `weekly-review.ts`               | → Discord `#daily-reports`                          |

---

## 7. Capture Inbox

See `VISION.md` for full capture inbox pipeline documentation including:

- Email classification rubric (7 categories)
- WhatsApp commitment extraction
- Plaud transcript processing
- Idempotency via `data/inbox-seen.db`

### 7.1 Governance-First Intake Policy

Capture Inbox must obey Notion governance rules before processing any source.

Governed sources:

- WhatsApp groups
- Email senders/domains
- Meetings
- Calls/Plaud recordings

Required rule fields:

- Monitor Mode (`Monitor | Archive | Ignore`)
- Processing Depth (`Full Transcript | Summary | Action Items Only | Skip`)
- Sensitivity (`Normal | Confidential | Restricted`)
- Routing targets (CRM / Notion / Todoist / Vault)
- Retention policy
- Owner

Operational behavior:

- `Monitor` -> process normally and extract highlights/action items.
- `Archive/Ignore` -> skip in capture pipeline.
- Mirror only high-value context to Telegram topics; suppress empty FYI reports.

### 7.2 Capture Hardening Guardrails (2026-03-07)

Mandatory flow:

1. Create/ingest in **Capture Inbox DB** (pre-screen only).
2. Human/AI routing decision in Capture Inbox.
3. Move/copy to **Super Inbox** only when explicitly required.

Hard protections:

- Config source: `config/notion-control-plane.json`
- `policy.allowDirectSuperInboxWrites=false` by default
- Router guard blocks writes when capture DB == super DB unless explicit override
- Validation script: `pnpm tsx scripts/integrations/validate-capture-flow.ts`

Monitoring:

- Guard emits `blocked-direct-super-inbox-seed` in `memory/event-log.jsonl`
- Validation report path: `reports/notion/capture-flow-validation-YYYY-MM-DD.json`

---

## 8. Notification System

### Priority Matrix

| Priority | Delivery     | Examples                                          |
| -------- | ------------ | ------------------------------------------------- |
| Critical | Immediate    | Gateway down, invariant violation, security alert |
| High     | Hourly batch | Task completed, cron failure, important email     |
| Medium   | 3-hour batch | Memory sync, deal stage change                    |
| Low      | Daily digest | Knowledge captures, weekly review, suggestions    |

### Proactive Pings (only these)

- Result delivered (work product ready)
- Blocker needing decision (can't proceed without input)
- High-impact alert (something broke, something urgent arrived)

Everything else goes to the appropriate Telegram topic for passive consumption.

---

## 9. Self-Healing

| Level         | Action                                                    |
| ------------- | --------------------------------------------------------- |
| P0 (critical) | Immediate halt, alert user via Telegram, attempt auto-fix |
| P1 (high)     | Escalate to user, include in next brief                   |
| P2 (medium)   | Include in morning brief, auto-fix if possible            |
| P3 (low)      | Include in weekly review                                  |

Invariant violations (VISION.md) are P0.

---

## 10. Notion Scope

Notion is for **INFT_Hub domain work only** — Live Engine, Creative Tools Agency, INFT projects. System operations live in the local workspace and Mission Control.

Do NOT push heartbeat snapshots, agent registry, or system health to Notion.

Build-location constraint (operator directive):

- For now, create any new Notion pages/databases ONLY under:
  - `https://www.notion.so/liveengine/Tulsbot-2ff51bf9731e806b81a3f4046740fac7`
- If a different location is desired, require explicit Tulio approval in chat.

---

## 11. Writing & Communication Standards

| Skill                 | Path                                  |
| --------------------- | ------------------------------------- |
| `professional-writer` | `skills/professional-writer/SKILL.md` |
| `event-brief`         | `skills/event-brief/SKILL.md`         |
| `sow-writer`          | `skills/sow-writer/SKILL.md`          |
| `proposal-writer`     | `skills/proposal-writer/SKILL.md`     |
| `weekly-review`       | `skills/weekly-review/SKILL.md`       |
| `research-digest`     | `skills/research-digest/SKILL.md`     |

Voice rules: Direct, no fluff. Specific over vague. Take a position. Cut AI vocabulary. External-facing text must pass humanizer.

---

## 12. Emergency Procedures

```bash
# Gateway crash
openclaw gateway restart   # or: openclaw doctor

# Telegram 409 (duplicate poller)
pgrep -f "openclaw gateway"   # find duplicate
kill <pid>                     # kill extra
openclaw gateway restart       # restart single

# Cron PATH break
crontab -l | head -1           # verify PATH line
# Must be: PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin

# Memory staleness
npx tsx scripts/run-heartbeat-hourly.ts   # regenerate state

# API key issues
openclaw status --deep

# Mac Mini unreachable
ssh tulioferro@100.100.5.125   # via Tailscale
```

---

## 13. Google Workspace (gog CLI)

| Email                            | Use              | Outbound send permission                            |
| -------------------------------- | ---------------- | --------------------------------------------------- |
| `ferro.tulio@gmail.com`          | Personal         | No (read/query context only unless policy override) |
| `tulsbot@gmail.com`              | Bot / automation | **Yes, with explicit Tulio send command only**      |
| `tulio@weareliveengine.com`      | Live Engine      | No (read/query context only unless policy override) |
| `tuliof@creativetoolsagency.com` | Creative Tools   | No (read/query context only unless policy override) |

Enforcement:

- Keep `GOG_ACCOUNT=tulsbot@gmail.com` as default.
- Treat “send”, “reply”, “forward”, and “draft + send now” as outbound actions requiring explicit command.

---

## 14. Coding & Safety

- TypeScript (ESM), strict typing, avoid `any`
- ~500-700 LOC max per file
- Use `scripts/committer "<msg>" <file...>` for commits
- Never edit `node_modules`
- Never commit secrets or PII
- Never send streaming/partial replies to messaging surfaces

---

_Last updated: 2026-03-05 — IOS V2_
