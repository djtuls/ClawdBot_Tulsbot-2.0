-- Supabase tables for Tulsbot cloud state
-- Run this in Supabase SQL Editor

-- Agent State table
-- Also used by telegram failover: key='telegram_leader_lock', value=LeaderLockValue JSON
CREATE TABLE IF NOT EXISTS agent_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast key lookups (used by failover lock polling)
CREATE INDEX IF NOT EXISTS agent_state_key_idx ON agent_state (key);

-- Master TODO table
CREATE TABLE IF NOT EXISTS master_todo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Session Transcript table
CREATE TABLE IF NOT EXISTS session_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  messages JSONB NOT NULL,
  saved_at TIMESTAMPTZ DEFAULT now()
);

-- Heartbeat History table
CREATE TABLE IF NOT EXISTS heartbeat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status JSONB NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE agent_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_todo ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeat_history ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service_role_full_access" ON agent_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON master_todo FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON session_transcripts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON heartbeat_history FOR ALL USING (true) WITH CHECK (true);
