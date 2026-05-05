-- 36_exec_sql_owner_manager_only.sql
-- 2026-05-04
--
-- Phase-3 hardening (C3). Tightens exec_sql from {Owner, Manager,
-- Merchandiser} → {Owner, Manager}. Migration 13 added the original
-- role gate; this is a follow-up that drops Merchandiser to match the
-- v2 audit requirement that ad-hoc SQL is a Manager-or-above tool.
--
-- The matching frontend change in src/lib/permissions.js drops
-- AI_DATA_QUERY from Merchandiser so the UI lock-screen appears
-- before a query is ever sent (consistent UX, no confusing DB
-- errors). Re-applying is safe (CREATE OR REPLACE).
--
-- Everything else from migration 13 (length cap, comment-strip,
-- semicolon reject, SECURITY INVOKER, REVOKE FROM PUBLIC) is
-- preserved verbatim.

CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  cleaned text;
  upper_clean text;
  caller_role text;
BEGIN
  -- 1. Auth gate.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'exec_sql: authentication required'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Role gate — Owner / Manager only (was: + Merchandiser).
  SELECT role INTO caller_role
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;
  IF caller_role IS NULL OR caller_role NOT IN ('Owner', 'Manager') THEN
    RAISE EXCEPTION 'exec_sql: insufficient privilege (role=%)', COALESCE(caller_role, 'unknown')
      USING ERRCODE = '42501';
  END IF;

  -- 3. Length cap.
  IF length(query) > 10000 THEN
    RAISE EXCEPTION 'exec_sql: query exceeds 10000 character limit';
  END IF;

  -- 4. Sanitise leading whitespace + line/block comments.
  cleaned := query;
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
  cleaned := regexp_replace(cleaned, ';\s*$', '');
  upper_clean := upper(cleaned);

  -- 5. Whitelist leading keyword.
  IF upper_clean NOT LIKE 'SELECT%' AND
     upper_clean NOT LIKE 'WITH%'   AND
     upper_clean NOT LIKE 'EXPLAIN%' THEN
    RAISE EXCEPTION 'exec_sql: only SELECT / WITH / EXPLAIN queries are allowed';
  END IF;

  -- 6. Reject embedded semicolons.
  IF position(';' IN cleaned) > 0 THEN
    RAISE EXCEPTION 'exec_sql: multiple statements are not allowed (found ";")';
  END IF;

  -- 7. Execute.
  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || cleaned || ') t'
    INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated;
