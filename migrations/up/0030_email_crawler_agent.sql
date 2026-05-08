-- Migration: 31_email_crawler_agent
-- Adds: gmail_tokens table, agent_run_log table,
--       email_crawl_log schema extensions,
--       pg_cron job for autonomous email processing

-- ============================================================
-- 1. gmail_tokens — stores OAuth tokens per user
-- ============================================================

CREATE TABLE IF NOT EXISTS gmail_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type    TEXT DEFAULT 'Bearer',
  expires_at    TIMESTAMPTZ NOT NULL,
  scope         TEXT,
  email         TEXT,           -- the Gmail address connected
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)               -- one Gmail account per MerQuant user (for now)
);

CREATE INDEX idx_gmail_tokens_user_id ON gmail_tokens(user_id);
CREATE INDEX idx_gmail_tokens_active  ON gmail_tokens(active) WHERE active = true;

ALTER TABLE gmail_tokens ENABLE ROW LEVEL SECURITY;

-- Only the token owner and Owners can see tokens
CREATE POLICY "user_sees_own_token"
  ON gmail_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "owner_sees_all_tokens"
  ON gmail_tokens FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Owner'
    )
  );

-- ============================================================
-- 2. agent_run_log — audit trail for every cron execution
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_run_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name  TEXT NOT NULL,
  run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status      TEXT DEFAULT 'success'
              CHECK (status IN ('success', 'partial', 'error')),
  summary     JSONB DEFAULT '{}'::jsonb,
  error       TEXT,
  duration_ms INTEGER
);

CREATE INDEX idx_agent_run_log_agent   ON agent_run_log(agent_name);
CREATE INDEX idx_agent_run_log_run_at  ON agent_run_log(run_at DESC);

-- No RLS — internal agent table; only service role writes
ALTER TABLE agent_run_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_read_run_log"
  ON agent_run_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner', 'Manager')
    )
  );

-- ============================================================
-- 3. Extend email_crawl_log for agent fields
--    (adds columns if they don't already exist)
-- ============================================================

ALTER TABLE email_crawl_log
  ADD COLUMN IF NOT EXISTS gmail_message_id         TEXT,
  ADD COLUMN IF NOT EXISTS is_po_email              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_type               TEXT,
  ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS draft_id                 UUID REFERENCES email_po_drafts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_version            TEXT,
  ADD COLUMN IF NOT EXISTS crawled_at               TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_email_crawl_gmail_id
  ON email_crawl_log(gmail_message_id) WHERE gmail_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_crawl_draft_id
  ON email_crawl_log(draft_id) WHERE draft_id IS NOT NULL;

-- ============================================================
-- 4. pg_cron — run the crawler agent every 15 minutes
--
--    PREREQUISITES:
--    - pg_cron extension must be enabled in Supabase dashboard
--      (Database → Extensions → pg_cron)
--    - pg_net extension must be enabled for HTTP calls
--      (Database → Extensions → pg_net)
--    - Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> with real values
-- ============================================================

-- Enable extensions (safe to run even if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if re-running this migration
SELECT cron.unschedule('email-crawler-agent')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'email-crawler-agent'
);

-- Schedule: every 15 minutes
-- The edge function URL uses the project ref from env
-- Replace <PROJECT_REF> with your actual Supabase project ref: ecjqdyruwqlesfthgphv
-- Replace <SERVICE_ROLE_KEY> with your service role key (store securely)

SELECT cron.schedule(
  'email-crawler-agent',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://ecjqdyruwqlesfthgphv.supabase.co/functions/v1/email-crawler-agent',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ============================================================
-- 5. Store service role key as a DB setting for pg_cron use
--    Run this separately after deployment:
--
--    ALTER DATABASE postgres
--      SET app.service_role_key = '<YOUR_SERVICE_ROLE_KEY>';
--
--    Or use Supabase Vault (recommended for production):
--    https://supabase.com/docs/guides/database/vault
-- ============================================================

COMMENT ON TABLE gmail_tokens IS
  'Stores Gmail OAuth tokens per MerQuant user. '
  'Used by the email-crawler-agent to autonomously fetch buyer emails.';

COMMENT ON TABLE agent_run_log IS
  'Audit trail for autonomous agent cron runs (email crawler, etc.)';
