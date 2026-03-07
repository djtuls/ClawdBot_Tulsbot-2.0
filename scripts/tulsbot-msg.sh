#!/usr/bin/env bash
# tulsbot-msg.sh — tulsCodex direct line to Tulsbot
# Usage:
#   tulsbot-msg.sh "your message"          → real-time, fresh daily session
#   tulsbot-msg.sh --async "note to leave" → writes to tulscodex-channel.md only (no wait)
#
# Always uses session-id tulscodex-YYYYMMDD so context stays fresh each day.

set -euo pipefail

CHANNEL_FILE="$HOME/.openclaw/workspace/memory/tulscodex-channel.md"
SESSION_ID="tulscodex-$(date +%Y%m%d)"

if [[ "${1:-}" == "--async" ]]; then
    shift
    MSG="${1:-}"
    TS="$(date -u +%Y-%m-%dT%H:%MZ)"
    # Append to channel file under pending section
    python3 - <<PYEOF
import re, pathlib, sys

path = pathlib.Path("$CHANNEL_FILE")
content = path.read_text()
entry = """
### [${TS}] Async note from tulsCodex

**Status:** PENDING  
> ${MSG}
"""
# Insert before the replies section
marker = "## Replies from Tulsbot"
content = content.replace(marker, entry + "\n" + marker)
path.write_text(content)
print("Written to tulscodex-channel.md")
PYEOF
    exit 0
fi

MSG="${1:-}"
if [[ -z "$MSG" ]]; then
    echo "Usage: tulsbot-msg.sh <message>" >&2
    echo "       tulsbot-msg.sh --async <note>" >&2
    exit 1
fi

openclaw agent --agent main --json \
    --session-id "$SESSION_ID" \
    --message "$MSG" \
| python3 -c "
import sys, json
d = json.load(sys.stdin)
reply = d.get('result',{}).get('payloads',[{}])[0].get('text','')
print(reply)
"
