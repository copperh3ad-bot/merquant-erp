-- tests/db/po_approval_automation.sql
-- Manual smoke for migrations/up/0029_po_approval_automation.sql.
-- Run section by section in the Supabase SQL Editor and compare RAISE
-- NOTICE outputs against the "Expected:" comments. Each section uses
-- temporary fixtures and cleans up after itself.
--
-- The SQL editor runs as service role, which (a) bypasses RLS and (b)
-- causes has_role() to return false. To exercise the role check you'll
-- need to re-run section 1 in a session where you've SET ROLE
-- authenticated and impersonated an Owner. For the function-body
-- assertions, prefix each section with the fixture block at the top
-- and call fn_approve_po_with_automation directly under a service
-- role context that has has_role mocked, OR just inspect the inserted
-- rows after a real client-driven approve.
--
-- All sections wrap in BEGIN/ROLLBACK so nothing persists. To run them
-- individually, the harness expects ON_ERROR_STOP=1.

-- ------------------------------------------------------------------
-- Section 0: Sanity — schema additions exist.
-- ------------------------------------------------------------------
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='tna_templates'
   AND column_name IN ('is_default','default_for_customer_name')
 ORDER BY column_name;
-- Expected: 2 rows.
--   default_for_customer_name | text    | YES | NULL
--   is_default                | boolean | NO  | false

SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='tna_templates'
   AND indexname IN (
     'tna_templates_one_system_default_idx',
     'tna_templates_one_default_per_customer_idx'
   )
 ORDER BY indexname;
-- Expected: 2 rows.

SELECT proname, prosecdef AS security_definer
  FROM pg_proc
 WHERE proname = 'fn_approve_po_with_automation' AND pronamespace = 'public'::regnamespace;
-- Expected: 1 row. security_definer = true.

-- ------------------------------------------------------------------
-- Section 1: Default-template uniqueness.
-- One row per (system-wide default) and one per customer.
-- ------------------------------------------------------------------
BEGIN;

INSERT INTO public.tna_templates (name, milestones, is_default)
  VALUES ('SMOKE_SYSDEFAULT_A', '[]'::jsonb, true);

DO $$ BEGIN
  BEGIN
    INSERT INTO public.tna_templates (name, milestones, is_default)
      VALUES ('SMOKE_SYSDEFAULT_B', '[]'::jsonb, true);
    RAISE NOTICE 'FAIL: second system-wide default was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: second system-wide default rejected (unique_violation)';
  END;
END $$;

INSERT INTO public.tna_templates (name, milestones, default_for_customer_name)
  VALUES ('SMOKE_CUST_A_v1', '[]'::jsonb, 'SmokeCustomerA');

DO $$ BEGIN
  BEGIN
    INSERT INTO public.tna_templates (name, milestones, default_for_customer_name)
      VALUES ('SMOKE_CUST_A_v2', '[]'::jsonb, 'smokecustomera');
    RAISE NOTICE 'FAIL: case-insensitive duplicate per-customer default was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: case-insensitive duplicate per-customer default rejected (unique_violation)';
  END;
END $$;

ROLLBACK;

-- ------------------------------------------------------------------
-- Section 2: Happy path — costing + T&A both fire.
-- Requires has_role('Owner','Manager') = true. In service role this
-- will fail with 42501; run from an Owner-impersonated session for
-- the real assertion.
-- ------------------------------------------------------------------
-- Pseudocode (uncomment + adapt against a real Owner-impersonated session):
--
-- BEGIN;
-- INSERT INTO public.purchase_orders (id, po_number, customer_name, ex_factory_date, currency)
--   VALUES (gen_random_uuid(), 'SMOKE-PO-001', 'SmokeCust', current_date + 60, 'USD')
--   RETURNING id INTO TEMP po_id;
-- INSERT INTO public.articles (po_id, article_code, article_name, order_quantity, components)
--   SELECT id, 'ART-1', 'Smoke Article', 100,
--          '[{"total_required":50,"cost_per_meter":2.5}]'::jsonb
--     FROM po_id;
-- INSERT INTO public.po_items (po_id, item_code, unit_price)
--   SELECT id, 'ART-1', 9.5 FROM po_id;
-- INSERT INTO public.tna_templates (name, milestones, is_default)
--   VALUES ('SMOKE_TPL_DEFAULT',
--           '[{"name":"Fabric in-house","category":"Fabric","days_before_exfactory":30}]'::jsonb,
--           true);
-- SELECT public.fn_approve_po_with_automation((SELECT id FROM po_id), 'Owner Smoke', 'smoke');
-- -- Expected JSONB: costing_succeeded=1, costing_skipped=0, tna_status='created', warnings=[]
-- SELECT count(*) FROM public.costing_sheets WHERE po_id=(SELECT id FROM po_id);
-- -- Expected: 1
-- SELECT count(*) FROM public.tna_milestones WHERE po_id=(SELECT id FROM po_id);
-- -- Expected: 1
-- ROLLBACK;

-- ------------------------------------------------------------------
-- Section 3: Idempotency — re-approve does not duplicate.
-- ------------------------------------------------------------------
-- (Run twice within the same BEGIN/ROLLBACK; second call should report
--  costing_skipped=N (matching the first call's costing_succeeded) and
--  tna_status='skipped:exists'. Calendar/milestone counts unchanged.)

-- ------------------------------------------------------------------
-- Section 4: Missing ex_factory_date → tna_status='skipped:no_ship_date'.
-- ------------------------------------------------------------------
-- (Setup PO with ex_factory_date IS NULL; expect warnings to contain
--  one entry with reason='T&A_NO_SHIP_DATE'.)

-- ------------------------------------------------------------------
-- Section 5: No default template → tna_status='skipped:no_default'.
-- ------------------------------------------------------------------
-- (Setup with no is_default=true rows and no per-customer match;
--  expect warnings to contain reason='T&A_NO_DEFAULT_TEMPLATE'.)

-- ------------------------------------------------------------------
-- Section 6: Non-Owner caller is rejected.
-- ------------------------------------------------------------------
-- SET ROLE authenticated;  -- with a JWT for a Merchandiser user
-- SELECT public.fn_approve_po_with_automation(<po_id>, 'Merch User', NULL);
-- -- Expected: ERROR  caller lacks Owner/Manager role  (SQLSTATE 42501)
-- RESET ROLE;
