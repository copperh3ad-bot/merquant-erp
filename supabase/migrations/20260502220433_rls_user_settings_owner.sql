-- Finding 5 — Group G: per-user data + price_list cleanup.
--
-- 1) public.user_settings — was `us_all USING (true)` (replaced previously
--    with `TO authenticated USING (true)` to close the anon hole). Switch
--    to a per-user-row scope with Owner override:
--      SELECT  → user_id = auth.uid() OR Owner
--      INSERT  → WITH CHECK (user_id = auth.uid())   — only own row
--      UPDATE  → user_id = auth.uid() OR Owner
--      DELETE  → user_id = auth.uid() OR Owner
--    The Owner override lets admins clean up settings when a team member
--    leaves the company without bypassing RLS via the service role.
--
-- 2) public.price_list — has BOTH the role-aware `price_list_read` /
--    `price_list_write` (correct) AND a dead `auth_all USING (true)`
--    permissive policy. Postgres ORs multiple permissive policies, so
--    auth_all wins and the role check is unreachable. Drop auth_all to
--    let the existing role-aware pair take effect.

-- ─── user_settings: drop existing permissive policy ──────────────────
DROP POLICY IF EXISTS us_all ON public.user_settings;

-- Idempotency
DROP POLICY IF EXISTS user_settings_select ON public.user_settings;
DROP POLICY IF EXISTS user_settings_insert ON public.user_settings;
DROP POLICY IF EXISTS user_settings_update ON public.user_settings;
DROP POLICY IF EXISTS user_settings_delete ON public.user_settings;

CREATE POLICY user_settings_select ON public.user_settings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role('Owner'));

CREATE POLICY user_settings_insert ON public.user_settings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_settings_update ON public.user_settings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role('Owner'))
  WITH CHECK (user_id = auth.uid() OR public.has_role('Owner'));

CREATE POLICY user_settings_delete ON public.user_settings
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role('Owner'));

-- ─── price_list: drop the dead permissive policy ─────────────────────
-- The role-aware price_list_read and price_list_write (already in DB)
-- remain in place after this drop.
DROP POLICY IF EXISTS auth_all ON public.price_list;
