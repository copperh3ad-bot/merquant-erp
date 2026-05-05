-- 40_buyer_rls.sql
--
-- F5 prerequisite — Buyer-role RLS scoping. Replaces the existing
-- open-to-all-authenticated SELECT policies on purchase_orders /
-- shipments / samples with a single combined policy per table that
-- restricts the Buyer role to their own customer's data.
--
-- DESIGN DECISIONS (deviation from brief):
-- 1. purchase_orders has no buyer_id column today — only customer_name
--    (text). Adding buyer_id would need full backfill of every
--    historical PO. Instead, link via customer_name match against
--    buyer_contacts.customer_name where buyer_user_id = auth.uid().
-- 2. Buyer can be assigned to multiple buyer_contacts rows for the
--    same customer (different roles at the buyer org); they see all
--    POs for that customer, which is the intended UX.
-- 3. INSERT/UPDATE/DELETE policies for these tables already restrict
--    to Owner/Manager/Merchandiser per tier-2 RLS — Buyer can't write
--    anyway. Only SELECT needs change.

-- UP

ALTER TABLE public.buyer_contacts
  ADD COLUMN IF NOT EXISTS buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS buyer_contacts_buyer_user_idx ON public.buyer_contacts(buyer_user_id);

-- ─── purchase_orders SELECT ───────────────────────────────────────────
DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders;
CREATE POLICY purchase_orders_select ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (
    -- Non-Buyer roles see everything (matches the previous policy)
    public.has_role('Owner', 'Manager', 'Merchandiser', 'QC Inspector', 'Viewer', 'Supplier')
    OR
    -- Buyer sees only POs for customers they're linked to
    (
      public.has_role('Buyer')
      AND customer_name IS NOT NULL
      AND lower(customer_name) IN (
        SELECT lower(customer_name) FROM public.buyer_contacts
        WHERE buyer_user_id = auth.uid() AND customer_name IS NOT NULL
      )
    )
  );

-- ─── shipments SELECT ─────────────────────────────────────────────────
-- Existing policy was open-to-authenticated. Mirror the buyer scoping
-- via po_id → purchase_orders.customer_name lookup.
DROP POLICY IF EXISTS shipments_select ON public.shipments;
CREATE POLICY shipments_select ON public.shipments
  FOR SELECT TO authenticated
  USING (
    public.has_role('Owner', 'Manager', 'Merchandiser', 'QC Inspector', 'Viewer', 'Supplier')
    OR (
      public.has_role('Buyer')
      AND po_id IN (
        SELECT id FROM public.purchase_orders
        WHERE customer_name IS NOT NULL
          AND lower(customer_name) IN (
            SELECT lower(customer_name) FROM public.buyer_contacts
            WHERE buyer_user_id = auth.uid() AND customer_name IS NOT NULL
          )
      )
    )
  );

-- ─── samples SELECT ───────────────────────────────────────────────────
DROP POLICY IF EXISTS samples_select ON public.samples;
CREATE POLICY samples_select ON public.samples
  FOR SELECT TO authenticated
  USING (
    public.has_role('Owner', 'Manager', 'Merchandiser', 'QC Inspector', 'Viewer', 'Supplier')
    OR (
      public.has_role('Buyer')
      AND po_id IN (
        SELECT id FROM public.purchase_orders
        WHERE customer_name IS NOT NULL
          AND lower(customer_name) IN (
            SELECT lower(customer_name) FROM public.buyer_contacts
            WHERE buyer_user_id = auth.uid() AND customer_name IS NOT NULL
          )
      )
    )
  );

-- DOWN
-- Restore the original tier-2 open SELECT policies
DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders;
CREATE POLICY purchase_orders_select ON public.purchase_orders
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS shipments_select ON public.shipments;
CREATE POLICY shipments_select ON public.shipments
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS samples_select ON public.samples;
CREATE POLICY samples_select ON public.samples
  FOR SELECT TO authenticated USING (true);
ALTER TABLE public.buyer_contacts DROP COLUMN IF EXISTS buyer_user_id;
