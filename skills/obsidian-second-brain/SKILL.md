---
name: obsidian
description: Manage Obsidian vaults as a second brain — create, read, link, search, and query notes. Handles YAML frontmatter, wikilinks, Dataview queries, tags, templates, canvas, and vault organization. Controls Obsidian via CLI and URI schemes. Use when working with Obsidian, managing notes, building a knowledge base, querying vault data, or automating note workflows.
---

# Obsidian Second Brain

You are an Obsidian expert. You manage the user's vault as their second brain — creating, linking, searching, and querying notes. Obsidian vaults are plain Markdown files on disk; every operation is a file operation.

## Vault Location

The vault path is configured per-user. Resolve in order:

1. Environment variable `OBSIDIAN_VAULT` (if set)
2. Check `TOOLS.md` in the Tulsbot workspace for a configured path
3. Ask the user

### Access Methods

| Method              | When                      | How                                                              |
| ------------------- | ------------------------- | ---------------------------------------------------------------- |
| Direct file I/O     | Always works, bulk ops    | Read/Write `.md` files in vault dir                              |
| Obsidian CLI        | App running + CLI enabled | `obsidian <command> [params]`                                    |
| URI scheme          | Open UI from outside      | `open "obsidian://open?vault=X&file=Y"`                          |
| `obsidian_tools.py` | Search, health, tasks     | `python3 scripts/obsidian_tools.py --vault PATH --action ACTION` |

## Note Anatomy

Every note is a Markdown file with optional YAML frontmatter:

```markdown
---
title: Project Alpha
type: project
status: active
tags: [engineering, q2]
created: 2026-03-10
related: "[[Project Beta]]"
---

# Project Alpha

Content here. Link to [[Project Beta]] or embed ![[diagram.png]].
```

### Frontmatter Rules

- Delimited by `---` on first and last line
- Strings with special chars need quotes: `title: "Note: Important"`
- Lists: `tags: [a, b, c]` or multi-line with `- item`
- Dates: ISO 8601 (`2026-03-10`)
- Links in frontmatter must be quoted: `"[[Page Name]]"`
- Booleans: `true`/`false` (lowercase)
- Keep properties minimal — only add what you actually query

### Reserved Properties

| Property     | Purpose                                         |
| ------------ | ----------------------------------------------- |
| `tags`       | Categorization (also usable inline with `#tag`) |
| `aliases`    | Alternative names for the note                  |
| `cssclasses` | Custom CSS classes for rendering                |
| `publish`    | Obsidian Publish visibility                     |

## Linking System

Links are the backbone of the second brain. They create bidirectional connections.

| Syntax                | Purpose             | Example                    |
| --------------------- | ------------------- | -------------------------- |
| `[[Note]]`            | Wikilink            | `[[Project Alpha]]`        |
| `[[Note\|Display]]`   | Wikilink with alias | `[[Project Alpha\|Alpha]]` |
| `[[Note#Heading]]`    | Link to heading     | `[[Project Alpha#Goals]]`  |
| `[[Note#^block-id]]`  | Link to block       | `[[Note#^abc123]]`         |
| `![[Note]]`           | Embed entire note   | `![[Meeting Notes]]`       |
| `![[Note#Heading]]`   | Embed section       | `![[Project Alpha#Goals]]` |
| `![[image.png]]`      | Embed image         | `![[diagram.png]]`         |
| `![[image.png\|300]]` | Embed with width    | `![[diagram.png\|400]]`    |
| `[text](url)`         | External link       | `[Docs](https://...)`      |

### Linking Best Practices

1. **Prefer wikilinks** (`[[]]`) for internal notes — auto-update on rename
2. **Use aliases** when the note name doesn't read naturally in context
3. **Link liberally** — every connection strengthens the graph
4. **Heading links** for specific sections, not just whole notes
5. **Create stub notes** — linking to a non-existent note is valid; it becomes a connection hub
6. **Block references**: add `^my-id` at end of any line to make it linkable via `[[Note#^my-id]]`
7. **Convert unlinked mentions** to wikilinks when you find them

## Tags

```markdown
#project # Simple tag
#project/active # Nested (hierarchical)
#2026/Q1 # Date-based
```

- Frontmatter tags (`tags: [project, active]`) are cleaner for Dataview queries
- Inline tags (`#project`) mark specific content within a note
- **Tags = categories/types** (broad). **Links = specific relationships** (precise)
- No spaces in tags — use hyphens: `#my-tag`
- Nested tags create hierarchy: `#status/active`, `#status/archived`

## Templates

Store in a designated folder (e.g. `_templates/`). Configure in Settings → Templates.

### Variables

| Variable              | Output                            |
| --------------------- | --------------------------------- |
| `{{title}}`           | Note title                        |
| `{{date}}`            | Current date                      |
| `{{time}}`            | Current time                      |
| `{{date:YYYY-MM-DD}}` | Formatted date (Moment.js format) |

### Key Templates

**Daily Note:**

```markdown
---
type: daily
date: "{{date:YYYY-MM-DD}}"
tags: [daily]
---

# {{date:dddd, MMMM D, YYYY}}

## Priorities

- [ ]

## Notes

## Reflections
```

**Project:**

```markdown
---
type: project
status: active
tags: [project]
created: "{{date:YYYY-MM-DD}}"
---

# {{title}}

## Overview

## Goals

- [ ]

## Resources

## Log
```

## Search

### Obsidian Search Operators

| Operator     | Example                   |
| ------------ | ------------------------- |
| (plain text) | `meeting notes`           |
| `path:`      | `path:projects/`          |
| `file:`      | `file:daily`              |
| `tag:`       | `tag:#active`             |
| `line:()`    | `line:(status active)`    |
| `section:()` | `section:(TODO priority)` |
| `[prop:val]` | `[status:active]`         |
| `/regex/`    | `/\d{4}-\d{2}-\d{2}/`     |

### CLI Search

```bash
obsidian search query="keyword"
obsidian search:context query="keyword"    # With surrounding lines
```

### Script Search

```bash
python3 scripts/obsidian_tools.py --vault $OBSIDIAN_VAULT --action search --query "keyword"
```

## Dataview Queries

Dataview turns the vault into a queryable database. Queries go inside ` ```dataview ` code blocks.

### Query Types

````markdown
```dataview
TABLE status, tags, created
FROM "projects"
WHERE status = "active"
SORT created DESC
```

```dataview
LIST
FROM #meeting AND "2026"
WHERE contains(file.name, "standup")
SORT file.ctime DESC
```

```dataview
TASK
FROM "projects"
WHERE !completed
SORT priority ASC
```
````

### Syntax

```
QUERY_TYPE [fields]
FROM source            -- "folder", #tag, [[link]], -"excluded"
WHERE condition        -- Combine with AND / OR
SORT field [ASC|DESC]
GROUP BY field
FLATTEN field
LIMIT n
```

### Implicit Fields (every note has these)

| Field                            | Description               |
| -------------------------------- | ------------------------- |
| `file.name`                      | Filename (no extension)   |
| `file.path`                      | Full vault path           |
| `file.folder`                    | Parent folder             |
| `file.ctime` / `file.mtime`      | Created / modified time   |
| `file.size`                      | Bytes                     |
| `file.tags`                      | All tags                  |
| `file.outlinks` / `file.inlinks` | Links out / backlinks in  |
| `file.tasks`                     | All tasks                 |
| `file.day`                       | Date parsed from filename |

### Essential Functions

| Function                  | Example                           |
| ------------------------- | --------------------------------- |
| `contains(field, "val")`  | `WHERE contains(tags, "project")` |
| `length(list)`            | `WHERE length(file.outlinks) > 5` |
| `date(today)`             | `WHERE created = date(today)`     |
| `dateformat(date, "fmt")` | `dateformat(created, "MMM dd")`   |
| `choice(cond, a, b)`      | `choice(done, "✅", "⏳")`        |
| `default(field, val)`     | `default(status, "unknown")`      |

For complete Dataview reference and DataviewJS, see [reference.md](reference.md).

## CLI Commands

Requires Obsidian running + CLI enabled (Settings → General → CLI).

```bash
# File operations
obsidian read "note.md"
obsidian create "folder/note.md" content="# Title"
obsidian append "note.md" content="\n## New Section"
obsidian delete "old-note.md"
obsidian move "note.md" to="new-folder/note.md"
obsidian rename "note.md" to="better-name.md"
obsidian open "note.md"

# Discovery
obsidian files                                 # All files
obsidian folders                               # All folders
obsidian tags                                  # All tags with counts
obsidian backlinks "note.md"                   # What links here
obsidian links "note.md"                       # What this links to
obsidian orphans                               # No links at all
obsidian unresolved                            # Broken links

# Properties
obsidian property:read "note.md"
obsidian property:set "note.md" key="status" value="done"
obsidian property:remove "note.md" key="draft"

# Daily notes
obsidian daily                                 # Open/create today's
obsidian daily:read
obsidian daily:append content="- Task done"

# Templates
obsidian templates
obsidian template:insert name="meeting"

# Multi-vault
obsidian --vault="My Vault" read "note.md"
```

For the full 130+ command reference, see [reference.md](reference.md).

## URI Schemes

Open notes and trigger actions from outside Obsidian:

```bash
open "obsidian://open?vault=MyVault&file=note"
open "obsidian://new?vault=MyVault&file=note&content=Hello"
open "obsidian://search?vault=MyVault&query=keyword"
open "obsidian://daily?vault=MyVault"
open "obsidian://new?vault=MyVault&file=note&content=appended&append=true"
```

URI-encode spaces and special characters.

## Utility Script

`scripts/obsidian_tools.py` provides vault operations without the Obsidian app running:

```bash
python3 scripts/obsidian_tools.py --vault ~/path/to/vault --action <action>

# Actions:
#   search --query "term"     Full-text search with context
#   find-tag --tag "project"  Notes with a tag (incl. nested)
#   list-projects             Active projects table
#   open-tasks                All open [ ] tasks
#   orphans                   Notes with zero links
#   backlinks --note "Name"   What links to a note
#   daily [--date YYYY-MM-DD] Today's daily note path
#   health                    Vault health score and issues
```

Requires `pyyaml`. Install: `pip install pyyaml`.

## Canvas

`.canvas` files are JSON-based visual workspaces. They contain cards (text, embedded notes, links, images) with x/y positions. Create via Obsidian UI or write JSON directly. Useful for mind maps, project boards, and relationship diagrams.

## Vault Organization

For recommended structures (PARA, Zettelkasten, daily-notes-first), see [vault-patterns.md](vault-patterns.md).

## Critical Rules

1. **Wikilinks for internal refs** — they auto-update on rename
2. **Frontmatter first** — add properties before content when creating notes
3. **Link > tag** for specific relationships; tags for broad categories
4. **Never hardcode vault paths** — use `$OBSIDIAN_VAULT` or ask
5. **Non-existent link targets are valid** — Obsidian treats them as stubs
6. **Read before modify** — preserve existing content
7. **Use templates** for consistent structure
8. **Never modify `.obsidian/`** config directory unless explicitly asked
9. **UTF-8 only** — all files must be UTF-8
10. **Filename restrictions** — no `* " \ / < > : | ?` in note names
