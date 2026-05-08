-- Migration: 36_agent_action_policy
-- Defines which actions each agent can execute autonomously
-- vs which require human approval (queued in agent_action_queue)

-- ============================================================
-- 1. agent_action_policy — what agents can do autonomously
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_action_policy (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  auto_execute    BOOLEAN DEFAULT false,   -- true = run immediately, false = queue for approval
  requires_role   TEXT DEFAULT 'Merchandiser',
  max_per_hour    INTEGER DEFAULT 10,      -- rate limit
  enabled         BOOLEAN DEFAULT true,
  notes           TEXT,
  updated_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_name, action_type)
);

ALTER TABLE agent_action_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_manage_policy"
  ON agent_action_policy FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Owner'
    )
  );
CREATE POLICY "all_read_policy"
  ON agent_action_policy FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Seed default policies
-- auto_execute=true = agent does it without asking
-- auto_execute=false = agent queues it for one-click human approval
INSERT INTO agent_action_policy
  (agent_name, action_type, auto_execute, notes)
VALUES
  -- Orchestrator
  ('orchestrator', 'tna_calendar.create',      true,  'Auto-create T&A calendar on PO approval'),
  ('orchestrator', 'tna_milestones.seed',       true,  'Auto-seed milestones from template'),
  ('orchestrator', 'notification.send',         true,  'Always auto-send in-app notifications'),
  ('orchestrator', 'memory.write',              true,  'Always write memories automatically'),
  -- T&A Risk Agent
  ('tna-risk-agent', 'milestone.flag_risk',     true,  'Auto-update risk_level on milestone'),
  ('tna-risk-agent', 'email_draft.create',      true,  'Auto-draft buyer emails (not send)'),
  ('tna-risk-agent', 'email.send',              false, 'Sending requires Merchandiser approval'),
  -- Email PO Agent
  ('email-po-agent', 'po_draft.create',         true,  'Auto-create PO drafts from emails'),
  ('email-po-agent', 'po.create',               false, 'Creating actual PO requires confirmation'),
  ('email-po-agent', 'email.mark_read',         true,  'Auto-mark processed emails as read'),
  -- AI Assistant
  ('ai-assistant', 'po.update_field',           false, 'Requires confirmation'),
  ('ai-assistant', 'po_items.bulk_update',      false, 'Requires confirmation'),
  ('ai-assistant', 'tna_milestones.bulk_shift', false, 'Date shifting requires approval'),
  ('ai-assistant', 'po_batch.split',            false, 'Batch splits require confirmation'),
  ('ai-assistant', 'costing.recalculate',       true,  'Read+calc only, no destructive write'),
  ('ai-assistant', 'report.generate',           true,  'Read-only, always auto-run')
ON CONFLICT (agent_name, action_type) DO NOTHING;

-- ============================================================
-- 2. agent_action_queue — pending agent actions awaiting approval
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_action_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  payload         JSONB NOT NULL,          -- the action to execute
  description     TEXT,                    -- human-readable "what will happen"
  triggered_by    TEXT,                    -- event_type that caused this
  event_id        UUID REFERENCES agent_events(id) ON DELETE SET NULL,

  status          TEXT DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',   -- awaiting human approval
                    'approved',  -- approved, will execute next run
                    'executing', -- currently executing
                    'done',      -- executed successfully
                    'rejected',  -- human rejected
                    'expired'    -- not actioned within TTL
                  )),

  approved_by     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  rejected_by     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  reject_reason   TEXT,
  executed_at     TIMESTAMPTZ,
  execution_error TEXT,

  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '48 hours',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_action_queue_status    ON agent_action_queue(status, created_at DESC);
CREATE INDEX idx_action_queue_agent     ON agent_action_queue(agent_name);
CREATE INDEX idx_action_queue_expires   ON agent_action_queue(expires_at)
  WHERE status = 'pending';

ALTER TABLE agent_action_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_managers_all_queue"
  ON agent_action_queue FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner', 'Manager')
    )
  );
CREATE POLICY "merchandisers_read_queue"
  ON agent_action_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Merchandiser'
    )
  );
CREATE POLICY "merchandisers_approve_queue"
  ON agent_action_queue FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner', 'Manager', 'Merchandiser')
    )
  );

-- ============================================================
-- 3. RPC: execute_agent_action
--    Called when an action is approved — executes the actual write
--    Uses a dispatch table so only approved action types can run
-- ============================================================

CREATE OR REPLACE FUNCTION execute_agent_action(p_action_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_action      agent_action_queue%ROWTYPE;
  v_result      JSONB := '{"success": true}'::jsonb;
  v_payload     JSONB;
BEGIN
  SELECT * INTO v_action FROM agent_action_queue WHERE id = p_action_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action % not found', p_action_id;
  END IF;

  IF v_action.status != 'approved' THEN
    RAISE EXCEPTION 'Action % is not approved (status: %)', p_action_id, v_action.status;
  END IF;

  v_payload := v_action.payload;

  UPDATE agent_action_queue SET status = 'executing' WHERE id = p_action_id;

  BEGIN
    CASE v_action.action_type

      -- Shift T&A milestone dates in bulk
      WHEN 'tna_milestones.bulk_shift' THEN
        UPDATE tna_milestones
        SET due_date = due_date + ((v_payload->>'shift_days')::INTEGER)
        WHERE calendar_id = (v_payload->>'calendar_id')::UUID
          AND status NOT IN ('completed', 'approved');
        v_result := jsonb_build_object('success', true, 'shifted', 'all pending milestones');

      -- Split a PO batch
      WHEN 'po_batch.split' THEN
        -- Placeholder: actual batch split logic is complex, handled by existing supabaseClient methods
        v_result := jsonb_build_object('success', false, 'reason', 'Use frontend batch split UI');

      -- Update a PO field
      WHEN 'po.update_field' THEN
        EXECUTE format(
          'UPDATE purchase_orders SET %I = $1 WHERE id = $2',
          v_payload->>'field'
        ) USING v_payload->>'value', (v_payload->>'po_id')::UUID;
        v_result := jsonb_build_object('success', true);

      -- Recalculate costing sheet
      WHEN 'costing.recalculate' THEN
        -- Read-only: trigger frontend refresh signal via notification
        v_result := jsonb_build_object('success', true, 'action', 'recalculate_requested');

      ELSE
        RAISE EXCEPTION 'Unknown action type: %', v_action.action_type;
    END CASE;

    UPDATE agent_action_queue
    SET status = 'done', executed_at = NOW()
    WHERE id = p_action_id;

  EXCEPTION WHEN OTHERS THEN
    UPDATE agent_action_queue
    SET status = 'done', execution_error = SQLERRM, executed_at = NOW()
    WHERE id = p_action_id;
    v_result := jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 4. pg_cron: expire stale pending actions every hour
-- ============================================================

SELECT cron.schedule(
  'expire-agent-actions',
  '0 * * * *',
  $$
    UPDATE agent_action_queue
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at < NOW();
  $$
);

COMMENT ON TABLE agent_action_policy IS
  'Defines what each agent can do autonomously vs what requires human approval. '
  'auto_execute=true runs immediately; false queues in agent_action_queue.';

COMMENT ON TABLE agent_action_queue IS
  'Pending agent actions awaiting human approval. '
  'Agents write here when auto_execute=false. '
  'Humans one-click approve/reject from the AgentActions UI.';
