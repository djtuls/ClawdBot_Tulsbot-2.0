#!/usr/bin/env python3
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/tulioferro/.openclaw/workspace')
STATE = ROOT / 'memory' / 'heartbeat-state.json'
OUT_JSON = ROOT / 'reports' / 'heartbeat-last-summary.json'
OUT_MD = ROOT / 'reports' / 'heartbeat-last-summary.md'

STEP_ORDER = [
    ('memorySyncSupabase', 'Memory sync → Supabase (cloud mirror)'),
    ('anythingLLMBackfill', 'AnythingLLM backfill (local RAG)'),
    ('contextWindow', 'Context window refresh'),
    ('tulsdaySync', 'Tulsday short-term memory sync'),
    ('briefBackfill', 'Brief backfill (context-window → memory)'),
    ('masterIndexer', 'Master indexer sync (tools, databases, docs → Supabase)'),
    ('notionPush', 'Notion status snapshot push'),
    ('dashboardSync', 'Notion Dashboard sync'),
    ('stateRefresh', 'STATE.md refresh'),
]


def run_heartbeat():
    cmd = ['/opt/homebrew/bin/node', '/opt/homebrew/bin/npx', 'tsx', 'scripts/run-heartbeat.ts']
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def load_state():
    if not STATE.exists():
        return {}
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}


def summarize(state, exit_code, stdout, stderr):
    tasks = state.get('tasks', {}) if isinstance(state, dict) else {}
    rows = []
    success = 0
    failed = 0
    for key, name in STEP_ORDER:
        t = tasks.get(key, {})
        st = t.get('status', 'UNKNOWN')
        details = (t.get('details') or '').strip()
        if st == 'SUCCEEDED':
            success += 1
            status = '✅'
        elif st == 'FAILED':
            failed += 1
            status = '❌'
        else:
            status = '⚪'
        rows.append({'key': key, 'name': name, 'status': st, 'emoji': status, 'details': details})

    summary = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'exit_code': exit_code,
        'success_count': success,
        'failure_count': failed,
        'rows': rows,
        'stdout_tail': '\n'.join(stdout.splitlines()[-50:]),
        'stderr_tail': '\n'.join(stderr.splitlines()[-50:]),
    }
    return summary


def render_md(s):
    lines = []
    lines.append('**Maintenance Heartbeat Summary**')
    lines.append('')
    lines.append(f"- Success: {s['success_count']}")
    lines.append(f"- Failed: {s['failure_count']}")
    lines.append(f"- Script exit code: {s['exit_code']}")
    lines.append('')
    lines.append('Step-by-step:')
    for i, r in enumerate(s['rows'], 1):
        detail = f" — {r['details']}" if r['details'] else ''
        lines.append(f"{i}. {r['emoji']} **{r['name']}** ({r['status']}){detail}")
    if s['stderr_tail'].strip():
        lines.append('')
        lines.append('Errors (tail):')
        lines.append('```')
        lines.append(s['stderr_tail'][:3500])
        lines.append('```')
    return '\n'.join(lines)


def main():
    code, out, err = run_heartbeat()
    state = load_state()
    summary = summarize(state, code, out, err)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(summary, indent=2))
    md = render_md(summary)
    OUT_MD.write_text(md)
    print(md)
    sys.exit(0 if summary['failure_count'] == 0 and code == 0 else 1)


if __name__ == '__main__':
    main()
