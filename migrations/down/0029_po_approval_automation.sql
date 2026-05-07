-- 0029_po_approval_automation.sql (DOWN)
-- Reverts migrations/up/0029_po_approval_automation.sql.
--
-- Drops the RPC and the two columns added to tna_templates. The
-- approval flow falls back to the four-column UPDATE in
-- db.purchaseOrders.approve(...) — that code path still exists in the
-- supabaseClient.js fallback (or is restored alongside the down).

DROP FUNCTION IF EXISTS public.fn_approve_po_with_automation(uuid, text, text);

DROP INDEX IF EXISTS public.tna_templates_one_default_per_customer_idx;
DROP INDEX IF EXISTS public.tna_templates_one_system_default_idx;

ALTER TABLE public.tna_templates
  DROP COLUMN IF EXISTS default_for_customer_name,
  DROP COLUMN IF EXISTS is_default;
