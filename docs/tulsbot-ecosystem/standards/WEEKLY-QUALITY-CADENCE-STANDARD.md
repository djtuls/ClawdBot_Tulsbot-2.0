# Weekly Quality Cadence Standard

**Owner:** Tulsbot  
**Status:** Active  
**Version:** 1.0  
**Last updated:** 2026-03-06  
**Review cadence:** Weekly (Friday, AEST)

---

## 1) Purpose

Define a fixed weekly quality operating rhythm so documentation quality is measured, corrected, and improved before quality debt accumulates.

---

## 2) Scope

In scope:

- All canonical documents under `docs/tulsbot-ecosystem/`
- All production deliverables classified as standards, SOPs, plans, incidents, reports, and ADRs
- Weekly scoring, trend analysis, and corrective actions

Out of scope:

- Ad-hoc chat responses not declared as final deliverables
- External mirrors as primary scoring source (canonical is authoritative)

---

## 3) Non-negotiable Rules

1. Weekly quality review must run once per week, even if no incidents occurred.
2. Every production-ready deliverable must score **>= 4.5/5**.
3. Any deliverable scoring below 4.5 must be marked `Draft` or `In Progress`, never `Done`.
4. Every weekly review must include evidence paths, not summaries without references.
5. Every quality miss must have a logged corrective action with owner and due date.
6. The review output must be saved under `docs/tulsbot-ecosystem/reports/`.

---

## 4) Exceptions Policy

Exceptions are allowed only when Tulio explicitly approves reduced scope or emergency delivery.

Exception requirements:

- Approval captured in writing
- Temporary status set to `Draft` (not `Done`)
- Follow-up remediation date assigned within 7 days
- Exception rationale recorded in the weekly report

---

## 5) Enforcement Method

Weekly enforcement sequence:

1. Run `scripts/validate-tulsbot-docs.sh`.
2. Score each changed deliverable using rubric categories: Completeness, Accuracy, Actionability, Traceability, Clarity.
3. Record scores and first-pass/rework state in weekly report.
4. Log incident for any quality miss, false completion claim, or placeholder policy breach.
5. Block completion claim until issues are corrected and revalidated.

Audit artifacts required each week:

- Weekly quality report file
- Evidence index with canonical paths
- Incident file(s) for misses

---

## 6) Review Cadence

- Schedule: Weekly, Friday 16:00–18:00 AEST
- Owner: Tulsbot
- Reviewer/Approver: Tulio
- SLA: Review report published the same day

Minimum report contents:

- Time range
- Scorecard and trend notes
- Rework count and incident count
- Risks and next-week commitments
- Decisions needed from Tulio

---

## 7) Change Log

- 2026-03-06 — v1.0 created. Established weekly quality cadence, scoring threshold, and enforcement cycle.

---

## Quality Gate Record

- Completeness: Pass
- Accuracy: Pass
- Actionability: Pass
- Traceability: Pass
- Clarity: Pass
- Quality score: 4.7/5 (production-ready)
