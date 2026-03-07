#!/usr/bin/env bash
set -euo pipefail

KEY="${1:-}"
if [[ -z "$KEY" ]]; then
  echo "Usage: $0 <ENV_KEY>"
  exit 1
fi

if [[ ! "$KEY" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
  echo "Invalid key name. Use ENV_STYLE_UPPERCASE names only."
  exit 1
fi

OPENCLAW_ENV="$HOME/.openclaw/.env"
mkdir -p "$HOME/.openclaw"
touch "$OPENCLAW_ENV"

echo -n "Enter value for $KEY (input hidden): "
read -r -s VALUE
echo

if [[ -z "$VALUE" ]]; then
  echo "No value entered; aborting."
  exit 1
fi

TMP_FILE="$(mktemp)"
awk -v key="$KEY" -v val="$VALUE" '
  BEGIN { updated=0 }
  $0 ~ "^" key "=" {
    print key "=" val
    updated=1
    next
  }
  { print }
  END {
    if (updated==0) print key "=" val
  }
' "$OPENCLAW_ENV" > "$TMP_FILE"
mv "$TMP_FILE" "$OPENCLAW_ENV"
chmod 600 "$OPENCLAW_ENV"

# Sync to Supabase/Fly vault through existing script
if command -v bun >/dev/null 2>&1; then
  bun "$HOME/.openclaw/workspace/scripts/sync-secrets.ts" sync-to-cloud
else
  echo "bun not found. Installed key locally, but cloud sync was skipped."
  exit 2
fi

echo "✅ Stored and synced: $KEY"
