# Hybrid Topic Operating Model

Canonical map: `config/topic-operating-model.json`

This model enforces explicit ownership between **tulsday** (human-domain execution) and **builder** (system/build execution), while retaining controlled shared context via cross-chat refresh.

## Status classes

- `active`: allowed for new work
- `deprecated`: visible for migration only; blocked for new work
- `archived`: retained for historical lookup only

## Mandatory guardrails

- Mode ownership must match topic owner mode (`shared` is the only exception).
- New posts must not land in deprecated topics.
- Cross-chat awareness must refresh regularly from `reports/cross-chat-delta.md`.
- Each active topic must keep scope boundaries and regression checks up to date.

Run audit snapshot:

```bash
cd /Users/tulioferro/.openclaw/workspace
pnpm tsx scripts/topic-guardrails-audit.ts
```

Outputs:

- `reports/topic-guardrails-snapshot.md`
- `state/topic-guardrails-audit.json`
- `reports/topic-status-update.md`
