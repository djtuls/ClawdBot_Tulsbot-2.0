#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone

WATCH_PATHS = [
    Path.home() / '.cursor' / 'plans',
    Path.home() / '.cursor' / 'archive',
    Path.home() / '.cursor' / 'projects',
    Path.home() / '.cursor' / 'chat-registry.md',
]
STATE_PATH = Path.home() / '.openclaw' / 'state' / 'cursor-watcher-state.json'
OUT_PATH = Path.home() / '.openclaw' / 'workspace' / 'reports' / 'cursor-watcher-latest.json'
MAX_FILES = 800


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open('rb') as f:
        while True:
            b = f.read(65536)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def scan_files():
    files = []
    for root in WATCH_PATHS:
        if root.is_file():
            files.append(root)
            continue
        if not root.exists():
            continue
        for p in root.rglob('*'):
            if p.is_file():
                files.append(p)
                if len(files) >= MAX_FILES:
                    return files
    return files


def load_state():
    if not STATE_PATH.exists():
        return {'files': {}, 'initialized': False}
    return json.loads(STATE_PATH.read_text())


def save_state(st):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(st, indent=2))


def rel(p: Path) -> str:
    return str(p).replace(str(Path.home()), '~')


def run(mode='run'):
    state = load_state()
    prev = state.get('files', {})
    now = {}
    files = scan_files()

    for p in files:
        try:
            stat = p.stat()
            key = rel(p)
            now[key] = {
                'mtime': int(stat.st_mtime),
                'size': stat.st_size,
                'hash': sha256_file(p) if stat.st_size < 2_000_000 else f"size:{stat.st_size}",
            }
        except Exception:
            continue

    if mode == 'bootstrap' and not state.get('initialized'):
        state['files'] = now
        state['initialized'] = True
        save_state(state)
        report = {
            'initialized': True,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'new': [],
            'changed': [],
            'deleted': [],
            'count': len(now),
        }
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(report, indent=2))
        print(json.dumps({'bootstrapped': True, 'count': len(now)}))
        return

    prev_keys = set(prev.keys())
    now_keys = set(now.keys())
    new = sorted(now_keys - prev_keys)
    deleted = sorted(prev_keys - now_keys)
    changed = []
    for k in sorted(prev_keys & now_keys):
        a, b = prev[k], now[k]
        if a.get('hash') != b.get('hash') or a.get('size') != b.get('size') or a.get('mtime') != b.get('mtime'):
            changed.append(k)

    report = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'new': new[:100],
        'changed': changed[:100],
        'deleted': deleted[:100],
        'counts': {'new': len(new), 'changed': len(changed), 'deleted': len(deleted), 'tracked': len(now)},
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, indent=2))

    state['files'] = now
    state['initialized'] = True
    save_state(state)
    print(json.dumps(report))


if __name__ == '__main__':
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else 'run'
    run(mode)
