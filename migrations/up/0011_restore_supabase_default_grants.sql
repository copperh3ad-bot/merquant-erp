-- migrations/up/0011_restore_supabase_default_grants.sql
--
-- During the 2026-05-01 migration to a new Supabase project we ran
-- `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` to clear the
-- empty-but-not-quite-empty schema before applying 0001_init.sql.
-- That dropped the standard Supabase grants:
--    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
--    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
--    ...
-- which Supabase normally provisions automatically. RLS policies were
-- intact but useless — no role could even USE the schema. Result: every
-- REST call from a logged-in user returned 403 "permission denied for
-- schema public".
--
-- This migration restores those grants. Idempotent.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
