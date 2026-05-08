-- Migration: 37_full_agentic_schedules
-- Schedules all remaining agents and sets required DB config

-- ============================================================
-- 1. Set project ref (needed by fire_agent_event trigger)
--    Run this once after deployment:
-- ============================================================
-- ALTER DATABASE postgres SET app.supabase_project_ref = 'ecjqdyruwqlesfthgphv';
-- (already set app.service_role_key in migration 31)

-- ============================================================
-- 2. pg_cron: memory-consolidation-agent — weekly Sunday 1 AM PKT
--    1 AM PKT = Sunday 20:00 UTC Saturday
-- ============================================================

SELECT cron.unschedule('memory-consolidation-agent')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'memory-consolidation-agent');

SELECT cron.schedule(
  'memory-consolidation-agent',
  '0 20 * * 0',  -- Sunday 8 PM UTC = Sunday 1 AM PKT
  $$
    SELECT net.http_post(
      url     := 'https://ecjqdyruwqlesfthgphv.supabase.co/functions/v1/memory-consolidation-agent',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ============================================================
-- 3. pg_cron: expire stale agent_action_queue entries hourly
--    (already in migration 36 — idempotent re-run safe)
-- ============================================================

SELECT cron.unschedule('expire-agent-actions')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-agent-actions');

SELECT cron.schedule(
  'expire-agent-actions',
  '0 * * * *',
  $$
    UPDATE agent_action_queue
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < NOW();
  $$
);

-- ============================================================
-- 4. pg_cron: clean up old agent_events (keep 30 days)
-- ============================================================

SELECT cron.schedule(
  'cleanup-agent-events',
  '0 3 * * *',   -- 3 AM UTC daily
  $$
    DELETE FROM agent_events
    WHERE triggered_at < NOW() - INTERVAL '30 days'
      AND status IN ('done', 'skipped', 'failed');
  $$
);

-- ============================================================
-- 5. Full cron schedule summary (all agents)
-- ============================================================

-- Every 15 min:  email-crawler-agent    (Gmail + IMAP)
-- Daily 2 AM UTC (7 AM PKT): tna-risk-agent
-- Weekly Sun 20 UTC (Sun 1 AM PKT): memory-consolidation-agent
-- Event-driven (instant): agent-orchestrator (via DB triggers)
-- On-demand: ai-assistant-v2, memory-writer, email-po-agent

COMMENT ON TABLE agent_events IS
  'Real-time event queue. Fire_agent_event() writes here on every significant DB change. '
  'Orchestrator consumes events and routes to appropriate agents. '
  'Retention: 30 days (cleaned by pg_cron daily).';
