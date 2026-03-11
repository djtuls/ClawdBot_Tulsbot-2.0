# Topic Contract — Operations

- **topicId:** `telegram:-1003840777920:12`
- **status:** `active`
- **ownerMode:** `tulsday`

## Context scope

Human-domain operations: priorities, commitments, scheduling, follow-ups, reminders, and execution support.

## What belongs

- Human todo planning and sequencing.
- Commitment tracking, reminders, and owner/accountability updates.
- Meeting prep/follow-up actions and context-routing decisions.

## What does not belong

- Deep build implementation details, code-change logs, or infra execution streams.
- Deprecated-topic migration leftovers after cutover.

## Expected outputs

- Clear next actions with owner and due context.
- Risk-aware operational briefs.
- Escalations when commitments are at risk.

## Escalation rules

Escalate when:

1. a commitment is at risk within 24h,
2. ownership is ambiguous,
3. execution requires builder-only technical implementation,
4. cross-topic conflicts are detected.

## Regression checks

- Builder-only execution requests are routed to Builder / Orchestration.
- Deprecated topic references are replaced with active target topics.
- Cross-chat awareness refresh is considered before major routing decisions.
