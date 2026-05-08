-- Migration: 0036_full_agentic_schedules (was MAS 37_full_agentic_schedules)
--
-- Sets up pg_cron schedules for all background agents. Each cron job calls
-- a Supabase edge function via pg_net.http_post.
--
-- ERP adaptations:
--   * Service-role key — read from `vault.decrypted_secrets` (name=service_role_key)
--     instead of the GUC `app.service_role_key`, which Supabase blocks.
--   * Project ref — hardcoded as `jcbxmpgjirxqszodotmx`.
--
-- All schedules are idempotent — `cron.unschedule(...)` runs first to avoid
-- duplicates on re-apply.

-- Helper: build the pg_net body that every scheduled job uses. Inlined as
-- text into each cron command so it can be reasoned about per-job.

-- ============================================================
-- 1. memory-consolidation-agent — weekly Sunday 20:00 UTC (Sunday 1 AM PKT)
-- ============================================================

SELECT cron.unschedule('memory-consolidation-agent')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'memory-consolidation-agent');

SELECT cron.schedule(
  'memory-consolidation-agent',
  '0 20 * * 0',
  $cron$
    SELECT net.http_post(
      url     := 'https://jcbxmpgjirxqszodotmx.supabase.co/functions/v1/memory-consolidation-agent',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

-- ============================================================
-- 2. tna-risk-agent — daily 02:00 UTC (07:00 PKT)
-- ============================================================

SELECT cron.unschedule('tna-risk-agent-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tna-risk-agent-daily');

SELECT cron.schedule(
  'tna-risk-agent-daily',
  '0 2 * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://jcbxmpgjirxqszodotmx.supabase.co/functions/v1/tna-risk-agent',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

-- ============================================================
-- 3. email-crawler-agent — every 15 minutes
--    (Gmail + IMAP polling. Defers per-account work to inside the fn.)
-- ============================================================

SELECT cron.unschedule('email-crawler-agent-15min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-crawler-agent-15min');

SELECT cron.schedule(
  'email-crawler-agent-15min',
  '*/15 * * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://jcbxmpgjirxqszodotmx.supabase.co/functions/v1/email-crawler-agent',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

-- ============================================================
-- 4. expire-agent-actions — hourly (created in mig 0035; re-asserted)
-- ============================================================

SELECT cron.unschedule('expire-agent-actions')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-agent-actions');

SELECT cron.schedule(
  'expire-agent-actions',
  '0 * * * *',
  $cron$
    UPDATE agent_action_queue
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < NOW();
  $cron$
);

-- ============================================================
-- 5. cleanup-agent-events — daily 03:00 UTC, keep 30 days
-- ============================================================

SELECT cron.unschedule('cleanup-agent-events')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-agent-events');

SELECT cron.schedule(
  'cleanup-agent-events',
  '0 3 * * *',
  $cron$
    DELETE FROM agent_events
    WHERE triggered_at < NOW() - INTERVAL '30 days'
      AND status IN ('done','skipped','failed');
  $cron$
);

-- ============================================================
-- 6. cleanup-pg-net-responses — daily 04:00 UTC, keep 7 days
--    pg_net's _http_response can grow unbounded; trim it.
-- ============================================================

SELECT cron.unschedule('cleanup-pg-net-responses')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-pg-net-responses');

SELECT cron.schedule(
  'cleanup-pg-net-responses',
  '0 4 * * *',
  $cron$
    DELETE FROM net._http_response
    WHERE created < NOW() - INTERVAL '7 days';
  $cron$
);

COMMENT ON TABLE agent_events IS
  'Real-time event queue. fire_agent_event() writes here on every significant '
  'DB change. agent-orchestrator consumes and routes to agents. '
  'Retention: 30 days (cleaned by pg_cron job cleanup-agent-events daily).';
