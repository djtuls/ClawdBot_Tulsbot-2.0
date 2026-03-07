#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Memory Full Flush — Service Manager
# Installs/manages the LaunchAgent that runs the full
# memory consolidation pipeline 3x/day + on load.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

LABEL="com.openclaw.memory-full-flush"
PLIST_NAME="${LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="${SCRIPT_DIR}/${PLIST_NAME}"
PLIST_DST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"
LOG_DIR="${HOME}/.openclaw/logs"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✅${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠️${NC}  $1"; }
fail()  { echo -e "${RED}❌${NC} $1"; exit 1; }

ensure_log_dir() {
    mkdir -p "$LOG_DIR"
}

cmd_install() {
    info "Installing memory full flush service..."

    [[ -f "$PLIST_SRC" ]] || fail "Plist not found: $PLIST_SRC"

    ensure_log_dir

    if launchctl list "$LABEL" &>/dev/null; then
        warn "Service already loaded — unloading first"
        launchctl unload "$PLIST_DST" 2>/dev/null || true
    fi

    cp "$PLIST_SRC" "$PLIST_DST"
    launchctl load "$PLIST_DST"

    ok "Service installed and loaded"
    info "Schedule: 05:00, 12:00, 20:00 (America/Sao_Paulo) + RunAtLoad"
    info "Logs:     $LOG_DIR/memory-full-flush-{stdout,stderr}.log"
    echo ""
    cmd_status
}

cmd_uninstall() {
    info "Uninstalling memory full flush service..."

    if launchctl list "$LABEL" &>/dev/null; then
        launchctl unload "$PLIST_DST" 2>/dev/null || true
        ok "Service unloaded"
    else
        warn "Service was not loaded"
    fi

    if [[ -f "$PLIST_DST" ]]; then
        rm "$PLIST_DST"
        ok "Plist removed from ~/Library/LaunchAgents/"
    else
        warn "Plist was not installed"
    fi

    ok "Service uninstalled"
}

cmd_start() {
    info "Starting service..."
    if ! launchctl list "$LABEL" &>/dev/null; then
        [[ -f "$PLIST_DST" ]] || fail "Service not installed. Run: $0 install"
        launchctl load "$PLIST_DST"
    fi
    launchctl start "$LABEL"
    ok "Service started (manual trigger)"
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
    echo -e "${CYAN}── Memory Full Flush Status ──${NC}"

    if launchctl list "$LABEL" &>/dev/null; then
        local pid
        pid=$(launchctl list "$LABEL" 2>/dev/null | grep PID | awk '{print $NF}' || echo "")
        ok "Service: loaded"
        if [[ -n "$pid" && "$pid" != "-" ]]; then
            info "PID: $pid (currently running)"
        else
            info "PID: not running (waiting for next scheduled time)"
        fi
    else
        warn "Service: not loaded"
    fi

    if [[ -f "$LOG_DIR/memory-full-flush-stdout.log" ]]; then
        local last_line
        last_line=$(tail -1 "$LOG_DIR/memory-full-flush-stdout.log" 2>/dev/null || echo "")
        if [[ -n "$last_line" ]]; then
            info "Last log: $last_line"
        fi
    else
        info "No logs yet"
    fi

    echo -e "${CYAN}── Schedule ──${NC}"
    info "05:00  Dawn health sync"
    info "12:00  Midday health sync"
    info "20:00  Evening health sync"
}

cmd_logs() {
    local lines="${1:-50}"
    echo -e "${CYAN}── Last ${lines} lines (stdout) ──${NC}"
    tail -n "$lines" "$LOG_DIR/memory-full-flush-stdout.log" 2>/dev/null || warn "No stdout log"
    echo ""
    echo -e "${CYAN}── Last ${lines} lines (stderr) ──${NC}"
    tail -n "$lines" "$LOG_DIR/memory-full-flush-stderr.log" 2>/dev/null || warn "No stderr log"
}

cmd_follow() {
    info "Following logs (Ctrl+C to stop)..."
    tail -f "$LOG_DIR/memory-full-flush-stdout.log" "$LOG_DIR/memory-full-flush-stderr.log" 2>/dev/null || fail "No logs to follow"
}

cmd_run() {
    info "Running memory full flush manually..."
    ensure_log_dir
    cd "$SCRIPT_DIR/.."
    node --import tsx scripts/memory-full-flush.ts "$@"
}

usage() {
    echo ""
    echo -e "${CYAN}Memory Full Flush — Service Manager${NC}"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  install     Install + load the LaunchAgent"
    echo "  uninstall   Remove the LaunchAgent"
    echo "  start       Trigger the service manually"
    echo "  stop        Stop the service"
    echo "  restart     Stop + start"
    echo "  status      Show service status"
    echo "  logs [N]    Tail last N log lines"
    echo "  follow      Stream logs"
    echo "  run [args]  Run once (no launchd)"
    echo ""
}

case "${1:-}" in
    install)    cmd_install ;;
    uninstall)  cmd_uninstall ;;
    start)      cmd_start ;;
    stop)       cmd_stop ;;
    restart)    cmd_restart ;;
    status)     cmd_status ;;
    logs)       cmd_logs "${2:-50}" ;;
    follow)     cmd_follow ;;
    run)        shift; cmd_run "$@" ;;
    *)          usage ;;
esac
