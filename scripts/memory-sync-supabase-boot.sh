#!/bin/sh
# One-time memory sync to Supabase. Run at boot or after memory file changes.
export SUPABASE_URL="$(openclaw secret get SUPABASE_URL 2>/dev/null)"
export SUPABASE_SERVICE_ROLE_KEY="$(openclaw secret get SUPABASE_SERVICE_ROLE_KEY 2>/dev/null)"
export GOOGLE_API_KEY="$(openclaw secret get GOOGLE_API_KEY 2>/dev/null || openclaw secret get GEMINI_API_KEY 2>/dev/null)"
export MEMORY_AGENT_ID="tulsbot"
exec bun /Users/tulioferro/.openclaw/workspace/scripts/memory-sync-supabase.ts --once "$@"
