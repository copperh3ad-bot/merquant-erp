-- Migration: 35_realtime_event_triggers
-- Database triggers that fire edge functions instantly on key row changes
-- Uses pg_net to POST to the orchestrator edge function
-- No cron delay — events fire within milliseconds of DB change

-- ============================================================
-- 1. agent_events — event queue / audit log
--    Every trigger writes here first, orchestrator reads this
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT NOT NULL,         -- e.g. 'po.approved', 'milestone.overdue'
  entity_type  TEXT NOT NULL,         -- 'purchase_order', 'tna_milestone', etc.
  entity_id    UUID NOT NULL,
  payload      JSONB DEFAULT '{}',    -- relevant fields snapshot
  status       TEXT DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
  error        TEXT,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  agent_name   TEXT                   -- which agent handled it
);

CREATE INDEX idx_agent_events_status      ON agent_events(status, triggered_at);
CREATE INDEX idx_agent_events_type        ON agent_events(event_type);
CREATE INDEX idx_agent_events_entity      ON agent_events(entity_type, entity_id);
CREATE INDEX idx_agent_events_triggered   ON agent_events(triggered_at DESC);

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_managers_read_events"
  ON agent_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner', 'Manager')
    )
  );

-- ============================================================
-- 2. Helper: fire_agent_event()
--    Called by all triggers. Writes event + fires HTTP to orchestrator.
--    Non-blocking — uses pg_net async HTTP.
-- ============================================================

CREATE OR REPLACE FUNCTION fire_agent_event(
  p_event_type  TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_payload     JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id    UUID;
  v_project_ref TEXT := current_setting('app.supabase_project_ref', true);
  v_service_key TEXT := current_setting('app.service_role_key', true);
BEGIN
  -- Write event record
  INSERT INTO agent_events (event_type, entity_type, entity_id, payload)
  VALUES (p_event_type, p_entity_type, p_entity_id, p_payload)
  RETURNING id INTO v_event_id;

  -- Fire async HTTP to orchestrator (non-blocking)
  IF v_project_ref IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := 'https://' || v_project_ref || '.supabase.co/functions/v1/agent-orchestrator',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object(
        'event_id',    v_event_id,
        'event_type',  p_event_type,
        'entity_type', p_entity_type,
        'entity_id',   p_entity_id,
        'payload',     p_payload
      )
    );
  END IF;

  RETURN v_event_id;
END;
$$;

-- ============================================================
-- 3. Trigger: purchase_orders → po.approved / po.submitted / po.created
-- ============================================================

CREATE OR REPLACE FUNCTION trg_po_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- New PO created
  IF TG_OP = 'INSERT' THEN
    PERFORM fire_agent_event(
      'po.created',
      'purchase_order',
      NEW.id,
      jsonb_build_object(
        'po_number',    NEW.po_number,
        'buyer_name',   NEW.buyer_name,
        'delivery_date', NEW.delivery_date,
        'currency',      NEW.currency
      )
    );
    RETURN NEW;
  END IF;

  -- Approval status changed
  IF TG_OP = 'UPDATE' AND OLD.approval_status IS DISTINCT FROM NEW.approval_status THEN
    PERFORM fire_agent_event(
      'po.' || NEW.approval_status,   -- po.approved, po.rejected, po.pending
      'purchase_order',
      NEW.id,
      jsonb_build_object(
        'po_number',       NEW.po_number,
        'buyer_name',      NEW.buyer_name,
        'delivery_date',   NEW.delivery_date,
        'old_status',      OLD.approval_status,
        'new_status',      NEW.approval_status
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_events ON purchase_orders;
CREATE TRIGGER trg_po_events
  AFTER INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_po_status_change();

-- ============================================================
-- 4. Trigger: tna_milestones → milestone.overdue / milestone.completed
-- ============================================================

CREATE OR REPLACE FUNCTION trg_milestone_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Milestone marked complete
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('completed', 'approved') THEN
    PERFORM fire_agent_event(
      'milestone.completed',
      'tna_milestone',
      NEW.id,
      jsonb_build_object(
        'milestone_name', NEW.milestone_name,
        'calendar_id',    NEW.calendar_id,
        'due_date',       NEW.due_date,
        'completed_date', NEW.completed_date
      )
    );
  END IF;

  -- Risk level escalated by agent
  IF TG_OP = 'UPDATE'
     AND OLD.risk_level IS DISTINCT FROM NEW.risk_level
     AND NEW.risk_level IN ('overdue', 'critical') THEN
    PERFORM fire_agent_event(
      'milestone.risk_escalated',
      'tna_milestone',
      NEW.id,
      jsonb_build_object(
        'milestone_name', NEW.milestone_name,
        'calendar_id',    NEW.calendar_id,
        'old_risk',       OLD.risk_level,
        'new_risk',       NEW.risk_level,
        'days_relative',  NEW.days_relative
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_milestone_events ON tna_milestones;
CREATE TRIGGER trg_milestone_events
  AFTER UPDATE ON tna_milestones
  FOR EACH ROW EXECUTE FUNCTION trg_milestone_change();

-- ============================================================
-- 5. Trigger: email_po_drafts → draft.confirmed (PO created from email)
-- ============================================================

CREATE OR REPLACE FUNCTION trg_email_draft_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'confirmed'
     AND NEW.created_po_id IS NOT NULL THEN
    PERFORM fire_agent_event(
      'email_draft.confirmed',
      'email_po_draft',
      NEW.id,
      jsonb_build_object(
        'po_id',       NEW.created_po_id,
        'buyer_name',  NEW.buyer_name,
        'po_number',   NEW.po_number
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_draft_events ON email_po_drafts;
CREATE TRIGGER trg_email_draft_events
  AFTER UPDATE ON email_po_drafts
  FOR EACH ROW EXECUTE FUNCTION trg_email_draft_confirmed();

-- ============================================================
-- 6. Trigger: shipments → shipment.delayed / shipment.created
-- ============================================================

CREATE OR REPLACE FUNCTION trg_shipment_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fire_agent_event(
      'shipment.created',
      'shipment',
      NEW.id,
      jsonb_build_object('po_id', NEW.po_id, 'etd', NEW.etd, 'eta', NEW.eta)
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'delayed' THEN
    PERFORM fire_agent_event(
      'shipment.delayed',
      'shipment',
      NEW.id,
      jsonb_build_object(
        'po_id',        NEW.po_id,
        'original_etd', OLD.etd,
        'new_etd',      NEW.etd,
        'delay_reason', NEW.delay_reason
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipment_events ON shipments;
CREATE TRIGGER trg_shipment_events
  AFTER INSERT OR UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION trg_shipment_change();

-- ============================================================
-- 7. Trigger: qc_inspections → qc.failed
-- ============================================================

CREATE OR REPLACE FUNCTION trg_qc_result()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE')
     AND NEW.result = 'failed' THEN
    PERFORM fire_agent_event(
      'qc.failed',
      'qc_inspection',
      NEW.id,
      jsonb_build_object(
        'po_id',         NEW.po_id,
        'defect_count',  NEW.defect_count,
        'defect_types',  NEW.defect_types,
        'inspector',     NEW.inspector_name
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qc_events ON qc_inspections;
CREATE TRIGGER trg_qc_events
  AFTER INSERT OR UPDATE ON qc_inspections
  FOR EACH ROW EXECUTE FUNCTION trg_qc_result();

-- ============================================================
-- 8. Trigger: tna_risk_drafts → draft sent (write memory)
-- ============================================================

CREATE OR REPLACE FUNCTION trg_tna_draft_sent()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'sent' THEN
    PERFORM fire_agent_event(
      'tna_draft.sent',
      'tna_risk_draft',
      NEW.id,
      jsonb_build_object(
        'po_id',          NEW.po_id,
        'buyer_name',     NEW.buyer_name,
        'milestone_name', NEW.milestone_name,
        'risk_level',     NEW.risk_level,
        'days_relative',  NEW.days_relative
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tna_draft_events ON tna_risk_drafts;
CREATE TRIGGER trg_tna_draft_events
  AFTER UPDATE ON tna_risk_drafts
  FOR EACH ROW EXECUTE FUNCTION trg_tna_draft_sent();

-- ============================================================
-- 9. Store project ref for triggers to use
--    Run after deployment:
--    ALTER DATABASE postgres SET app.supabase_project_ref = 'ecjqdyruwqlesfthgphv';
-- ============================================================

COMMENT ON TABLE agent_events IS
  'Real-time event queue. DB triggers write events here and fire HTTP to orchestrator. '
  'Every significant state change in MerQuant produces an event.';

COMMENT ON FUNCTION fire_agent_event IS
  'Called by all DB triggers. Writes to agent_events and fires async HTTP to orchestrator.';
