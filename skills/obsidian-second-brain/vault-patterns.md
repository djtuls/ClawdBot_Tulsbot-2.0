# Vault Organization Patterns

Recommended vault structures. Pick one and adapt. Consistency matters more than the specific pattern.

---

## PARA Method

Projects, Areas, Resources, Archives. Best for action-oriented users who manage multiple active projects.

```
vault/
├── 00-Inbox/                    # Capture everything here first
├── 01-Daily/                    # Daily notes
│   └── 2026/
│       ├── 01-January/
│       ├── 02-February/
│       └── ...
├── 02-Projects/                 # Active, time-bound work with a goal
│   ├── Project Alpha/
│   │   ├── Project Alpha.md     # Main project note (MOC)
│   │   ├── Meeting 2026-03-10.md
│   │   └── Requirements.md
│   └── Website Redesign/
├── 03-Areas/                    # Ongoing responsibilities (no end date)
│   ├── Health/
│   ├── Finance/
│   ├── Career/
│   └── Home/
├── 04-Resources/                # Reference material and interests
│   ├── Books/
│   ├── Courses/
│   ├── Tools/
│   └── People/
├── 05-Archive/                  # Completed/inactive projects and areas
├── 06-Templates/                # Note templates
│   ├── daily.md
│   ├── project.md
│   ├── meeting.md
│   ├── person.md
│   └── book.md
└── 07-Assets/                   # Images, PDFs, attachments
```

### PARA Frontmatter Conventions

**Project:**

```yaml
---
type: project
status: active # active | paused | completed | cancelled
tags: [project]
created: 2026-03-10
deadline: 2026-06-01
priority: high # critical | high | medium | low
client: "Client Name"
project-code: "PA-001"
---
```

**Area:**

```yaml
---
type: area
tags: [area]
review-cycle: monthly # weekly | monthly | quarterly
---
```

**Resource:**

```yaml
---
type: resource # or: book, course, tool, person
tags: [resource]
source: "URL or reference"
---
```

### PARA Rules

1. **Inbox zero** — process daily, move notes to the right folder
2. **Projects have deadlines** — if it doesn't end, it's an Area
3. **Archive aggressively** — completed projects move to Archive immediately
4. **MOC per project** — each project folder has a main note that links to all related notes
5. **Daily note as triage** — capture in daily, then link or move

---

## Zettelkasten (Slip-Box)

Atomic, interconnected notes. Best for researchers, writers, and deep thinkers building a lifelong knowledge network.

```
vault/
├── 00-Inbox/                    # Fleeting notes land here
├── 01-Zettel/                   # All permanent notes (flat or lightly foldered)
│   ├── 202603101430 Cognitive load theory.md
│   ├── 202603101445 Chunking reduces load.md
│   └── ...
├── 02-Literature/               # Notes on specific sources
│   ├── Kahneman 2011 Thinking Fast and Slow.md
│   └── ...
├── 03-MOC/                      # Maps of Content (index notes)
│   ├── Learning.md
│   ├── Psychology.md
│   └── ...
├── 04-Projects/                 # Active writing/output projects
├── 05-Templates/
└── 06-Assets/
```

### Zettelkasten Frontmatter

```yaml
---
type: zettel # zettel | literature | moc | fleeting
tags: [cognition, learning]
created: 2026-03-10T14:30
source: "[[Kahneman 2011 Thinking Fast and Slow]]"
---
```

### Zettelkasten Rules

1. **One idea per note** — atomic notes, not topic dumps
2. **Write in your own words** — don't copy/paste from sources
3. **Link everything** — every new note should connect to at least one existing note
4. **Use MOCs as entry points** — Maps of Content collect related zettels by theme
5. **Literature notes reference sources** — separate your thoughts from the author's
6. **Unique IDs optional** — timestamps in filenames (`YYYYMMDDHHmm`) or just descriptive names
7. **Flat is fine** — don't over-folder; let links create structure

---

## Daily-Notes-First

Everything starts from the daily note. Best for journalers, managers, and anyone who thinks chronologically.

```
vault/
├── Daily/
│   └── 2026/
│       ├── 2026-03-10.md
│       ├── 2026-03-11.md
│       └── ...
├── Notes/                       # Evergreen notes extracted from dailies
├── People/                      # Person pages
├── Projects/                    # Project pages (MOCs)
├── Meetings/                    # Meeting notes (linked from daily)
├── Templates/
└── Assets/
```

### Daily-Notes-First Workflow

1. Start every day by opening the daily note (auto-created from template)
2. Capture everything in the daily note — tasks, ideas, meeting notes
3. At end of day (or during review):
   - Extract reusable ideas into standalone notes in `Notes/`
   - Link meeting notes to `People/` and `Projects/`
   - Move completed tasks to project logs
4. Weekly review: scan the week's dailies, update project statuses

### Daily Note Template

```markdown
---
type: daily
date: "{{date:YYYY-MM-DD}}"
tags: [daily]
---

# {{date:dddd, MMMM D, YYYY}}

## Focus

> What's the one thing that matters most today?

## Tasks

- [ ]

## Meetings

-

## Notes

## Gratitude

-

## End of Day

> What went well? What to improve?
```

---

## Hybrid: PARA + Daily-First (Recommended)

Combines the organizational clarity of PARA with the daily capture workflow.

```
vault/
├── 00-Inbox/
├── 01-Daily/
│   └── 2026/
│       └── 03-March/
├── 02-Projects/
├── 03-Areas/
├── 04-Resources/
│   ├── Books/
│   ├── People/
│   └── Tools/
├── 05-Archive/
├── 06-Templates/
└── 07-Assets/
```

**Flow**: Daily note → capture → link to Projects/Areas → extract evergreen notes to Resources → archive when done.

---

## Key Templates

### Meeting Note

```markdown
---
type: meeting
date: "{{date:YYYY-MM-DD}}"
attendees: []
project: ""
tags: [meeting]
---

# {{title}}

## Agenda

1.

## Notes

## Action Items

- [ ]

## Decisions

-
```

### Person

```markdown
---
type: person
tags: [person]
company: ""
role: ""
email: ""
phone: ""
last-contact: "{{date:YYYY-MM-DD}}"
---

# {{title}}

## Context

## Notes

## Interactions

- {{date:YYYY-MM-DD}} —
```

### Book / Reading Note

```markdown
---
type: book
tags: [book]
author: ""
status: reading # to-read | reading | completed | abandoned
rating:
started: "{{date:YYYY-MM-DD}}"
finished:
---

# {{title}}

## Summary

## Key Ideas

1.

## Quotes

>

## Application

How does this connect to what I already know?

- [[]]
```

### Decision Log

```markdown
---
type: decision
date: "{{date:YYYY-MM-DD}}"
status: decided # proposed | decided | reversed
tags: [decision]
project: ""
---

# {{title}}

## Context

Why is this decision needed?

## Options

1. **Option A** —
2. **Option B** —

## Decision

We chose **Option X** because...

## Consequences

-
```

---

## Naming Conventions

| Content                | Convention                    | Example                                 |
| ---------------------- | ----------------------------- | --------------------------------------- |
| Daily notes            | `YYYY-MM-DD.md`               | `2026-03-10.md`                         |
| Meeting notes          | `Meeting YYYY-MM-DD Topic.md` | `Meeting 2026-03-10 Sprint Planning.md` |
| Projects               | Descriptive name              | `Website Redesign.md`                   |
| People                 | Full name                     | `Jane Smith.md`                         |
| Zettels (if using IDs) | `YYYYMMDDHHmm Title.md`       | `202603101430 Cognitive load.md`        |
| Templates              | Lowercase type                | `daily.md`, `meeting.md`                |

- Avoid special characters: `* " \ / < > : | ?`
- Spaces are fine (Obsidian handles them well)
- Use consistent casing (Title Case for notes, lowercase for templates)
