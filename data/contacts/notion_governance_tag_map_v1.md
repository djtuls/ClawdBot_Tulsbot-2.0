# Notion Governance Tag Map v1

Applied to `contacts_tierA1_active` notes and inbox imprint seed.

- `governance/inft_hub` (umbrella)
- `domain/live-engine` when email domain is `@weareliveengine.com`
- `domain/creative-tools` when email domain is `@creativetoolsagency.com`
- `label/<family|important|contractor|...>` from contact label
- `role/contractor` when contractor flag is true
- `org/<fifa|concacaf|conmebol|afc|qvision|rws>` when detected
- `tier-a1-active` for active operational set

Inbox imprint seed priorities:

- P1: score >= 20 (score = email_hits\*2 + wa_hits)
- P2: score 5..19
- P3: score < 5
