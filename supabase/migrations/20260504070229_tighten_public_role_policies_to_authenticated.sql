-- 13 RLS policies were assigned `TO PUBLIC` (the default when no `TO`
-- clause is given) instead of `TO authenticated`. Their qual clauses
-- include `auth.uid() IS NOT NULL`, which means the anon role couldn't
-- actually read rows in practice (auth.uid() returns NULL for anon).
-- But it's poor hygiene and the original audit's Finding 4 mandates
-- explicit `TO authenticated` everywhere. Belt-and-braces against
-- a future role-check refactor that might forget the auth.uid() guard.
--
-- Tables: capacity_plans, consumption_library, po_item_sizes,
--         price_list, production_lines, production_output, production_stages
--
-- Recreate every policy with identical USING/WITH CHECK clauses but
-- bound TO authenticated.

-- capacity_plans
DROP POLICY IF EXISTS capacity_plans_read  ON public.capacity_plans;
DROP POLICY IF EXISTS capacity_plans_write ON public.capacity_plans;
CREATE POLICY capacity_plans_read  ON public.capacity_plans
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY capacity_plans_write ON public.capacity_plans
  FOR ALL TO authenticated
  USING (public.has_role('Owner', 'Manager'))
  WITH CHECK (public.has_role('Owner', 'Manager'));

-- consumption_library
DROP POLICY IF EXISTS cl_read  ON public.consumption_library;
DROP POLICY IF EXISTS cl_write ON public.consumption_library;
CREATE POLICY cl_read  ON public.consumption_library
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY cl_write ON public.consumption_library
  FOR ALL TO authenticated
  USING (public.has_role('Owner', 'Manager', 'Merchandiser'))
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));

-- po_item_sizes
DROP POLICY IF EXISTS po_item_sizes_read  ON public.po_item_sizes;
DROP POLICY IF EXISTS po_item_sizes_write ON public.po_item_sizes;
CREATE POLICY po_item_sizes_read  ON public.po_item_sizes
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY po_item_sizes_write ON public.po_item_sizes
  FOR ALL TO authenticated
  USING (public.has_role('Owner', 'Manager', 'Merchandiser'))
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));

-- price_list
DROP POLICY IF EXISTS price_list_read  ON public.price_list;
DROP POLICY IF EXISTS price_list_write ON public.price_list;
CREATE POLICY price_list_read  ON public.price_list
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY price_list_write ON public.price_list
  FOR ALL TO authenticated
  USING (public.has_role('Owner', 'Manager'))
  WITH CHECK (public.has_role('Owner', 'Manager'));

-- production_lines
DROP POLICY IF EXISTS production_lines_read  ON public.production_lines;
DROP POLICY IF EXISTS production_lines_write ON public.production_lines;
CREATE POLICY production_lines_read  ON public.production_lines
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY production_lines_write ON public.production_lines
  FOR ALL TO authenticated
  USING (public.has_role('Owner', 'Manager'))
  WITH CHECK (public.has_role('Owner', 'Manager'));

-- production_output
DROP POLICY IF EXISTS production_output_read  ON public.production_output;
DROP POLICY IF EXISTS production_output_write ON public.production_output;
CREATE POLICY production_output_read  ON public.production_output
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY production_output_write ON public.production_output
  FOR ALL TO authenticated
  USING (public.has_role('Owner', 'Manager', 'Merchandiser'))
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));

-- production_stages (read-only — admin-managed reference data)
DROP POLICY IF EXISTS production_stages_read ON public.production_stages;
CREATE POLICY production_stages_read ON public.production_stages
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
-- NB: no write policy was found for production_stages; service_role
-- handles seeding via migrations. Leaving the gap intentional.
