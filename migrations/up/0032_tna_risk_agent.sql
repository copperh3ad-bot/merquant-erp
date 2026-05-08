-- Migration: 33_tna_risk_agent
-- T&A Risk Agent tables:
--   tna_risk_drafts     — AI-drafted buyer emails per at-risk milestone
--   tna_risk_thresholds — configurable per-calendar risk thresholds
-- Also extends tna_milestones with risk tracking columns
-- and schedules the agent via pg_cron at 7 AM daily

-- ============================================================
-- 1. tna_risk_thresholds — configurable per calendar/milestone type
-- ============================================================

CREATE TABLE IF NOT EXISTS tna_risk_thresholds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id       UUID REFERENCES tna_calendars(id) ON DELETE CASCADE,
  -- NULL calendar_id = global default override (applies to all calendars)

  milestone_name    TEXT NOT NULL,
  at_risk_days      INTEGER NOT NULL DEFAULT -2,
    -- negative = days BEFORE due date to flag as at-risk
  overdue_days      INTEGER NOT NULL DEFAULT 0,
    -- 0 = flag on the due date
  critical_days     INTEGER NOT NULL DEFAULT 3,
    -- positive = days AFTER due date before escalating to critical
  priority          INTEGER NOT NULL DEFAULT 2
    CHECK (priority BETWEEN 1 AND 3),
    -- 1=low, 2=medium, 3=high

  created_by        UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (calendar_id, milestone_name)
);

CREATE INDEX idx_tna_thresholds_calendar ON tna_risk_thresholds(calendar_id);

ALTER TABLE tna_risk_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners_managers_manage_thresholds"
  ON tna_risk_thresholds FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner', 'Manager')
    )
  );

CREATE POLICY "merchandisers_read_thresholds"
  ON tna_risk_thresholds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Merchandiser'
    )
  );

-- ============================================================
-- 2. tna_risk_drafts — AI-drafted buyer emails for at-risk milestones
-- ============================================================

CREATE TABLE IF NOT EXISTS tna_risk_drafts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  calendar_id       UUID REFERENCES tna_calendars(id) ON DELETE CASCADE,
  milestone_id      UUID REFERENCES tna_milestones(id) ON DELETE CASCADE,
  po_id             UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,

  -- Context snapshot (denormalised for display)
  po_number         TEXT,
  buyer_name        TEXT,
  buyer_email       TEXT,
  milestone_name    TEXT NOT NULL,
  due_date          DATE,
  days_relative     INTEGER,  -- positive = overdue, negative = days remaining

  -- Risk classification
  risk_level        TEXT NOT NULL
                    CHECK (risk_level IN ('at_risk', 'overdue', 'critical')),
  urgency           TEXT NOT NULL DEFAULT 'medium'
                    CHECK (urgency IN ('low', 'medium', 'high', 'critical')),

  -- AI-drafted email
  email_subject     TEXT,
  email_body        TEXT,
  suggested_action  TEXT,
  revised_date      DATE,

  -- Review workflow
  status            TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN (
                      'pending_review',   -- awaiting Merchandiser action
                      'sent',             -- email sent by Merchandiser
                      'dismissed',        -- Merchandiser dismissed (issue resolved)
                      'escalated'         -- escalated to Manager
                    )),

  -- Send tracking
  sent_at           TIMESTAMPTZ,
  sent_by           UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  sent_to_email     TEXT,
  comms_log_id      UUID REFERENCES comms_log(id) ON DELETE SET NULL,

  -- Dismissal
  dismissed_at      TIMESTAMPTZ,
  dismissed_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  dismiss_reason    TEXT,

  -- Agent metadata
  agent_version     TEXT DEFAULT 'tna-v1',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  -- One draft per milestone per day (prevent duplicate runs)
  UNIQUE (milestone_id, DATE(created_at))
);

CREATE INDEX idx_tna_risk_drafts_status      ON tna_risk_drafts(status);
CREATE INDEX idx_tna_risk_drafts_calendar    ON tna_risk_drafts(calendar_id);
CREATE INDEX idx_tna_risk_drafts_po          ON tna_risk_drafts(po_id);
CREATE INDEX idx_tna_risk_drafts_risk_level  ON tna_risk_drafts(risk_level);
CREATE INDEX idx_tna_risk_drafts_created_at  ON tna_risk_drafts(created_at DESC);
CREATE INDEX idx_tna_risk_drafts_urgency     ON tna_risk_drafts(urgency)
  WHERE status = 'pending_review';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_tna_risk_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tna_risk_drafts_updated_at
  BEFORE UPDATE ON tna_risk_drafts
  FOR EACH ROW EXECUTE FUNCTION update_tna_risk_drafts_updated_at();

ALTER TABLE tna_risk_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners_managers_all_tna_drafts"
  ON tna_risk_drafts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner', 'Manager')
    )
  );

CREATE POLICY "merchandisers_read_update_tna_drafts"
  ON tna_risk_drafts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Merchandiser'
    )
  );

CREATE POLICY "merchandisers_update_tna_drafts"
  ON tna_risk_drafts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner', 'Manager', 'Merchandiser')
    )
  );

-- ============================================================
-- 3. Extend tna_milestones with risk tracking columns
-- ============================================================

ALTER TABLE tna_milestones
  ADD COLUMN IF NOT EXISTS risk_level     TEXT
    CHECK (risk_level IN ('on_track', 'at_risk', 'overdue', 'critical', NULL)),
  ADD COLUMN IF NOT EXISTS days_relative  INTEGER,
  ADD COLUMN IF NOT EXISTS last_flagged   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tna_milestones_risk_level
  ON tna_milestones(risk_level)
  WHERE risk_level IN ('at_risk', 'overdue', 'critical');

-- ============================================================
-- 4. Seed global default thresholds
--    (can be overridden per-calendar in the UI)
-- ============================================================

INSERT INTO tna_risk_thresholds
  (calendar_id, milestone_name, at_risk_days, overdue_days, critical_days, priority)
VALUES
  -- Pre-production
  (NULL, 'Tech Pack Approval',   -3, 0,  3, 2),
  (NULL, 'Fabric Approval',      -5, 0,  5, 3),
  (NULL, 'Lab Dip Approval',     -3, 0,  3, 2),
  (NULL, 'Trim Approval',        -2, 0,  2, 2),
  (NULL, 'PP Sample Approval',   -5, 0,  5, 3),
  (NULL, 'Size Set Approval',    -3, 0,  3, 2),
  -- Production
  (NULL, 'Fabric In-House',      -2, 0,  3, 3),
  (NULL, 'Cutting Start',        -1, 0,  2, 2),
  (NULL, 'Sewing Start',         -1, 0,  3, 2),
  (NULL, 'Sewing Complete',      -2, 0,  5, 3),
  (NULL, 'QC Inspection',        -2, 0,  3, 3),
  (NULL, 'Final Inspection',     -3, 0,  5, 3),
  -- Shipment
  (NULL, 'Ex-Factory Date',      -5, 0,  3, 3),
  (NULL, 'ETD (Port Departure)', -3, 0,  2, 3),
  (NULL, 'ETA (Port Arrival)',   -2, 0,  2, 2),
  (NULL, 'Delivery to Warehouse',-3, 0,  5, 3)
ON CONFLICT (calendar_id, milestone_name) DO NOTHING;

-- ============================================================
-- 5. pg_cron — run T&A Risk Agent daily at 7:00 AM UTC
--    (adjust timezone offset for PKT = UTC+5: run at 02:00 UTC)
-- ============================================================

SELECT cron.unschedule('tna-risk-agent')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'tna-risk-agent'
);

SELECT cron.schedule(
  'tna-risk-agent',
  '0 2 * * *',   -- 2 AM UTC = 7 AM Pakistan Standard Time
  $$
    SELECT net.http_post(
      url     := 'https://ecjqdyruwqlesfthgphv.supabase.co/functions/v1/tna-risk-agent',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE tna_risk_thresholds IS
  'Configurable risk thresholds per milestone type. NULL calendar_id = global defaults. '
  'Per-calendar entries override globals. Managed via T&A Risk Agent settings UI.';

COMMENT ON TABLE tna_risk_drafts IS
  'AI-drafted buyer emails for at-risk/overdue T&A milestones. '
  'Created autonomously by the tna-risk-agent cron job. '
  'Requires Merchandiser review before sending.';
