# Notion Docs Portal Implementation Plan

**Owner:** Tulsbot  
**Approver:** Tulio  
**Status:** Draft (Plan Only)  
**Version:** 1.0  
**Last updated:** 2026-03-06

---

## 1) Problem Statement

Canonical documentation now exists in workspace markdown, but discoverability for non-technical execution stakeholders is limited. A Notion portal is needed to expose curated, up-to-date summaries and navigation without creating a second source of truth.

---

## 2) Goals and Success Metrics

Goals:

1. Provide one Notion entry point for docs discovery, ownership, and execution status.
2. Preserve canonical-first governance and prevent content drift.
3. Reduce time to locate active SOP/plan/report documents.

Success metrics:

- 100% of active canonical docs represented in Notion index with canonical links.
- 0 conflicting procedural text between Notion summaries and canonical docs.
- <= 2 minutes to locate target document from Notion landing page.
- Weekly mirror health check reported with evidence paths.

---

## 3) Constraints

1. Canonical source remains `docs/tulsbot-ecosystem/`; Notion is a mirror/portal only.
2. No direct operational execution should depend on Notion-only text.
3. Implementation must use existing approved credentials and tools.
4. No production rollout without Tulio approval.

---

## 4) Options Considered

### Option A — Manual Notion updates per publish cycle

- Pros: simple to start, low engineering overhead
- Cons: error-prone, higher drift risk, inconsistent speed

### Option B — Scripted sync (metadata + summaries)

- Pros: deterministic updates, lower drift, better auditability
- Cons: setup effort, needs schema design and validation rules

### Option C — Read-only index with canonical links only

- Pros: minimal drift risk, fastest to ship
- Cons: less context in Notion, weaker stakeholder usability

---

## 5) Chosen Approach + Rationale

**Chosen approach: staged rollout combining Option C then Option B.**

Rationale:

- Start with low-risk read-only index (canonical links + ownership + status).
- Add scripted metadata/summaries only after guardrails and drift checks are validated.
- This sequence preserves trust and avoids introducing a second uncontrolled source.

Planned phases:

1. Phase 1: Notion portal skeleton + canonical link index.
2. Phase 2: Automated sync of metadata fields (status, owner, last updated, path).
3. Phase 3: Controlled summary sync with conflict guardrails.

---

## 6) Dependencies

- Approved Notion workspace/database access
- Stable canonical folder taxonomy under `docs/tulsbot-ecosystem/`
- Publish pipeline maintained (`validate` + `publish` scripts)
- Decision from Tulio on rollout scope and phase boundaries

---

## 7) Risks and Mitigation

1. **Risk:** Notion content drifts from canonical
   - **Mitigation:** canonical link field mandatory, summary length limits, drift checks in publish report
2. **Risk:** Team reads mirror as authoritative
   - **Mitigation:** explicit “Canonical Source” banner and link on every portal page
3. **Risk:** Sync script fails silently
   - **Mitigation:** publish workflow must emit sync status and evidence path; failure opens incident
4. **Risk:** Scope expands into implementation without approval
   - **Mitigation:** plan status locked as Draft until Tulio explicit go-ahead

---

## 8) Milestones and Timeline

- M1 (0.5 day): Design Notion information architecture and required database fields
- M2 (0.5 day): Build portal index page and manual canonical links for current docs
- M3 (1 day): Implement metadata sync script and validation checks
- M4 (0.5 day): Run pilot on one doc category (SOPs), verify no drift
- M5 (0.5 day): Expand to all categories and document operations runbook

Total estimated effort after approval: 3 days.

---

## 9) Approval Checklist

- [ ] Scope approved by Tulio
- [ ] Constraints acknowledged
- [ ] Rollout phases approved
- [ ] Allowed autonomous actions confirmed
- [ ] External notifications required before release confirmed

---

## Plan Quality Gate Record

- Completeness: Pass
- Accuracy: Pass
- Actionability: Pass
- Traceability: Pass
- Clarity: Pass
- Quality score: 4.6/5 (plan ready for review, not approved for implementation)
