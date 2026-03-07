# Runbook v3 Autonomous Executor

Runbook v3 makes approved plans execute from state, not chat prompts.

## State file (single source of truth)

Path: `state/approved-plans.json`

Each plan record uses these core fields:

- `planId`
- `status` (`approved | in_progress | done | blocked`)
- `currentPhase`
- `lastUpdateAt`
- `blocked` (boolean)
- `blockerType`
- `nextAction`
- `notionPageId` (optional)
- `executionId`

Optional runtime metadata used for idempotency and auditing:

- `phases`
- `completedPhases`
- `phaseLocks`
- `blockers`

Top-level also stores `transitions[]` for transition logging.

## CLI wrapper

Script: `scripts/runbook-v3.ts`

```bash
# Initialize state file if needed
pnpm tsx scripts/runbook-v3.ts init

# Auto-execute one phase per eligible plan (cron-safe every 5-10 min)
pnpm tsx scripts/runbook-v3.ts run

# Set a hard blocker on a plan
pnpm tsx scripts/runbook-v3.ts block \
  --plan=plan-123 \
  --blocker="Missing API credential" \
  --impact="Cannot execute phase-2" \
  --decision="Provide token or approve fallback" \
  --unblock="Add NOTION_API_KEY in .env"
```

## Auto-executor behavior

- Selects plans where `status in [approved, in_progress]`, `blocked=false`, `status!=done`
- Uses execution lock file (`state/approved-plans.lock`) to prevent concurrent runners
- Uses per-plan phase lock (`executionId + phaseLocks[currentPhase]`) for idempotency
- Advances **one phase per run** and writes transition events to `transitions[]`
- Prevents repeated approvals from re-running already completed phases
- On every transition, appends a progress block to Notion (`notionPageId`) when token exists
- If Notion credentials are missing, logs explicit no-op and continues

## Suggested cron (every 5 minutes)

```bash
*/5 * * * * cd /Users/tulioferro/.openclaw/workspace && pnpm tsx scripts/runbook-v3.ts run >> logs/runbook-v3.log 2>&1
```

## Testing

```bash
pnpm vitest run tests/scripts/runbook-v3.test.ts
```
