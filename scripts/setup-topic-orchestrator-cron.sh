#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/topic-orchestrator.ts"
CONFIG="config/topic-orchestration.topics-group.json"

if command -v pnpm >/dev/null 2>&1; then
  RUNTIME="pnpm tsx"
elif command -v bun >/dev/null 2>&1; then
  RUNTIME="bun"
else
  echo "Error: pnpm or bun required"
  exit 1
fi

ENTRY="*/30 * * * * cd $PROJECT_ROOT && $RUNTIME $SCRIPT plan --config $CONFIG >> logs/topic-orchestrator.log 2>&1"

(crontab -l 2>/dev/null | grep -v "topic-orchestrator.ts plan"; echo "$ENTRY") | crontab -

echo "Installed topic orchestrator cron:"
crontab -l | grep "topic-orchestrator.ts plan" || true
