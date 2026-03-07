#!/bin/bash
# Shift Manager Cron Setup
# 
# This script sets up cron jobs for automatic shift handoffs
# Run: bash scripts/setup-shift-cron.sh

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHIFT_SCRIPT="$PROJECT_ROOT/scripts/shift-manager.ts"

# Detect runtime (prefer pnpm over direct tsx)
if command -v pnpm &> /dev/null; then
    RUNTIME="pnpm tsx"
elif command -v bun &> /dev/null; then
    RUNTIME="bun"
else
    echo "Error: Neither pnpm nor bun found"
    exit 1
fi

echo "Setting up cron for Tulsbot shift management..."
echo "Runtime: $RUNTIME"
echo ""

# Add cron entries
# Shift start at 6am - morning shift
(crontab -l 2>/dev/null | grep -v "shift-manager start"; echo "0 6 * * * cd $PROJECT_ROOT && $RUNTIME $SHIFT_SCRIPT start tulsday") | crontab -

# Shift end at 6pm - end evening shift
(crontab -l 2>/dev/null | grep -v "shift-manager end"; echo "0 18 * * * cd $PROJECT_ROOT && $RUNTIME $SHIFT_SCRIPT end") | crontab -

# Alternative: 12-hour shifts (6am and 6pm)
# (already covered above)

echo "Cron entries added:"
crontab -l | grep shift-manager

echo ""
echo "✅ Cron setup complete!"
echo ""
echo "You can also manually run shifts:"
echo "  $RUNTIME $SHIFT_SCRIPT start tulsday     # Start Tulsday mode"
echo "  $RUNTIME $SHIFT_SCRIPT start builder     # Start Builder mode"
echo "  $RUNTIME $SHIFT_SCRIPT start tulsday 8   # Start with custom 8 hours"
echo "  $RUNTIME $SHIFT_SCRIPT end               # End current shift"
echo "  $RUNTIME $SHIFT_SCRIPT status            # Show status"
echo "  $RUNTIME $SHIFT_SCRIPT extend 2         # Extend by 2 hours"
echo "  $RUNTIME $SHIFT_SCRIPT shorten 1        # Shorten by 1 hour"
echo "  $RUNTIME $SHIFT_SCRIPT handoff 'acc' 'next'  # Prepare handoff"
