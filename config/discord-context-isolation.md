# Discord Context Isolation Policy

## Scope

Guild: `1469708768173363343`

## Enforced rules

1. **One context per channel/thread**
   - Every channel/thread has a single context domain.
2. **Cross-context explicit link required**
   - Any reference outside current context must include:
   - `context-link: discord:<channel-id>/<thread-id>`
3. **No cross-domain leakage**
   - Personal (`🏠 Personal Life`) and business/project channels must remain isolated unless explicitly linked.
4. **Project boundaries**
   - INFT / Live Engine / CTA channels remain domain-scoped.
5. **Protected channels structurally locked**
   - `daily-standup`, `inbox-capture`, `builder`, `research`, `daily-reports`, `tulsday` cannot be moved/renamed/deleted without explicit approval.

## Routing conventions

- Briefs -> `#daily-standup`
- Reports -> `#daily-reports`
- Research -> `#research`
- PRDs -> `#prd`
- Tasks -> `#tasks`
- Triage -> `#requests`
- Human approvals -> `#hitl`

## Governance controls

- Structural changes must be logged with rationale and before/after IDs.
- Ambiguous or risky actions are draft-only and require `APPROVE <id>`.
- Any rejected action is logged with `REJECT <id>` + rationale.

## Validation tests (policy level)

- Test CI-01: all core channels mapped to a single contract -> PASS
- Test CI-02: protected channel lock list unchanged from Phase 0 manifest -> PASS
- Test CI-03: cross-context operations require explicit `context-link` marker -> PASS (spec validation)
- Test CI-04: risky action template includes `APPROVE <id>`/`REJECT <id>` -> PASS

## Notes

Live Discord publish/pin operations are queued as approval packets because cross-surface posting from the current Telegram-bound session is blocked by policy controls.
