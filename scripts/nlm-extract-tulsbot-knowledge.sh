#!/usr/bin/env bash
# Extract and chunk Tulsbot knowledge from core-app-knowledge.json into
# domain-specific markdown slices for NotebookLM upload.
#
# Usage:
#   scripts/nlm-extract-tulsbot-knowledge.sh
#
# Reads:
#   Tulsbot/.tulsbot/core-app-knowledge.json
#
# Produces (in .local/nlm/tulsbot/):
#   workspace-architecture.md   — workspace structure, settings, integrations
#   automation-patterns.md      — automation rules, triggers, workflows, protocols
#   agent-roster.md             — 17 agent definitions, capabilities, coordination
#   notion-schemas.md           — database schemas, page templates, API patterns
#
# Requires:
#   - Python 3.10+
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TULSBOT_ROOT="${TULSBOT_ROOT:-$HOME/Backend_local Macbook/Tulsbot}"
KNOWLEDGE_JSON="$TULSBOT_ROOT/.tulsbot/core-app-knowledge.json"
OUTPUT_DIR="$REPO_ROOT/knowledge-slices"

# ── Preflight ──────────────────────────────────────────────────────────────────
if [ ! -f "$KNOWLEDGE_JSON" ]; then
  echo "Error: core-app-knowledge.json not found at:"
  echo "  $KNOWLEDGE_JSON"
  echo ""
  echo "Ensure Tulsbot/.tulsbot/core-app-knowledge.json exists (synced from Notion)."
  exit 1
fi

command -v python3 >/dev/null 2>&1 || {
  echo "Error: python3 not found. Python 3.10+ is required."
  exit 1
}

# ── Extract ────────────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR"

echo "Extracting Tulsbot knowledge from core-app-knowledge.json..."
echo "  Source: $KNOWLEDGE_JSON"
echo "  Output: $OUTPUT_DIR/"
echo ""

# Export variables for Python heredoc
export KNOWLEDGE_JSON
export OUTPUT_DIR

python3 << 'PYEOF'
import json
import sys
import os
import re

# Use environment variables exported from the shell script
knowledge_file = os.environ["KNOWLEDGE_JSON"]
output_dir = os.environ["OUTPUT_DIR"]

# ── Load JSON ──────────────────────────────────────────────────────────────────
try:
    with open(knowledge_file, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    print(f"Error reading JSON: {e}", file=sys.stderr)
    sys.exit(1)

tulsbot_md = data.get("tulsbotMd", "")
agents = data.get("agents", [])

if not tulsbot_md:
    print("Error: tulsbotMd field is empty or missing.", file=sys.stderr)
    sys.exit(1)

lines = tulsbot_md.split("\n")
total_lines = len(lines)
print(f"  tulsbotMd: {total_lines:,} lines, {len(tulsbot_md):,} chars")
print(f"  agents: {len(agents)} entries")

# ── Find H1 headings (first occurrence only) ──────────────────────────────────
# tulsbotMd contains massive duplication — the same sections repeat dozens of
# times (memory snapshot / changelog pattern). We only take the FIRST occurrence
# of each heading plus unique late sections.
#
# Layout (confirmed via prior analysis):
#   L0-L1037:      pre-H1 content (License Control sub-H2s)
#   L1038:         # Agent Registry
#   L1430:         # Data Access Protocol (MANDATORY)
#   L1958:         # Core Knowledge Policy (MANDATORY)
#   L2312:         # Internal Container: File Storage Architecture
#   L2776:         # Handshakes & Bot Coordination
#   L2880:         # Recent Improvements
#   L2960:         # Active Processes
#   L3040:         # Memory Churning Status
#   L3152:         # Tulsbot Learned (Brain Nodes)
#   L3264:         # Conflict Resolution Policy
#   L3328:         # Key File References
#   L3504:         # Next Steps
#   L3576:         # Archive & Transcript References
#   L3834+:        DUPLICATE BLOCK (skip)
#   L4442:         # Current System State (unique)
#   L4618:         # Mandatory Protocols (unique)
#   L5862:         # Memory System (unique)
#   L6294:         # Implemented Systems (unique)
#   L7342+:        Repeated cycles (skip all)

def find_h1_positions(lines):
    """Find all H1 heading positions and their titles."""
    positions = []
    for i, line in enumerate(lines):
        if line.startswith("# "):
            positions.append((i, line.strip()))
    return positions

h1s = find_h1_positions(lines)

# Build a set of seen headings to detect first occurrences
seen_headings = set()
first_occurrence_ranges = []  # (start_line, end_line, heading_title)

# Also track unique late sections by position
DUPLICATE_START = 3834
UNIQUE_LATE_START = 4442
SKIP_AFTER = 7342

for idx, (line_num, title) in enumerate(h1s):
    # Skip anything after the repeated cycles cutoff
    if line_num >= SKIP_AFTER:
        break

    # Determine end of this section (next H1 or end of relevant range)
    if idx + 1 < len(h1s):
        next_h1_line = h1s[idx + 1][0]
    else:
        next_h1_line = min(total_lines, SKIP_AFTER)

    # For the duplicate block region, only take headings we haven't seen
    if DUPLICATE_START <= line_num < UNIQUE_LATE_START:
        if title in seen_headings:
            continue  # Skip duplicate

    # For unique late sections, always include
    if line_num >= UNIQUE_LATE_START:
        end = min(next_h1_line, SKIP_AFTER)
        first_occurrence_ranges.append((line_num, end, title))
        seen_headings.add(title)
        continue

    # For the first block (before duplicates), always include
    if line_num < DUPLICATE_START:
        first_occurrence_ranges.append((line_num, min(next_h1_line, DUPLICATE_START if next_h1_line > DUPLICATE_START else next_h1_line), title))
        seen_headings.add(title)

# Also capture the pre-H1 content (L0-L1037)
PRE_H1_END = h1s[0][0] if h1s else total_lines

def get_lines(start, end):
    """Extract lines from start (inclusive) to end (exclusive)."""
    return "\n".join(lines[start:end])

# ── Slice into domains ─────────────────────────────────────────────────────────
# Mapping headings to domain slices:
#
# workspace-architecture.md:
#   - Pre-H1 content (L0-L1037): License Control, workspace structure
#   - Internal Container: File Storage Architecture
#   - Current System State
#
# automation-patterns.md:
#   - Data Access Protocol (MANDATORY)
#   - Mandatory Protocols
#   - Memory System
#   - Implemented Systems
#
# agent-roster.md:
#   - Agent Registry
#   - Core Knowledge Policy (MANDATORY)
#   - Handshakes & Bot Coordination
#   - Recent Improvements / Active Processes / Memory Churning Status
#
# notion-schemas.md:
#   - Internal Container: File Storage Architecture (subset — database schemas)
#   - Tulsbot Learned (Brain Nodes)
#   - Key File References

WORKSPACE_HEADINGS = {
    None,  # pre-H1 content
    "# Internal Container: File Storage Architecture",
    "# Current System State",
    "# Conflict Resolution Policy",
    "# Archive & Transcript References",
}

AUTOMATION_HEADINGS = {
    "# Data Access Protocol (MANDATORY)",
    "# Mandatory Protocols",
    "# Memory System",
    "# Implemented Systems",
    "# Next Steps",
}

AGENT_HEADINGS = {
    "# Agent Registry",
    "# Core Knowledge Policy (MANDATORY)",
    "# Handshakes & Bot Coordination",
    "# Recent Improvements",
    "# Active Processes",
    "# Memory Churning Status",
}

NOTION_HEADINGS = {
    "# Internal Container: File Storage Architecture",
    "# Tulsbot Learned (Brain Nodes)",
    "# Key File References",
}

def build_slice(heading_set, include_pre_h1=False):
    """Collect content sections for a given set of headings."""
    parts = []

    # Pre-H1 content if requested
    if include_pre_h1 and None in heading_set:
        pre_h1 = get_lines(0, PRE_H1_END)
        if pre_h1.strip():
            parts.append(pre_h1)

    # Sections matching the heading set
    for start, end, title in first_occurrence_ranges:
        if title in heading_set:
            section = get_lines(start, end)
            if section.strip():
                parts.append(section)

    return "\n\n---\n\n".join(parts)

workspace_content = build_slice(WORKSPACE_HEADINGS, include_pre_h1=True)
automation_content = build_slice(AUTOMATION_HEADINGS)
agent_content = build_slice(AGENT_HEADINGS)
notion_content = build_slice(NOTION_HEADINGS)

# ── Enrich agent-roster with structured agent data ─────────────────────────────
if agents:
    agent_section = "\n\n---\n\n# Agent Definitions (Structured)\n\n"
    agent_section += "| # | Name | Role | Status |\n"
    agent_section += "|---|------|------|--------|\n"
    for i, agent in enumerate(agents, 1):
        name = agent.get("name", "Unknown")
        role = agent.get("role", agent.get("description", "—"))
        status = agent.get("status", "active")
        # Truncate long roles for table readability
        if len(role) > 80:
            role = role[:77] + "..."
        agent_section += f"| {i} | {name} | {role} | {status} |\n"

    agent_content += agent_section

# ── Write slices ───────────────────────────────────────────────────────────────
slices = {
    "workspace-architecture.md": workspace_content,
    "automation-patterns.md": automation_content,
    "agent-roster.md": agent_content,
    "notion-schemas.md": notion_content,
}

for filename, content in slices.items():
    path = os.path.join(output_dir, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    size = len(content.encode("utf-8"))
    line_count = content.count("\n") + 1
    print(f"  → {filename}: {line_count:,} lines, {size:,} bytes")

print(f"\n  Total slices: {len(slices)}")
PYEOF

# ── Report ─────────────────────────────────────────────────────────────────────
echo ""
echo "Extraction complete. Files in: $OUTPUT_DIR/"
echo ""
ls -lh "$OUTPUT_DIR/"*.md 2>/dev/null || echo "  (no files found — check Python output above)"
echo ""
echo "Next steps:"
echo "  1. Review slices in $OUTPUT_DIR/"
echo "  2. Upload to Tulsbot notebooks: scripts/nlm-seed-tulsbot.sh"
echo "  3. Or refresh existing notebooks: scripts/nlm-sync-tulsbot.sh"
