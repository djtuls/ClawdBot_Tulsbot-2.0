# ROADMAP.md — Tulsbot Vision & Backlog

> Last updated: 2026-03-05 (IOS V2)

---

## Vision

**"An autonomous context engine that ingests all scattered information, organizes it, learns workflows, and pre-loads context so the operator can say 'let's work on X' and everything is ready."**

Not a chatbot. Not a reminder bot. A system that:

- **Ingests** every signal (email, WhatsApp, calls, notes, documents)
- **Organizes** into the right platform (HubSpot, Notion, Todoist, vault)
- **Maintains** always-current project dossiers
- **Learns** operator workflows and progressively automates
- **Pre-works** — loads context before asked, surfaces blockers, prepares next steps
- **Self-heals** — monitors its own health, fixes broken automation
- **Operates 24/7** on the Mac Mini hub

## Guiding Principles

1. **Context engine over assistant** — manage information, not just respond to prompts
2. **Correctness over speed** — never send wrong information to save time
3. **One source of truth** per domain — sync between platforms, never duplicate authority
4. **Idempotent ingestion** — every capture pipeline deduplicates; no repeat tasks
5. **Observable** — if it's not logged, it didn't happen
6. **Progressive trust** — start read-only, earn write authority
7. **Lean over bureaucratic** — fewer files on boot, faster to context

## Operator Protocol (Active Constraint)

Roadmap execution must follow `OPERATOR_PROTOCOL.md`:

- No assumptions
- No jumping to action
- No planning before full picture
- Clarifying questions until explicit alignment
- Consequences/trade-offs before recommendations
- Durable logging of directives/decisions/actions/results

**Execution Gate (required before significant changes):**

- Objective explicit
- Scope explicit
- Constraints explicit
- Dependencies identified
- Trade-offs disclosed
- User confirmation received

---

## Completed

| ID              | Task                                                    |
| --------------- | ------------------------------------------------------- |
| IOS-REBUILD     | Clean OS, archived legacy, Mission Control, cron system |
| MAC-MINI-HUB    | Mac Mini as primary hub (gateway, tunnel, Ollama)       |
| CLOUD-MIGRATE   | Cloud migration (Mac Mini hub, Fly.io retired)          |
| EVENT-LOGGING   | Unified event log + morning self-heal                   |
| MISSION-CONTROL | Custom dashboard on Mac Mini                            |
| CRON-SYSTEM     | Full cron schedule (12 jobs)                            |
| VAULT-SYSTEM    | Obsidian vault with indexer, music library, structure   |
| IOS-V2-VISION   | VISION.md context engine blueprint                      |

## Active — IOS V2 Rollout

| Gate   | Task                                                              | Status      |
| ------ | ----------------------------------------------------------------- | ----------- |
| Gate 1 | Infrastructure fixes (cron PATH, heartbeat, workspace, Telegram)  | In Progress |
| Gate 2 | 3-tier memory restoration and enforcement                         | Pending     |
| Gate 3 | Capture inbox pipeline (email, WhatsApp, Plaud)                   | Pending     |
| Gate 4 | Cross-platform sync + project dossiers (HubSpot, Notion, Todoist) | Pending     |
| Gate 5 | Council system + Telegram topics + notifications                  | Pending     |

## Backlog

| ID                 | Task                                              | Priority |
| ------------------ | ------------------------------------------------- | -------- |
| WORKFLOW-LEARNING  | Pattern detection and progressive automation      | High     |
| BIDIRECTIONAL-SYNC | HubSpot <-> Notion two-way sync (after V1 stable) | Medium   |
| MEETING-INTEL      | Meeting prep, notes processing, action extraction | Medium   |
| KNOWLEDGE-PIPELINE | Article/link capture → vault with summaries       | Medium   |
| GOODNOTES-INGEST   | GoodNotes → Drive → vault pipeline                | Medium   |
| FINANCIAL-TRACKING | QuickBooks integration                            | Low      |
| DUAL-PROMPTS       | Dual prompt stacks (multi-model)                  | Low      |

---

## Architecture Reference

See `VISION.md` for the full architecture diagram, source of truth map, and all operational protocols.
