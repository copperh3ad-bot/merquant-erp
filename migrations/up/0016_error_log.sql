-- 30_error_log.sql
--
-- Application error log. The frontend logger (src/lib/logger.js) writes
-- here on production crashes via PageErrorBoundary's componentDidCatch.
--
-- Owner reads (admin debugging). Anyone authenticated can insert their
-- own crash report. Never UPDATE; never DELETE from the client.

-- UP
CREATE TABLE IF NOT EXISTS public.error_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message text,
  stack text,
  context jsonb,
  url text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS error_log_owner_select ON public.error_log;
DROP POLICY IF EXISTS error_log_authenticated_insert ON public.error_log;

CREATE POLICY error_log_owner_select ON public.error_log
  FOR SELECT TO authenticated
  USING (public.has_role('Owner'));

CREATE POLICY error_log_authenticated_insert ON public.error_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- DOWN
DROP POLICY IF EXISTS error_log_authenticated_insert ON public.error_log;
DROP POLICY IF EXISTS error_log_owner_select ON public.error_log;
DROP TABLE IF EXISTS public.error_log;
