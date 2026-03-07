#!/bin/bash
# setup-hybrid-bridge.sh — Install and start the OpenClaw hybrid bridge LaunchAgent.
#
# USAGE:
#   export BRIDGE_SECRET="your-secret-here"
#   chmod +x scripts/setup-hybrid-bridge.sh
#   ./scripts/setup-hybrid-bridge.sh
#
# The script injects BRIDGE_SECRET into the plist, copies it to ~/Library/LaunchAgents/,
# and loads the service via launchctl.
set -euo pipefail

LABEL="com.openclaw.hybrid-bridge"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="${LABEL}.plist"
PLIST_SRC="${SCRIPT_DIR}/${PLIST_NAME}"
PLIST_DST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"
LOG_DIR="${HOME}/.openclaw/logs"
BRIDGE_PORT="${HYBRID_BRIDGE_PORT:-8090}"

info() { echo -e "\033[0;36mℹ\033[0m  $1"; }
ok()   { echo -e "\033[0;32m✅\033[0m $1"; }
warn() { echo -e "\033[0;33m⚠️\033[0m  $1"; }
fail() { echo -e "\033[0;31m❌\033[0m $1"; exit 1; }

# ── 1. Validate BRIDGE_SECRET ─────────────────────────────────────────────────
if [[ -z "${BRIDGE_SECRET:-}" ]]; then
  fail "BRIDGE_SECRET is not set.

Set it before running this script:
  export BRIDGE_SECRET=\"$(openssl rand -hex 32)\"
  ./scripts/setup-hybrid-bridge.sh

The secret must match what tulsbot-v2 sends in the Authorization header."
fi

info "BRIDGE_SECRET is set (length: ${#BRIDGE_SECRET})"

# ── 2. Ensure log directory exists ────────────────────────────────────────────
mkdir -p "$LOG_DIR"

# ── 3. Inject BRIDGE_SECRET into a temp copy of the plist ─────────────────────
[[ -f "$PLIST_SRC" ]] || fail "Plist not found: $PLIST_SRC"

PLIST_TMP="$(mktemp /tmp/${LABEL}.plist.XXXXXX)"
# Escape any special chars in the secret for sed (/, &, \)
ESCAPED_SECRET="$(printf '%s\n' "$BRIDGE_SECRET" | sed 's/[\/&]/\\&/g')"
sed "s/__BRIDGE_SECRET_PLACEHOLDER__/${ESCAPED_SECRET}/g" "$PLIST_SRC" > "$PLIST_TMP"
info "Plist prepared with injected BRIDGE_SECRET"

# ── 4. Unload existing service if loaded ──────────────────────────────────────
if launchctl list "$LABEL" &>/dev/null; then
  warn "Service already loaded — unloading first"
  launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

# ── 5. Copy plist to LaunchAgents ─────────────────────────────────────────────
cp "$PLIST_TMP" "$PLIST_DST"
rm -f "$PLIST_TMP"
ok "Plist installed to $PLIST_DST"

# ── 6. Load the service ───────────────────────────────────────────────────────
launchctl load "$PLIST_DST"
ok "Service loaded"

# ── 7. Wait and verify health ─────────────────────────────────────────────────
info "Waiting 2s for server to start..."
sleep 2

HEALTH_URL="http://localhost:${BRIDGE_PORT}/health"
info "Checking health at $HEALTH_URL ..."

if HEALTH_RESP=$(curl -sf --max-time 5 "$HEALTH_URL" 2>/dev/null); then
  ok "Health check passed: $HEALTH_RESP"
  echo ""
  ok "hybrid-bridge is running on port ${BRIDGE_PORT}"
  echo ""
  info "Logs:"
  info "  stdout: $LOG_DIR/hybrid-bridge-stdout.log"
  info "  stderr: $LOG_DIR/hybrid-bridge-stderr.log"
  info ""
  info "To stop:  launchctl unload $PLIST_DST"
  info "To start: launchctl load   $PLIST_DST"
else
  warn "Health check failed — service may still be starting."
  warn "Check logs:"
  warn "  tail -f $LOG_DIR/hybrid-bridge-stdout.log"
  warn "  tail -f $LOG_DIR/hybrid-bridge-stderr.log"
  exit 1
fi
