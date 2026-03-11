# Active Projects Master Context — 2026-03-09

**Prepared:** 2026-03-09 (AEST)
**Scope:** Local sources only (no Google Drive / no `gog` usage)
**Method:** Read-only aggregation across local Notion sync caches, HubSpot/Todoist snapshots, memory logs, WhatsApp extracted commitments, and existing project dossiers. Additive file updates only.

## 1) Executive Summary

This snapshot shows a broad active portfolio in Notion/HubSpot, but **operationally only a small subset is currently “hot” in recent interactions**. The most evidence-rich active thread is:

- **2603_AFC Women’s Asian Cup** (pre-production, at risk)

Other recently signaled active projects:

- **2616_Finalíssima Qatar 2026/Qatar Football Festival**
- **2615_Match For Hope**
- **2611_Concacaf W. Champions Cup Finals**
- **2612_Concacaf Champions Cup Final**
- **2605/2608/2609 AFC finals pipeline**
- **2613_FIFA World Cup 26**

Cross-cutting signal: portfolio hygiene is weak (many `Unknown`/stale entries in generated dossiers), and task ownership/date quality remains the main blocker to execution clarity.

---

## 2) Source Reality Check (what was available)

### High-confidence sources used

- `data/notion-summary.json` (local Notion sync cache)
- `data/hubspot-summary.json` + `data/hubspot-stage-mirror-summary.json`
- `data/todoist-summary.json`
- `memory/councils/inft-hub-2026-03-07.md`
- `memory/councils/inft-hub-2026-03-08.md`
- `memory/councils/operations-2026-03-08.md`
- `memory/daily/2026-03-08.md`
- `memory/event-log.jsonl` (recent tail)
- `data/inbox-seen.json` (WhatsApp commitments extracted)
- existing `context/projects/*.md` dossiers

### Meeting transcript requirement (critical)

- **No raw full meeting transcript files were discoverable in workspace runtime paths for today’s pass** (Plaud processor logged “Directory not found”; no local meeting transcript corpus available in `memory/` or `context/`).
- To satisfy transcript-first intent where possible, this report uses:
  - raw WhatsApp commitment extractions (`data/inbox-seen.json`) and
  - explicit call outcome note in daily log (`memory/daily/2026-03-08.md`)
- **Gap:** full meeting transcript text (speaker-by-speaker) is still missing from local accessible sources.

---

## 3) Active Projects Discussed Recently (detailed)

## 2603 — AFC Women’s Asian Cup

**Project code + name:** 2603_AFC Women’s Asian Cup  
**Current lifecycle:** Pre-production (Notion + HubSpot stage mirror)

**Chronology / key dates**

- 2026-03-01: official date / next-action boundary repeatedly referenced as missed
- 2026-03-05 to 2026-03-08: repeated council reports flag this project as **At Risk**
- 2026-03-08: still called out as active risk in INFT council + operations council

**Relevant interactions / signals found**

- INFT council repeatedly reports unresolved ownership and workflow governance for cuesheet/roster/headshot cadence.
- Operational recommendation chain references James + Bow dependency.
- WhatsApp-derived commitments include coordination with Ivan/Carlos/James/Luke; while not all explicitly tagged 2603, they align with live production dependency threads.
- Notion CRM contact notes explicitly link RWS contacts to 2603.

**Key contacts (evidence-backed)**

- Tulio (PM)
- James / Bow (execution dependencies)
- Luke Campbell (RWS; from HubSpot contacts + WhatsApp commitment “heads-up after James sends email”)
- Tara Myers, Mark Axford (RWS contacts linked to 2603 in Notion CRM notes)
- Carlos (follow-up/call thread)

**Current status / blockers / dependencies**

- Status: Active, at risk
- Blockers:
  - cuesheet approval ownership unclear
  - roster/headshot cutoff windows unconfirmed
  - decision bottleneck around Tulio as central coordinator
- Dependencies:
  - rapid decision/assignment cycle with James/Bow
  - cleanup of ownerless high-priority tasks

**Proposed next actions**

1. Lock named owner + SLA for cuesheet approvals.
2. Confirm roster/headshot hard freeze dates and publish to team.
3. Convert WhatsApp commitments into dated owners/tasks (Ivan/Carlos/James/Luke chain).
4. Mark dossier status explicitly as At Risk and add dated recovery plan.

**Open questions for Tulio**

- Who is final approver for cuesheet at each stage?
- Are James/Bow decisions already made offline since 2026-03-08?
- Which of Ivan/Carlos/Luke tasks are 2603-critical vs adjacent?

---

## 2616 — Finalíssima Qatar 2026 / Qatar Football Festival

**Project code + name:** 2616_Finalíssima Qatar 2026/Qatar Football Festival  
**Current lifecycle:** Biz Dev / RFP (HubSpot + Notion stage mirror)

**Chronology / key dates**

- Close date in HubSpot snapshot: 2026-03-26
- 2026-03-08: Todoist task “Finalíssima @proposal” completed

**Relevant interactions / signals found**

- Completion of proposal task indicates active movement.
- Daily memory note logs Carlos call outcome (“wait/no immediate action”), likely linked to this/related Qatar thread.

**Key contacts**

- Tulio (PM in Notion grid)
- Carlos (decision signal in daily memory)
- Mostafa Abdelhay (QVision; contact notes mention common linkage with Match for Hope + Finalissima)

**Status / blockers / dependencies**

- Status: Active pipeline, awaiting counterpart signal.
- Blocker: external go/no-go momentum (“wait” outcome).
- Dependency: commercial chain mapping and response timing.

**Proposed next actions**

1. Convert “wait” into explicit review checkpoint date.
2. Confirm proposal package version sent and open items.
3. Link counterpart decision owner + expected response window.

**Open questions**

- Was the completed “Finalíssima @proposal” sent externally, or internal draft only?
- Who holds next move after Carlos call?

---

## 2615 — Match For Hope

**Current lifecycle:** Recon

**Signals**

- Appears in active mirrored deals with Recon stage.
- Contact graph overlaps with Finalissima/Qatar thread.

**Status + blockers**

- No fresh execution notes found in local logs after stage sync.
- Likely in reconciliation/settlement phase with low narrative visibility.

**Next actions**

- Confirm reconciliation checklist and closure owner.
- Add last external interaction date to dossier.

**Open questions**

- What remains open in Recon for 2615?

---

## 2611 — Concacaf W. Champions Cup Finals

**Current lifecycle:** Target

**Signals**

- Explicitly present as active target in stage mirror updates.
- Concacaf operational tasks due 9 Mar suggest adjacent commercial/ops pressure.

**Key contacts**

- PM field indicates Tulio/Duda.
- Concacaf contact signals in HubSpot include Juan Ascanio, Maria Claro.

**Blockers / dependencies**

- Dependencies on broader Concacaf recon/planning tasks due now.
- Missing explicit next action/date in project dossier.

**Open questions**

- Is this still target stage or moved due to recent 9 Mar task outcomes?

---

## 2612 — Concacaf Champions Cup Final

**Current lifecycle:** Target

**Signals**

- Active target in stage mirror + project caches.
- Coupled with Concacaf overdue tasks in Todoist.

**Key contacts**

- PM listed Tulio/AJ.
- Concacaf contact candidates from HubSpot (Juan Ascanio, Maria Claro).

**Open questions**

- Which 9 Mar tasks map directly to 2612 vs 2611 vs broader Concacaf 2026?

---

## 2605 / 2608 / 2609 — AFC finals pipeline

**Current lifecycle:** Biz Dev / RFP

**Signals**

- All three projects appear in active stage mirror updates.
- Limited fresh interaction narrative in memory logs.

**Risk**

- Pipeline exists, but context density is low (few dated actions, low narrative continuity).

**Next actions**

- Add one-line commercial status + next milestone date to each dossier.
- Attach primary stakeholder contacts for each.

---

## 2613 — FIFA World Cup 26

**Current lifecycle:** Pre-production

**Signals**

- Active stage in mirror and summaries.
- No recent execution log details in memory for this pass.

**Risk**

- Pre-production status without updated interaction notes suggests monitoring gap.

**Next actions**

- Confirm scope owner, current workstream, and next hard date.

---

## 4) WhatsApp + Call-derived practical signals (transcript-adjacent)

From `data/inbox-seen.json` and daily logs:

- “Call Ivan now”
- “Discuss Mexico equipment project with Ivan”
- “Schedule 3-way call with Ivan and Carlos”
- “Give Luke a heads-up after James sends email”
- “Catch up with James tomorrow”
- Daily note: “Call with Carlos happened yesterday; outcome = wait/no immediate action”

**Practical use:** these are actionable micro-commitments that should be mapped into project-linked tasks with owner/date/outcome fields.

---

## 5) Portfolio-level blockers

1. **Status hygiene drift:** many generated per-project files still show `Notion status: Unknown` despite stage mirror evidence.
2. **Ownership ambiguity:** multiple high-priority tasks still `[Team assigned]` with no named owner.
3. **Transcript visibility gap:** no local raw meeting transcript corpus available for deep extraction in this run.
4. **Execution bottleneck:** repeated dependence on Tulio for cross-project decision closure.

---

## 6) Proposed immediate next actions (operator-level)

1. Resolve today’s Concacaf due items and map each to project code (2611/2612/other).
2. Close 2603 governance chain (owner + dates + call outcomes).
3. Add contact map block to each hot project dossier (at minimum: owner, client lead, counterpart).
4. Restore transcript ingestion visibility (Plaud folder path + local transcript destination).
5. Enforce rule: no P3/P4 task without owner and due date.

---

## 7) Notion write attempt (Project Context DB only, additive)

- Policy requested: **write only to Project Context DB, additive only**.
- Attempted outcome: **blocked in this run** from safe scripted path due lack of schema-confirmed writer in current task window.
- No destructive Notion action performed.
- Recommendation: use controlled script with known schema to create a single context entry titled: **“Active Projects Master Context — 2026-03-09”**, including link back to this file path.

Local report path to reference in Notion:
`/Users/tulioferro/.openclaw/workspace/context/reports/active-projects-master-report-2026-03-09.md`

---

## 8) What was read vs what was written

### Read

- `data/notion-summary.json`
- `data/hubspot-summary.json`
- `data/hubspot-stage-mirror-summary.json`
- `data/todoist-summary.json`
- `data/inbox-seen.json`
- `memory/councils/inft-hub-2026-03-07.md`
- `memory/councils/inft-hub-2026-03-08.md`
- `memory/councils/operations-2026-03-08.md`
- `memory/daily/2026-03-08.md`
- `memory/event-log.jsonl`
- `context/projects/*.md` (selected active projects)

### Written (additive/local)

- `context/reports/active-projects-master-report-2026-03-09.md` (this file)
- `context/reports/active-projects-exec-index-2026-03-09.md`
- Updated selected `context/projects/*.md` dossiers with additional context blocks (non-destructive append)

---

## 9) Audit trail (key evidence lines)

- Stage mapping + updates: `data/hubspot-stage-mirror-summary.json`
- Active tasks + due items: `data/todoist-summary.json`
- WhatsApp commitments extracted: `data/inbox-seen.json`
- Carlos call outcome: `memory/daily/2026-03-08.md`
- Repeated 2603 risk flags + action chain: `memory/councils/inft-hub-2026-03-07.md`, `memory/councils/inft-hub-2026-03-08.md`
- Portfolio operations risks: `memory/councils/operations-2026-03-08.md`
- Dossier staleness/unknown statuses: `context/projects/2603-*.md`, `2611-*.md`, `2616-*.md`, etc.
