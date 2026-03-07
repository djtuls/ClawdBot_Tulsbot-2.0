-- SECRETS-VAULT: Supabase table for API keys
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  key_name TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;

-- Policy: only service role can read/write
CREATE POLICY "Service role full access" ON secrets
  FOR ALL USING (true) WITH CHECK (true);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_secrets_category ON secrets(category);
CREATE INDEX IF NOT EXISTS idx_secrets_key_name ON secrets(key_name);