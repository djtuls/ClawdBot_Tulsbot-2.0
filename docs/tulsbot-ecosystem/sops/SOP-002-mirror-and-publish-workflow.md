# SOP-002: Mirror + Publish Workflow

**Owner:** Tulsbot  
**Status:** Active  
**Version:** 1.0  
**Last updated:** 2026-03-06

## 1. Objective

Ensure every canonical documentation update is mirrored to Obsidian and reported to Tulio with zero ambiguity about source-of-truth.

## 2. Scope

- In scope: Standards, SOPs, plans, incidents, reports under `docs/tulsbot-ecosystem/`.
- Out of scope: Non-canonical scratch notes and ad-hoc chat drafts.

## 3. Inputs / Prerequisites

1. Canonical document updated in workspace
2. Obsidian vault path available:
   - `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault/03_openclaw/tulsbot-ecosystem/`
3. Permission to write into vault path
4. Quality gate passed for the document

## 4. Procedure (Step-by-step)

1. **Confirm canonical file path**
   - Verify updated file exists under `docs/tulsbot-ecosystem/`.
2. **Run documentation preflight**
   - Execute: `scripts/validate-tulsbot-docs.sh`
   - If fail: stop and fix before mirroring.
3. **Mirror files to Obsidian**
   - Copy updated files to matching folders under `03_openclaw/tulsbot-ecosystem/`.
4. **Verify mirror integrity**
   - Confirm destination files exist and are readable.
5. **Publish status report**
   - Add/update report entry under `docs/tulsbot-ecosystem/reports/`.
6. **Report back to Tulio**
   - Send concise completion summary with canonical + mirror paths.

## 5. Validation Checks

- Preflight script returns PASS.
- Mirrored files exist in Obsidian destination.
- Canonical and mirrored filenames match.
- Report includes evidence paths.

## 6. Failure Modes and Recovery

- **Failure mode:** Preflight fails.
  - **Recovery:** Fix document sections/placeholders, rerun preflight.
- **Failure mode:** Mirror copy fails (permissions/path).
  - **Recovery:** verify path, create directories, retry copy, escalate only if blocked.
- **Failure mode:** Mirror drift from canonical.
  - **Recovery:** overwrite mirror from canonical and log correction in report.

## 7. Escalation Path

1. Self-correct for path/copy/validation issues.
2. Escalate to Tulio only when blocked by access or approval constraints.

## 8. Ownership and Frequency

- Owner: Tulsbot
- Frequency: Every canonical documentation update.

## 9. Example Run / Expected Output

- Input: Updated SOP in canonical path
- Output:
  1. Preflight PASS
  2. File mirrored to Obsidian path
  3. Report entry with evidence paths

## 10. Revision History

- 2026-03-06 — Initial release.

## Quality Gate

- [x] No placeholders
- [x] Executable end-to-end
- [x] Evidence included
