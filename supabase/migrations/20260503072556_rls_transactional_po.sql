-- Finding 5 — Group B (tier-2): transactional PO and merchandising data.
--
-- SELECT → all authenticated. INSERT/UPDATE → Owner+Manager+Merchandiser.
-- DELETE → Owner.
--
-- Tables covered (19):
--   purchase_orders, po_items, po_batches, po_change_log, articles,
--   article_packaging, tech_packs, sku_review_queue, quotations,
--   quotation_items, rfqs, complaints, crosscheck_discrepancies,
--   tna_calendars, tna_milestones, style_consumption, print_layouts,
--   lab_dips*, samples*
--
-- *lab_dips and samples follow permissions.js LAB_DIP_EDIT / SAMPLE_EDIT
-- = ["Owner","Manager","QC Inspector","Merchandiser"] — wider than the
-- original draft 0013 which restricted to O+M only. Reconciled to match
-- the live UI matrix; otherwise QC Inspectors and Merchandisers would
-- see "permission denied" on a flow they use today.

DROP POLICY IF EXISTS auth_all_po                ON public.purchase_orders;
DROP POLICY IF EXISTS auth_all_items             ON public.po_items;
DROP POLICY IF EXISTS auth_all                   ON public.po_batches;
DROP POLICY IF EXISTS auth_all                   ON public.po_change_log;
DROP POLICY IF EXISTS auth_all                   ON public.articles;
DROP POLICY IF EXISTS auth_all                   ON public.article_packaging;
DROP POLICY IF EXISTS auth_all                   ON public.tech_packs;
DROP POLICY IF EXISTS auth_all_sku_queue         ON public.sku_review_queue;
DROP POLICY IF EXISTS auth_all                   ON public.quotations;
DROP POLICY IF EXISTS auth_all                   ON public.quotation_items;
DROP POLICY IF EXISTS auth_all                   ON public.rfqs;
DROP POLICY IF EXISTS auth_all                   ON public.complaints;
DROP POLICY IF EXISTS auth_all                   ON public.crosscheck_discrepancies;
DROP POLICY IF EXISTS auth_all                   ON public.tna_calendars;
DROP POLICY IF EXISTS auth_all                   ON public.tna_milestones;
DROP POLICY IF EXISTS style_cons_all             ON public.style_consumption;
DROP POLICY IF EXISTS auth_all                   ON public.print_layouts;
DROP POLICY IF EXISTS auth_all                   ON public.lab_dips;
DROP POLICY IF EXISTS auth_all                   ON public.samples;

DROP POLICY IF EXISTS purchase_orders_select          ON public.purchase_orders;
DROP POLICY IF EXISTS purchase_orders_insert          ON public.purchase_orders;
DROP POLICY IF EXISTS purchase_orders_update          ON public.purchase_orders;
DROP POLICY IF EXISTS purchase_orders_delete          ON public.purchase_orders;
DROP POLICY IF EXISTS po_items_select                 ON public.po_items;
DROP POLICY IF EXISTS po_items_insert                 ON public.po_items;
DROP POLICY IF EXISTS po_items_update                 ON public.po_items;
DROP POLICY IF EXISTS po_items_delete                 ON public.po_items;
DROP POLICY IF EXISTS po_batches_select               ON public.po_batches;
DROP POLICY IF EXISTS po_batches_insert               ON public.po_batches;
DROP POLICY IF EXISTS po_batches_update               ON public.po_batches;
DROP POLICY IF EXISTS po_batches_delete               ON public.po_batches;
DROP POLICY IF EXISTS po_change_log_select            ON public.po_change_log;
DROP POLICY IF EXISTS po_change_log_insert            ON public.po_change_log;
DROP POLICY IF EXISTS po_change_log_update            ON public.po_change_log;
DROP POLICY IF EXISTS po_change_log_delete            ON public.po_change_log;
DROP POLICY IF EXISTS articles_select                 ON public.articles;
DROP POLICY IF EXISTS articles_insert                 ON public.articles;
DROP POLICY IF EXISTS articles_update                 ON public.articles;
DROP POLICY IF EXISTS articles_delete                 ON public.articles;
DROP POLICY IF EXISTS article_packaging_select        ON public.article_packaging;
DROP POLICY IF EXISTS article_packaging_insert        ON public.article_packaging;
DROP POLICY IF EXISTS article_packaging_update        ON public.article_packaging;
DROP POLICY IF EXISTS article_packaging_delete        ON public.article_packaging;
DROP POLICY IF EXISTS tech_packs_select               ON public.tech_packs;
DROP POLICY IF EXISTS tech_packs_insert               ON public.tech_packs;
DROP POLICY IF EXISTS tech_packs_update               ON public.tech_packs;
DROP POLICY IF EXISTS tech_packs_delete               ON public.tech_packs;
DROP POLICY IF EXISTS sku_review_queue_select         ON public.sku_review_queue;
DROP POLICY IF EXISTS sku_review_queue_insert         ON public.sku_review_queue;
DROP POLICY IF EXISTS sku_review_queue_update         ON public.sku_review_queue;
DROP POLICY IF EXISTS sku_review_queue_delete         ON public.sku_review_queue;
DROP POLICY IF EXISTS quotations_select               ON public.quotations;
DROP POLICY IF EXISTS quotations_insert               ON public.quotations;
DROP POLICY IF EXISTS quotations_update               ON public.quotations;
DROP POLICY IF EXISTS quotations_delete               ON public.quotations;
DROP POLICY IF EXISTS quotation_items_select          ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_insert          ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_update          ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_delete          ON public.quotation_items;
DROP POLICY IF EXISTS rfqs_select                     ON public.rfqs;
DROP POLICY IF EXISTS rfqs_insert                     ON public.rfqs;
DROP POLICY IF EXISTS rfqs_update                     ON public.rfqs;
DROP POLICY IF EXISTS rfqs_delete                     ON public.rfqs;
DROP POLICY IF EXISTS complaints_select               ON public.complaints;
DROP POLICY IF EXISTS complaints_insert               ON public.complaints;
DROP POLICY IF EXISTS complaints_update               ON public.complaints;
DROP POLICY IF EXISTS complaints_delete               ON public.complaints;
DROP POLICY IF EXISTS crosscheck_discrepancies_select ON public.crosscheck_discrepancies;
DROP POLICY IF EXISTS crosscheck_discrepancies_insert ON public.crosscheck_discrepancies;
DROP POLICY IF EXISTS crosscheck_discrepancies_update ON public.crosscheck_discrepancies;
DROP POLICY IF EXISTS crosscheck_discrepancies_delete ON public.crosscheck_discrepancies;
DROP POLICY IF EXISTS tna_calendars_select            ON public.tna_calendars;
DROP POLICY IF EXISTS tna_calendars_insert            ON public.tna_calendars;
DROP POLICY IF EXISTS tna_calendars_update            ON public.tna_calendars;
DROP POLICY IF EXISTS tna_calendars_delete            ON public.tna_calendars;
DROP POLICY IF EXISTS tna_milestones_select           ON public.tna_milestones;
DROP POLICY IF EXISTS tna_milestones_insert           ON public.tna_milestones;
DROP POLICY IF EXISTS tna_milestones_update           ON public.tna_milestones;
DROP POLICY IF EXISTS tna_milestones_delete           ON public.tna_milestones;
DROP POLICY IF EXISTS style_consumption_select        ON public.style_consumption;
DROP POLICY IF EXISTS style_consumption_insert        ON public.style_consumption;
DROP POLICY IF EXISTS style_consumption_update        ON public.style_consumption;
DROP POLICY IF EXISTS style_consumption_delete        ON public.style_consumption;
DROP POLICY IF EXISTS print_layouts_select            ON public.print_layouts;
DROP POLICY IF EXISTS print_layouts_insert            ON public.print_layouts;
DROP POLICY IF EXISTS print_layouts_update            ON public.print_layouts;
DROP POLICY IF EXISTS print_layouts_delete            ON public.print_layouts;
DROP POLICY IF EXISTS lab_dips_select                 ON public.lab_dips;
DROP POLICY IF EXISTS lab_dips_insert                 ON public.lab_dips;
DROP POLICY IF EXISTS lab_dips_update                 ON public.lab_dips;
DROP POLICY IF EXISTS lab_dips_delete                 ON public.lab_dips;
DROP POLICY IF EXISTS samples_select                  ON public.samples;
DROP POLICY IF EXISTS samples_insert                  ON public.samples;
DROP POLICY IF EXISTS samples_update                  ON public.samples;
DROP POLICY IF EXISTS samples_delete                  ON public.samples;

-- Standard Group B: write = O+M+Merchandiser
CREATE POLICY purchase_orders_select ON public.purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY purchase_orders_insert ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY purchase_orders_update ON public.purchase_orders FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY purchase_orders_delete ON public.purchase_orders FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY po_items_select ON public.po_items FOR SELECT TO authenticated USING (true);
CREATE POLICY po_items_insert ON public.po_items FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY po_items_update ON public.po_items FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY po_items_delete ON public.po_items FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY po_batches_select ON public.po_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY po_batches_insert ON public.po_batches FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY po_batches_update ON public.po_batches FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY po_batches_delete ON public.po_batches FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY po_change_log_select ON public.po_change_log FOR SELECT TO authenticated USING (true);
CREATE POLICY po_change_log_insert ON public.po_change_log FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY po_change_log_update ON public.po_change_log FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY po_change_log_delete ON public.po_change_log FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY articles_select ON public.articles FOR SELECT TO authenticated USING (true);
CREATE POLICY articles_insert ON public.articles FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY articles_update ON public.articles FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY articles_delete ON public.articles FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY article_packaging_select ON public.article_packaging FOR SELECT TO authenticated USING (true);
CREATE POLICY article_packaging_insert ON public.article_packaging FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY article_packaging_update ON public.article_packaging FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY article_packaging_delete ON public.article_packaging FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY tech_packs_select ON public.tech_packs FOR SELECT TO authenticated USING (true);
CREATE POLICY tech_packs_insert ON public.tech_packs FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY tech_packs_update ON public.tech_packs FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY tech_packs_delete ON public.tech_packs FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY sku_review_queue_select ON public.sku_review_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY sku_review_queue_insert ON public.sku_review_queue FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY sku_review_queue_update ON public.sku_review_queue FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY sku_review_queue_delete ON public.sku_review_queue FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY quotations_select ON public.quotations FOR SELECT TO authenticated USING (true);
CREATE POLICY quotations_insert ON public.quotations FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY quotations_update ON public.quotations FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY quotations_delete ON public.quotations FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY quotation_items_select ON public.quotation_items FOR SELECT TO authenticated USING (true);
CREATE POLICY quotation_items_insert ON public.quotation_items FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY quotation_items_update ON public.quotation_items FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY quotation_items_delete ON public.quotation_items FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY rfqs_select ON public.rfqs FOR SELECT TO authenticated USING (true);
CREATE POLICY rfqs_insert ON public.rfqs FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY rfqs_update ON public.rfqs FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY rfqs_delete ON public.rfqs FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY complaints_select ON public.complaints FOR SELECT TO authenticated USING (true);
CREATE POLICY complaints_insert ON public.complaints FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY complaints_update ON public.complaints FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY complaints_delete ON public.complaints FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY crosscheck_discrepancies_select ON public.crosscheck_discrepancies FOR SELECT TO authenticated USING (true);
CREATE POLICY crosscheck_discrepancies_insert ON public.crosscheck_discrepancies FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY crosscheck_discrepancies_update ON public.crosscheck_discrepancies FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY crosscheck_discrepancies_delete ON public.crosscheck_discrepancies FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY tna_calendars_select ON public.tna_calendars FOR SELECT TO authenticated USING (true);
CREATE POLICY tna_calendars_insert ON public.tna_calendars FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY tna_calendars_update ON public.tna_calendars FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY tna_calendars_delete ON public.tna_calendars FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY tna_milestones_select ON public.tna_milestones FOR SELECT TO authenticated USING (true);
CREATE POLICY tna_milestones_insert ON public.tna_milestones FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY tna_milestones_update ON public.tna_milestones FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY tna_milestones_delete ON public.tna_milestones FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY style_consumption_select ON public.style_consumption FOR SELECT TO authenticated USING (true);
CREATE POLICY style_consumption_insert ON public.style_consumption FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY style_consumption_update ON public.style_consumption FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY style_consumption_delete ON public.style_consumption FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY print_layouts_select ON public.print_layouts FOR SELECT TO authenticated USING (true);
CREATE POLICY print_layouts_insert ON public.print_layouts FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY print_layouts_update ON public.print_layouts FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY print_layouts_delete ON public.print_layouts FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- lab_dips and samples: WIDER role set than original draft per current
-- permissions.js LAB_DIP_EDIT / SAMPLE_EDIT (O + M + QC Inspector + Merchandiser).
CREATE POLICY lab_dips_select ON public.lab_dips FOR SELECT TO authenticated USING (true);
CREATE POLICY lab_dips_insert ON public.lab_dips FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'QC Inspector', 'Merchandiser'));
CREATE POLICY lab_dips_update ON public.lab_dips FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'QC Inspector', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'QC Inspector', 'Merchandiser'));
CREATE POLICY lab_dips_delete ON public.lab_dips FOR DELETE TO authenticated USING (public.has_role('Owner'));

CREATE POLICY samples_select ON public.samples FOR SELECT TO authenticated USING (true);
CREATE POLICY samples_insert ON public.samples FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager', 'QC Inspector', 'Merchandiser'));
CREATE POLICY samples_update ON public.samples FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager', 'QC Inspector', 'Merchandiser')) WITH CHECK (public.has_role('Owner', 'Manager', 'QC Inspector', 'Merchandiser'));
CREATE POLICY samples_delete ON public.samples FOR DELETE TO authenticated USING (public.has_role('Owner'));
