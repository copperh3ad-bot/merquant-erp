-- 37_owner_bootstrap.sql
-- 2026-05-04
--
-- Phase-3 hardening (C4). Adds a one-shot Owner bootstrap RPC.
--
-- Context. The auto-create-on-signup trigger (migration 9) deliberately
-- refuses to grant the Owner role — see 0001_init.sql lines 519-522.
-- This means a brand-new project ends up with zero Owners and there is
-- no UI path to elevate the first user. The historical workaround was
-- "manually UPDATE user_profiles SET role='Owner' WHERE email=…" via
-- the Supabase SQL editor, which is fine but easy to fat-finger.
--
-- This migration ships a guarded RPC that performs the same operation
-- safely:
--   1. Hard-fails if an Owner already exists. Once at least one Owner
--      is in place, normal RBAC governs all role changes — bootstrap
--      is no longer needed.
--   2. Requires the caller to supply a target email (no auth.uid()
--      shortcut — the bootstrap is meant to be run by a service-role
--      key during initial setup, not by a self-signed-up user).
--   3. Returns the promoted user's id, or raises if the email is not
--      registered yet.
--
-- Usage (one-time, via Supabase SQL editor or service-role admin SDK):
--   SELECT public.bootstrap_first_owner('founder@example.com');
--
-- Re-running after the first Owner exists is safe: the function raises
-- and changes nothing.

CREATE OR REPLACE FUNCTION public.bootstrap_first_owner(target_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER  -- needs to UPDATE user_profiles regardless of caller's role
SET search_path TO 'public'
AS $$
DECLARE
  existing_owner_count int;
  target_id uuid;
BEGIN
  IF target_email IS NULL OR length(trim(target_email)) = 0 THEN
    RAISE EXCEPTION 'bootstrap_first_owner: target_email is required';
  END IF;

  -- 1. Guard — if an Owner already exists, refuse. There is no
  --    legitimate reason to invoke bootstrap a second time.
  SELECT count(*) INTO existing_owner_count
    FROM public.user_profiles
    WHERE role = 'Owner' AND COALESCE(is_active, true) = true;

  IF existing_owner_count > 0 THEN
    RAISE EXCEPTION 'bootstrap_first_owner: an Owner already exists (count=%) — use the User Management UI to grant additional Owner roles', existing_owner_count
      USING ERRCODE = '42501';
  END IF;

  -- 2. Resolve target — the user must already exist (i.e. they have
  --    signed up at least once and the auto-create trigger inserted a
  --    row in user_profiles with the default role).
  SELECT id INTO target_id
    FROM public.user_profiles
    WHERE lower(email) = lower(trim(target_email))
    LIMIT 1;

  IF target_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_first_owner: no user_profiles row for email %, ask them to sign up first', target_email;
  END IF;

  -- 3. Promote.
  UPDATE public.user_profiles
    SET role = 'Owner',
        is_active = true
    WHERE id = target_id;

  RETURN target_id;
END;
$$;

-- Lock the function down — only the service_role key (used by the
-- Supabase admin SDK / dashboard SQL editor) and the postgres role
-- (direct DB) should be able to call it. Authenticated/anon users
-- have no business invoking bootstrap from the client.
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_owner(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_owner(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_owner(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bootstrap_first_owner(text) TO service_role;

COMMENT ON FUNCTION public.bootstrap_first_owner(text) IS
  'One-shot Owner bootstrap. Refuses if any Owner already exists. service_role only.';
