# TULSBOT Documentation & Execution Standard

**Owner:** Tulio Ferro  
**Operator:** Tulsbot  
**Status:** Active (Draft for approval)  
**Version:** 1.0  
**Last updated:** 2026-03-06

---

## 1) Purpose

This standard exists to prevent low-quality outputs, placeholder documents, and false completion claims.

It defines:

1. Where documentation lives (source of truth + visibility mirrors)
2. What each document must contain
3. The mandatory workflow from idea → planning → approval → execution → reporting
4. Quality gates and Definition of Done (DoD)
5. Role assignment: who should build what

---

## 2) Documentation Architecture (Single Source + Full Visibility)

## 2.1 Canonical Source (authoritative)

**Location:** `/Users/tulioferro/.openclaw/workspace/docs/tulsbot-ecosystem/`

All official SOPs, standards, architecture decisions, and incidents are authored and versioned here.

Why: this gives deterministic history, diffability, and avoids “which doc is the real one?” drift.

## 2.2 Visibility Mirrors (read/distribute layers)

- **Obsidian:** curated mirror for linked thinking and fast retrieval
- **Notion:** execution dashboards, ownership, due dates, status summaries
- **Telegram/Discord:** change notifications only (not full canonical text)

Rule: mirrors can summarize and reference canonical docs; they must not silently diverge from canonical content.

---

## 3) Required Folder Structure

Create and maintain the following:

- `docs/tulsbot-ecosystem/standards/`
- `docs/tulsbot-ecosystem/sops/`
- `docs/tulsbot-ecosystem/incidents/`
- `docs/tulsbot-ecosystem/plans/`
- `docs/tulsbot-ecosystem/reports/`
- `docs/tulsbot-ecosystem/adr/` (architecture decision records)

---

## 4) Document Types + Mandatory Requirements

## 4.1 Standard Document (`standards/*`)

Use for policy, quality rules, and operating constraints.

**Required sections:**

1. Purpose
2. Scope
3. Non-negotiable rules
4. Exceptions policy
5. Enforcement method
6. Review cadence
7. Change log

## 4.2 SOP Document (`sops/*`)

Use for repeatable operational procedures.

**Required sections:**

1. Objective
2. Scope (in/out)
3. Inputs and prerequisites
4. Step-by-step procedure (numbered)
5. Validation checks per stage
6. Failure modes + recovery steps
7. Escalation path
8. Ownership and frequency
9. Example run / expected output
10. Revision history

**Absolute rule:** no SOP is marked done unless it can be executed by another operator without extra explanation.

## 4.3 Plan Document (`plans/*`)

Use for roadmap items, implementation plans, and build proposals.

**Mandatory procedure:** Follow `sops/SOP-004-implementation-plan-authoring.md` for all implementation plans. Use the same structure when writing plan summaries for Notion task pages.

**Required sections:**

1. Goals and objectives
2. Resources needed
3. Skills needed / used
4. The plan (summary)
5. Detailed plan (phases and subtasks)
6. Approval checklist

## 4.4 Incident Document (`incidents/*`)

Use for misses (including poor-quality deliverables).

**Required sections:**

1. Incident summary
2. Timeline
3. Root cause (not symptoms)
4. User impact
5. Corrective action
6. Preventive controls
7. Verification of prevention
8. Owner + due date

## 4.5 Report Document (`reports/*`)

Use for status updates and completion reports.

**Required sections:**

1. Objective and time range
2. What was done (with evidence links)
3. What is pending
4. Risks / blockers
5. Ask required from Tulio
6. Next execution window

---

## 5) End-to-End Workflow (Idea → Planning → Approval → Execution → Report)

## Stage 0 — Intake (Idea capture)

Input channels: Telegram, WhatsApp, email, voice transcript, Notion note.

Actions:

1. Capture request in canonical tracker
2. Classify type: SOP / Plan / Build / Incident / Report
3. Assign priority and deadline class

Output artifact:

- New entry in `plans/` or `sops/_draft-*` (never only in chat)

## Stage 1 — Clarification (minimal but sufficient)

Actions:

1. Clarify objective and desired outcome
2. Clarify constraints (time, tools, external approvals)
3. Confirm acceptance criteria

Rule: ask only what blocks progress. No interrogative loops.

Output artifact:

- Scope + acceptance criteria section completed

## Stage 2 — Planning

Actions:

1. Create implementation plan with milestones
2. Define dependencies and owners
3. Define quality gates before execution starts

Output artifact:

- `plans/<name>.md` complete and reviewable

## Stage 3 — Approval Gate

Actions:

1. Submit concise plan summary for go/no-go
2. Record approval state in plan header

Rule: no high-impact execution without explicit approval.

Output artifact:

- Approved plan status + timestamp

## Stage 4 — Execution

Actions:

1. Execute tasks in milestone order
2. Log every meaningful step and result
3. Attach evidence paths (files, outputs, diffs)
4. Stop claiming “done” until quality gate passes

Output artifact:

- Updated plan + generated SOP/implementation docs

## Stage 5 — Quality Gate (mandatory)

Before claiming completion, pass all checks:

1. Completeness check (no placeholders)
2. Content depth check (substantive, not headings-only)
3. Accuracy check (cross-verified against actual output)
4. Executability check (for SOPs)
5. Evidence check (paths included)
6. Owner + next-review date set

Output artifact:

- Completed gate checklist in document footer

## Stage 6 — Reporting Back

Actions:

1. Send concise summary: done / pending / risks / next
2. Include canonical path to final artifact
3. If any gap remains, present concrete closure plan with ETA

Output artifact:

- `reports/<date>-<topic>.md` and short Telegram summary

---

## 6) Definition of Done (DoD)

A task is “Done” only if all are true:

1. Deliverable exists in canonical path
2. It satisfies mandatory section requirements
3. Quality gate checklist is fully passed
4. Evidence links are present
5. Risks and follow-ups are declared
6. Report-back has been sent

If any item is missing, status must be **Draft** or **In Progress**, never **Done**.

---

## 7) Anti-Placeholder Policy (Critical)

A placeholder output is treated as an incident.

Examples considered incident-worthy:

- File with headings but no content
- “TODO later” in final SOP
- “Done” claim without executable procedure
- Report with no evidence paths

Mandatory response to incident:

1. Log incident in `incidents/`
2. Apply root-cause analysis
3. Add or tighten preventive gate
4. Re-deliver corrected output

---

## 8) Quality Scoring Rubric (0–5)

Each deliverable is scored on:

1. Completeness
2. Accuracy
3. Actionability
4. Traceability (evidence)
5. Clarity

Thresholds:

- 5.0–4.5: production-ready
- 4.4–4.0: acceptable with minor edits
- <4.0: reject and rework

---

## 9) RACI (Who does what)

- **Tulio:** final approver, strategic priority owner
- **Tulsbot:** orchestrator, planner, QA enforcer, reporting
- **Execution agent(s):** implementation and drafting work

---

## 10) Builder vs Cursor Tulscodex — Recommended Assignment

Given current observed performance standard:

## Recommendation

Use **Cursor Tulscodex as primary executor** for production-critical deliverables now.

Use **Builder as orchestrator + reviewer**, not sole executor, until it demonstrates consistent quality gate compliance.

## Why

- Current trust signal favors Cursor Tulscodex for output quality and completion consistency.
- Builder can still add value in decomposition, orchestration, and review loops.
- This hybrid model reduces delivery risk immediately while preserving parallel throughput.

## Operating model

1. **Tulsbot (main):** define scope, acceptance criteria, and gates
2. **Cursor Tulscodex:** produce first-pass implementation/docs
3. **Builder:** independent review pass against quality gate
4. **Tulsbot:** final synthesis + report to Tulio

If Builder fails gate twice on same class of deliverable, keep Builder in review-only mode for that class until retrained.

---

## 11) Approval Template (for Tulio)

Use this exact block when approving work packages:

- Scope approved: [yes/no]
- Constraints acknowledged: [yes/no]
- Delivery deadline: [date/time]
- Quality threshold: [minimum score]
- Allowed autonomous actions: [list]
- Requires check-in before external action: [yes/no]

---

## 12) Reporting Template (back to Tulio)

- Status: Done / In Progress / Blocked
- Completed: [3-7 bullets]
- Evidence: [canonical file paths]
- Gaps: [if any]
- Risks: [if any]
- Next actions + ETA: [concrete]
- Decision needed from Tulio: [if applicable]

---

## 13) Change Control

Any change to this standard requires:

1. Explicit change note
2. Updated version number
3. Dated rationale entry

No silent policy changes.

---

## 14) Immediate Implementation Checklist

- [ ] Create required directories under `docs/tulsbot-ecosystem/`
- [ ] Add SOP template and incident template
- [ ] Add quality gate checklist template
- [ ] Start first incident entry for placeholder-SOP failure
- [ ] Start weekly quality score review

---

**End of Standard v1.0**
