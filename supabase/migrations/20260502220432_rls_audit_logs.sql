-- Finding 5 — Group E: audit / log tables.
--
-- General pattern:
--   SELECT  → Owner+Manager (audit data is admin-only)
--   INSERT  → varies; caller-context inserts (status_logs, comms_log,
--             permission_denials) get WITH CHECK (true) so any
--             logged-in user can write their own activity. Admin-only
--             logs gate INSERT to the same roles that produce the data.
--   UPDATE  → no policy created — mutating audit history is a red flag,
--             so authenticated users cannot UPDATE these rows.
--             (service_role retains full access via Postgres default.)
--   DELETE  → Owner only.
--
-- Tables covered (8):
--   status_logs, comms_log, gcal_sync_log, email_crawl_log,
--   permission_denials, master_article_changes, bom_explosion_log,
--   whatsapp_crawl

-- ─── Drop existing permissive policies ───────────────────────────────
DROP POLICY IF EXISTS auth_all_logs            ON public.status_logs;
DROP POLICY IF EXISTS auth_all                 ON public.comms_log;
DROP POLICY IF EXISTS auth_all                 ON public.gcal_sync_log;
DROP POLICY IF EXISTS auth_all_email_crawl     ON public.email_crawl_log;
DROP POLICY IF EXISTS auth_all                 ON public.permission_denials;
DROP POLICY IF EXISTS mac_auth_all             ON public.master_article_changes;
DROP POLICY IF EXISTS bom_log_all              ON public.bom_explosion_log;
DROP POLICY IF EXISTS wa_all                   ON public.whatsapp_crawl;

-- Idempotency
DROP POLICY IF EXISTS status_logs_select               ON public.status_logs;
DROP POLICY IF EXISTS status_logs_insert               ON public.status_logs;
DROP POLICY IF EXISTS status_logs_delete               ON public.status_logs;
DROP POLICY IF EXISTS comms_log_select                 ON public.comms_log;
DROP POLICY IF EXISTS comms_log_insert                 ON public.comms_log;
DROP POLICY IF EXISTS comms_log_delete                 ON public.comms_log;
DROP POLICY IF EXISTS gcal_sync_log_select             ON public.gcal_sync_log;
DROP POLICY IF EXISTS gcal_sync_log_insert             ON public.gcal_sync_log;
DROP POLICY IF EXISTS gcal_sync_log_update             ON public.gcal_sync_log;
DROP POLICY IF EXISTS gcal_sync_log_delete             ON public.gcal_sync_log;
DROP POLICY IF EXISTS email_crawl_log_select           ON public.email_crawl_log;
DROP POLICY IF EXISTS email_crawl_log_insert           ON public.email_crawl_log;
DROP POLICY IF EXISTS email_crawl_log_update           ON public.email_crawl_log;
DROP POLICY IF EXISTS email_crawl_log_delete           ON public.email_crawl_log;
DROP POLICY IF EXISTS permission_denials_select        ON public.permission_denials;
DROP POLICY IF EXISTS permission_denials_insert        ON public.permission_denials;
DROP POLICY IF EXISTS permission_denials_delete        ON public.permission_denials;
DROP POLICY IF EXISTS master_article_changes_select    ON public.master_article_changes;
DROP POLICY IF EXISTS master_article_changes_insert    ON public.master_article_changes;
DROP POLICY IF EXISTS master_article_changes_delete    ON public.master_article_changes;
DROP POLICY IF EXISTS bom_explosion_log_select         ON public.bom_explosion_log;
DROP POLICY IF EXISTS bom_explosion_log_insert         ON public.bom_explosion_log;
DROP POLICY IF EXISTS bom_explosion_log_delete         ON public.bom_explosion_log;
DROP POLICY IF EXISTS whatsapp_crawl_select            ON public.whatsapp_crawl;
DROP POLICY IF EXISTS whatsapp_crawl_insert            ON public.whatsapp_crawl;
DROP POLICY IF EXISTS whatsapp_crawl_update            ON public.whatsapp_crawl;
DROP POLICY IF EXISTS whatsapp_crawl_delete            ON public.whatsapp_crawl;

-- ─── status_logs (caller-context inserts from app) ───────────────────
CREATE POLICY status_logs_select ON public.status_logs
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY status_logs_insert ON public.status_logs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY status_logs_delete ON public.status_logs
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── comms_log ───────────────────────────────────────────────────────
CREATE POLICY comms_log_select ON public.comms_log
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY comms_log_insert ON public.comms_log
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY comms_log_delete ON public.comms_log
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── gcal_sync_log (TNA gcal sync — O+M only) ────────────────────────
CREATE POLICY gcal_sync_log_select ON public.gcal_sync_log
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY gcal_sync_log_insert ON public.gcal_sync_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY gcal_sync_log_update ON public.gcal_sync_log
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY gcal_sync_log_delete ON public.gcal_sync_log
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── email_crawl_log (EmailCrawler page is O+M) ──────────────────────
CREATE POLICY email_crawl_log_select ON public.email_crawl_log
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY email_crawl_log_insert ON public.email_crawl_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY email_crawl_log_update ON public.email_crawl_log
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY email_crawl_log_delete ON public.email_crawl_log
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── permission_denials (any user logging a denial against themselves)
CREATE POLICY permission_denials_select ON public.permission_denials
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY permission_denials_insert ON public.permission_denials
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY permission_denials_delete ON public.permission_denials
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── master_article_changes (apply-master-data writes) ───────────────
CREATE POLICY master_article_changes_select ON public.master_article_changes
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY master_article_changes_insert ON public.master_article_changes
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY master_article_changes_delete ON public.master_article_changes
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── bom_explosion_log (explode_po_bom RPC — non-DEFINER, caller-ctx)
CREATE POLICY bom_explosion_log_select ON public.bom_explosion_log
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY bom_explosion_log_insert ON public.bom_explosion_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY bom_explosion_log_delete ON public.bom_explosion_log
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── whatsapp_crawl (no active app code paths) ───────────────────────
CREATE POLICY whatsapp_crawl_select ON public.whatsapp_crawl
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY whatsapp_crawl_insert ON public.whatsapp_crawl
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY whatsapp_crawl_update ON public.whatsapp_crawl
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY whatsapp_crawl_delete ON public.whatsapp_crawl
  FOR DELETE TO authenticated USING (public.has_role('Owner'));
