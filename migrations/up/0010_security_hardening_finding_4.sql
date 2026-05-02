-- 0010_security_hardening_finding_4.sql
-- Critical fix from the 2026-05-01 hardening audit
-- (docs/security/hardening-audit-2026-05-01.md, finding 4).
--
-- Five tables (bom_explosion_log, job_card_steps, sample_invoices,
-- user_settings, whatsapp_crawl) each carry a single permissive RLS
-- policy created by migrations/up/0001_init.sql with no TO clause.
-- When the TO clause is omitted Postgres defaults to PUBLIC, which
-- includes the anon role — i.e. anyone with the public anon key from
-- the client bundle can read, insert, update, and delete every row.
--
-- Mirrors the pattern set by 0007 for email_crawl: drop the
-- permissive policies and recreate them scoped TO authenticated.
-- The USING (true) WITH CHECK (true) shape is preserved (this
-- migration only closes the anon hole — Finding 5 will tighten the
-- still-broad authenticated grant in a separate session).
--
-- Rollback: see migrations/down/0010_security_hardening_finding_4.sql

BEGIN;

-- ─── bom_explosion_log ───────────────────────────────────────────────
DROP POLICY IF EXISTS bom_log_all ON public.bom_explosion_log;

CREATE POLICY bom_log_all ON public.bom_explosion_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── job_card_steps ──────────────────────────────────────────────────
DROP POLICY IF EXISTS jcs_all ON public.job_card_steps;

CREATE POLICY jcs_all ON public.job_card_steps
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── sample_invoices ─────────────────────────────────────────────────
DROP POLICY IF EXISTS sample_invoices_all ON public.sample_invoices;

CREATE POLICY sample_invoices_all ON public.sample_invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── user_settings ───────────────────────────────────────────────────
DROP POLICY IF EXISTS us_all ON public.user_settings;

CREATE POLICY us_all ON public.user_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── whatsapp_crawl ──────────────────────────────────────────────────
DROP POLICY IF EXISTS wa_all ON public.whatsapp_crawl;

CREATE POLICY wa_all ON public.whatsapp_crawl
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- Verification query (run after applying):
--   SELECT schemaname, tablename, policyname, roles
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('bom_explosion_log', 'job_card_steps',
--                        'sample_invoices', 'user_settings',
--                        'whatsapp_crawl');
-- Expected: every row's `roles` column shows {authenticated},
--           never {public}.
