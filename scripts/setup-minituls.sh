#!/bin/bash
# MiniTuls Setup Script
# Sets up MiniTuls as a workhorse node with deprecated file processing
# Run on Mac Mini

set -e

echo "🦞 MiniTuls Setup Starting..."

# ============================================
# 1. CHECK REQUIREMENTS
# ============================================

echo "📋 Checking requirements..."

# Check macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script requires macOS"
    exit 1
fi

# Check if directories exist
if [ ! -d "$HOME/.openclaw" ]; then
    echo "❌ ~/.openclaw not found. Run OpenClaw setup first."
    exit 1
fi

echo "✅ Requirements OK"

# ============================================
# 2. CREATE DIRECTORY STRUCTURE
# ============================================

echo "📁 Creating directory structure..."

WORKSPACE="$HOME/.openclaw/workspace"

# Create MiniTuls directories
mkdir -p "$WORKSPACE/agents/builder"
mkdir -p "$WORKSPACE/agents/scriber"
mkdir -p "$WORKSPACE/agents/tulsmanager"
mkdir -p "$WORKSPACE/agents/tulsnotion"
mkdir -p "$WORKSPACE/agents/concacaf"
mkdir -p "$WORKSPACE/agents/finalissima"

mkdir -p "$WORKSPACE/memory/deprecated"
mkdir -p "$WORKSPACE/memory/processed"

mkdir -p "$WORKSPACE/scripts"
mkdir -p "$WORKSPACE/logs"

echo "✅ Directories created"

# ============================================
# 3. COPY AGENT FILES
# ============================================

echo "📦 Copying agent files..."

# Copy agent files from current workspace (assumes running from laptop)
LAPTOP_WORKSPACE="$(dirname "$0")/.."

if [ -f "$LAPTOP_WORKSPACE/agents/builder/agent.ts" ]; then
    cp -r "$LAPTOP_WORKSPACE/agents/builder/"* "$WORKSPACE/agents/builder/"
    echo "  ✅ Builder"
fi

if [ -f "$LAPTOP_WORKSPACE/agents/scriber/agent.ts" ]; then
    cp -r "$LAPTOP_WORKSPACE/agents/scriber/"* "$WORKSPACE/agents/scriber/"
    echo "  ✅ Scriber"
fi

if [ -f "$LAPTOP_WORKSPACE/agents/tulsmanager/agent.ts" ]; then
    cp -r "$LAPTOP_WORKSPACE/agents/tulsmanager/"* "$WORKSPACE/agents/tulsmanager/"
    echo "  ✅ TulsManager"
fi

if [ -f "$LAPTOP_WORKSPACE/agents/tulsnotion/agent.ts" ]; then
    cp -r "$LAPTOP_WORKSPACE/agents/tulsnotion/"* "$WORKSPACE/agents/tulsnotion/"
    echo "  ✅ TulsNotion"
fi

# ============================================
# 4. COPY NECESSARY SCRIPTS
# ============================================

echo "📜 Copying scripts..."

if [ -f "$LAPTOP_WORKSPACE/scripts/run-heartbeat.ts" ]; then
    cp "$LAPTOP_WORKSPACE/scripts/run-heartbeat.ts" "$WORKSPACE/scripts/"
    echo "  ✅ Heartbeat"
fi

if [ -f "$LAPTOP_WORKSPACE/scripts/smart-heartbeat-agent.ts" ]; then
    cp "$LAPTOP_WORKSPACE/scripts/smart-heartbeat-agent.ts" "$WORKSPACE/scripts/"
    echo "  ✅ Smart Heartbeat"
fi

# ============================================
# 5. CREATE LAUNCH AGENTS
# ============================================

echo "🚀 Creating LaunchAgents..."

# Builder agent
cat > "$HOME/Library/LaunchAgents/com.tulsbot.builder.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.tulsbot.builder</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/pnpm</string>
        <string>tsx</string>
        <string>agents/builder/agent.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/tulioferro/.openclaw/workspace</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/tulioferro/.openclaw/logs/builder.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/tulioferro/.openclaw/logs/builder-error.log</string>
</dict>
</plist>
PLIST

# Scriber agent
cat > "$HOME/Library/LaunchAgents/com.tulsbot.scriber.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.tulsbot.scriber</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/pnpm</string>
        <string>tsx</string>
        <string>agents/scriber/agent.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/tulioferro/.openclaw/workspace</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/tulioferro/.openclaw/logs/scriber.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/tulioferro/.openclaw/logs/scriber-error.log</string>
</dict>
</plist>
PLIST

# TulsManager agent
cat > "$HOME/Library/LaunchAgents/com.tulsbot.tulsmanager.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.tulsbot.tulsmanager</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/pnpm</string>
        <string>tsx</string>
        <string>agents/tulsmanager/agent.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/tulioferro/.openclaw/workspace</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/tulioferro/.openclaw/logs/tulsmanager.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/tulioferro/.openclaw/logs/tulsmanager-error.log</string>
</dict>
</plist>
PLIST

# TulsNotion agent
cat > "$HOME/Library/LaunchAgents/com.tulsbot.tulsnotion.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.tulsbot.tulsnotion</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/pnpm</string>
        <string>tsx</string>
        <string>agents/tulsnotion/agent.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/tulioferro/.openclaw/workspace</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/tulioferro/.openclaw/logs/tulsnotion.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/tulioferro/.openclaw/logs/tulsnotion-error.log</string>
</dict>
</plist>
PLIST

echo "✅ LaunchAgents created"

# ============================================
# 6. LOAD AGENTS
# ============================================

echo "▶️ Loading agents..."

launchctl load "$HOME/Library/LaunchAgents/com.tulsbot.builder.plist"
launchctl load "$HOME/Library/LaunchAgents/com.tulsbot.scriber.plist"
launchctl load "$HOME/Library/LaunchAgents/com.tulsbot.tulsmanager.plist"
launchctl load "$HOME/Library/LaunchAgents/com.tulsbot.tulsnotion.plist"

echo "✅ Agents loaded"

# ============================================
# 7. TEST AGENTS
# ============================================

echo "🧪 Testing agents..."

cd "$WORKSPACE"

# Test each agent
echo "  Testing Builder..."
pnpm tsx agents/builder/agent.ts > /dev/null 2>&1 && echo "    ✅ Builder OK" || echo "    ❌ Builder failed"

echo "  Testing Scriber..."
pnpm tsx agents/scriber/agent.ts > /dev/null 2>&1 && echo "    ✅ Scriber OK" || echo "    ❌ Scriber failed"

echo "  Testing INF-HUB..."
pnpm tsx agents/tulsmanager/agent.ts > /dev/null 2>&1 && echo "    ✅ INF-HUB OK" || echo "    ❌ INF-HUB failed"

echo "  Testing TulsNotion..."
pnpm tsx agents/tulsnotion/agent.ts > /dev/null 2>&1 && echo "    ✅ TulsNotion OK" || echo "    ❌ TulsNotion failed"

# ============================================
# 8. SUMMARY
# ============================================

echo ""
echo "🦞 MiniTuls Setup Complete!"
echo ""
echo "Running Agents:"
echo "  - Builder (Silent Architect)"
echo "  - Scriber (Indexer/Health)"
echo "  - INF-HUB (Agent Manager)"
echo "  - TulsNotion (Notion Manager)"
echo ""
echo "Logs: ~/.openclaw/logs/"
echo "Workspace: ~/.openclaw/workspace/"
echo ""
echo "To check status:"
echo "  launchctl list | grep tulsbot"
echo ""
echo "To stop:"
echo "  launchctl unload ~/Library/LaunchAgents/com.tulsbot.*.plist"
echo ""
