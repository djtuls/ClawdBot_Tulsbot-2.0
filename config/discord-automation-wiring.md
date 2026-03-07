# Discord Automation Wiring Plan (Phase 4)

## Objective

Map daily briefing, reporting, enrichment, and maintenance automations to canonical Discord channels while keeping Telegram as ingress/backup.

## Channel Wiring Map

- **Daily briefing**
  - Primary channel: `#daily-standup` (`1476394151300956250`)
  - Backup mirror: Telegram Daily Briefs topic
- **Daily reporting**
  - Primary channel: `#daily-reports` (`1476422877254389954`)
  - Escalation channel: `#hitl` (`1476426082705211423`) for anomalies
- **Research enrichment**
  - Primary channel: `#research` (`1476394064659349557`)
  - If execution needed: route actionables to `#tasks`
- **System maintenance/health**
  - Primary channel: `#heartbeat-reports` (`1476409757043789874`)
  - Critical incidents: `#system-status` (`1469735004459368562`) + Telegram urgent ping

## Proposed Scheduling (workspace-safe; no external config mutation applied)

1. 06:00 local - morning brief -> post to `#daily-standup`
2. 12:00 local - midday sync summary -> post to `#daily-standup`
3. 18:00 local - evening report -> post to `#daily-reports`
4. Hourly - heartbeat summary (issues only) -> `#heartbeat-reports`
5. Nightly 22:00 - enrichment digest -> `#research`
6. Nightly 23:00 - maintenance report -> `#heartbeat-reports`

## System-Event Hooks (proposed)

- Capture inbox event with "high urgency" -> `#requests`
- Governance gate "blocked" event -> `#hitl`
- Failed cron job event -> `#system-status`
- New project risk discovered -> `#daily-standup` + linked thread in project channel

## Acceptance Checklist

- [ ] Every automation has one canonical Discord channel owner
- [ ] Telegram messages include source tag and are mirrored into Discord
- [ ] No automation posts to protected channels outside channel contract scope
- [ ] Approval-gated actions emit APPROVE/REJECT id packets
- [ ] Workflow validation report updated with pass/fail evidence
