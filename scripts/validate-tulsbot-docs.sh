#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-/Users/tulioferro/.openclaw/workspace/docs/tulsbot-ecosystem}"
FAIL=0

check_file() {
  local file="$1"; shift
  for h in "$@"; do
    if ! grep -q "^## .*${h}" "$file"; then
      echo "[FAIL] $file missing section: $h"
      FAIL=1
    fi
  done
}

echo "Checking Tulsbot docs at: $ROOT"

# SOP checks
for f in "$ROOT"/sops/*.md; do
  [[ -f "$f" ]] || continue
  # Skip templates from strict placeholder scanning
  if [[ "$f" == *"TEMPLATE"* ]]; then
    continue
  fi
  check_file "$f" "Objective" "Scope" "Inputs" "Procedure" "Validation" "Failure" "Escalation" "Ownership" "Example" "Revision"
  if grep -qiE "__PLACEHOLDER__|^TBD[: ]|^TODO[: ]|<TODO>" "$f"; then
    echo "[FAIL] $f contains unresolved placeholder marker"
    FAIL=1
  fi
done

# Incident checks
for f in "$ROOT"/incidents/*.md; do
  [[ -f "$f" ]] || continue
  check_file "$f" "Summary" "Impact" "Root Cause" "Corrective" "Preventive" "Owner"
done

# Standards checks
for f in "$ROOT"/standards/*.md; do
  [[ -f "$f" ]] || continue
  if grep -qiE "__PLACEHOLDER__|^TBD[: ]|^TODO[: ]|<TODO>" "$f"; then
    echo "[FAIL] $f contains unresolved placeholder marker"
    FAIL=1
  fi
done

if [[ $FAIL -eq 0 ]]; then
  echo "[PASS] Tulsbot documentation preflight passed"
else
  echo "[FAIL] Tulsbot documentation preflight failed"
  exit 1
fi
