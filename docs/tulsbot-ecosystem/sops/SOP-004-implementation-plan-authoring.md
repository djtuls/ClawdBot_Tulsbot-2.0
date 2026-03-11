# SOP-004: Implementation Plan Authoring

**Owner:** Tulsbot  
**Status:** Active  
**Version:** 1.0  
**Last updated:** 2026-03-07

## 1. Objective

Ensure every implementation plan produced by Tulsbot follows a consistent, high-quality structure — whether written as a canonical markdown document, a Notion task update, or both. Plans must be scannable, actionable, and complete enough that Tulio can approve or reject with confidence.

## 2. Scope

- In scope: All implementation plans, build proposals, and roadmap-item plans authored by Tulsbot — including plan content written into Notion task pages.
- Out of scope: Ad-hoc status updates, daily recaps, and incident reports (covered by other SOPs/templates).

## 3. Inputs / Prerequisites

1. Clear request or task assignment from Tulio.
2. Enough context to define goals (if ambiguous, ask before drafting).
3. Canonical destination path: `docs/tulsbot-ecosystem/plans/<YYYY-MM-DD>-<slug>.md`.
4. If the plan is for a Notion task: an existing or new task page in Tulsbot Tasks.

## 4. Procedure (Step-by-step)

### 4.1 Capture and confirm scope

1. Record the request: what needs to be planned and why.
2. If the scope is unclear, ask Tulio one round of clarifying questions before drafting.
3. Identify the document type as "Implementation Plan."

### 4.2 Draft the plan using the required sections

Every implementation plan MUST contain the following sections, in this order:

---

**Header block**

```
# <Plan Title>

**Owner:** <owner>
**Approver:** Tulio
**Status:** Draft (Plan Only) | Approved | In Progress | Done
**Version:** <n.n>
**Last updated:** <YYYY-MM-DD>
```

---

**Section 1 — Goals and Objectives**

State what the plan aims to achieve and how success will be measured.

- Write 2–4 high-level goals as a numbered list.
- Write 2–5 measurable success criteria as bullets.
- Each success criterion must be testable (a reviewer can say yes/no to whether it was met).

---

**Section 2 — Resources Needed**

List everything required to execute the plan.

- Tools, APIs, credentials, and access needed.
- Decisions or approvals required from Tulio or other stakeholders (mark as blockers if unresolved).
- Dependencies on other work, systems, or external parties.
- Hard constraints (technical, governance, scope, budget, timeline).

---

**Section 3 — Skills Needed / Used**

Identify the OpenClaw skills, integrations, and capabilities involved in execution.

- List each skill by name (e.g. `notion`, `discord`, `himalaya`, `healthcheck`).
- For each skill, state what it will be used for in one line.
- If a skill does not yet exist or needs modification, flag it explicitly.
- If no skills are needed, write "None — manual/document-only task."

---

**Section 4 — The Plan (Summary)**

Provide a short narrative (1–2 paragraphs) of the chosen approach.

- What are we doing and why this approach over alternatives?
- Name the key phases in one sentence each.
- State the top 2–3 risks with one-line mitigations.
- A reader should understand the full strategy without reading the detailed plan.

---

**Section 5 — Detailed Plan (Phases and Subtasks)**

Break the work into executable phases.

For each phase:

- Give it a clear name and time estimate (e.g. "Phase 1 — Scaffold portal (0.5 day)").
- List subtasks as a numbered checklist.
- Each subtask must be actionable and testable — another operator could execute it without extra explanation.

Optionally include a milestones table:

```
| Milestone | Estimate  | Description                     |
|-----------|-----------|---------------------------------|
| M1        | 0.5 day   | <one-line description>          |
| M2        | 1 day     | <one-line description>          |
```

End with: **Total estimated effort: <X> days.**

---

**Section 6 — Approval Checklist**

```
- [ ] Scope approved by Tulio
- [ ] Constraints acknowledged
- [ ] Rollout phases approved
- [ ] Allowed autonomous actions confirmed
- [ ] External notifications required before release confirmed
```

---

### 4.3 Run quality gate

Before marking the plan as ready for review:

1. Verify every section above is filled — no heading-only or placeholder sections.
2. Confirm all success criteria are measurable.
3. Confirm all subtasks are actionable.
4. Confirm skills listed are accurate and available.
5. Confirm risks have mitigations.

### 4.4 Publish and notify

1. Save the plan to the canonical path: `docs/tulsbot-ecosystem/plans/<YYYY-MM-DD>-<slug>.md`.
2. If a Notion task exists: copy the plan content (same structure) into the task page notes. Set status to **Human in the Loop**.
3. Report to Tulio with the canonical file path and a one-line summary.

### 4.5 Handle revisions

1. If Tulio requests changes, update the **same canonical file** and the **same Notion task page** (never create duplicates).
2. Increment the version number.
3. Re-run the quality gate after edits.

### 4.6 After approval

1. Move status to **Approved** in the canonical file and Notion.
2. When execution begins, move to **In Progress**.
3. During execution, update the Detailed Plan section with phase completion status.

## 5. Validation Checks

- Every required section (1–6) is present and filled.
- No placeholder or TODO stubs.
- Goals have measurable success criteria.
- Resources section lists all blockers and dependencies.
- Skills section names specific skills (not generic descriptions).
- Every subtask in the Detailed Plan is actionable by another operator.
- Canonical file path follows naming convention: `<YYYY-MM-DD>-<slug>.md`.
- If synced to Notion, both copies use the same structure and content.

## 6. Failure Modes and Recovery

- **Failure mode:** Plan delivered with placeholder sections.
  - **Recovery:** Reclassify as incomplete, fill all sections, re-run quality gate.
- **Failure mode:** Plan written in Notion but not in canonical path (or vice versa).
  - **Recovery:** Create the missing copy, verify content matches.
- **Failure mode:** Subtasks are vague or untestable.
  - **Recovery:** Rewrite each subtask with specific action and expected output.
- **Failure mode:** Skills section missing or inaccurate.
  - **Recovery:** Audit the plan for all integrations/tools used, update the section.
- **Failure mode:** Duplicate task pages created on revision.
  - **Recovery:** Merge into single page, delete duplicate, note in revision history.

## 7. Escalation Path

1. Self-correct if the issue is internal quality or process adherence.
2. Escalate to Tulio if blocked by missing approval, access, or unclear scope.

## 8. Ownership and Frequency

- **Owner:** Tulsbot
- **Frequency:** Every time an implementation plan is requested or a Notion task requires a plan update.

## 9. Example Run / Expected Output

- **Input:** "Write a plan for building a Notion docs portal."
- **Output:**
  1. Canonical file: `docs/tulsbot-ecosystem/plans/2026-03-06-notion-docs-portal-implementation-plan.md`
  2. Sections filled: Goals and Objectives, Resources Needed, Skills Needed/Used, The Plan (Summary), Detailed Plan (3 phases, 8 subtasks), Approval Checklist.
  3. Notion task page updated with same content, status set to Human in the Loop.
  4. Summary reply: "Plan ready for review at `docs/tulsbot-ecosystem/plans/2026-03-06-notion-docs-portal-implementation-plan.md`. 3 phases, estimated 3 days. Awaiting approval."

## 10. Revision History

- 2026-03-07 — Initial release.

## Quality Gate

- [x] No placeholders
- [x] Executable end-to-end
- [x] Evidence included
