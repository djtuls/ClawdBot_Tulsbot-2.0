#!/bin/bash
set -euo pipefail

LABEL="com.openclaw.heartbeat-loop"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="${LABEL}.plist"
PLIST_SRC="${SCRIPT_DIR}/${PLIST_NAME}"
PLIST_DST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"
LOG_DIR="${HOME}/.openclaw/logs"

info() { echo -e "\033[0;36mℹ\033[0m  $1"; }
ok()   { echo -e "\033[0;32m✅\033[0m $1"; }
warn() { echo -e "\033[0;33m⚠️\033[0m  $1"; }
fail() { echo -e "\033[0;31m❌\033[0m $1"; exit 1; }

ensure_logs() {
  mkdir -p "$LOG_DIR"
}

cmd_install() {
  info "Installing heartbeat loop service..."
  [[ -f "$PLIST_SRC" ]] || fail "Plist not found: $PLIST_SRC"
  ensure_logs
  if launchctl list "$LABEL" &>/dev/null; then
    warn "Service already loaded — unloading first"
    launchctl unload "$PLIST_DST" 2>/dev/null || true
  fi
  cp "$PLIST_SRC" "$PLIST_DST"
  launchctl load "$PLIST_DST"
  ok "Service installed and loaded (every 60 minutes + RunAtLoad)"
  cmd_status
}

cmd_uninstall() {
  info "Uninstalling heartbeat loop service..."
  if launchctl list "$LABEL" &>/dev/null; then
    launchctl unload "$PLIST_DST" 2>/dev/null || true
    ok "Service unloaded"
  else
    warn "Service was not loaded"
  fi
  if [[ -f "$PLIST_DST" ]]; then
    rm "$PLIST_DST"
    ok "Plist removed"
  else
    warn "Plist already removed"
  fi
}

cmd_start() {
  info "Starting service..."
  if ! launchctl list "$LABEL" &>/dev/null; then
    [[ -f "$PLIST_DST" ]] || fail "Service not installed. Run: $0 install"
    launchctl load "$PLIST_DST"
  fi
  launchctl start "$LABEL"
  ok "Heartbeat loop triggered"
}

cmd_stop() {
  info "Stopping service..."
  launchctl stop "$LABEL" 2>/dev/null || warn "Service not running"
  ok "Service stopped"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  echo -e "\033[0;36m── Heartbeat Loop Status ──\033[0m"
  if launchctl list "$LABEL" &>/dev/null; then
    ok "Service: loaded"
  else
    warn "Service: not loaded"
  fi
  if [[ -f "$LOG_DIR/heartbeat-loop-stdout.log" ]]; then
    info "Last stdout: $(tail -n 1 "$LOG_DIR/heartbeat-loop-stdout.log" 2>/dev/null)"
  else
    info "No stdout log yet"
  fi
}

cmd_logs() {
  local lines="${1:-50}"
  echo -e "\033[0;36m── Last ${lines} lines (stdout) ──\033[0m"
  tail -n "$lines" "$LOG_DIR/heartbeat-loop-stdout.log" 2>/dev/null || warn "No stdout log"
  echo -e "\033[0;36m── Last ${lines} lines (stderr) ──\033[0m"
  tail -n "$lines" "$LOG_DIR/heartbeat-loop-stderr.log" 2>/dev/null || warn "No stderr log"
}

cmd_run() {
  info "Running heartbeat loop once..."
  cd "$SCRIPT_DIR/.."
  node --import tsx scripts/run-heartbeat.ts
}

usage() {
  echo "Usage: $0 {install|uninstall|start|stop|restart|status|logs [N]|run}"
}

case "${1:-}" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "${1:-50}" ;;
  run) cmd_run ;;
  *) usage ;;
esac
