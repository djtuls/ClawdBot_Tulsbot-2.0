# PRD: Capture Inbox OS

**Date:** 2026-03-04  
**Author:** Tulsbot (professional-writer skill)  
**Status:** Draft  
**Priority:** P0

---

## Problem Statement

Tulio’s inbox currently mixes high-signal messages (client decisions, active project threads, time-sensitive requests) with low-signal email (subscriptions, receipts, notifications, auto-generated updates). This creates two failures: important emails are easier to miss, and capture work (tasks, notes, requests, meeting prep) depends on manual triage. The system needs an opinionated Inbox OS that keeps only relevant items in the inbox, auto-organizes everything else, and escalates uncertain items through a human-in-the-loop queue.

## Goal

Run a deterministic + ML-assisted triage pipeline that keeps inbox focused on current priorities, auto-archives low-value mail with labels, and routes actionable content into execution and capture channels with confidence-based HITL review.

## Success Metrics

- **Inbox Signal Ratio:** ≥80% of messages remaining in inbox are classified as important/relevant.
- **Auto-Resolution Rate:** ≥65% of incoming mail is handled without manual triage (label/archive/route).
- **Missed Important Mail:** <1% false negatives (important mail incorrectly archived) in first 30 days.
- **HITL Throughput:** 95% of HITL queue reviewed within 24h.
- **Action Capture Latency:** Median <15 minutes from email receipt to task/note/request capture.
- **Manual Triage Time:** Reduce daily manual inbox triage by at least 50% in 4 weeks.

## Target Users / Stakeholders

- **Primary:** Tulio (operator), Tulsbot orchestration layer.
- **Secondary:** Project stakeholders across Live Engine + Creative Tools via downstream workflows (Notion, briefs, requests).
- **Approvers:** Tulio.

---

## System Architecture

### 1) Core Components

1. **Ingestion Layer**
   - Gmail push/poll listener (new message events + periodic reconciliation).
   - Pulls headers, sender metadata, thread context, body snippet/full body (on demand), and attachments metadata.

2. **Normalization & Enrichment Layer**
   - Canonical message object generation.
   - Sender identity resolution (known contacts, vendors, clients, no-reply systems).
   - Domain and sender reputation classes (internal, trusted external, transactional, promotional, unknown).

3. **Classification Engine (Hybrid)**
   - **Rule Engine (deterministic):** fast, explicit conditions for common categories.
   - **ML Scoring Layer:** relevance, urgency, intent, and routing predictions.
   - **Priority Model:** computes inbox retention score.
   - **Confidence Gate:** chooses auto-action vs HITL queue.

4. **Action Orchestrator**
   - Executes Gmail actions (label/archive/star/keep in inbox/mark important).
   - Sends structured payloads to capture channels:
     - Notion tasks
     - Notes bucket
     - Requests queue
     - PLAUD pipeline
     - Meeting brief generator

5. **HITL Queue + Control Console (MC tab)**
   - Queue for uncertain/low-confidence items.
   - Operator controls for override, rule tuning, project context assignment, and routing directives.

6. **Feedback & Learning Loop**
   - Capture override decisions.
   - Update rule weights/allowlists/blocklists and threshold calibration.

7. **Observability & Audit**
   - Event log per message decision path.
   - KPI dashboard + weekly drift report.

---

## Processing Stages (End-to-End)

### Stage 0 — Intake

- Receive new email event.
- De-duplicate (message-id/thread-id hash).
- Skip already-processed messages unless reprocessing requested.

### Stage 1 — Pre-filter

- Hard filters:
  - Spam/phishing indicators → spam/security label + archive (or isolate).
  - Auto-replies/out-of-office patterns → auto-label + archive.

### Stage 2 — Taxonomy Classification

Classify into primary buckets:

- `SUBSCRIPTION`
- `RECEIPT_INVOICE`
- `NEWSLETTER`
- `SOCIAL_NOTIFICATION`
- `SYSTEM_ALERT`
- `PERSONAL_THREAD`
- `CLIENT_PROJECT`
- `VENDOR_PARTNER`
- `REQUEST_ACTION`
- `MEETING_COMMS`
- `UNKNOWN`

### Stage 3 — Relevance + Priority Scoring

Compute:

- **Relevance Score (0–100):** business/personal importance to Tulio now.
- **Urgency Score (0–100):** deadline/time sensitivity.
- **Actionability Score (0–100):** explicit ask requiring execution.
- **Project Match Score (0–100):** fit to active WIP contexts (INF-2603, INF-Concacaf-2026, INF-Finalissima, CTA projects).

### Stage 4 — Decision Policy

- Determine disposition:
  - Keep in inbox
  - Label + archive
  - Label + keep in inbox
  - Route to capture channel + optional archive
  - HITL queue

### Stage 5 — Routing

If actionable/context-bearing:

- Create/update Notion task
- Create note (reference + summary)
- Add request item
- Push transcript/insight to PLAUD pipeline
- Generate/update meeting brief seed

### Stage 6 — Post-Action Verification

- Confirm action execution.
- Log full decision trace.
- Emit metrics.

### Stage 7 — HITL Resolution Loop

- Present uncertain decisions with recommendation + confidence.
- Human resolves; system applies decision and records training signal.

---

## Rule Engine Design (Deterministic Layer)

### Rule Priority Order

1. **Safety rules** (phishing/spoofing/high-risk patterns)
2. **Sender trust rules** (VIP contacts, internal domains, known clients)
3. **Transactional patterns** (receipts, invoices, shipping, payment confirmations)
4. **Subscription/newsletter patterns**
5. **Project and workstream keyword/entity match**
6. **Fallback to ML classifier + HITL gate**

### Example Rules

- **R-001 VIP Keep-In-Inbox**
  - If sender in `vip_senders` OR thread contains `decision needed` marker from known stakeholder
  - Then: label `INBOX/PRIORITY`, keep in inbox, boost priority.

- **R-010 Receipt Auto-Archive**
  - If from known transactional domain OR subject matches `(receipt|invoice|payment confirmation|order #)`
  - Then: label `AUTO/FINANCE`, archive, route metadata to finance log (optional).

- **R-020 Subscription Auto-Archive**
  - If `List-Unsubscribe` header present AND sender not allowlisted AND no active project keyword match
  - Then: label `AUTO/SUBSCRIPTIONS`, archive.

- **R-030 Project Routing**
  - If project entity confidence > threshold and contains action request
  - Then: label `WIP/<project>`, keep in inbox or route to task queue based on priority.

- **R-040 Meeting Brief Trigger**
  - If meeting invite/thread detected with participants + agenda/date hints
  - Then: route to Meeting Brief pipeline and label `CAPTURE/MEETING`.

- **R-099 Uncertain Fallback**
  - If conflict between rules or low confidence
  - Then: send to HITL queue with top-2 recommendations.

---

## Priority Model

### Inputs

- Sender tier (VIP/client/partner/unknown/system)
- Thread recency + unresolved replies
- Presence of direct ask or deadline
- Mention of active projects/workspaces
- Contract/commercial risk terms (approval, quote, payment hold, legal)
- Calendar proximity (events in next 14 days)

### Priority Formula (initial)

`PriorityScore = 0.30*Relevance + 0.25*Urgency + 0.20*Actionability + 0.15*ProjectMatch + 0.10*SenderTierBoost`

### Priority Bands

- **P0 (85–100):** keep in inbox + alert
- **P1 (70–84):** keep in inbox + label
- **P2 (45–69):** label + archive or route to capture
- **P3 (<45):** auto-archive (label retained)

---

## Confidence Thresholds & Decision Gate

- **High confidence (>=0.90):** auto-execute full action plan.
- **Medium confidence (0.70–0.89):** auto-label + conservative action, queue silent review batch.
- **Low confidence (<0.70):** no destructive archive action without HITL.
- **Conflict confidence rule:** if top-2 class probabilities delta <0.15 → HITL required.

### Inbox Protection Guardrails

- Never archive if:
  - sender is VIP/trusted and thread unresolved
  - email contains explicit question to Tulio
  - deadline within 72h and confidence <0.9
- For first rollout phase: maintain **soft archive mode** (recoverable label + 7-day rollback query).

---

## HITL UX (Human-in-the-Loop)

### Queue Design

Each queue item includes:

- Message summary (who/what/why now)
- Predicted class + confidence
- Proposed action (label/archive/route)
- Risk badge (low/med/high)
- One-click alternatives

### Review Actions

- Approve recommendation
- Override class
- Override routing target
- Mark sender rule (`always inbox`, `always archive`, `always route to X`)
- Assign project context
- Snooze / revisit

### UX Priorities

- Batch actions (approve all similar)
- Keyboard-first quick triage
- Explainability snippet: “because sender + keywords + prior decisions”
- Daily digest of unresolved HITL items

### SLA

- High-risk HITL items: review <4h
- Standard HITL items: review <24h

---

## Taxonomy & Project Context Model

### A) Message Taxonomy

**Level 1 (Intent):**

- Informational
- Action Required
- Decision Required
- Scheduling
- Financial/Transactional
- Promotional

**Level 2 (Domain):**

- Client Project
- Internal Ops
- Vendor/Partner
- Finance/Admin
- Personal

**Level 3 (Subtype):**

- Approval, Contract, Invoice, Travel, Newsletter, Receipt, Brief Input, Feedback, etc.

### B) Project Context Graph

Entities:

- `Project` (INF-2603, INF-Concacaf-2026, INF-Finalissima, CTA-\*)
- `Company` (Live Engine, Creative Tools Agency)
- `Workstream` (Production, Logistics, Contracts, Finance, Creative, Tech)
- `Contact` (role, organization, trust tier)
- `Deliverable` (brief, quote, timeline, deck, task)

Relationships:

- Email → Project (confidence)
- Email → Workstream
- Email → Required Outcome (task/note/decision/meeting)

### C) Context Assignment Strategy

- **Auto-assignment:** when project match confidence >=0.8.
- **Suggested assignment:** 0.5–0.79, goes to HITL suggestion.
- **No assignment:** <0.5, stays unassigned until clarified.

---

## Routing Map (Capture Channels)

| Trigger Condition                          | Target Channel | Payload                                                 |
| ------------------------------------------ | -------------- | ------------------------------------------------------- |
| Explicit to-do / deliverable / follow-up   | Notion Tasks   | title, due, owner, project, email link, summary         |
| Reference info, idea, background material  | Notes          | structured note with source + tags                      |
| External ask needing response/coordination | Requests Queue | requester, ask, urgency, suggested owner                |
| Voice memo/transcript/insight request      | PLAUD Pipeline | transcript source, extraction task, context tags        |
| Meeting setup / pre-read / agenda thread   | Meeting Briefs | participants, objectives, key decisions, open questions |

### Canonical Routing Payload (minimum)

- `source_message_id`
- `thread_id`
- `from`
- `subject`
- `summary`
- `intent`
- `project_context`
- `priority_band`
- `confidence`
- `deep_link_to_email`

---

## MC Control Tab — Exact Field Schema

Purpose: single operator control surface to direct flow logic, assign context/projects, and tune automation safely.

### Schema (v1)

```yaml
mc_control_tab:
  tab_meta:
    tab_id: string # e.g. MC-CTRL-001
    version: string # schema version, e.g. 1.0.0
    updated_at: datetime
    updated_by: string

  global_controls:
    automation_mode: enum # OFF | SHADOW | SAFE_AUTO | FULL_AUTO
    archive_guard_mode: enum # STRICT | BALANCED | AGGRESSIVE
    default_confidence_threshold: float # 0.0-1.0
    low_confidence_hitl_threshold: float # 0.0-1.0
    medium_confidence_review_threshold: float # 0.0-1.0
    vip_never_archive: boolean
    dry_run_routing: boolean
    hitl_sla_hours: integer

  inbox_policy:
    keep_in_inbox_priority_min: integer # 0-100
    unresolved_thread_protection: boolean
    deadline_protection_hours: integer
    max_inbox_items_target: integer
    auto_archive_delay_minutes: integer # optional grace window

  taxonomy_map:
    class_id: string # unique class key
    class_name: string # e.g. RECEIPT_INVOICE
    default_label: string # Gmail label path
    default_action: enum # KEEP | ARCHIVE | ROUTE | HITL
    default_route_target: enum # NONE | NOTION | NOTES | REQUESTS | PLAUD | MEETING_BRIEF
    priority_override: integer|null # 0-100 optional
    active: boolean

  project_context_registry:
    project_id: string # INF-2603, INF-CONCACAF-2026...
    project_name: string
    company: enum # LIVE_ENGINE | CTA | PERSONAL
    workstreams: string[]
    keywords: string[]
    domains: string[] # known project email domains
    contacts: string[] # key stakeholders emails
    default_route_target: enum
    active: boolean

  sender_policies:
    sender_key: string # exact email or domain
    sender_type: enum # VIP | TRUSTED | TRANSACTIONAL | PROMOTIONAL | UNKNOWN
    action_override: enum # KEEP | ARCHIVE | HITL | FOLLOW_CLASS
    label_override: string|null
    route_override: enum|null # NOTION | NOTES | REQUESTS | PLAUD | MEETING_BRIEF
    project_override: string|null # project_id
    priority_boost: integer # -20..+20
    never_archive: boolean
    active: boolean

  rule_controls:
    rule_id: string # R-001 etc.
    enabled: boolean
    precedence: integer
    confidence_min: float # execution minimum
    hitl_on_conflict: boolean
    cooldown_minutes: integer # prevent flapping on repeated threads

  hitl_queue_controls:
    queue_enabled: boolean
    require_reason_on_override: boolean
    batch_approve_limit: integer
    high_risk_keywords: string[]
    escalation_channels: string[] # e.g. telegram id/channel

  routing_templates:
    route_target: enum # NOTION | NOTES | REQUESTS | PLAUD | MEETING_BRIEF
    template_id: string
    required_fields: string[]
    optional_fields: string[]
    dedupe_window_hours: integer

  audit_controls:
    log_level: enum # BASIC | FULL_TRACE
    retain_days: integer
    sample_rate: float # 0.0-1.0 for deep trace sampling
    export_destination: string # table/path

  overrides:
    message_id: string
    forced_action: enum # KEEP | ARCHIVE | ROUTE | HITL
    forced_label: string|null
    forced_project: string|null
    forced_route_target: enum|null
    reason: string
    expires_at: datetime|null
```

### Required Columns (if implemented as table)

| Column     | Type     | Required | Notes                                                    |
| ---------- | -------- | -------- | -------------------------------------------------------- |
| id         | string   | yes      | unique row id                                            |
| scope      | enum     | yes      | GLOBAL, TAXONOMY, PROJECT, SENDER, RULE, ROUTE, OVERRIDE |
| key        | string   | yes      | lookup key (rule_id/sender/project/class)                |
| value_json | json     | yes      | structured config payload                                |
| active     | boolean  | yes      | toggle without deletion                                  |
| version    | int      | yes      | optimistic locking                                       |
| updated_at | datetime | yes      | audit                                                    |
| updated_by | string   | yes      | audit                                                    |

---

## Rollout Plan

### Phase 0 — Baseline Instrumentation (Days 1–3)

- Log-only ingestion and classification.
- No automated archive actions.
- Collect labeled sample + evaluate baseline precision/recall.

### Phase 1 — Safe Automation (Week 1)

- Enable deterministic handling for obvious classes (receipts/subscriptions/newsletters).
- Keep strict guardrails for VIP/active project threads.
- HITL for medium/low confidence.

### Phase 2 — Context Routing (Week 2)

- Enable Notion/notes/requests/meeting routing.
- Introduce project auto-assignment + MC overrides.

### Phase 3 — Priority Optimization (Weeks 3–4)

- Tune priority formula and thresholds.
- Add batch HITL UX and explanation quality improvements.

### Phase 4 — Full Auto with Audits (Month 2)

- Expand auto-actions with audited confidence.
- Weekly drift checks and sender policy tuning.

---

## Risks & Dependencies

| Risk                                       | Likelihood | Mitigation                                                  |
| ------------------------------------------ | ---------- | ----------------------------------------------------------- |
| False negatives archive important email    | Medium     | strict guardrails + soft-archive rollback + VIP protections |
| Over-routing noise into Notion             | Medium     | dedupe windows + route confidence threshold                 |
| Rule/ML conflict causing unstable behavior | Medium     | precedence model + conflict-to-HITL fallback                |
| Taxonomy drift over time                   | High       | weekly review + retraining/retuning loop                    |
| Integration failures with capture channels | Low        | retry queue + dead-letter log + idempotent payload ids      |

Dependencies:

- Gmail API access and labels setup
- Notion/notes/requests/plaud/meeting-brief integration endpoints
- Persistent config store for MC control tab
- Observability storage (metrics + audit logs)

---

## Out of Scope (v1)

- Full autonomous response drafting/sending.
- Multi-mailbox orchestration beyond Tulio’s main accounts.
- Attachment OCR/deep document understanding for all files (only metadata + selective extraction in v1).

---

## 48h Implementation Checklist (Short)

1. **Set foundation**
   - [ ] Create canonical message schema + processing log table.
   - [ ] Create initial Gmail labels (`AUTO/*`, `WIP/*`, `CAPTURE/*`, `HITL/*`).

2. **Implement deterministic core**
   - [ ] Add top 10 rules (VIP, receipts, subscriptions, newsletters, meeting trigger).
   - [ ] Implement guardrails: never-archive conditions + soft archive mode.

3. **Stand up HITL queue (MVP)**
   - [ ] Build queue view with approve/override/project-assign actions.
   - [ ] Save overrides to policy store.

4. **Enable first routing targets**
   - [ ] Notion task route (with dedupe).
   - [ ] Meeting brief seed route.
   - [ ] Notes route (minimal schema).

5. **MC control tab v1**
   - [ ] Implement global controls + sender policy + taxonomy map fields.
   - [ ] Add edit audit trail (`updated_by`, `updated_at`, `version`).

6. **Measure immediately**
   - [ ] Dashboard: inbox signal ratio, auto-resolution, HITL backlog, false negative count.
   - [ ] Run 1st threshold calibration after 24h of traffic.

---

## Done-When Criteria

- Deterministic rules handle obvious low-signal emails with <1% important-message misses.
- Inbox mostly contains P0/P1 items tied to active work.
- HITL queue captures ambiguous items with clear recommendations.
- At least three capture routes (Notion, notes, meeting briefs) running end-to-end with traceable payloads.
- MC control tab can tune thresholds, sender policies, taxonomy behavior, and project assignment without code changes.
