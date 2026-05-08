-- Migration: 32_imap_credentials
-- Stores IMAP server credentials per user, encrypted via Supabase Vault.
-- Supports Outlook, Yahoo, corporate IMAP servers alongside Gmail OAuth.

-- ============================================================
-- 1. Enable Supabase Vault (if not already)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ============================================================
-- 2. imap_credentials table
-- ============================================================

CREATE TABLE IF NOT EXISTS imap_credentials (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Connection settings
  host               TEXT NOT NULL,          -- e.g. imap.outlook.com, imap.gmail.com
  port               INTEGER NOT NULL DEFAULT 993,
  secure             BOOLEAN NOT NULL DEFAULT true,  -- true = SSL/TLS, false = STARTTLS
  username           TEXT NOT NULL,          -- email address / login

  -- Password stored as Vault secret ID (never plaintext in DB)
  vault_secret_id    UUID,                   -- references vault.secrets(id)

  -- Metadata
  email_label        TEXT,                   -- friendly label e.g. "Outlook - Buyer Inbox"
  provider           TEXT DEFAULT 'imap'
                     CHECK (provider IN ('imap', 'outlook', 'yahoo', 'zoho', 'other')),
  last_tested_at     TIMESTAMPTZ,
  last_test_status   TEXT CHECK (last_test_status IN ('ok', 'failed', NULL)),
  last_test_error    TEXT,

  active             BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (user_id)   -- one IMAP account per user for now
);

CREATE INDEX idx_imap_creds_user_id ON imap_credentials(user_id);
CREATE INDEX idx_imap_creds_active  ON imap_credentials(active) WHERE active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_imap_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_imap_credentials_updated_at
  BEFORE UPDATE ON imap_credentials
  FOR EACH ROW EXECUTE FUNCTION update_imap_credentials_updated_at();

-- RLS
ALTER TABLE imap_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_owns_imap_creds"
  ON imap_credentials FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "owner_sees_all_imap_creds"
  ON imap_credentials FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Owner'
    )
  );

-- ============================================================
-- 3. Vault RPC — securely store password
--    Called from Edge Function (service role) when saving creds
-- ============================================================

CREATE OR REPLACE FUNCTION store_imap_password(
  p_credential_id UUID,
  p_password      TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as superuser to access vault
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  -- Insert into Vault
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (
    p_password,
    'imap_password_' || p_credential_id::text,
    'IMAP password for credential ' || p_credential_id::text
  )
  RETURNING id INTO v_secret_id;

  -- Store secret ID in credentials table
  UPDATE imap_credentials
  SET vault_secret_id = v_secret_id
  WHERE id = p_credential_id;

  RETURN v_secret_id;
END;
$$;

-- ============================================================
-- 4. Vault RPC — decrypt password for edge function use
-- ============================================================

CREATE OR REPLACE FUNCTION vault_decrypt_imap_password(
  p_credential_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_secret TEXT;
  v_secret_id UUID;
BEGIN
  SELECT vault_secret_id INTO v_secret_id
  FROM imap_credentials
  WHERE id = p_credential_id;

  IF v_secret_id IS NULL THEN
    RAISE EXCEPTION 'No vault secret for credential %', p_credential_id;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;

-- ============================================================
-- 5. Extend email_crawl_log for IMAP source tracking
-- ============================================================

ALTER TABLE email_crawl_log
  ADD COLUMN IF NOT EXISTS email_source  TEXT DEFAULT 'gmail'
    CHECK (email_source IN ('gmail', 'imap')),
  ADD COLUMN IF NOT EXISTS imap_uid      TEXT;   -- UID on IMAP server for dedup

CREATE INDEX IF NOT EXISTS idx_email_crawl_imap_uid
  ON email_crawl_log(imap_uid) WHERE imap_uid IS NOT NULL;

-- ============================================================
-- 6. Extend agent_run_log summary for source breakdown
--    (no schema change needed — summary is JSONB)
--    The agent will write:
--    { gmail_emails: N, imap_emails: M, drafts_created: X, ... }
-- ============================================================

COMMENT ON TABLE imap_credentials IS
  'IMAP server credentials per user. Password stored encrypted in Supabase Vault. '
  'Supports Outlook, Yahoo, Zoho, and any standard IMAP server.';

COMMENT ON FUNCTION store_imap_password IS
  'Stores IMAP password in Supabase Vault and links secret ID to credential record.';

COMMENT ON FUNCTION vault_decrypt_imap_password IS
  'Decrypts IMAP password from Vault for use by the crawler agent edge function.';
