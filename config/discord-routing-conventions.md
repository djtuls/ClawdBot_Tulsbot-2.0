# Discord Routing Conventions (Guild 1469708768173363343)

## Canonical Routing

- **Briefs / daily operating context** -> `#daily-standup` (`1476394151300956250`)
- **Raw intake / captures** -> `#inbox-capture` (`1476422591765024789`)
- **Human approvals / risk decisions** -> `#hitl` (`1476426082705211423`)
- **Product/feature specs (PRD)** -> `#prd` (`1476422032878076066`)
- **Execution tasks** -> `#tasks` (`1476422035210113055`)
- **Backlog grooming** -> `#backlog` (`1476422040591274075`)
- **Inbound requests triage** -> `#requests` (`1476422037747798116`)
- **Research investigations** -> `#research` (`1476394064659349557`)
- **Daily reporting outputs** -> `#daily-reports` (`1476422877254389954`)
- **Builder orchestration** -> `#builder` (`1476394231726735431`)
- **Context manager operation** -> `#tulsday` (`1476394237590372412`)

## Context Isolation and Links

- One context per channel/thread.
- Cross-context references must include explicit link marker:
  - `context-link: discord:<channel-id>/<thread-id>`
- No context copy/paste between business domains unless routed via `#hitl` and approved.

## Telegram fallback (ingress only)

- Telegram remains ingress/backup only.
- Any operational Telegram message must be mirrored to its canonical Discord channel with source tag:
  - `source: telegram:<chat-id>/<topic-id>`

## Safety Gate

- Draft-only for risky outbound actions.
- Approval commands:
  - `APPROVE <id>`
  - `REJECT <id>`
