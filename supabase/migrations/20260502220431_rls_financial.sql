-- Finding 5 — Group D: financial tables.
--
-- Highest blast-radius group — locks BOTH read and write down to the
-- finance circle (Owner+Manager). A non-finance role calling
-- supabase.from('payments').select() will receive zero rows after this
-- migration. Mirrors permissions.js COSTING_EDIT / PAYMENT_EDIT.
--
-- Policy shape:
--   SELECT  → Owner + Manager only
--   INSERT  → Owner + Manager only
--   UPDATE  → Owner + Manager only
--   DELETE  → Owner
--
-- Tables covered (6):
--   payments, commercial_invoices, costing_sheets, shipping_documents,
--   shipping_doc_register, sample_invoices

-- ─── Drop existing permissive policies ───────────────────────────────
DROP POLICY IF EXISTS auth_all           ON public.payments;
DROP POLICY IF EXISTS auth_all           ON public.commercial_invoices;
DROP POLICY IF EXISTS auth_all           ON public.costing_sheets;
DROP POLICY IF EXISTS auth_all_docs      ON public.shipping_documents;
DROP POLICY IF EXISTS auth_all           ON public.shipping_doc_register;
DROP POLICY IF EXISTS sample_invoices_all ON public.sample_invoices;

-- Idempotency: drop new names too
DROP POLICY IF EXISTS payments_select               ON public.payments;
DROP POLICY IF EXISTS payments_insert               ON public.payments;
DROP POLICY IF EXISTS payments_update               ON public.payments;
DROP POLICY IF EXISTS payments_delete               ON public.payments;
DROP POLICY IF EXISTS commercial_invoices_select    ON public.commercial_invoices;
DROP POLICY IF EXISTS commercial_invoices_insert    ON public.commercial_invoices;
DROP POLICY IF EXISTS commercial_invoices_update    ON public.commercial_invoices;
DROP POLICY IF EXISTS commercial_invoices_delete    ON public.commercial_invoices;
DROP POLICY IF EXISTS costing_sheets_select         ON public.costing_sheets;
DROP POLICY IF EXISTS costing_sheets_insert         ON public.costing_sheets;
DROP POLICY IF EXISTS costing_sheets_update         ON public.costing_sheets;
DROP POLICY IF EXISTS costing_sheets_delete         ON public.costing_sheets;
DROP POLICY IF EXISTS shipping_documents_select     ON public.shipping_documents;
DROP POLICY IF EXISTS shipping_documents_insert     ON public.shipping_documents;
DROP POLICY IF EXISTS shipping_documents_update     ON public.shipping_documents;
DROP POLICY IF EXISTS shipping_documents_delete     ON public.shipping_documents;
DROP POLICY IF EXISTS shipping_doc_register_select  ON public.shipping_doc_register;
DROP POLICY IF EXISTS shipping_doc_register_insert  ON public.shipping_doc_register;
DROP POLICY IF EXISTS shipping_doc_register_update  ON public.shipping_doc_register;
DROP POLICY IF EXISTS shipping_doc_register_delete  ON public.shipping_doc_register;
DROP POLICY IF EXISTS sample_invoices_select        ON public.sample_invoices;
DROP POLICY IF EXISTS sample_invoices_insert        ON public.sample_invoices;
DROP POLICY IF EXISTS sample_invoices_update        ON public.sample_invoices;
DROP POLICY IF EXISTS sample_invoices_delete        ON public.sample_invoices;

-- ─── payments ────────────────────────────────────────────────────────
CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY payments_insert ON public.payments
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY payments_update ON public.payments
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY payments_delete ON public.payments
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── commercial_invoices ─────────────────────────────────────────────
CREATE POLICY commercial_invoices_select ON public.commercial_invoices
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY commercial_invoices_insert ON public.commercial_invoices
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY commercial_invoices_update ON public.commercial_invoices
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY commercial_invoices_delete ON public.commercial_invoices
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── costing_sheets ──────────────────────────────────────────────────
CREATE POLICY costing_sheets_select ON public.costing_sheets
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY costing_sheets_insert ON public.costing_sheets
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY costing_sheets_update ON public.costing_sheets
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY costing_sheets_delete ON public.costing_sheets
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── shipping_documents ──────────────────────────────────────────────
CREATE POLICY shipping_documents_select ON public.shipping_documents
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY shipping_documents_insert ON public.shipping_documents
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY shipping_documents_update ON public.shipping_documents
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY shipping_documents_delete ON public.shipping_documents
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── shipping_doc_register ───────────────────────────────────────────
CREATE POLICY shipping_doc_register_select ON public.shipping_doc_register
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY shipping_doc_register_insert ON public.shipping_doc_register
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY shipping_doc_register_update ON public.shipping_doc_register
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY shipping_doc_register_delete ON public.shipping_doc_register
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- ─── sample_invoices ─────────────────────────────────────────────────
CREATE POLICY sample_invoices_select ON public.sample_invoices
  FOR SELECT TO authenticated USING (public.has_role('Owner', 'Manager'));
CREATE POLICY sample_invoices_insert ON public.sample_invoices
  FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY sample_invoices_update ON public.sample_invoices
  FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager'))
                              WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY sample_invoices_delete ON public.sample_invoices
  FOR DELETE TO authenticated USING (public.has_role('Owner'));
