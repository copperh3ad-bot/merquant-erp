-- migrations/up/0010_backfill_auth_user_created_trigger.sql
--
-- The on_auth_user_created trigger lives on auth.users, which is a
-- Supabase-managed schema not captured by pg_dump --schema=public.
-- Discovered 2026-05-01 during cutover to the new MerQuant ERP project
-- (jcbxmpgjirxqszodotmx) when sign-up succeeded but no user_profiles
-- row was created — leaving the new user unable to log in.
--
-- This migration recreates the trigger so future cross-project moves
-- (or fresh project setups) don't have to remember to add it manually.
--
-- Note: this migration is idempotent — DROP IF EXISTS first.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
