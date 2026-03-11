# Obsidian Reference

Deep reference for CLI commands, Dataview syntax, property types, and DataviewJS.

## CLI Command Reference

### File Operations

| Command   | Description         | Example                                            |
| --------- | ------------------- | -------------------------------------------------- |
| `read`    | Read note content   | `obsidian read "note.md"`                          |
| `create`  | Create a note       | `obsidian create "path/note.md" content="# Title"` |
| `append`  | Append to note      | `obsidian append "note.md" content="\nNew line"`   |
| `prepend` | Prepend to note     | `obsidian prepend "note.md" content="Top line\n"`  |
| `move`    | Move a note         | `obsidian move "note.md" to="folder/note.md"`      |
| `rename`  | Rename a note       | `obsidian rename "note.md" to="new-name.md"`       |
| `delete`  | Delete a note       | `obsidian delete "note.md"`                        |
| `open`    | Open in Obsidian UI | `obsidian open "note.md"`                          |
| `file`    | File metadata       | `obsidian file "note.md"`                          |
| `files`   | List all files      | `obsidian files`                                   |
| `folder`  | Folder info         | `obsidian folder "projects"`                       |
| `folders` | List all folders    | `obsidian folders`                                 |

### Search

| Command          | Description               | Example                               |
| ---------------- | ------------------------- | ------------------------------------- |
| `search`         | Full-text search          | `obsidian search query="keyword"`     |
| `search:context` | Search with context lines | `obsidian search:context query="API"` |
| `search:open`    | Open search in UI         | `obsidian search:open query="todo"`   |

### Properties

| Command           | Description                 | Example                                                     |
| ----------------- | --------------------------- | ----------------------------------------------------------- |
| `properties`      | List all properties in note | `obsidian properties "note.md"`                             |
| `property:read`   | Read a property value       | `obsidian property:read "note.md" key="status"`             |
| `property:set`    | Set a property              | `obsidian property:set "note.md" key="status" value="done"` |
| `property:remove` | Remove a property           | `obsidian property:remove "note.md" key="draft"`            |
| `aliases`         | List note aliases           | `obsidian aliases "note.md"`                                |

### Links

| Command      | Description                  | Example                        |
| ------------ | ---------------------------- | ------------------------------ |
| `links`      | Outgoing links from note     | `obsidian links "note.md"`     |
| `backlinks`  | Notes linking TO this note   | `obsidian backlinks "note.md"` |
| `unresolved` | Broken/unresolved links      | `obsidian unresolved`          |
| `orphans`    | Notes with no links          | `obsidian orphans`             |
| `deadends`   | Notes with no outgoing links | `obsidian deadends`            |

### Tags

| Command | Description             | Example                       |
| ------- | ----------------------- | ----------------------------- |
| `tags`  | All tags with counts    | `obsidian tags`               |
| `tag`   | Notes with specific tag | `obsidian tag name="project"` |

### Tasks

| Command | Description            | Example                       |
| ------- | ---------------------- | ----------------------------- |
| `tasks` | All tasks across vault | `obsidian tasks`              |
| `task`  | Query/filter tasks     | `obsidian task status="open"` |

### Daily Notes

| Command         | Description               | Example                                       |
| --------------- | ------------------------- | --------------------------------------------- |
| `daily`         | Open/create today's note  | `obsidian daily`                              |
| `daily:path`    | Print daily note path     | `obsidian daily:path`                         |
| `daily:read`    | Read today's note content | `obsidian daily:read`                         |
| `daily:append`  | Append to daily note      | `obsidian daily:append content="- Done"`      |
| `daily:prepend` | Prepend to daily note     | `obsidian daily:prepend content="## Morning"` |

### Templates

| Command           | Description               | Example                                 |
| ----------------- | ------------------------- | --------------------------------------- |
| `templates`       | List templates            | `obsidian templates`                    |
| `template:read`   | Read template content     | `obsidian template:read name="meeting"` |
| `template:insert` | Insert template into note | `obsidian template:insert name="daily"` |

### Bases (Database Views)

| Command       | Description          | Example                               |
| ------------- | -------------------- | ------------------------------------- |
| `bases`       | List all bases       | `obsidian bases`                      |
| `base:views`  | List views of a base | `obsidian base:views "projects.base"` |
| `base:create` | Create a base        | `obsidian base:create "tasks.base"`   |
| `base:query`  | Query a base         | `obsidian base:query "projects.base"` |

### Plugins

| Command            | Description            | Example                                    |
| ------------------ | ---------------------- | ------------------------------------------ |
| `plugins`          | List installed plugins | `obsidian plugins`                         |
| `plugins:enabled`  | List enabled plugins   | `obsidian plugins:enabled`                 |
| `plugin:enable`    | Enable a plugin        | `obsidian plugin:enable id="dataview"`     |
| `plugin:disable`   | Disable a plugin       | `obsidian plugin:disable id="dataview"`    |
| `plugin:install`   | Install from community | `obsidian plugin:install id="dataview"`    |
| `plugin:uninstall` | Remove a plugin        | `obsidian plugin:uninstall id="plugin-id"` |
| `plugin:reload`    | Reload a plugin        | `obsidian plugin:reload id="dataview"`     |

### Vault

| Command      | Description        |
| ------------ | ------------------ |
| `vault`      | Current vault info |
| `vaults`     | List all vaults    |
| `vault:open` | Open a vault       |
| `version`    | Obsidian version   |
| `reload`     | Reload vault       |
| `restart`    | Restart Obsidian   |

### Developer

| Command          | Description         |
| ---------------- | ------------------- |
| `eval`           | Evaluate JavaScript |
| `devtools`       | Open DevTools       |
| `dev:screenshot` | Take screenshot     |
| `dev:errors`     | Show console errors |
| `dev:css`        | Inspect CSS         |
| `dev:dom`        | Inspect DOM         |
| `dev:console`    | Read console output |

### Misc

| Command               | Description              |
| --------------------- | ------------------------ |
| `wordcount "note.md"` | Word/char/sentence count |
| `outline "note.md"`   | Heading outline          |
| `random`              | Open random note         |
| `random:read`         | Read random note         |
| `bookmarks`           | List bookmarks           |
| `recents`             | Recently opened files    |

---

## Dataview Query Language (DQL) — Full Reference

### Query Structure

```
QUERY_TYPE [WITHOUT ID] [fields]
FROM source [AND/OR source]
WHERE condition
SORT field [ASC|DESC]
GROUP BY field
FLATTEN field
LIMIT number
```

### Query Types

| Type       | Purpose       | Example                          |
| ---------- | ------------- | -------------------------------- |
| `TABLE`    | Tabular data  | `TABLE status, due FROM "tasks"` |
| `LIST`     | Simple list   | `LIST FROM #project`             |
| `TASK`     | Task items    | `TASK FROM "projects"`           |
| `CALENDAR` | Calendar view | `CALENDAR file.day`              |

`WITHOUT ID` hides the file link column: `TABLE WITHOUT ID title, status`

### Sources (FROM)

| Source   | Syntax                 | Example                                        |
| -------- | ---------------------- | ---------------------------------------------- |
| Folder   | `"folder"`             | `FROM "projects"`                              |
| Tag      | `#tag`                 | `FROM #meeting`                                |
| Link     | `[[note]]`             | `FROM [[Project Alpha]]` (notes linking to it) |
| Outlinks | `outgoing([[note]])`   | Notes linked FROM this note                    |
| Exclude  | `-"folder"` or `-#tag` | `FROM "notes" AND -"archive"`                  |
| Combine  | `AND` / `OR`           | `FROM #project AND "2026"`                     |

### Operators

| Operator             | Purpose              | Example                                         |
| -------------------- | -------------------- | ----------------------------------------------- |
| `=`                  | Equals               | `WHERE status = "active"`                       |
| `!=`                 | Not equals           | `WHERE status != "done"`                        |
| `>`, `<`, `>=`, `<=` | Comparison           | `WHERE priority > 2`                            |
| `contains()`         | List/string contains | `WHERE contains(tags, "urgent")`                |
| `AND`, `OR`          | Logical              | `WHERE status = "active" AND priority = "high"` |
| `!`                  | Negation             | `WHERE !completed`                              |

### Implicit Fields

| Field              | Type     | Description                       |
| ------------------ | -------- | --------------------------------- |
| `file.name`        | text     | Filename without extension        |
| `file.path`        | text     | Full path from vault root         |
| `file.folder`      | text     | Parent folder path                |
| `file.link`        | link     | Clickable link to the file        |
| `file.ctime`       | datetime | Creation time                     |
| `file.mtime`       | datetime | Last modification time            |
| `file.cday`        | date     | Creation date                     |
| `file.mday`        | date     | Last modification date            |
| `file.size`        | number   | Size in bytes                     |
| `file.ext`         | text     | File extension                    |
| `file.tags`        | list     | All tags (frontmatter + inline)   |
| `file.etags`       | list     | Explicit tags only                |
| `file.outlinks`    | list     | Outgoing links                    |
| `file.inlinks`     | list     | Backlinks                         |
| `file.aliases`     | list     | Aliases                           |
| `file.tasks`       | list     | All tasks                         |
| `file.lists`       | list     | All list items                    |
| `file.frontmatter` | object   | Raw frontmatter                   |
| `file.day`         | date     | Date from filename (if parseable) |
| `file.starred`     | bool     | Whether bookmarked                |

### Functions

**String:**
| Function | Description |
|----------|-------------|
| `contains(str, sub)` | Substring check |
| `startswith(str, prefix)` | Starts with |
| `endswith(str, suffix)` | Ends with |
| `upper(str)` / `lower(str)` | Case conversion |
| `replace(str, from, to)` | String replace |
| `regexmatch(pattern, str)` | Regex match (bool) |
| `regexreplace(str, pat, rep)` | Regex replace |
| `length(str)` | Character count |
| `padleft(str, len, char)` | Left pad |
| `padright(str, len, char)` | Right pad |
| `split(str, sep)` | Split to list |
| `join(list, sep)` | Join list to string |
| `substring(str, start, end)` | Substring |

**Date/Time:**
| Function | Description |
|----------|-------------|
| `date(any)` | Parse to date |
| `date(today)` | Today |
| `date(now)` | Now with time |
| `date(tomorrow)` / `date(yesterday)` | Relative dates |
| `dateformat(date, "format")` | Format date (Luxon) |
| `dur(value)` | Duration: `dur(2 days)` |

**List:**
| Function | Description |
|----------|-------------|
| `length(list)` | Item count |
| `contains(list, item)` | Contains check |
| `sort(list)` | Sort ascending |
| `reverse(list)` | Reverse |
| `flat(list)` | Flatten nested lists |
| `filter(list, fn)` | Filter items |
| `map(list, fn)` | Transform items |
| `all(list, fn)` | All match |
| `any(list, fn)` | Any match |
| `nonnull(list)` | Remove nulls |

**Numeric:**
| Function | Description |
|----------|-------------|
| `sum(list)` | Sum values |
| `min(a, b)` / `max(a, b)` | Min/max |
| `average(list)` | Average |
| `round(num, digits)` | Round |
| `trunc(num)` | Truncate to int |

**Utility:**
| Function | Description |
|----------|-------------|
| `default(val, fallback)` | Fallback for null |
| `choice(cond, yes, no)` | Ternary |
| `link(path, alias)` | Create link |
| `embed(link)` | Create embed |
| `typeof(val)` | Type name |
| `object(key1, val1, ...)` | Create object |
| `list(val1, val2, ...)` | Create list |

### Date Formats (Luxon)

| Token                | Output                 |
| -------------------- | ---------------------- |
| `yyyy`               | 2026                   |
| `MM`                 | 03                     |
| `dd`                 | 10                     |
| `EEE`                | Mon                    |
| `EEEE`               | Monday                 |
| `MMM`                | Mar                    |
| `MMMM`               | March                  |
| `HH:mm`              | 14:30                  |
| `cccc, LLLL d, yyyy` | Monday, March 10, 2026 |

---

## DataviewJS

For advanced queries, use `dataviewjs` code blocks with the `dv` API:

````markdown
```dataviewjs
// Table of active projects with progress bars
let projects = dv.pages("#project")
    .where(p => p.status === "active")
    .sort(p => p.priority, 'asc');

dv.table(
    ["Project", "Status", "Due", "Progress"],
    projects.map(p => [
        p.file.link,
        p.status,
        p.due || "—",
        `${"█".repeat(p.progress || 0)}${"░".repeat(10 - (p.progress || 0))} ${(p.progress || 0) * 10}%`
    ])
);
```
````

### Key `dv` API Methods

| Method                        | Description                             |
| ----------------------------- | --------------------------------------- |
| `dv.pages("source")`          | Query pages (same source syntax as DQL) |
| `dv.page("path")`             | Get single page                         |
| `dv.current()`                | Current file metadata                   |
| `dv.table(headers, rows)`     | Render table                            |
| `dv.list(items)`              | Render list                             |
| `dv.taskList(tasks, grouped)` | Render tasks                            |
| `dv.paragraph(text)`          | Render text                             |
| `dv.header(level, text)`      | Render heading                          |
| `dv.el(tag, text, attrs)`     | Render HTML element                     |
| `dv.span(text)`               | Inline text                             |
| `dv.io.load(path)`            | Read file content                       |

### DataviewJS Examples

**Weekly review — tasks completed this week:**

````markdown
```dataviewjs
let start = dv.date("sow");  // start of week
let tasks = dv.pages('"projects"')
    .file.tasks
    .where(t => t.completed && t.completion >= start);
dv.taskList(tasks, false);
```
````

**MOC (Map of Content) auto-generator:**

````markdown
```dataviewjs
let folder = dv.current().file.folder;
let pages = dv.pages(`"${folder}"`)
    .where(p => p.file.name !== dv.current().file.name)
    .sort(p => p.file.name, 'asc');
dv.list(pages.map(p => p.file.link));
```
````

---

## Property Type Reference

How to set each property type in YAML frontmatter:

| Type         | Syntax                     | Notes                                |
| ------------ | -------------------------- | ------------------------------------ |
| Text         | `key: "value"`             | Quote if contains `:`, `#`, `[`, `]` |
| Number       | `key: 42`                  | No quotes                            |
| Boolean      | `key: true`                | Lowercase `true`/`false`             |
| Date         | `key: 2026-03-10`          | ISO 8601, no quotes                  |
| DateTime     | `key: 2026-03-10T14:30:00` | With time                            |
| List         | `key: [a, b, c]`           | Inline                               |
| List (multi) | `key:\n  - a\n  - b`       | Multi-line                           |
| Link         | `key: "[[Note]]"`          | Must quote                           |
| Link list    | `key: ["[[A]]", "[[B]]"]`  | Must quote each                      |

---

## Canvas JSON Format

`.canvas` files are JSON with this structure:

```json
{
  "nodes": [
    {
      "id": "unique-id",
      "type": "text",
      "text": "Card content in **markdown**",
      "x": 0,
      "y": 0,
      "width": 250,
      "height": 140,
      "color": "1"
    },
    {
      "id": "note-card",
      "type": "file",
      "file": "path/to/note.md",
      "x": 300,
      "y": 0,
      "width": 250,
      "height": 140
    },
    {
      "id": "link-card",
      "type": "link",
      "url": "https://example.com",
      "x": 600,
      "y": 0,
      "width": 250,
      "height": 140
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "fromNode": "unique-id",
      "toNode": "note-card",
      "fromSide": "right",
      "toSide": "left",
      "label": "relates to"
    }
  ]
}
```

Node types: `text`, `file`, `link`, `group`
Colors: `"1"` through `"6"` (red, orange, yellow, green, cyan, purple) or hex `"#RRGGBB"`
Sides: `top`, `right`, `bottom`, `left`
