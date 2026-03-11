# GOVERNANCE.md — Unified Operating Governance

Status: Active (consolidation-only)
Owner: Tulio
Scope: Tulsbot/OpenClaw runtime behavior, communication, capture intake, and risk controls.

> This file consolidates active governance across OPERATOR_PROTOCOL, RUNBOOK Discord/capture sections, and `config/discord-*` policy files.
> It does **not** introduce new policy; it is a single reference point.

## 1) Decision Authority

### Requires explicit approval (`APPROVE <id>`)

- Destructive/system-impacting actions.
- Deleting non-empty channels/categories.
- Renaming/moving protected channels.
- Bulk IA changes (3+ non-empty entities).
- Outbound risky actions with unclear ownership.
- Cross-surface posting when runtime policy blocks direct action.
- Any outbound email send action.

### Rejection

- `REJECT <id>` cancels queued action and must include rationale in audit log.

### Auto-allowed

- Read-only audits/snapshots.
- Local workspace policy/doc updates.
- Low-risk internal triage actions.

## 2) Communication Policy

### Surface priority

- Telegram DM = canonical operational execution surface.
- Optional Telegram alerts channel = P0/P1 incidents only.
- Discord = dormant/archived for now (no active automation routing).

### Email authority

- Authorized sender mailbox: `tulsbot@gmail.com` only.
- Sending email requires explicit Tulio send command.
- Otherwise: draft-only.

### Notification behavior

- Draft-only for risky outbound.
- Approval packet must include: `id`, `action`, `target`, `evidence`, `rollback`.

## 3) Data Write Policy

### General

- Correctness > speed.
- Evidence-first actions.
- Rollback-first for meaningful changes.

### Shared state safety

- Workspace lease/single-writer guard for key state writers.
- Avoid split-brain by keeping one active execution brain for shared-state mutation.

### Durability

- Log directives/decisions/outcomes in memory files.
- Keep event-log writes schema-safe and non-breaking.

## 4) Capture Intake Rules

### Capture quality

- Keep high-signal context; avoid promo/junk ingestion.
- Preserve action visibility and do not bury true action items.

### Routing defaults

- `TODO.md + STATE.md` are master operational source-of-truth.
- External task apps (Todoist/Apple Reminders/Things) are queried explicitly by user intent.

### Context handling

- Context-only captures are valid and should be stored durably when no action is needed.

## 5) Discord Governance Contracts (Dormant Archive)

Discord contracts are retained as archived references while Discord routing is paused.

### Context isolation

- One context per channel/thread.
- Cross-context references require explicit marker:
  - `context-link: discord:<channel-id>/<thread-id>`

### Protected channels (no structural changes without explicit approval)

- `daily-standup`
- `inbox-capture`
- `builder`
- `research`
- `daily-reports`
- `tulsday`

### Canonical routing (high level)

- Briefs -> `#daily-standup`
- Reports -> `#daily-reports`
- Research -> `#research`
- PRDs -> `#prd`
- Tasks -> `#tasks`
- Triage -> `#requests`
- Approvals -> `#hitl`

## 6) Security & Secrets

- Never exfiltrate private data.
- No destructive commands without explicit confirmation.
- Prefer recoverable operations.
- Secrets must be stored via approved secret tooling and never echoed in full.

## 7) Emergency / Drift Procedures

If behavior or system state drifts:

1. Acknowledge drift immediately.
2. Apply corrective action in the same interaction/run.
3. Record correction to durable memory and handoff.

If invariant violations occur:

- Attempt auto-fix first.
- If unresolved, escalate via system health channel with concise blocker + impact + unblock path.

## 8) Canonical References (deep)

- `OPERATOR_PROTOCOL.md`
- `RUNBOOK.md`
- `config/discord-channel-contracts.md`
- `config/discord-context-isolation.md`
- `config/discord-routing-conventions.md`
- `config/discord-outbound-approval-gate.md`
- `config/discord-automation-wiring.md`
