-- Migration: 30_email_po_drafts
-- Table to store AI-generated PO drafts from email parsing
-- before human confirmation

CREATE TABLE IF NOT EXISTS email_po_drafts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source email
  email_id                TEXT,                          -- reference to email_crawl_log if applicable
  sender_email            TEXT,
  raw_email_text          TEXT,                          -- full email text passed to agent
  raw_extracted           JSONB,                         -- raw Claude extraction output

  -- PO Header fields (pre-fill for purchase_orders)
  buyer_name              TEXT,
  po_number               TEXT,
  order_date              DATE,
  delivery_date           DATE,
  currency                TEXT DEFAULT 'USD',
  destination_country     TEXT,
  payment_terms           TEXT,
  incoterms               TEXT,
  special_instructions    TEXT,

  -- Line items (array of extracted items)
  items                   JSONB DEFAULT '[]'::jsonb,

  -- Confidence & validation
  overall_confidence      NUMERIC(4,3) DEFAULT 0,        -- 0.000 to 1.000
  field_scores            JSONB DEFAULT '{}'::jsonb,     -- per-field confidence scores
  missing_critical_fields JSONB DEFAULT '[]'::jsonb,
  ambiguities             JSONB DEFAULT '[]'::jsonb,
  unmatched_items         JSONB DEFAULT '[]'::jsonb,
  match_suggestions       JSONB DEFAULT '[]'::jsonb,

  -- Agent metadata
  is_po_email             BOOLEAN DEFAULT false,         -- false if email is not a PO
  agent_version           TEXT DEFAULT 'v1',
  processing_time_ms      INTEGER,

  -- Workflow status
  status                  TEXT DEFAULT 'pending_review'
                          CHECK (status IN (
                            'pending_review',   -- awaiting human review
                            'confirmed',        -- human confirmed → PO created
                            'rejected',         -- human rejected
                            'edited_confirmed'  -- human edited then confirmed
                          )),

  -- Link to created PO (set after confirmation)
  created_po_id           UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,

  -- Reviewer info
  reviewed_by             UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  reviewer_notes          TEXT,

  -- Timestamps
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_email_po_drafts_status       ON email_po_drafts(status);
CREATE INDEX idx_email_po_drafts_created_at   ON email_po_drafts(created_at DESC);
CREATE INDEX idx_email_po_drafts_buyer        ON email_po_drafts(buyer_name);
CREATE INDEX idx_email_po_drafts_po_number    ON email_po_drafts(po_number);
CREATE INDEX idx_email_po_drafts_email_id     ON email_po_drafts(email_id) WHERE email_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_email_po_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_email_po_drafts_updated_at
  BEFORE UPDATE ON email_po_drafts
  FOR EACH ROW EXECUTE FUNCTION update_email_po_drafts_updated_at();

-- RLS
ALTER TABLE email_po_drafts ENABLE ROW LEVEL SECURITY;

-- Owners and Managers can see all drafts
CREATE POLICY "owners_managers_all_drafts"
  ON email_po_drafts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('Owner', 'Manager')
    )
  );

-- Merchandisers can see and create drafts, but not delete
CREATE POLICY "merchandisers_read_create_drafts"
  ON email_po_drafts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'Merchandiser'
    )
  );

CREATE POLICY "merchandisers_insert_drafts"
  ON email_po_drafts
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('Owner', 'Manager', 'Merchandiser')
    )
  );

COMMENT ON TABLE email_po_drafts IS
  'AI-generated PO drafts extracted from buyer emails by the Email-to-PO Agent. '
  'Requires human confirmation before a purchase_order record is created.';
