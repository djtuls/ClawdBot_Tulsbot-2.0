# SOP-001: Document Production Pipeline

**Owner:** Tulsbot  
**Status:** Active  
**Version:** 1.0  
**Last updated:** 2026-03-06

## 1. Objective

Guarantee that every requested document is complete, useful, verifiable, and never delivered as placeholder content.

## 2. Scope

- In scope: SOPs, standards, plans, reports, ADRs, and operator-facing operational docs.
- Out of scope: ad-hoc chat replies that are not declared final deliverables.

## 3. Inputs / Prerequisites

1. Clear request from Tulio
2. Document type identified
3. Acceptance criteria defined
4. Canonical destination path defined under `docs/tulsbot-ecosystem/`

## 4. Procedure (Step-by-step)

1. **Capture request**
   - Record intent, document type, and expected outcome.
2. **Define acceptance criteria**
   - Confirm minimum required sections and expected depth.
3. **Create draft in canonical path**
   - Use the correct template for the document type.
4. **Write full content (no placeholders)**
   - Fill all required sections with actionable and specific content.
5. **Run quality gate check**
   - Validate against `standards/QUALITY-GATE-CHECKLIST.md`.
6. **Evidence pass**
   - Ensure all claims have file-path evidence where applicable.
7. **Mark status correctly**
   - `Done` only if all gates pass; otherwise `Draft` or `In Progress`.
8. **Report back to Tulio**
   - Send concise summary with canonical file paths.

## 5. Validation Checks

- Every required section is complete.
- No heading-only sections.
- No TODO/placeholder stubs.
- Procedure is executable by another operator.
- Risks/follow-ups are stated.
- Evidence paths are included.

## 6. Failure Modes and Recovery

- **Failure mode:** Placeholder content shipped as final.
  - **Recovery:** Reclassify as incident, rewrite to full standard, re-run quality gate.
- **Failure mode:** Claimed completion without evidence.
  - **Recovery:** Reopen task, attach evidence, re-report status.
- **Failure mode:** Ambiguous scope leads to low-quality output.
  - **Recovery:** Add clarification step before drafting, update acceptance criteria.

## 7. Escalation Path

1. Self-correct if issue is internal quality/process.
2. Escalate to Tulio only when blocked by missing approval/access.

## 8. Ownership and Frequency

- Owner: Tulsbot
- Frequency: For every production document request.

## 9. Example Run / Expected Output

- Input: “Write SOP for X.”
- Output:
  1. Canonical SOP file under `docs/tulsbot-ecosystem/sops/`
  2. Completed quality gate
  3. Summary reply with artifact path and status

## 10. Revision History

- 2026-03-06 — Initial release.

## Quality Gate

- [x] No placeholders
- [x] Executable end-to-end
- [x] Evidence included
