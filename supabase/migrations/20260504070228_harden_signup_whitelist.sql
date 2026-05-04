-- signup_whitelist hardening — table was discovered with RLS DISABLED and
-- wide GRANTs to anon (SELECT, INSERT, UPDATE, DELETE, TRUNCATE), meaning
-- any unauthenticated user could read the entire whitelist or add their
-- own email to it.
--
-- Audit confirmed all production reads come from supabase/functions/
-- user-approval/index.ts via the service-role admin client (which
-- bypasses both RLS and GRANT defaults). Frontend has zero references.
-- So the right model is: lock down completely; only service_role
-- touches it.
--
-- Belt-and-braces:
--   1. REVOKE all the over-broad anon + authenticated GRANTs.
--   2. ENABLE RLS so even with leftover GRANTs, no row-level access works.
--   3. Add a single Owner policy for occasional manual admin via the
--      Supabase studio (Owner can manage the whitelist when adding new
--      employees through the UI). service_role bypasses RLS by default
--      so the user-approval edge function is unaffected.

REVOKE ALL ON public.signup_whitelist FROM anon;
REVOKE ALL ON public.signup_whitelist FROM authenticated;

ALTER TABLE public.signup_whitelist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signup_whitelist_owner_all ON public.signup_whitelist;
CREATE POLICY signup_whitelist_owner_all ON public.signup_whitelist
  FOR ALL TO authenticated
  USING (public.has_role('Owner'))
  WITH CHECK (public.has_role('Owner'));
