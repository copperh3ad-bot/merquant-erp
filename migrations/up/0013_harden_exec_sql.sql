-- 0013_harden_exec_sql.sql
-- 2026-05-02
--
-- Hardening for hardening-audit-2026-05-01 Finding 9 (exec_sql RPC).
--
-- The original exec_sql function (migration 0001) had three security gaps:
--   1. SECURITY DEFINER — runs as the database owner, bypassing every RLS
--      policy. A user could read tables their role would never normally
--      reach (e.g. price_list, payments).
--   2. Multi-statement injection — the leading-keyword regex
--      (UPPER(TRIM(query)) LIKE 'SELECT%') passed any string that started
--      with SELECT, even strings containing embedded semicolons. The
--      function concatenated the user input into a wrapper EXECUTE
--      ("SELECT ... FROM (USER_QUERY) t") which let an attacker close the
--      parens early and append arbitrary statements:
--         "1) t; DROP TABLE user_profiles; SELECT * FROM (SELECT 1"
--   3. PUBLIC EXECUTE — by default any role (anon + authenticated) could
--      call the function.
--
-- This migration replaces the function definition with a hardened version:
--   • SECURITY INVOKER (the default) — RLS now applies. The user can only
--     see what their normal SELECT permissions allow.
--   • Role gate — must be a logged-in user with role in
--     {Owner, Manager, Merchandiser} (matches AI_DATA_QUERY in
--     src/lib/permissions.js).
--   • Sanitiser — strips leading whitespace + SQL comments before the
--     keyword check so /*x*/SELECT doesn't bypass.
--   • Statement count check — rejects any query containing a semicolon
--     other than at the very end (which we strip first).
--   • Length cap — 10 000 chars to protect against pathological input.
--   • REVOKE EXECUTE FROM PUBLIC, GRANT only to authenticated.
--
-- Re-applying is safe (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
-- Deliberately NOT SECURITY DEFINER. The function runs as the calling
-- user, so RLS policies on every table are honoured.
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  cleaned text;
  upper_clean text;
  caller_role text;
BEGIN
  -- 1. Auth gate. Must be a logged-in user.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'exec_sql: authentication required'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Role gate. Match the AI_DATA_QUERY permission in permissions.js.
  SELECT role INTO caller_role
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;
  IF caller_role IS NULL OR caller_role NOT IN ('Owner', 'Manager', 'Merchandiser') THEN
    RAISE EXCEPTION 'exec_sql: insufficient privilege (role=%)', COALESCE(caller_role, 'unknown')
      USING ERRCODE = '42501';
  END IF;

  -- 3. Length cap. Anything over 10kB is suspicious.
  IF length(query) > 10000 THEN
    RAISE EXCEPTION 'exec_sql: query exceeds 10000 character limit';
  END IF;

  -- 4. Sanitise leading whitespace + line/block comments before the
  --    keyword check, so /*x*/SELECT or --x\nSELECT can't slip past.
  cleaned := query;
  -- Strip leading SQL line comments and whitespace iteratively.
  LOOP
    DECLARE
      prev text := cleaned;
    BEGIN
      cleaned := regexp_replace(cleaned, '^\s+', '');
      cleaned := regexp_replace(cleaned, '^--[^\n]*\n?', '');
      cleaned := regexp_replace(cleaned, '^/\*.*?\*/', '', 'n');
      EXIT WHEN cleaned = prev;
    END;
  END LOOP;
  -- Strip a single trailing semicolon if present (the front-end already
  -- does this but belt-and-suspenders).
  cleaned := regexp_replace(cleaned, ';\s*$', '');
  upper_clean := upper(cleaned);

  -- 5. Whitelist leading keyword.
  IF upper_clean NOT LIKE 'SELECT%' AND
     upper_clean NOT LIKE 'WITH%'   AND
     upper_clean NOT LIKE 'EXPLAIN%' THEN
    RAISE EXCEPTION 'exec_sql: only SELECT / WITH / EXPLAIN queries are allowed';
  END IF;

  -- 6. Reject any embedded semicolons. After step 4 stripped the trailing
  --    one, any remaining ';' indicates an attempted multi-statement
  --    injection (e.g. "SELECT 1; DROP TABLE x").
  IF position(';' IN cleaned) > 0 THEN
    RAISE EXCEPTION 'exec_sql: multiple statements are not allowed (found ";")';
  END IF;

  -- 7. Execute. Wrapper subquery means the result is always jsonb.
  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || cleaned || ') t'
    INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Lock down EXECUTE so the function can ONLY be called by authenticated
-- users (not anon, not service_role-by-mistake). The role gate above is
-- the second line of defence; this is the first.
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated;
