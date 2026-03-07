# SOP-003 — Notion Command-Loop + Capture Hardening

**Owner:** Tulsbot  
**Effective Date:** 2026-03-07  
**Scope:** Notion Phase-1 schema fields, CRM routing control-plane, command-loop execution, and capture hardening.

## 1) Phase-1 schema apply (schema-only)

Run:

```bash
pnpm tsx scripts/integrations/notion-phase1-schema.ts
```

Behavior:

- Ensures fields exist on writable DBs:
  - AI Command
  - AI Status
  - Tulio's Notes
  - Tulsbot Notes
  - Last AI Run At
  - AI Evidence Links
- Respects read-only policy:
  - Project Grid: read-only verification
  - Meetings: read-only verification

Evidence output:

- `reports/notion/phase1-schema-YYYY-MM-DD.json`

## 2) CRM routing control-plane

Run:

```bash
pnpm tsx scripts/integrations/crm-routing-sync.ts
```

Behavior:

- Classifies contacts into taxonomy: family/work/inft/sales/vendor/partner/media/friend/ignore/unknown
- Writes routing into contact page properties (no interactions DB):
  - Relationship Type (category)
  - Domain (route target)
  - Priority
  - Tulsbot Notes (mapping summary)

Evidence output:

- `reports/notion/crm-routing-sync-YYYY-MM-DD.json`

## 3) Notion command-loop runner

Run:

```bash
pnpm tsx scripts/integrations/notion-command-loop-runner.ts
```

Trigger condition:

- `AI Command = "Tulsbot Action Requested"`
- `AI Status in [Pending, In Progress]`

Instruction source:

- Reads first non-empty line from `Tulio's Notes`

Supported actions:

- `archive`
- `to_super_inbox` (blocked when policy disallows direct writes)
- `contact_summary:<contactPageId>|<summary text>`

Post-run writes:

- Tulsbot Notes
- AI Evidence Links
- Last AI Run At
- AI Status
- AI Command (completion marker)

Evidence output:

- `reports/notion/command-loop-YYYY-MM-DD.json`

## 4) Capture hardening validation

Run:

```bash
pnpm tsx scripts/integrations/validate-capture-flow.ts
```

Checks:

- Control-plane config exists
- Capture + Super Inbox DB IDs configured
- DB separation or explicit override
- Router guard present

Evidence output:

- `reports/notion/capture-flow-validation-YYYY-MM-DD.json`

## 5) Regression tests

Run:

```bash
pnpm vitest run src/integrations/crm-control-plane.test.ts src/integrations/capture-flow-policy.test.ts
```

Pass criteria: all tests green.
