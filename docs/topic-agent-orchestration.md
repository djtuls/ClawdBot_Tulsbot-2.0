# Topic-Agent Orchestration for Telegram Forum Topics

## Goal

Keep every Telegram forum topic relevant and covered without exhausting daily context budget.

Primary group pilot target:

- `groupId: -1003840777920`
- requester session pattern: `agent:main:telegram:group:-1003840777920:topic:<threadId>`

---

## 1) Architecture Spec

### Control Plane

Single **Topic Orchestrator** process (cron-driven) that:

1. Reads topic config + recent metrics (`config/topic-orchestration.topics-group.json`, `data/topic-orchestrator/topic-metrics.json`).
2. Assigns each topic to one of 3 coverage tiers.
3. Produces action plan (`reports/topic-orchestration-plan.md`) and state snapshot (`data/topic-orchestrator/state.json`).
4. Writes daily memory digest file (`memory/topics/YYYY-MM-DD.md`) to keep rolling context tight.

### Coverage Tiers

#### Tier A — Dedicated Steward Agent

Use when **any** condition is true:

- topic marked `critical=true`, OR
- priority score >= 80, OR
- > = 20 messages / 24h, OR
- has open blocker / deadline <= 48h.

Behavior:

- one steward agent bound to the topic session.
- maintains short rolling summary every 2h active window.

#### Tier B — Pooled Steward Coverage

Use when:

- score 35–79, OR
- 5–19 messages / 24h.

Behavior:

- one pooled steward handles up to 5 Tier B topics.
- summary cadence every 6h.

#### Tier C — On-Demand

Use when:

- score < 35 and no critical flag.

Behavior:

- no persistent steward.
- trigger only on new mention, command, or inactivity reminder threshold breach.
- summary once daily if touched.

---

## 2) Spawn / Retire Policies

### Spawn Rules

- Spawn Dedicated when topic enters Tier A for 2 consecutive orchestrator runs.
- Spawn Pooled worker when Tier B topic count exceeds existing pool capacity (`maxTopicsPerPool=5`).
- Spawn On-Demand worker only per event trigger; do not persist.

### Retire Rules

- Dedicated -> Pooled when below Tier A threshold for 3 consecutive runs and no open blocker.
- Pooled topic -> On-Demand when score < 35 for 2 days.
- Hard retire any idle steward after `idleRetireHours` (default 12h) unless `critical=true`.

### Hysteresis (anti-flap)

- Promotions: require 2 consecutive runs.
- Demotions: require 3 consecutive runs (or 2 days for B->C).

---

## 3) Daily Context Budget + Summarization Cadence

### Budget Model (per day)

Default pilot budget: **180k tokens/day** across Topics group.

Allocations:

- Tier A: 20k tokens/topic/day cap (hard)
- Tier B: 8k tokens/topic/day cap
- Tier C: 2k tokens/topic/day cap
- Cross-topic sync reserve: 20% of total budget

### Controls

- If group reaches 80% budget: move lowest-priority Tier B topics to sparse mode (summary-only).
- If reaches 95%: freeze non-critical Tier C processing until next daily reset.

### Summarization Cadence

- Tier A: micro-summary every 2h active + end-of-day summary
- Tier B: summary every 6h active + end-of-day summary
- Tier C: end-of-day summary only (if touched)

Summary output targets:

- `memory/topics/YYYY-MM-DD.md` (group-wide)
- optional topic slices under `memory/topics/<threadId>.md`

---

## 4) Escalation + Cross-Topic Sync Rules

### Escalation Triggers

Escalate topic to main operator workflow when:

- blocker older than 4h in Tier A,
- conflicting decisions detected across topics,
- deadline risk detected (due < 24h + unresolved owner),
- budget freeze hit on a critical topic.

Escalation output:

- append to `memory/HITL/topic-escalations.md`
- include: topic id, issue, impact, recommended action, owner.

### Cross-Topic Sync

Run sync pass every 4h:

- detect shared entities (project names, deadlines, owners) across topic summaries,
- write "cross-topic deltas" into daily file,
- if conflict, generate single canonical decision note and link back to affected topics.

---

## 5) Implementation Plan (Workspace)

Implemented files:

1. `docs/topic-agent-orchestration.md` (this spec)
2. `config/topic-orchestration.topics-group.json` (pilot config + tier thresholds)
3. `scripts/topic-orchestrator.ts` (planner + budget gate + digest writer)
4. `scripts/setup-topic-orchestrator-cron.sh` (cron bootstrap)

Operational data files (generated):

- `data/topic-orchestrator/topic-metrics.json` (input; can be updated by external collectors)
- `data/topic-orchestrator/state.json` (planner output)
- `reports/topic-orchestration-plan.md` (human-readable action plan)
- `memory/topics/YYYY-MM-DD.md` (daily context digest)

---

## 6) Pilot Rollout — Current Topics Group

### Scope

Start with a small pilot set in `-1003840777920`:

- thread `40` (active builder topic)
- 2–4 additional active threads as they appear

### Rollout Steps

1. Tune `config/topic-orchestration.topics-group.json` for real thread priorities.
2. Seed metrics file (`data/topic-orchestrator/topic-metrics.json`) once.
3. Run planner in dry mode:
   - `pnpm tsx scripts/topic-orchestrator.ts plan --config config/topic-orchestration.topics-group.json`
4. Review `reports/topic-orchestration-plan.md`.
5. Execute spawn/retire actions manually (first week, human-in-the-loop).
6. Enable cron every 30 min:
   - `bash scripts/setup-topic-orchestrator-cron.sh`
7. After 7 days, tighten automation by allowing auto-apply for non-critical demotions only.

### Manual execution pattern (week 1)

- Keep Tier A fully stewarded.
- Allow auto-summarization for all tiers.
- Require approval for retire on critical topics.

---

## Immediate Commands

```bash
cd /Users/tulioferro/.openclaw/workspace
mkdir -p data/topic-orchestrator memory/topics reports
pnpm tsx scripts/topic-orchestrator.ts plan --config config/topic-orchestration.topics-group.json
cat reports/topic-orchestration-plan.md
bash scripts/setup-topic-orchestrator-cron.sh
```
