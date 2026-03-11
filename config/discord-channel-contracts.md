# [ARCHIVED] Discord Channel Contracts

> Archived on 2026-03-11: Discord operational routing is dormant. Retained for future reactivation.

Guild: `1469708768173363343`

## Contract schema (required fields)

- **Purpose**
- **Allowed actions**
- **Model tier** (`Fast` | `Mid` | `Premium`)
- **Approval rule** (`draft-only` + `APPROVE <id>`/`REJECT <id>`)
- **Context rule** (one context per channel/thread; explicit cross-context link)

## Core channel contracts

1. `#daily-standup` (`1476394151300956250`)

- Purpose: Daily operating brief + handoff.
- Allowed actions: Priorities, blockers, handoffs, links to execution threads.
- Model tier: Mid.
- Approval rule: Outbound risky actions draft-only.

2. `#inbox-capture` (`1476422591765024789`)

- Purpose: Raw intake/capture queue.
- Allowed actions: Unstructured captures, links, quick notes.
- Model tier: Fast.
- Approval rule: Any external send derived from captures requires approval id.

3. `#builder` (`1476394231726735431`)

- Purpose: Build/system orchestration.
- Allowed actions: Build plans, implementation logs, technical decisioning.
- Model tier: Premium for architecture; Mid for routine updates.
- Approval rule: Destructive/system-impacting actions require approval id.

4. `#research` (`1476394064659349557`)

- Purpose: Research findings and synthesis.
- Allowed actions: Research plans, citations, synthesis drafts.
- Model tier: Premium for deep synthesis.
- Approval rule: Outbound/public research summaries are draft-only.

5. `#daily-reports` (`1476422877254389954`)

- Purpose: End-of-day and periodic reports.
- Allowed actions: Daily/weekly reports, KPI summaries.
- Model tier: Mid.
- Approval rule: Client-facing report sends require approval id.

6. `#tulsday` (`1476394237590372412`)

- Purpose: Context manager operation lane.
- Allowed actions: State tracking, blockers, next actions.
- Model tier: Mid.
- Approval rule: Cross-domain operational directives use approval gate when risky.

7. `#requests` (`1476422037747798116`)

- Purpose: Intake triage for actionable work.
- Allowed actions: New requests, triage outcomes, routing decisions.
- Model tier: Fast.
- Approval rule: None for internal triage; external send remains gated.

8. `#prd` (`1476422032878076066`)

- Purpose: Product requirement documents.
- Allowed actions: PRD drafts, reviews, decision logs.
- Model tier: Premium.
- Approval rule: External/client PRD distribution requires approval id.

9. `#tasks` (`1476422035210113055`)

- Purpose: Execution task tracking.
- Allowed actions: Task breakdown, assignment, completion evidence.
- Model tier: Fast.
- Approval rule: None for internal task management.

10. `#backlog` (`1476422040591274075`)

- Purpose: Deferred/queued work.
- Allowed actions: Backlog intake, prioritization notes.
- Model tier: Fast.
- Approval rule: None for internal backlog updates.

11. `#hitl` (`1476426082705211423`)

- Purpose: Human-in-the-loop approvals and exceptions.
- Allowed actions: Approval packets, risk decisions, waivers.
- Model tier: Mid.
- Approval rule: Canonical approval surface for `APPROVE <id>` / `REJECT <id>`.

## Protected channels (structural lock)

No move/rename/delete without explicit instruction:

- `daily-standup`
- `inbox-capture`
- `builder`
- `research`
- `daily-reports`
- `tulsday`

## Draft publish queue (live post/pin pending cross-surface permission)

- `APPROVE DC-CONTRACT-001` -> publish+pin contract in `#daily-standup`
- `APPROVE DC-CONTRACT-002` -> publish+pin contract in `#inbox-capture`
- `APPROVE DC-CONTRACT-003` -> publish+pin contract in `#builder`
- `APPROVE DC-CONTRACT-004` -> publish+pin contract in `#research`
- `APPROVE DC-CONTRACT-005` -> publish+pin contract in `#daily-reports`
- `APPROVE DC-CONTRACT-006` -> publish+pin contract in `#tulsday`
- `APPROVE DC-CONTRACT-007` -> publish+pin contract in `#requests`
- `APPROVE DC-CONTRACT-008` -> publish+pin contract in `#prd`
- `APPROVE DC-CONTRACT-009` -> publish+pin contract in `#tasks`
- `APPROVE DC-CONTRACT-010` -> publish+pin contract in `#backlog`
- `APPROVE DC-CONTRACT-011` -> publish+pin contract in `#hitl`
