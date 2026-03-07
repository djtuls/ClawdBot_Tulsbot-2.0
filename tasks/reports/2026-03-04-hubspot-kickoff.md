# HubSpot Kickoff Plan — Tulio

**Date:** 2026-03-04  
**Owner:** Tulio / Tulsbot  
**Status:** Ready to execute

## Executive Summary

HubSpot should start as a **lean operating CRM** for two immediate outcomes: (1) move new opportunities to close with clear ownership and follow-up discipline, and (2) track post-sale project delivery for Live Engine / Creative Tools so execution risk is visible early. Keep week 1 tight: one sales pipeline, one delivery pipeline, must-have fields only, and 4–6 core workflows. Avoid over-modeling until real deal flow generates evidence. By Day 7, Tulio should have: active pipelines, standardized records, automated next-step reminders, and one live dashboard for weekly decision-making.

---

## 1) Recommended Project Scope

### In scope (Kickoff v1)

1. **CRM foundation**
   - Contacts, Companies, Deals setup and field standards.
   - Ownership model (Deal Owner + Delivery Owner).
2. **Sales pipeline (single source of truth)**
   - Opportunity stages from lead intake to closed won/lost.
3. **Project Delivery pipeline (post-sale ops)**
   - Hand-off from closed won to delivery execution states.
4. **Core automation**
   - Task reminders, stage-entry actions, stale-deal alerts, won-deal handoff.
5. **Weekly reporting baseline**
   - Pipeline health, forecast by month, and delivery risk view.

### Out of scope (for now)

- Full marketing automation and lead scoring.
- Advanced custom objects.
- Complex CPQ / quote automation.
- Deep integrations (finance/ERP) before data model stabilizes.

---

## 2) CRM Pipeline Stages

## A. Sales Pipeline (Deals)

1. **New / Unqualified**
   - Inbound or identified lead, basic data incomplete.
2. **Qualified Discovery**
   - Fit confirmed, key context captured (budget window, timeline, decision process).
3. **Solution & Scope Drafted**
   - Initial approach prepared; high-level scope documented.
4. **Proposal Sent**
   - Proposal/estimate delivered; follow-up date set.
5. **Negotiation / Procurement**
   - Commercial/legal alignment in progress.
6. **Verbal Commit**
   - Client intent confirmed; awaiting final paperwork/PO.
7. **Closed Won**
   - Converted to active delivery pipeline.
8. **Closed Lost**
   - Loss reason mandatory.

## B. Project Delivery Pipeline (Deals in second pipeline)

1. **Handoff Pending**
   - Sales won; delivery packet not yet complete.
2. **Kickoff Scheduled**
   - Internal/external kickoff date set.
3. **Planning & Dependencies**
   - Scope breakdown, vendors/approvals mapped.
4. **In Execution**
   - Active delivery period.
5. **Client Review / Change Requests**
   - Revisions or approvals loop.
6. **Delivered**
   - Core deliverables complete.
7. **Closed / Archived**
   - Financial + documentation wrap-up done.

---

## 3) Must-Have Properties / Fields

## A. Deal properties (Sales + Delivery)

- **Business Unit** (Live Engine / Creative Tools)
- **Deal Type** (Event Production / Creative Tech / Consulting / Retainer)
- **Lead Source**
- **Primary Service Line**
- **Estimated Value**
- **Target Close Date**
- **Deal Owner**
- **Delivery Owner**
- **Proposal Sent Date**
- **Next Step** (single-line text)
- **Next Step Due Date**
- **Priority** (High/Medium/Low)
- **Confidence %** (manual, simple forecast quality)
- **Loss Reason** (required on Closed Lost)

## B. Delivery-specific properties

- **Project Start Date**
- **Project End Date**
- **Delivery Status RAG** (Green/Amber/Red)
- **Dependency Blocker** (Yes/No)
- **Key Risk Note**
- **Last Client Update Date**
- **Postmortem Completed** (Yes/No)

## C. Company/Contact minimums

- Company: Segment, Country/Region, Relationship status.
- Contact: Role in decision process (Decision Maker / Influencer / Ops).

---

## 4) Automations / Workflows to Set First

1. **Deal creation hygiene**
   - Trigger: new deal created.
   - Action: enforce required fields (Business Unit, Deal Owner, Target Close Date, Next Step Due Date).

2. **Stage-entry task generation**
   - Trigger: move to “Proposal Sent”.
   - Action: create follow-up task due in 2 business days.

3. **Stale opportunity alert**
   - Trigger: no activity for 7 days on open deals.
   - Action: notify owner + set “At Risk” task.

4. **Closed Won handoff automation**
   - Trigger: deal = Closed Won.
   - Action: copy/initialize delivery fields, move/clone into Delivery Pipeline, create kickoff checklist task bundle.

5. **Delivery risk escalation**
   - Trigger: Delivery Status RAG = Red OR Dependency Blocker = Yes.
   - Action: immediate notification to Tulio + delivery owner, create mitigation task.

6. **Weekly pipeline digest**
   - Trigger: weekly schedule.
   - Action: summary email/report (new deals, stage changes, stuck deals, won/lost, red delivery projects).

---

## 5) 7-Day Implementation Checklist

## Day 1 — Model & Rules

- [ ] Confirm scope (sales + delivery only).
- [ ] Create/clean core properties.
- [ ] Define stage exit criteria per pipeline.

## Day 2 — Build Pipelines

- [ ] Configure Sales pipeline stages.
- [ ] Configure Delivery pipeline stages.
- [ ] Set required fields by stage.

## Day 3 — Migrate Active Work

- [ ] Add active opportunities and projects from current trackers.
- [ ] Assign Deal Owner + Delivery Owner to every active record.
- [ ] Validate close dates and next-step dates.

## Day 4 — Core Workflows

- [ ] Implement first 4 workflows (hygiene, follow-up, stale alert, won handoff).
- [ ] Test with sample deals.

## Day 5 — Delivery Controls + Dashboard

- [ ] Add delivery risk escalation workflow.
- [ ] Build dashboard: open pipeline by stage, forecast, stale deals, delivery RAG.

## Day 6 — Live Run

- [ ] Run one real update cycle with current opportunities.
- [ ] Fix friction points (field overload, unclear stage transitions, notification noise).

## Day 7 — Operationalize

- [ ] Final SOP: “How we update deals daily / review weekly”.
- [ ] Lock v1 field dictionary.
- [ ] Schedule weekly HubSpot review ritual with Tulio.

---

## 6) Risks and Dependencies

## Risks

1. **Over-customization too early**
   - Impact: complexity, low adoption.
   - Mitigation: v1 = must-have fields only.

2. **Inconsistent data entry**
   - Impact: unreliable dashboards/forecast.
   - Mitigation: required fields + stage-entry checks.

3. **Pipeline not tied to real operating rhythm**
   - Impact: tool becomes passive database.
   - Mitigation: weekly review cadence + owner accountability.

4. **No clean handoff between sales and delivery**
   - Impact: execution delays, context loss.
   - Mitigation: automatic won-deal handoff checklist.

## Dependencies

- Tulio to confirm final stage names and definitions.
- Access to current opportunity/project data sources for migration.
- Clear ownership map (who owns sales follow-up vs delivery execution).

---

## 7) First 3 Concrete Actions to Start Today

1. **Finalize v1 stage map (30 minutes)**
   - Confirm sales + delivery stage names above and lock definitions.

2. **Create 15 must-have properties (60 minutes)**
   - Start with Deal object first (owner, next step, dates, value, confidence, RAG).

3. **Load current active deals/projects (90 minutes)**
   - Add only active records with owner + next action + due date; skip historical backlog for now.

---

## Suggested Operating Rule (starting this week)

- **Daily (10 min):** update next steps and due dates for all active deals.
- **Weekly (30 min):** pipeline review with Tulio: stuck deals, forecast shifts, red delivery items, and decision blockers.
