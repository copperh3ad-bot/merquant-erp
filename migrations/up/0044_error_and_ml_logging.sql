-- 0044: Error logging and ML feedback / training data tables

-- ── error_log ──────────────────────────────────────────────────────────────
-- logger.js already writes {message, stack, context, url}.
-- Add richer columns for classification and ML analysis.

CREATE TABLE IF NOT EXISTS error_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message    TEXT NOT NULL,
  stack      TEXT,
  context    TEXT,
  url        TEXT,
  severity   TEXT DEFAULT 'error',   -- 'info' | 'warning' | 'error' | 'critical'
  category   TEXT,                   -- 'render' | 'network' | 'permission' | 'validation' | 'timeout'
  component  TEXT,                   -- React component name from componentStack
  user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent column additions for any environment where table already exists
ALTER TABLE error_log ADD COLUMN IF NOT EXISTS severity   TEXT DEFAULT 'error';
ALTER TABLE error_log ADD COLUMN IF NOT EXISTS category   TEXT;
ALTER TABLE error_log ADD COLUMN IF NOT EXISTS component  TEXT;
ALTER TABLE error_log ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE error_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_error_log_created  ON error_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_severity ON error_log (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_category ON error_log (category, created_at DESC);

-- ── ml_feedback ────────────────────────────────────────────────────────────
-- Captures every human correction to an AI or automation suggestion.
-- This is the primary ML training dataset — each row is a labelled example.
--
-- feedback_type values:
--   'cell_edit'         — user edited a cell in AIExtractionReview
--   'status_override'   — user changed a status that was auto-set (Overdue, Shortfall, Expired …)
--   'agent_outcome'     — an agent action was approved/rejected
--   'automation_outcome'— post-hoc validation of an automation (e.g. was shortfall correct?)
--
-- source_module values:
--   'po_extraction' | 'tna_risk' | 'payment_auto' | 'compliance_auto'
--   'fabric_shortfall' | 'qc_verdict' | 'job_card_auto' | 'sample_auto'

CREATE TABLE IF NOT EXISTS ml_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_type   TEXT NOT NULL,
  source_module   TEXT NOT NULL,

  -- The AI / automation suggestion vs human correction
  field_name      TEXT,
  original_value  TEXT,
  corrected_value TEXT,

  -- Extra context for the model (JSONB lets us add fields without schema changes)
  context         JSONB,

  -- Link back to the extraction record if this came from AIExtractionReview
  extraction_id   UUID,

  -- The entity being worked on
  entity_type     TEXT,
  entity_id       UUID,

  -- Who made the correction
  user_email      TEXT,
  user_role       TEXT,

  -- Post-hoc label: was the original AI/automation output actually correct?
  -- NULL = not yet evaluated, TRUE = AI was right, FALSE = AI was wrong
  was_correct     BOOLEAN,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_fb_source  ON ml_feedback (source_module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_fb_field   ON ml_feedback (field_name, source_module);
CREATE INDEX IF NOT EXISTS idx_ml_fb_correct ON ml_feedback (was_correct, source_module);
CREATE INDEX IF NOT EXISTS idx_ml_fb_created ON ml_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_fb_extid   ON ml_feedback (extraction_id) WHERE extraction_id IS NOT NULL;
