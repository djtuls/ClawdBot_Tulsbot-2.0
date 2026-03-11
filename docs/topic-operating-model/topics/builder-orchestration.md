# Topic Contract — Builder / Orchestration

- **topicId:** `telegram:-1003840777920:40`
- **status:** `active`
- **ownerMode:** `builder`

## Context scope

System/build delivery: architecture decisions, code changes, scripts, infra operations, CI/CD, automation execution.

## What belongs

- Implementation plans and execution logs for build/system work.
- PR readiness, migration scripts, runbook hardening, automation changes.
- Technical blockers requiring system-level decisions.

## What does not belong

- Human personal planning, commitments, reminders, or follow-ups not tied to build execution.
- Generic catch-all chatter with no concrete system/build objective.

## Expected outputs

- Shippable code/docs/runbook changes.
- Clear risk/verification notes.
- Actionable blocker packets (decision + impact + fastest unblock).

## Escalation rules

Escalate to Tulio immediately when:

1. destructive change is required,
2. secrets/credentials are missing,
3. policy conflict exists,
4. there is uncertainty on ownership for a high-impact action.

## Regression checks

- No tulsday-owned tasks posted here unless directly linked to build execution.
- No updates posted to deprecated topics as fallback.
- Cross-chat implications captured in `reports/cross-chat-delta.md` when relevant.
