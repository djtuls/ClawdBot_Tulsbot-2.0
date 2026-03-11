#!/usr/bin/env python3
"""
obsidian_tools.py — Tulsbot utility for Obsidian vault operations.

Usage:
  python3 scripts/obsidian_tools.py --vault ~/path/to/vault --action <action> [options]

Actions:
  search          Full-text search
  find-tag        Find notes with a tag
  list-projects   List active projects
  open-tasks      List all open tasks
  orphans         Find notes with no links
  backlinks       Find notes linking to a given note
  daily           Print today's daily note path
  health          Vault health check report

Requires: pyyaml (pip install pyyaml)
"""

import os
import re
import sys
import yaml
import argparse
from datetime import date
from pathlib import Path
from typing import Optional


PRIORITY_ORDER = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def iter_notes(vault_path: str):
    """Iterate over all .md files in vault, skipping hidden dirs."""
    for root, dirs, files in os.walk(vault_path):
        dirs[:] = sorted([d for d in dirs if not d.startswith('.')])
        for f in sorted(files):
            if f.endswith('.md'):
                yield os.path.join(root, f)


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from note content. Returns (fm_dict, body)."""
    if not content.startswith('---'):
        return {}, content
    end = content.find('---', 3)
    if end < 0:
        return {}, content
    try:
        fm = yaml.safe_load(content[3:end]) or {}
    except yaml.YAMLError:
        fm = {}
    return fm, content[end + 3:].strip()


def relative_path(vault_path: str, filepath: str) -> str:
    return os.path.relpath(filepath, vault_path)


def extract_wikilinks(content: str) -> list[str]:
    """Extract all [[wikilinks]] from content (note name only, no heading/alias)."""
    return re.findall(r'\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]', content)


def extract_tags(content: str, fm: dict) -> list[str]:
    """Collect all tags (frontmatter + inline #tags), deduplicated."""
    fm_tags = fm.get('tags', []) or []
    if isinstance(fm_tags, str):
        fm_tags = [fm_tags]
    inline = re.findall(r'(?:^|\s)#([\w/\-]+)', content)
    return list(set(fm_tags + inline))


def read_note(filepath: str) -> str:
    return Path(filepath).read_text(encoding='utf-8', errors='backslashreplace')


# ─── Actions ─────────────────────────────────────────────────────────────────

def action_search(vault_path: str, query: str, max_results: int = 20):
    """Full-text search with ranked results and context."""
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    results = []

    for fp in iter_notes(vault_path):
        text = read_note(fp)
        matches = pattern.findall(text)
        if matches:
            lines = [l for l in text.splitlines() if pattern.search(l)][:3]
            results.append({
                'file': relative_path(vault_path, fp),
                'matches': len(matches),
                'preview': lines,
            })

    results.sort(key=lambda x: x['matches'], reverse=True)
    print(f"\nSearch: \"{query}\" — {len(results)} notes matched\n")
    for r in results[:max_results]:
        print(f"  {r['file']} ({r['matches']} matches)")
        for line in r['preview']:
            print(f"    > {line.strip()}")
        print()


def action_find_tag(vault_path: str, tag: str):
    """Find notes with a specific tag (including nested children)."""
    found = []
    for fp in iter_notes(vault_path):
        content = read_note(fp)
        fm, body = parse_frontmatter(content)
        tags = extract_tags(body, fm)
        if tag in tags or any(t.startswith(tag + '/') for t in tags):
            found.append(relative_path(vault_path, fp))

    print(f"\nNotes tagged #{tag} ({len(found)}):\n")
    for f in found:
        print(f"  - {f}")


def action_list_projects(vault_path: str):
    """List all active projects sorted by priority then deadline."""
    projects = []
    for fp in iter_notes(vault_path):
        content = read_note(fp)
        fm, _ = parse_frontmatter(content)
        if fm.get('type') == 'project' and fm.get('status', 'active') == 'active':
            projects.append({
                'title': fm.get('title', Path(fp).stem),
                'code': fm.get('project-code', ''),
                'client': fm.get('client', ''),
                'deadline': str(fm.get('deadline', '')),
                'priority': fm.get('priority', 'medium'),
                'file': relative_path(vault_path, fp),
            })

    projects.sort(key=lambda x: (
        PRIORITY_ORDER.get(x['priority'], 9),
        x['deadline'] or '9999-99-99',
    ))

    print(f"\nActive Projects ({len(projects)}):\n")
    print(f"  {'Code':<8} {'Title':<35} {'Client':<20} {'Deadline':<12} {'Priority'}")
    print(f"  {'-' * 87}")
    for p in projects:
        print(
            f"  {p['code']:<8} {p['title'][:34]:<35} "
            f"{str(p['client'])[:19]:<20} {p['deadline']:<12} {p['priority']}"
        )


def action_open_tasks(vault_path: str):
    """List all open [ ] tasks across the vault."""
    task_pattern = re.compile(r'^\s*- \[ \] (.+)', re.MULTILINE)
    all_tasks = []

    for fp in iter_notes(vault_path):
        rel = relative_path(vault_path, fp)
        if 'Archive' in rel or 'Templates' in rel or 'Template' in rel:
            continue
        content = read_note(fp)
        tasks = task_pattern.findall(content)
        for t in tasks:
            all_tasks.append({'task': t.strip(), 'file': rel})

    print(f"\nOpen Tasks ({len(all_tasks)}):\n")
    for t in all_tasks:
        print(f"  [ ] {t['task']}")
        print(f"      {t['file']}")


def action_orphans(vault_path: str):
    """Find notes with no inlinks and no outlinks."""
    note_titles: dict[str, str] = {}
    for fp in iter_notes(vault_path):
        note_titles[Path(fp).stem] = fp

    inlinks: dict[str, set] = {stem: set() for stem in note_titles}
    outlinks: dict[str, set] = {stem: set() for stem in note_titles}

    for stem, fp in note_titles.items():
        content = read_note(fp)
        links = extract_wikilinks(content)
        for link in links:
            outlinks[stem].add(link)
            if link in inlinks:
                inlinks[link].add(stem)

    skip_patterns = ('Daily', 'Inbox', 'Template', 'MOC')
    orphans = [
        stem for stem in note_titles
        if not inlinks[stem] and not outlinks[stem]
        and not any(p in note_titles[stem] for p in skip_patterns)
    ]

    print(f"\nOrphan Notes — no links in or out ({len(orphans)}):\n")
    for o in sorted(orphans):
        print(f"  - {relative_path(vault_path, note_titles[o])}")


def action_backlinks(vault_path: str, note_name: str):
    """Find all notes that link to a given note."""
    pattern = re.compile(rf'\[\[{re.escape(note_name)}(?:[|#][^\]]*)?\]\]')
    found = []

    for fp in iter_notes(vault_path):
        content = read_note(fp)
        if pattern.search(content):
            found.append(relative_path(vault_path, fp))

    print(f"\nBacklinks to [[{note_name}]] ({len(found)}):\n")
    for f in found:
        print(f"  <- {f}")


def action_daily(vault_path: str, day: Optional[str] = None):
    """Print the path to today's (or given) daily note."""
    d = date.fromisoformat(day) if day else date.today()
    year = d.strftime('%Y')
    month = d.strftime('%m-%B')
    filename = d.isoformat() + '.md'

    candidates = [
        os.path.join(vault_path, '01-Daily', year, month, filename),
        os.path.join(vault_path, '01-Daily', year, filename),
        os.path.join(vault_path, '01-Daily', filename),
        os.path.join(vault_path, 'Daily', year, month, filename),
        os.path.join(vault_path, 'Daily', year, filename),
        os.path.join(vault_path, 'Daily', filename),
    ]

    for path in candidates:
        if os.path.exists(path):
            print(f"Found: {relative_path(vault_path, path)}")
            return

    print(f"Daily note not found for {d.isoformat()}. Expected:")
    print(f"  {relative_path(vault_path, candidates[0])}")


def action_health(vault_path: str):
    """Vault health check — reports structural issues and a quality score."""
    total = 0
    no_frontmatter = 0
    no_tags = 0
    no_type = 0
    broken_links = 0
    total_links = 0
    note_titles: set[str] = set()

    for fp in iter_notes(vault_path):
        total += 1
        content = read_note(fp)
        fm, _ = parse_frontmatter(content)
        note_titles.add(Path(fp).stem)

        if not fm:
            no_frontmatter += 1
        if not fm.get('tags') and not fm.get('type'):
            no_tags += 1
        if not fm.get('type'):
            no_type += 1

    for fp in iter_notes(vault_path):
        content = read_note(fp)
        links = extract_wikilinks(content)
        total_links += len(links)
        for link in links:
            if link not in note_titles:
                broken_links += 1

    score = max(0, 100 - no_frontmatter - (no_tags // 2) - (broken_links // 3))

    print(f"""
Vault Health Report
{'=' * 40}
Vault:             {vault_path}
Total notes:       {total}
Total wikilinks:   {total_links}

Issues:
  Missing frontmatter: {no_frontmatter}
  Missing tags/type:   {no_tags}
  Missing type field:  {no_type}
  Broken wikilinks:    {broken_links}

Health Score: {score}/100
""")


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Tulsbot Obsidian Tools')
    parser.add_argument('--vault', required=True, help='Path to Obsidian vault')
    parser.add_argument(
        '--action', required=True,
        choices=[
            'search', 'find-tag', 'list-projects', 'open-tasks',
            'orphans', 'backlinks', 'daily', 'health',
        ],
    )
    parser.add_argument('--query', help='Search query')
    parser.add_argument('--tag', help='Tag to search for')
    parser.add_argument('--note', help='Note name for backlinks')
    parser.add_argument('--date', help='Date for daily note (YYYY-MM-DD)')
    parser.add_argument('--max', type=int, default=20, help='Max results for search')
    args = parser.parse_args()

    vault = os.path.expanduser(args.vault)
    if not os.path.isdir(vault):
        print(f"Error: Vault not found: {vault}", file=sys.stderr)
        sys.exit(1)

    actions = {
        'search': lambda: (
            action_search(vault, args.query, args.max) if args.query
            else sys.exit("Error: --query required for search")
        ),
        'find-tag': lambda: (
            action_find_tag(vault, args.tag) if args.tag
            else sys.exit("Error: --tag required")
        ),
        'list-projects': lambda: action_list_projects(vault),
        'open-tasks': lambda: action_open_tasks(vault),
        'orphans': lambda: action_orphans(vault),
        'backlinks': lambda: (
            action_backlinks(vault, args.note) if args.note
            else sys.exit("Error: --note required for backlinks")
        ),
        'daily': lambda: action_daily(vault, args.date),
        'health': lambda: action_health(vault),
    }

    actions[args.action]()


if __name__ == '__main__':
    main()
