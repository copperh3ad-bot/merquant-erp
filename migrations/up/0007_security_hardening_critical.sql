-- 0007_security_hardening_critical.sql
-- Critical fixes from the 2026-05-01 hardening audit
-- (docs/security/hardening-audit-2026-05-01.md, findings 1 and 2).
--
-- Fix 1: Drop public-anon read access on user_profiles. The existing
--        profiles_select_authenticated policy keeps the table readable
--        to logged-in users, which is the only legitimate use case.
--
-- Fix 2: Recreate the four email_crawl policies with TO authenticated.
--        The current policies have no TO clause, so they default to
--        PUBLIC (anon + authenticated), exposing every email body,
--        sender, and AI-extracted PO content to the open internet.
--
-- Rollback: see migrations/down/0007_security_hardening_critical.sql

BEGIN;

-- ─── Fix 1: user_profiles ────────────────────────────────────────────
DROP POLICY IF EXISTS profiles_anon_select ON public.user_profiles;

-- ─── Fix 2: email_crawl ──────────────────────────────────────────────
DROP POLICY IF EXISTS email_crawl_read   ON public.email_crawl;
DROP POLICY IF EXISTS email_crawl_insert ON public.email_crawl;
DROP POLICY IF EXISTS email_crawl_update ON public.email_crawl;
DROP POLICY IF EXISTS email_crawl_delete ON public.email_crawl;

CREATE POLICY email_crawl_read ON public.email_crawl
  FOR SELECT TO authenticated USING (true);

CREATE POLICY email_crawl_insert ON public.email_crawl
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY email_crawl_update ON public.email_crawl
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY email_crawl_delete ON public.email_crawl
  FOR DELETE TO authenticated USING (true);

COMMIT;
