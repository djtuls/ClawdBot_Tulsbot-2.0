# TODO Consolidation — 2026-03-04

## Scope

Consolidated from:

- `/Users/tulioferro/.openclaw/workspace/TODO.md`
- `/Users/tulioferro/.openclaw/workspace/tasks/backlog.json`

This plan covers all **remaining** TODO categories from `TODO.md` (**In Progress, High, Medium, Deferred**) and aligns with live task-board status where available.

## Execution Plan (Consolidated)

| Item                                                                           | Source                                       |                           Current Status |                         Recommended Status | Owner           | Next concrete action                                                                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------: | -----------------------------------------: | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex Pro OAuth on Mac Mini (interactive TTY)                                  | TODO + backlog (`codex-oauth`)               |                                  backlog |            **in_progress (handoff-ready)** | Tulio           | Run: `ssh -t tulioferro@100.100.5.125 'openclaw models auth login --provider openai-codex'`; confirm success in model list; log completion in backlog. |
| GoDaddy CNAME: `mc.weareliveengine.com` → tunnel                               | TODO + backlog (`mc-cname`)                  |       done in backlog, unchecked in TODO |              **done (sync TODO checkbox)** | Tulio           | Update `TODO.md` to checked state to remove duplicate open item and avoid rework.                                                                      |
| Teach Tulsbot about Live Engine / Creative Tools / INFT projects               | TODO High + backlog (`teach-domain`)         |                              in_progress |         **in_progress (active execution)** | Tulsbot         | Produce 1-page domain brief from active projects (context, patterns, next actions) and attach to Mission Control memory.                               |
| Set up knowledge-base capture pipeline (Telegram links → capture/embed/search) | TODO High + backlog (`knowledge-pipeline`)   |                                  backlog |                    **in_progress (build)** | Tulsbot         | Define MVP flow (ingest, parse, dedupe, embed, retrieval), choose storage/index, then implement test with 3 real links.                                |
| Reverse-prompt: custom Mission Control tools to build                          | TODO High + backlog (`reverse-prompt-tools`) | in_progress (medium priority in backlog) | **in_progress (promote priority to high)** | Tulsbot         | Generate ranked top-10 tool ideas with impact/effort scoring; select top-3 for immediate build specs.                                                  |
| Sprint 3.2: Prompt caching                                                     | TODO Medium                                  |                   not tracked in backlog |             **backlog (ready for design)** | Tulsbot         | Write technical design: cache keys, invalidation policy, hit-rate metrics, fallback behavior; then estimate implementation slices.                     |
| Phase 4.2: Supabase Realtime (replace polling)                                 | TODO Medium                                  |                   not tracked in backlog |          **backlog (dependency planning)** | Tulsbot         | Map current poll loops; define migration plan by subsystem (events, tasks, notifications); create phased cutover checklist.                            |
| CRM / Contact Intelligence                                                     | TODO Medium                                  |                   not tracked in backlog |                 **deferred (intentional)** | Tulio + Tulsbot | Define trigger criteria for activation (e.g., lead volume threshold) and minimal schema so prep is ready when promoted.                                |
| Dual prompt stacks (multi-model)                                               | TODO Deferred                                |                   not tracked in backlog |                      **deferred (parked)** | Tulsbot         | Document activation condition and architecture constraints; no implementation until multi-model load is consistent.                                    |
| Meeting intelligence                                                           | TODO Deferred                                |                   not tracked in backlog |                      **deferred (parked)** | Tulio + Tulsbot | Set readiness gate (meeting frequency + transcript quality); prepare lightweight pilot checklist only.                                                 |
| Financial tracking (QuickBooks integration)                                    | TODO Deferred                                |                   not tracked in backlog |                      **deferred (parked)** | Tulio           | Confirm business need + API access prerequisites; create integration discovery ticket when approved.                                                   |

## Additional active backlog items (not listed in TODO.md, but currently open)

| Item                                                                                         | Current Status |                   Recommended Status | Owner                     | Next concrete action                                                                                                         |
| -------------------------------------------------------------------------------------------- | -------------: | -----------------------------------: | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Prepare proposal plan for Nina Luz request (`nina-luz-proposal-prep`)                        |    in_progress |                      **in_progress** | Tulsbot                   | Convert execution plan into first draft proposal packet sections and timeline by tomorrow kickoff.                           |
| Operational rule: MC-first → delegate → report back → track (`ops-mc-first-delegate-report`) |    in_progress | **in_progress (policy enforcement)** | Tulsbot                   | Add compliance checkpoint to every new task creation/update flow; validate with one end-to-end example daily.                |
| Fix Telegram latency from heartbeat flood handling (`heartbeat-latency-fix`)                 |    in_progress |             **in_progress (urgent)** | Tulsbot                   | Enforce fast `HEARTBEAT_OK` response path and cap verbose payloads; verify latency drop via timestamped before/after sample. |
| Starred email review pipeline (`starred-email-review-flow`)                                  |        blocked |   **blocked (awaiting user action)** | Tulio (unblock) + Tulsbot | Tulio attaches Chrome Relay tab; then Tulsbot runs starred-email fetch + summary pipeline and posts action digest.           |

## Recommended execution order (next 48h)

1. **Unblock/finish operator-dependent tasks:** Codex OAuth, Chrome Relay attach.
2. **Close consistency gap:** mark CNAME done in `TODO.md`.
3. **Complete high-impact active streams:** teach-domain brief, heartbeat latency fix.
4. **Kick off systems work:** knowledge capture MVP, reverse-prompt top-10 + top-3 specs.
5. **Prepare medium items as design-ready backlog:** prompt caching and realtime migration plans.
6. **Keep deferred items explicitly parked with activation criteria only.**

## Ownership summary

- **Tulio (direct action needed):** Codex OAuth, CNAME TODO sync, Chrome Relay unblock, QuickBooks go/no-go.
- **Tulsbot (build/analysis):** domain teaching, knowledge pipeline, reverse-prompt tools, heartbeat latency fix, policy enforcement, medium-level technical designs.
- **Shared (policy/strategy):** CRM and meeting-intelligence activation criteria.
