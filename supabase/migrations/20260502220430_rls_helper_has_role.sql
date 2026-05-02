-- Finding 5 — overhaul of permissive `auth_all USING (true)` RLS policies.
-- Adds a single SECURITY DEFINER helper used by every per-command policy
-- in the financial / audit / user_settings hardening migrations.
--
-- Why SECURITY DEFINER:
--   The helper reads public.user_profiles to determine the caller's role.
--   user_profiles itself has RLS enabled, and a non-DEFINER call from
--   inside another policy would either recurse or hit a stricter scope.
--   SECURITY DEFINER bypasses RLS for the duration of the helper, which
--   is safe because the helper only ever returns a boolean derived from
--   auth.uid() (the calling session's own identity, not user-supplied input).
--
-- Why SET search_path = public:
--   Required hardening for any SECURITY DEFINER function. Without it, a
--   schema-shadowing attack could install a malicious user_profiles in
--   another schema earlier on the search_path and the helper would read
--   from there. Pinning search_path to `public` blocks that.
--
-- Why STABLE:
--   The result depends only on auth.uid() and the user_profiles row,
--   which are stable within a single statement. Marking STABLE lets the
--   planner cache the result per query, so a policy that calls
--   has_role() five times only does the lookup once.

CREATE OR REPLACE FUNCTION public.has_role(VARIADIC roles text[])
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_profiles
     WHERE id = auth.uid()
       AND role = ANY(roles)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.has_role(text[]) TO service_role;

COMMENT ON FUNCTION public.has_role(text[]) IS
  'Returns true if the calling user_profiles.role matches any of the supplied roles. SECURITY DEFINER + SET search_path=public.';
