# Idea Registry

Last updated: 2026-03-06 (Australia/Brisbane)

## Active Ideas

### 1) Capture Inbox Governance Control Plane (One-stop governance hub)

- **Status:** Approved to execute
- **Origin:** DM + CRM topic (@idea)
- **Goal:** Prevent idea loss and reduce capture noise with explicit source-level governance.
- **Scope:** WhatsApp groups, Email senders/domains, Meetings, Calls/Plaud.

#### Core design

- Notion-backed governance layer with explicit rules per source.
- `Monitor Mode`: Monitor | Archive | Ignore
- `Processing Depth`: Full Transcript | Summary | Action Items Only | Skip
- `Sensitivity`: Normal | Confidential | Restricted
- `Routing`: CRM / Notion / Todoist / Vault
- `Retention`: keep duration + archival policy
- `Owner`: governance owner/override authority

#### Execution intent

- Monitor => ingest + extract highlights/actions/decisions.
- Archive/Ignore => skip from capture inbox pipeline.
- Mirror only high-value updates to Telegram topics; suppress empty FYI.

#### Next concrete steps

1. Define Notion schema (Contacts, WhatsApp Groups, Capture Highlights, Calls governance fields).
2. Implement inbox router gating against governance rules.
3. Pilot with top 3 WA groups + 1 Plaud flow.
4. Tune extraction/routing and document SOP.

---

## Operating Rule (Do not lose ideas)

- Any message tagged `@idea` in DM is immediately:
  1. logged in this registry,
  2. mirrored to the relevant Telegram topic,
  3. added to TODO/workstream if approved for execution.
