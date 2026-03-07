# Discord Outbound Approval Gate

## Default mode

**Draft-only outbound** for high-impact and/or ambiguous actions.

## Requires explicit approval (`APPROVE <id>`)

1. Deleting non-empty channels/categories.
2. Renaming/moving protected channels.
3. Bulk IA changes (3+ non-empty entities).
4. Any action with unclear ownership or potential historical loss.
5. Cross-surface messaging actions blocked by runtime policy (e.g., Telegram-bound session posting to Discord).
6. Any outbound email send action requested from Discord.

### Email-specific governance rule (2026-03-07)

- Authorized sender mailbox for outbound email: **`tulsbot@gmail.com` only**.
- Outbound email requires an **explicit Tulio command** to send.
- Without explicit send command, produce draft-only output.

## Rejection command

- `REJECT <id>` cancels queued action.

## Approval packet format

Every high-risk proposal must include:

- `id`: unique action id
- `action`: move/rename/delete/post/pin
- `target`: channel/category id + name
- `evidence`: usage/duplication/policy rationale
- `rollback`: exact rollback steps

## Auto-allowed (no approval)

- Read-only audits/snapshots.
- Temporary probe artifacts for permission tests (must be deleted in same run).
- Deleting empty, clearly duplicate legacy categories/channels with audit evidence.
- Workspace-local governance file updates.

## Active approval queue

- `DC-MIGRATE-001` - enable Discord-first runtime delivery for daily operations while retaining Telegram ingress fallback.

## Approved/applied

- `DC-CONTRACT-001..011` - published and pinned in core Discord channels (executed 2026-03-07).
- `DC-AUTO-001` - cron/system-event delivery remap to Discord-primary approved and applied (executed 2026-03-07).

## Logging

All approved/rejected actions must be written to `memory/discord/audit-log-*.md` with before/after IDs and rationale.
