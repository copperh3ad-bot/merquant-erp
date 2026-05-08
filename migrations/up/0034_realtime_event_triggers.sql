-- Migration: 0034_realtime_event_triggers (was MAS 35_realtime_event_triggers)
--
-- Database triggers that fire the agent-orchestrator edge function on key
-- row changes. Uses pg_net for non-blocking HTTP. agent_events doubles as
-- an event queue and audit log.
--
-- ERP adaptations:
--   1. Service-role key — Supabase blocks `ALTER DATABASE ... SET` on the
--      `app.service_role_key` GUC. Read from `vault.decrypted_secrets`
--      (vault secret named `service_role_key`) instead.
--   2. Project ref — hardcoded constant ('jcbxmpgjirxqszodotmx'). It's not a
--      secret, just an identifier.
--   3. Column-name patches for ERP tables (tna_milestones uses target_date /
--      actual_date / name / tna_id; qc_inspections uses verdict + summed
--      defect counts; shipments has no delay_reason).
--
-- Prereqs (Phase PAUSE):
--   - pg_cron + pg_net extensions enabled (✓)
--   - vault secret `service_role_key` containing the project's service-role JWT (✓)

-- ============================================================
-- 1. agent_events — event queue / audit log
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  payload      JSONB DEFAULT '{}',
  status       TEXT DEFAULT 'pending'
               CHECK (status IN ('pending','processing','done','failed','skipped')),
  error        TEXT,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  agent_name   TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_events_status    ON agent_events(status, triggered_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_type      ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_entity    ON agent_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_triggered ON agent_events(triggered_at DESC);

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners_managers_read_events" ON agent_events;
CREATE POLICY "owners_managers_read_events"
  ON agent_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner','Manager')
    )
  );

-- ============================================================
-- 2. fire_agent_event() — called by every trigger
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
SET search_path = public, vault
AS $$
DECLARE
  v_event_id    UUID;
  v_project_ref CONSTANT TEXT := 'jcbxmpgjirxqszodotmx';
  v_service_key TEXT;
BEGIN
  INSERT INTO agent_events (event_type, entity_type, entity_id, payload)
  VALUES (p_event_type, p_entity_type, p_entity_id, p_payload)
  RETURNING id INTO v_event_id;

  -- Read service-role JWT from Vault. If absent, log only (don't fire HTTP).
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_service_key IS NOT NULL THEN
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
EXCEPTION WHEN OTHERS THEN
  -- Don't break the originating transaction if the orchestrator call fails;
  -- agent_events row is already committed and the orchestrator's
  -- pending-poll fallback will pick it up.
  RAISE WARNING 'fire_agent_event % failed: %', p_event_type, SQLERRM;
  RETURN v_event_id;
END;
$$;

-- ============================================================
-- 3. Trigger: purchase_orders → po.created / po.{approval_status}
-- ============================================================

CREATE OR REPLACE FUNCTION trg_po_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fire_agent_event(
      'po.created', 'purchase_order', NEW.id,
      jsonb_build_object(
        'po_number',     NEW.po_number,
        'buyer_name',    NEW.buyer_name,
        'delivery_date', NEW.delivery_date,
        'currency',      NEW.currency
      )
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.approval_status IS DISTINCT FROM NEW.approval_status THEN
    PERFORM fire_agent_event(
      'po.' || NEW.approval_status,
      'purchase_order', NEW.id,
      jsonb_build_object(
        'po_number',     NEW.po_number,
        'buyer_name',    NEW.buyer_name,
        'delivery_date', NEW.delivery_date,
        'old_status',    OLD.approval_status,
        'new_status',    NEW.approval_status
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
-- 4. Trigger: tna_milestones → milestone.completed / risk_escalated
-- ERP columns: name (not milestone_name), tna_id (not calendar_id),
-- target_date (not due_date), actual_date (not completed_date).
-- ============================================================

CREATE OR REPLACE FUNCTION trg_milestone_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Marked complete
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('completed','approved') THEN
    PERFORM fire_agent_event(
      'milestone.completed', 'tna_milestone', NEW.id,
      jsonb_build_object(
        'milestone_name', NEW.name,
        'calendar_id',    NEW.tna_id,
        'due_date',       NEW.target_date,
        'completed_date', NEW.actual_date
      )
    );
  END IF;

  -- Risk escalated by tna-risk-agent
  IF TG_OP = 'UPDATE'
     AND OLD.risk_level IS DISTINCT FROM NEW.risk_level
     AND NEW.risk_level IN ('overdue','critical') THEN
    PERFORM fire_agent_event(
      'milestone.risk_escalated', 'tna_milestone', NEW.id,
      jsonb_build_object(
        'milestone_name', NEW.name,
        'calendar_id',    NEW.tna_id,
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
-- 5. Trigger: email_po_drafts → email_draft.confirmed
-- ============================================================

CREATE OR REPLACE FUNCTION trg_email_draft_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'confirmed'
     AND NEW.created_po_id IS NOT NULL THEN
    PERFORM fire_agent_event(
      'email_draft.confirmed', 'email_po_draft', NEW.id,
      jsonb_build_object(
        'po_id',      NEW.created_po_id,
        'buyer_name', NEW.buyer_name,
        'po_number',  NEW.po_number
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
-- 6. Trigger: shipments → shipment.created / shipment.delayed
-- ERP shipments has no delay_reason — derived from notes if needed.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_shipment_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fire_agent_event(
      'shipment.created', 'shipment', NEW.id,
      jsonb_build_object(
        'po_id', NEW.po_id, 'etd', NEW.etd, 'eta', NEW.eta,
        'po_number', NEW.po_number
      )
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'delayed' THEN
    PERFORM fire_agent_event(
      'shipment.delayed', 'shipment', NEW.id,
      jsonb_build_object(
        'po_id',        NEW.po_id,
        'po_number',    NEW.po_number,
        'original_etd', OLD.etd,
        'new_etd',      NEW.etd,
        'notes',        NEW.notes
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
-- ERP qc_inspections uses `verdict` (not `result`) and split defect counts
-- (critical_defects + major_defects + minor_defects).
-- ============================================================

CREATE OR REPLACE FUNCTION trg_qc_result()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_total_defects INTEGER;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE')
     AND NEW.verdict IN ('failed','rejected','fail') THEN
    v_total_defects := COALESCE(NEW.critical_defects, 0)
                     + COALESCE(NEW.major_defects, 0)
                     + COALESCE(NEW.minor_defects, 0);
    PERFORM fire_agent_event(
      'qc.failed', 'qc_inspection', NEW.id,
      jsonb_build_object(
        'po_id',            NEW.po_id,
        'po_number',        NEW.po_number,
        'verdict',          NEW.verdict,
        'total_defects',    v_total_defects,
        'critical_defects', NEW.critical_defects,
        'major_defects',    NEW.major_defects,
        'minor_defects',    NEW.minor_defects,
        'inspector',        NEW.inspector_name
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
-- 8. Trigger: tna_risk_drafts → tna_draft.sent
-- ============================================================

CREATE OR REPLACE FUNCTION trg_tna_draft_sent()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'sent' THEN
    PERFORM fire_agent_event(
      'tna_draft.sent', 'tna_risk_draft', NEW.id,
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

COMMENT ON TABLE agent_events IS
  'Real-time event queue. DB triggers write events here and fire HTTP to '
  'agent-orchestrator. Every significant state change in MerQuant produces '
  'an event. ERP-adapted: reads service-role key from vault.decrypted_secrets '
  '(name=service_role_key), project ref hardcoded.';

COMMENT ON FUNCTION fire_agent_event IS
  'Called by all DB triggers. Writes to agent_events and fires async HTTP '
  'to agent-orchestrator. Failures are logged as WARNING and swallowed so '
  'they never break the originating transaction.';
