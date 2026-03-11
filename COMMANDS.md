# Custom Telegram Commands

## /tulsday

Context manager — track current focus, priorities, and state.

When a user sends `/tulsday`, run the shift manager status command and report the result:

```bash
cd /Users/tulioferro/.openclaw/workspace && npx tsx scripts/shift-manager.ts status
```

If no shift is active, offer to start one:

- "No active shift. Start a tulsday shift?" → run `npx tsx scripts/shift-manager.ts start tulsday`

Sub-commands (passed as arguments after `/tulsday`):

- `/tulsday start` → `npx tsx scripts/shift-manager.ts start tulsday`
- `/tulsday end` → `npx tsx scripts/shift-manager.ts end`
- `/tulsday extend <hours>` → `npx tsx scripts/shift-manager.ts extend <hours>`
- `/tulsday shorten <hours>` → `npx tsx scripts/shift-manager.ts shorten <hours>`
- `/tulsday handoff` → `npx tsx scripts/shift-manager.ts handoff`

Always report the output to the user in a concise format.

## /builder

Orchestrator — spawn agents, manage repo, coordinate tasks.

When a user sends `/builder`, start a builder shift:

```bash
cd /Users/tulioferro/.openclaw/workspace && npx tsx scripts/shift-manager.ts start builder
```

Sub-commands:

- `/builder start` → `npx tsx scripts/shift-manager.ts start builder`
- `/builder status` → `npx tsx scripts/builder-task-manager.ts status`
- `/builder cancel <id>` → `npx tsx scripts/builder-task-manager.ts cancel <id> --notes "cancelled by user"`
- `/builder end` → `npx tsx scripts/shift-manager.ts end`

In builder mode, the agent should focus on heavy-lifting coding tasks:

- Prioritize repo work, code changes, and automation
- Use sub-agents/background workers for scoped heavy tasks
- Register background work in `state/background-tasks.json` via `scripts/builder-task-manager.ts`
- Keep main chat responsive while background work runs
- Report progress/status periodically (`/builder status`)

Builder mode is task-scoped; it does not self-activate or run autonomous 24/7 patrol behavior.

## /build

Dispatch a coding/build task to the builder agent on Mac Mini.

When a user sends `/build <project> [spec]` or describes a build task, do the following:

### 1. Parse the request

Extract:

- **Project name** — the thing to build (e.g., `landing-page`, `cli-tool`, `api-server`)
- **Spec** — what to build (can be inline text or "see queue" if a spec file was already dropped)
- **Mode** — `overnight` (queue it, no hurry) or `now` (start immediately)

If the spec is too short or vague, ask clarifying questions before queuing.

### 2. Write a spec file to the build queue

Write a spec file to `/Users/tulioferro/.openclaw/builds/queue/<project>-<timestamp>.spec.md`:

```markdown
# Build Spec: <project>

**Requested:** <datetime BRT>
**Mode:** overnight | now
**Requester:** Tulio

## What to Build

<spec text>

## Tech Stack

<inferred or specified by user>

## Output

- Repo path: ~/projects/<project>
- Branch: build/<project>-<YYYYMMDD>

## Notes

<any extra context>
```

Confirm to the user: "✅ Queued: `<project>`. Spec saved. Builder will pick it up."

### 3. If mode is `now`, dispatch immediately

Call the builder agent:

```bash
openclaw agent --agent builder --json --message "Build task: <project>. Spec at ~/.openclaw/builds/queue/<spec-file>. Start now."
```

Report the agent's acknowledgment back to the user.

### 4. Sub-commands

- `/build status` — check what's in queue, active, done
  ```bash
  ls ~/.openclaw/builds/queue/ && echo "---active---" && ls ~/.openclaw/builds/active/ && echo "---done---" && ls ~/.openclaw/builds/done/ | tail -5
  ```
- `/build report [project]` — read the latest build report
  ```bash
  cat $(ls -t ~/.openclaw/builds/done/*.md 2>/dev/null | head -1)
  ```
- `/build cancel` — clear the queue (ask for confirmation first)

### 5. Natural language patterns

Also recognize these without the `/build` prefix:

- "build me a <thing>" → parse as `/build`
- "build this overnight" → mode: overnight
- "start the build now" → mode: now
- "what's building?" → `/build status`
- "show me the build report" → `/build report`

## /rule

Add or update a behavior, policy, or rule in the workspace SOPs.

When a user sends `/rule <description>`, follow the Rule & Policy Routing protocol in RUNBOOK.md section 9:

1. Parse the rule description from the user's message
2. Classify: is this a general SOP rule (all agents) or agent-specific?
3. Identify the target file and section
4. Confirm with the user before writing
5. Apply using the update script:

```bash
cd /Users/tulioferro/.openclaw/workspace && npx tsx scripts/update-rule.ts \
  --target <target> --section "<section>" --rule "<rule text>"
```

6. Log the change to `memory/CHANGELOG.md`

The agent should also detect natural language rule commands without the `/rule` prefix (see RUNBOOK.md section 9 for detection patterns).

Examples:

- `/rule never deploy on Fridays` → RUNBOOK.md, Guardrails section
- `/rule builder must run tests before committing` → IDENTITY.md, Builder mode section
- `/rule always use BRT timezone in reports` → AGENTS.md, Coding Style section
