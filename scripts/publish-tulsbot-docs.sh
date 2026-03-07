#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="/Users/tulioferro/.openclaw/workspace"
DOC_ROOT="$WORKSPACE/docs/tulsbot-ecosystem"
VAULT_ROOT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Tulsbot Repo"
STAMP="$(date +%F-%H%M)"
REPORT="$DOC_ROOT/reports/${STAMP}-publish-run.md"

cd "$WORKSPACE"

echo "[1/4] Running documentation preflight..."
"$WORKSPACE/scripts/validate-tulsbot-docs.sh" "$DOC_ROOT"

echo "[2/4] Syncing canonical docs to Obsidian mirror..."
mkdir -p "$VAULT_ROOT"
rsync -a --delete "$DOC_ROOT/" "$VAULT_ROOT/"

echo "[3/4] Writing publish report..."
cat > "$REPORT" <<EOF
# Publish Run Report — $STAMP

**Status:** Success  
**Canonical root:** 
$DOC_ROOT  
**Mirror root:** 
$VAULT_ROOT

## Steps
1. Preflight validation passed (scripts/validate-tulsbot-docs.sh)
2. Canonical docs synced to Obsidian mirror (rsync -a --delete)
3. Publish report generated

## Evidence
- Canonical: $DOC_ROOT
- Mirror: $VAULT_ROOT
- Report: $REPORT
EOF

echo "[4/4] Syncing publish report to mirror..."
mkdir -p "$VAULT_ROOT/reports"
cp -f "$REPORT" "$VAULT_ROOT/reports/"

echo "Done."
echo "Report: $REPORT"