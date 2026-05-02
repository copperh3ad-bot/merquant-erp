-- Rollback for 0007_security_hardening_critical.sql
-- Restores the pre-hardening (insecure) policy set. Use only if the
-- hardening change broke a legitimate workflow that needs investigation.

BEGIN;

-- Restore anon read on user_profiles
CREATE POLICY profiles_anon_select ON public.user_profiles
  FOR SELECT TO anon USING (true);

-- Restore PUBLIC policies on email_crawl
DROP POLICY IF EXISTS email_crawl_read   ON public.email_crawl;
DROP POLICY IF EXISTS email_crawl_insert ON public.email_crawl;
DROP POLICY IF EXISTS email_crawl_update ON public.email_crawl;
DROP POLICY IF EXISTS email_crawl_delete ON public.email_crawl;

CREATE POLICY email_crawl_read   ON public.email_crawl FOR SELECT USING (true);
CREATE POLICY email_crawl_insert ON public.email_crawl FOR INSERT WITH CHECK (true);
CREATE POLICY email_crawl_update ON public.email_crawl FOR UPDATE USING (true);
CREATE POLICY email_crawl_delete ON public.email_crawl FOR DELETE USING (true);

COMMIT;
