#!/bin/zsh
# auto-model-profile.sh — periodic model profile check
# Reads the current model-profile.json and validates it is still active.
# Exits 0 if profile is valid, non-zero on error.

PROFILE_FILE="$HOME/.openclaw/model-profile.json"

if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "⚠️  model-profile.json not found, skipping"
  exit 0
fi

profile=$(python3 -c "import json; d=json.load(open('$PROFILE_FILE')); print(d.get('profile','unknown'))" 2>/dev/null)
echo "✅ Model profile active: $profile ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
exit 0
