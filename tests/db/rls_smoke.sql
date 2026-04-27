-- tests/db/rls_smoke.sql
-- Spec §8 test 23: RLS is enabled on ai_extractions and storage; auth_all
-- policy permits authenticated select+insert; anon role denied.
--
-- The SQL editor runs as service role (bypasses RLS), so this script reports
-- the configured policies rather than executing them as a non-privileged role.
-- A future pgTAP run would set role and SELECT to actually exercise the gate.

SELECT
    relname,
    relrowsecurity AS rls_enabled,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename=c.relname) AS policy_count
FROM pg_class c
WHERE relname = 'ai_extractions'
  AND relnamespace = 'public'::regnamespace;

-- Expected:
--   rls_enabled = true
--   policy_count = 1 (auth_all)

SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='ai_extractions';

-- Expected:
--   policyname=auth_all, roles={authenticated}, cmd=ALL, qual=true, with_check=true

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'ai_extraction_sources_%';

-- Expected: 3 rows
--   ai_extraction_sources_select / SELECT
--   ai_extraction_sources_insert / INSERT
--   ai_extraction_sources_delete / DELETE

-- Manual anon-denied check (run from a context where role can be set):
-- SET ROLE anon;
-- SELECT id FROM public.ai_extractions LIMIT 1;
-- → expect: ERROR  permission denied for table ai_extractions
-- RESET ROLE;
