-- Rollback for 0010_security_hardening_finding_4.sql
-- Restores the pre-hardening (insecure) policy set on the five
-- Finding-4 tables: a single permissive _all policy with no TO clause,
-- which defaults to PUBLIC (anon + authenticated). Use only if the
-- hardening change broke a legitimate workflow that needs investigation.

BEGIN;

DROP POLICY IF EXISTS bom_log_all ON public.bom_explosion_log;
CREATE POLICY bom_log_all ON public.bom_explosion_log
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS jcs_all ON public.job_card_steps;
CREATE POLICY jcs_all ON public.job_card_steps
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sample_invoices_all ON public.sample_invoices;
CREATE POLICY sample_invoices_all ON public.sample_invoices
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS us_all ON public.user_settings;
CREATE POLICY us_all ON public.user_settings
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS wa_all ON public.whatsapp_crawl;
CREATE POLICY wa_all ON public.whatsapp_crawl
  USING (true) WITH CHECK (true);

COMMIT;
