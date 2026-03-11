# TODO_MASTER — Canonical Backlog

Use this as the single source of truth for both Tulio (human) and Tulsbot (agent).

## Operating Rule — Always Write First

When an idea appears:

1. Write it here first.
2. Classify owner and task type.
3. If one-off/simple: delegate immediately, report back.
4. If multi-step/complex: write full approved plan + subtasks + delegation notes before execution.

## Task format

- [ ] [OWNER:HUMAN|AGENT] [TYPE:ONESHOT|PLAN] [STATUS:TODO|IN_PROGRESS|BLOCKED|DONE] Title
  - Context:
  - Next step:
  - Delegate:
  - Evidence/Links:

---

## PRIORITY P0/P1 — EXECUTION QUEUE

### HUMAN (Tulio)

- [ ] [OWNER:HUMAN] [TYPE:PLAN] [STATUS:TODO] Prepare RFP response for Elite + U17 (Saudi)
  - Context: Short tender window; John requested full plan + costs/submission details quickly.
  - Next step: Confirm final commercial/payment terms and approve proposal skeleton for drafting.
  - Delegate: Tulsbot drafting + packaging support.
  - Evidence/Links: memory/2026-03-11.md (WhatsApp context + LOC process).

- [ ] [OWNER:HUMAN] [TYPE:ONESHOT] [STATUS:TODO] Re-auth gog account on Mac Mini for outbound Gmail
  - Context: Outbound Gmail send blocked by auth/keyring constraints.
  - Next step: Complete browser consent for `tulsbot@gmail.com`, then run send smoke test command.
  - Delegate: Human action required; Tulsbot verifies after completion.
  - Evidence/Links: TODO.md (HITL — Mac Mini Login Required).

- [ ] [OWNER:HUMAN] [TYPE:PLAN] [STATUS:TODO] Confirm medium-confidence project/contact mappings from transcripts
  - Context: Per-project segmentation and East Tour dual-linking rules are approved.
  - Next step: Fast chat validation pass on ambiguous segments only.
  - Delegate: Tulsbot prepares review batch.
  - Evidence/Links: memory/2026-03-11.md (routing decision rules).

### AGENT (Tulsbot)

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:IN_PROGRESS] Implement Directive 1: one-brain architecture + foreground/background execution
  - Context: Builder autonomy retired; main must stay responsive while heavy work runs in subagents.
  - Next step: Complete remaining command/routing polish and verify `/builder status`/cancel behavior in DM flow.
  - Delegate: Main + subagent workers.
  - Evidence/Links: memory/inbox/2026-03-11-agent-architecture-directive.md.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Execute Directive 2 sequencing: Telegram DM-first and Discord elimination
  - Context: Approved priority order requires DM-first simplification and Discord dormancy.
  - Next step: Present/confirm exact file/script routing deltas, then implement with rollback-safe changes.
  - Delegate: Subagent for docs + script routing updates.
  - Evidence/Links: memory/inbox/2026-03-11-operating-system-redesign-directive.md.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Finish capture-governance completion
  - Context: Inbox router gating, thread lifecycle states, and summary refresh remain partially pending.
  - Next step: Implement Archive/Ignore gates, thread upsert/append behavior, summary-at-top refresh, sorted-state auto move-out.
  - Delegate: Subagent implementation + validation.
  - Evidence/Links: TODO.md (Capture Inbox Governance), STATE.md blocker.

- [ ] [OWNER:AGENT] [TYPE:ONESHOT] [STATUS:TODO] Run credential inventory + secret checks for active integrations
  - Context: Phase A active integrations check is open.
  - Next step: Audit required secrets and log missing tokens as skipped with concise alerts.
  - Delegate: Subagent run.
  - Evidence/Links: TODO.md, STATE.md current focus.

- [ ] [OWNER:AGENT] [TYPE:ONESHOT] [STATUS:TODO] Validate governance guardrails (draft-only outbound + explicit approvals)
  - Context: Must remain intact while operating model changes.
  - Next step: Execute policy verification pass and record outcome in state/event log.
  - Delegate: Subagent audit.
  - Evidence/Links: TODO.md, STATE.md current focus.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Deliver Google Calendar MCP integration (foundation for Life OS)
  - Context: Required by both API rollout Phase B and Personal Life OS directive.
  - Next step: Complete integration + morning brief feed wiring.
  - Delegate: Subagent build.
  - Evidence/Links: TODO.md Phase B; operating-system-redesign Directive 4.

- [ ] [OWNER:AGENT] [TYPE:ONESHOT] [STATUS:TODO] Fix Docker Release failure due uppercase cache repository reference
  - Context: Workflow failing with invalid uppercase reference format.
  - Next step: Ensure all cache/image refs are lowercase; verify green run.
  - Delegate: Subagent CI fix + monitor.
  - Evidence/Links: memory/2026-03-11.md monitoring findings.

- [ ] [OWNER:AGENT] [TYPE:ONESHOT] [STATUS:TODO] Investigate Anthropic provider probe failures (400 / 0% windows)
  - Context: Health monitor flagged persistent degraded provider status.
  - Next step: Diagnose endpoint/config/auth cause and restore stable probe success.
  - Delegate: Subagent investigation.
  - Evidence/Links: memory/2026-03-11.md monitoring findings.

---

## PRIORITY P2/P3 — PLANNED BACKLOG

### HUMAN (Tulio)

- [ ] [OWNER:HUMAN] [TYPE:ONESHOT] [STATUS:TODO] Telegram topic cleanup (archive/close legacy forum threads)
  - Context: DM-first model is the target operating surface.
  - Next step: Keep DM + optional alert channel only.
  - Delegate: Human action with Tulsbot checklist.
  - Evidence/Links: TODO.md + operating-system-redesign directive.

### AGENT (Tulsbot)

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:IN_PROGRESS] Plaud daily routing automation
  - Context: Transcript ingestion path integrated; daily first-pass context routine mandated.
  - Next step: Schedule previous-day ingest + missing-context prompt loop in DM.
  - Delegate: Subagent + cron wiring.
  - Evidence/Links: TODO_MASTER previous state; memory/2026-03-11.md policy update.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Plaud integration completion (deferred task package)
  - Context: Tokenized API client + scan script + state tracking + provider health + cron still pending full rollout.
  - Next step: Execute deferred setup/test then full `plaud-scan.ts` integration plan.
  - Delegate: Subagent implementation.
  - Evidence/Links: memory/inbox/2026-03-11-plaud-integration-instructions.md.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Execute Directive 5 writing-quality uplift across briefs/reports
  - Context: 30-second test and anti-pattern avoidance must become default output standard.
  - Next step: Ensure report pipeline has interpretation step + quality gates applied before send.
  - Delegate: Subagent doc/pipeline updates.
  - Evidence/Links: operating-system-redesign directive; SOUL writing standards.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Execute Obsidian restructure (Directive 3)
  - Context: Shift from deep PARA silos to linked project/people/signals hubs.
  - Next step: Plan and stage migration with no destructive deletes; verify capture creates links.
  - Delegate: Subagent migration workstream.
  - Evidence/Links: memory/inbox/2026-03-11-operating-system-redesign-directive.md.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Execute INFT Phase 1 “Connect the Chaos”
  - Context: Depends on Obsidian restructure; requires people graph + enriched dossiers + lifecycle awareness.
  - Next step: Start 1.1 people graph after restructure validation.
  - Delegate: Subagent phased execution.
  - Evidence/Links: memory/inbox/2026-03-11-inft-project-management-directive.md.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Complete remaining API rollout phases (Sheets, Firecrawl/Markitdown, Tavily/Exa, RSS/YouTube, GSC/GA4/FetchSERP)
  - Context: Calendar is first dependency; remaining roadmap remains approved backlog.
  - Next step: Re-prioritize sequence post-Calendar completion.
  - Delegate: Subagent by integration batch.
  - Evidence/Links: TODO.md Phase B/C/D.

- [ ] [OWNER:AGENT] [TYPE:ONESHOT] [STATUS:TODO] Implement email dedup invariant + upsert-only thread model
  - Context: Required capture governance hardening item.
  - Next step: Enforce `provider+account+threadId` (fallback `messageId`) and same-thread same-page append behavior.
  - Delegate: Subagent.
  - Evidence/Links: TODO.md capture governance checklist.

- [ ] [OWNER:AGENT] [TYPE:ONESHOT] [STATUS:TODO] Add calls/Plaud governance properties in capture schema
  - Context: Governance model missing processing depth/confidentiality/routing properties for calls.
  - Next step: Add fields and wire enforcement.
  - Delegate: Subagent.
  - Evidence/Links: TODO.md capture governance checklist.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:TODO] Keep split-brain risk on decay path until reconciliation normalizes
  - Context: Operational mitigation completed; metric remains HIGH due 48h history window.
  - Next step: Maintain single-writer discipline and monitor trend during cooldown.
  - Delegate: Main monitoring + periodic checks.
  - Evidence/Links: STATE.md reconciliation, session-handoff.md.

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:BLOCKED] Push pending hardening commits after GitHub SSH access is restored
  - Context: Local branch ahead; push blocked by `Permission denied (publickey)`.
  - Next step: Restore SSH auth then push.
  - Delegate: Human key fix + agent push.
  - Evidence/Links: memory/session-handoff.md.

- [ ] [OWNER:AGENT] [TYPE:ONESHOT] [STATUS:TODO] Validate DR restore/sync-back runbook under real offline simulation
  - Context: DR flow documented; should be periodically re-tested safely.
  - Next step: Execute dry-run restore/sync-back validation checklist.
  - Delegate: Subagent guided test.
  - Evidence/Links: memory/2026-03-11.md DR runtime note.

---

## Completed / Closed (from migration sources)

- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:DONE] Disable builder autonomous cron lanes to stop split-brain writes
- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:DONE] Apply gateway hardening (`sandbox=all`, `workspaceOnly=true`) and restart successfully
- [ ] [OWNER:AGENT] [TYPE:ONESHOT] [STATUS:DONE] Run heartbeat/service-health/security audit checkpoint with criticals cleared
- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:DONE] Create single canonical backlog policy (`TODO_MASTER.md`) with owner-tag routing in AGENTS
- [ ] [OWNER:AGENT] [TYPE:PLAN] [STATUS:DONE] Complete safe chunked signal graph backfill (584/584 linked)

---

## Migration Notes (2026-03-12)

Backlog migrated into canonical `TODO_MASTER.md` from:

- `TODO.md` (active + deferred + HITL)
- `STATE.md` (current focus + blocker threads)
- `memory/2026-03-11.md` (durable updates, overnight findings, directives, policy decisions)
- `memory/session-handoff.md` (hardening completion + deferred next actions)
- `memory/inbox/2026-03-11-agent-architecture-directive.md`
- `memory/inbox/2026-03-11-operating-system-redesign-directive.md`
- `memory/inbox/2026-03-11-inft-project-management-directive.md`
- `memory/inbox/2026-03-11-plaud-integration-instructions.md`

Dedup policy applied:

- Consolidated overlapping Plaud items into one IN_PROGRESS automation track + one TODO deferred integration package.
- Consolidated split-brain items into one IN_PROGRESS stability track.
- Preserved approved priority order from directives (Architecture → Telegram/Discord → Writing → Obsidian → INFT/Life OS dependencies).
