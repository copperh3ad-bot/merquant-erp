-- Finding 5 — Group C (tier-2): production / logistics tables.
--
-- SELECT → all authenticated. INSERT/UPDATE → Owner+Manager+Merchandiser.
-- DELETE → Owner. Special case: qc_inspections write set is
-- O+M+QC Inspector per permissions.js QC_CREATE.
--
-- Tables covered (13):
--   job_cards, job_card_steps, batch_items, batch_split_snapshots,
--   fabric_orders, accessory_items, accessory_purchase_orders,
--   trim_items, yarn_requirements, shipments, packing_lists, rm_stock,
--   qc_inspections*

DROP POLICY IF EXISTS auth_all                           ON public.job_cards;
DROP POLICY IF EXISTS jcs_all                            ON public.job_card_steps;
DROP POLICY IF EXISTS auth_all                           ON public.batch_items;
DROP POLICY IF EXISTS auth_all                           ON public.batch_split_snapshots;
DROP POLICY IF EXISTS auth_all                           ON public.fabric_orders;
DROP POLICY IF EXISTS auth_all                           ON public.accessory_items;
DROP POLICY IF EXISTS auth_all                           ON public.accessory_purchase_orders;
DROP POLICY IF EXISTS auth_all                           ON public.trim_items;
DROP POLICY IF EXISTS auth_all                           ON public.yarn_requirements;
DROP POLICY IF EXISTS auth_all_shipments                 ON public.shipments;
DROP POLICY IF EXISTS auth_all                           ON public.packing_lists;
DROP POLICY IF EXISTS rm_stock_all                       ON public.rm_stock;
DROP POLICY IF EXISTS auth_all                           ON public.qc_inspections;

DROP POLICY IF EXISTS job_cards_select               ON public.job_cards;
DROP POLICY IF EXISTS job_cards_insert               ON public.job_cards;
DROP POLICY IF EXISTS job_cards_update               ON public.job_cards;
DROP POLICY IF EXISTS job_cards_delete               ON public.job_cards;
DROP POLICY IF EXISTS job_card_steps_select          ON public.job_card_steps;
DROP POLICY IF EXISTS job_card_steps_insert          ON public.job_card_steps;
DROP POLICY IF EXISTS job_card_steps_update          ON public.job_card_steps;
DROP POLICY IF EXISTS job_card_steps_delete          ON public.job_card_steps;
DROP POLICY IF EXISTS batch_items_select             ON public.batch_items;
DROP POLICY IF EXISTS batch_items_insert             ON public.batch_items;
DROP POLICY IF EXISTS batch_items_update             ON public.batch_items;
DROP POLICY IF EXISTS batch_items_delete             ON public.batch_items;
DROP POLICY IF EXISTS batch_split_snapshots_select   ON public.batch_split_snapshots;
DROP POLICY IF EXISTS batch_split_snapshots_insert   ON public.batch_split_snapshots;
DROP POLICY IF EXISTS batch_split_snapshots_update   ON public.batch_split_snapshots;
DROP POLICY IF EXISTS batch_split_snapshots_delete   ON public.batch_split_snapshots;
DROP POLICY IF EXISTS fabric_orders_select           ON public.fabric_orders;
DROP POLICY IF EXISTS fabric_orders_insert           ON public.fabric_orders;
DROP POLICY IF EXISTS fabric_orders_update           ON public.fabric_orders;
DROP POLICY IF EXISTS fabric_orders_delete           ON public.fabric_orders;
DROP POLICY IF EXISTS accessory_items_select         ON public.accessory_items;
DROP POLICY IF EXISTS accessory_items_insert         ON public.accessory_items;
DROP POLICY IF EXISTS accessory_items_update         ON public.accessory_items;
DROP POLICY IF EXISTS accessory_items_delete         ON public.accessory_items;
DROP POLICY IF EXISTS accessory_purchase_orders_select ON public.accessory_purchase_orders;
DROP POLICY IF EXISTS accessory_purchase_orders_insert ON public.accessory_purchase_orders;
DROP POLICY IF EXISTS accessory_purchase_orders_update ON public.accessory_purchase_orders;
DROP POLICY IF EXISTS accessory_purchase_orders_delete ON public.accessory_purchase_orders;
DROP POLICY IF EXISTS trim_items_select              ON public.trim_items;
DROP POLICY IF EXISTS trim_items_insert              ON public.trim_items;
DROP POLICY IF EXISTS trim_items_update              ON public.trim_items;
DROP POLICY IF EXISTS trim_items_delete              ON public.trim_items;
DROP POLICY IF EXISTS yarn_requirements_select       ON public.yarn_requirements;
DROP POLICY IF EXISTS yarn_requirements_insert       ON public.yarn_requirements;
DROP POLICY IF EXISTS yarn_requirements_update       ON public.yarn_requirements;
DROP POLICY IF EXISTS yarn_requirements_delete       ON public.yarn_requirements;
DROP POLICY IF EXISTS shipments_select               ON public.shipments;
DROP POLICY IF EXISTS shipments_insert               ON public.shipments;
DROP POLICY IF EXISTS shipments_update               ON public.shipments;
DROP POLICY IF EXISTS shipments_delete               ON public.shipments;
DROP POLICY IF EXISTS packing_lists_select           ON public.packing_lists;
DROP POLICY IF EXISTS packing_lists_insert           ON public.packing_lists;
DROP POLICY IF EXISTS packing_lists_update           ON public.packing_lists;
DROP POLICY IF EXISTS packing_lists_delete           ON public.packing_lists;
DROP POLICY IF EXISTS rm_stock_select                ON public.rm_stock;
DROP POLICY IF EXISTS rm_stock_insert                ON public.rm_stock;
DROP POLICY IF EXISTS rm_stock_update                ON public.rm_stock;
DROP POLICY IF EXISTS rm_stock_delete                ON public.rm_stock;
DROP POLICY IF EXISTS qc_inspections_select          ON public.qc_inspections;
DROP POLICY IF EXISTS qc_inspections_insert          ON public.qc_inspections;
DROP POLICY IF EXISTS qc_inspections_update          ON public.qc_inspections;
DROP POLICY IF EXISTS qc_inspections_delete          ON public.qc_inspections;

CREATE POLICY job_cards_select ON public.job_cards FOR SELECT TO authenticated USING (true);
CREATE POLICY job_cards_insert ON public.job_cards FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY job_cards_update ON public.job_cards FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY job_cards_delete ON public.job_cards FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY job_card_steps_select ON public.job_card_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY job_card_steps_insert ON public.job_card_steps FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY job_card_steps_update ON public.job_card_steps FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY job_card_steps_delete ON public.job_card_steps FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY batch_items_select ON public.batch_items FOR SELECT TO authenticated USING (true);
CREATE POLICY batch_items_insert ON public.batch_items FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY batch_items_update ON public.batch_items FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY batch_items_delete ON public.batch_items FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY batch_split_snapshots_select ON public.batch_split_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY batch_split_snapshots_insert ON public.batch_split_snapshots FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY batch_split_snapshots_update ON public.batch_split_snapshots FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY batch_split_snapshots_delete ON public.batch_split_snapshots FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY fabric_orders_select ON public.fabric_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY fabric_orders_insert ON public.fabric_orders FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY fabric_orders_update ON public.fabric_orders FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY fabric_orders_delete ON public.fabric_orders FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY accessory_items_select ON public.accessory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY accessory_items_insert ON public.accessory_items FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY accessory_items_update ON public.accessory_items FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY accessory_items_delete ON public.accessory_items FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY accessory_purchase_orders_select ON public.accessory_purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY accessory_purchase_orders_insert ON public.accessory_purchase_orders FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY accessory_purchase_orders_update ON public.accessory_purchase_orders FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY accessory_purchase_orders_delete ON public.accessory_purchase_orders FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY trim_items_select ON public.trim_items FOR SELECT TO authenticated USING (true);
CREATE POLICY trim_items_insert ON public.trim_items FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY trim_items_update ON public.trim_items FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY trim_items_delete ON public.trim_items FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY yarn_requirements_select ON public.yarn_requirements FOR SELECT TO authenticated USING (true);
CREATE POLICY yarn_requirements_insert ON public.yarn_requirements FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY yarn_requirements_update ON public.yarn_requirements FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY yarn_requirements_delete ON public.yarn_requirements FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY shipments_select ON public.shipments FOR SELECT TO authenticated USING (true);
CREATE POLICY shipments_insert ON public.shipments FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY shipments_update ON public.shipments FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY shipments_delete ON public.shipments FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY packing_lists_select ON public.packing_lists FOR SELECT TO authenticated USING (true);
CREATE POLICY packing_lists_insert ON public.packing_lists FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY packing_lists_update ON public.packing_lists FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY packing_lists_delete ON public.packing_lists FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY rm_stock_select ON public.rm_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY rm_stock_insert ON public.rm_stock FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY rm_stock_update ON public.rm_stock FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY rm_stock_delete ON public.rm_stock FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- qc_inspections: write = O+M+QC Inspector per permissions.js QC_CREATE.
-- Merchandiser excluded (consistent with the UI matrix).
CREATE POLICY qc_inspections_select ON public.qc_inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY qc_inspections_insert ON public.qc_inspections FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'QC Inspector'));
CREATE POLICY qc_inspections_update ON public.qc_inspections FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'QC Inspector')) WITH CHECK (public.has_role('Owner', 'Manager', 'QC Inspector'));
CREATE POLICY qc_inspections_delete ON public.qc_inspections FOR DELETE TO authenticated USING (public.has_role('Owner'));
