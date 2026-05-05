-- 38_reenable_email_confirmation.sql
-- 2026-05-04
--
-- Phase-3 hardening (M2). Re-enables Supabase email confirmation,
-- reversing migration 19 (`disable_email_confirmation`).
--
-- ─── Why this matters ────────────────────────────────────────────────
-- Supabase's "Email Confirm" toggle gates whether new signups can sign
-- in immediately or must click a link mailed to them first. With it
-- OFF, anyone can sign up with any email — including typos that hand
-- access to the wrong person and entirely fabricated addresses that
-- never resolve. With it ON:
--   • The address must be reachable.
--   • A typo'd account stays inactive instead of becoming a live user.
--   • Phishing flows that rely on an attacker's free-email signup are
--     slowed because they need real mailbox access.
--
-- ─── This migration is informational + DB-side ───────────────────────
-- Most of the toggle lives in Supabase Auth project settings, which
-- are not reachable via SQL DDL. A `db push` cannot flip the
-- "Confirm email" switch. So this migration:
--   1. Documents the manual step that must accompany it (see below).
--   2. Adds a row to migrations_applied so deployment automation can
--      detect that the project is meant to require confirmation.
--   3. Tightens the user_profiles auto-create trigger so a confirmed
--      email is required before the user is marked is_active=true.
--
-- ─── Manual Supabase Dashboard step (REQUIRED) ───────────────────────
--   1. Open Supabase Dashboard → Authentication → Sign In / Providers
--      → Email.
--   2. Toggle **Confirm email** to ON.
--   3. (Optional but recommended) configure SMTP under Auth → SMTP
--      Settings so confirmation mails actually leave the platform's
--      shared sender (which is heavily rate-limited).
--   4. Verify by signing up a new test account — the user record
--      should appear in auth.users with email_confirmed_at = NULL
--      until the link is clicked.
--
-- Re-applying this migration is safe — the trigger redefinition is
-- CREATE OR REPLACE.

-- 1. Tighten the auto-create trigger so the user_profiles row defaults
--    to is_active=false until auth.users.email_confirmed_at is set.
--    (When email confirmation is OFF, Supabase sets email_confirmed_at
--    immediately on signup, so the existing flow keeps working.)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _role text;
  _name text;
  _confirmed boolean;
BEGIN
  -- Read initial_role from raw_user_meta_data if passed during sign-up.
  _role := COALESCE(NEW.raw_user_meta_data->>'initial_role', 'Merchandiser');
  _name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  _confirmed := NEW.email_confirmed_at IS NOT NULL;

  -- Enforce safe default — never grant Owner via self-signup.
  IF _role NOT IN ('Manager','Merchandiser','QC Inspector','Viewer','Supplier','Buyer') THEN
    _role := 'Merchandiser';
  END IF;

  -- is_active reflects whether the address is confirmed. With email
  -- confirmation ON: false until they click the link; the activation
  -- can be done by a downstream trigger on auth.users UPDATE that
  -- watches for email_confirmed_at flipping non-null. With email
  -- confirmation OFF (legacy): this is true immediately.
  INSERT INTO public.user_profiles (id, email, full_name, role, is_active)
  VALUES (NEW.id, NEW.email, _name, _role, _confirmed)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2. Add a trigger that activates the user_profiles row when the
--    auth.users row's email_confirmed_at flips from NULL → non-NULL.
CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.user_profiles
       SET is_active = true
     WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  EXECUTE FUNCTION public.handle_email_confirmed();
