-- 39_ai_proxy_rate_limit.sql
-- 2026-05-04
--
-- Phase-3 hardening (AI-RL). Adds the audit table + helper RPC the
-- ai-proxy edge function uses to enforce a per-user rate limit on
-- Anthropic calls.
--
-- Threat model: an authenticated user (any role) can hit the proxy
-- without an upper bound today. Even a low-skill mistake — a runaway
-- React effect, a script in dev tools — can burn the project's
-- Anthropic budget in minutes. Per-user limit at the edge stops
-- single-account abuse without depending on Netlify-level WAF rules.
--
-- Design:
--   • One row per call in ai_proxy_calls. Tiny — id, user_id,
--     called_at, tokens_used (nullable; we don't always know).
--   • check_ai_proxy_rate_limit(window_seconds, max_calls) — counts
--     the caller's rows in the trailing window and raises if they
--     exceed max_calls. Returns the current count + a remaining
--     budget so the caller can surface a friendly message.
--   • SECURITY INVOKER + RLS: each user can read/insert ONLY their
--     own rows; the service-role key from the edge function bypasses
--     RLS naturally. Owner is granted SELECT-all for support tooling.
--
-- Defaults the proxy will use: 60 calls per 5-minute window
-- (configurable per call via the helper's args).

CREATE TABLE IF NOT EXISTS public.ai_proxy_calls (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  called_at   timestamptz NOT NULL DEFAULT now(),
  tokens_used int,
  model       text
);

CREATE INDEX IF NOT EXISTS ai_proxy_calls_user_called_idx
  ON public.ai_proxy_calls (user_id, called_at DESC);

ALTER TABLE public.ai_proxy_calls ENABLE ROW LEVEL SECURITY;

-- Self-read for the caller (for in-app "your usage" telemetry someday).
DROP POLICY IF EXISTS ai_proxy_calls_self_select ON public.ai_proxy_calls;
CREATE POLICY ai_proxy_calls_self_select ON public.ai_proxy_calls
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role('Owner'));

-- Self-insert. The edge function uses the service-role key which
-- bypasses RLS anyway; this lets a future client-side write path
-- (e.g. local-only assistant) work without admin keys.
DROP POLICY IF EXISTS ai_proxy_calls_self_insert ON public.ai_proxy_calls;
CREATE POLICY ai_proxy_calls_self_insert ON public.ai_proxy_calls
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Owner cleanup (rotation policy lives outside this migration; for
-- now, retention is unbounded — will revisit when row count gets
-- noisy).
DROP POLICY IF EXISTS ai_proxy_calls_owner_delete ON public.ai_proxy_calls;
CREATE POLICY ai_proxy_calls_owner_delete ON public.ai_proxy_calls
  FOR DELETE TO authenticated
  USING (public.has_role('Owner'));

-- Helper RPC. Returns jsonb { allowed, count, max, window_seconds, remaining }.
-- Raises when the cap is exceeded so the edge function can short-circuit
-- with a 429.
CREATE OR REPLACE FUNCTION public.check_ai_proxy_rate_limit(
  p_user_id uuid,
  p_window_seconds int DEFAULT 300,
  p_max_calls int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent_count int;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'check_ai_proxy_rate_limit: p_user_id required';
  END IF;
  IF p_window_seconds <= 0 OR p_max_calls <= 0 THEN
    RAISE EXCEPTION 'check_ai_proxy_rate_limit: window_seconds and max_calls must be > 0';
  END IF;

  SELECT count(*) INTO recent_count
    FROM public.ai_proxy_calls
    WHERE user_id = p_user_id
      AND called_at >= now() - make_interval(secs => p_window_seconds);

  RETURN jsonb_build_object(
    'allowed',         recent_count < p_max_calls,
    'count',           recent_count,
    'max',             p_max_calls,
    'window_seconds',  p_window_seconds,
    'remaining',       greatest(0, p_max_calls - recent_count)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_ai_proxy_rate_limit(uuid, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_ai_proxy_rate_limit(uuid, int, int) TO service_role;
GRANT  EXECUTE ON FUNCTION public.check_ai_proxy_rate_limit(uuid, int, int) TO authenticated;

COMMENT ON TABLE public.ai_proxy_calls IS
  'One row per Anthropic call routed through ai-proxy. Used for per-user rate limiting and usage analytics.';
COMMENT ON FUNCTION public.check_ai_proxy_rate_limit(uuid, int, int) IS
  'Returns { allowed, count, max, window_seconds, remaining }. Used by the ai-proxy edge function before forwarding to Anthropic.';
