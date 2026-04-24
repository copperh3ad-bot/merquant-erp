-- Migration: drop NOT NULL on fabric_orders.mill_name
-- Date: 2026-04-23
-- Purpose:
--   The "Auto from Yarn" generator on the Fabric Orders page creates one
--   fabric order per distinct fabric requirement, long before the operator
--   decides which mill will supply each fabric. Requiring mill_name at
--   insert time forced operators to either pick a mill up front (losing
--   the batch-generate flow) or fabricate a placeholder that later needed
--   cleaning. This change lets fabric orders exist in an "unassigned"
--   state until sourcing attaches a mill. The UI renders "— unassigned —"
--   for null mill_name values.
--
--   Any downstream report or filter that groups by mill_name must tolerate
--   nulls. A quick audit suggests this is safe: the current UI treats
--   mill_name as a display field, not a join key.
--
-- Safe to re-run: PostgreSQL DROP NOT NULL is idempotent.
-- Reversible: rerun `ALTER COLUMN mill_name SET NOT NULL` after backfilling.

ALTER TABLE public.fabric_orders
  ALTER COLUMN mill_name DROP NOT NULL;

COMMENT ON COLUMN public.fabric_orders.mill_name IS
  'Mill/supplier name. Nullable to allow fabric orders generated from yarn requirements before a mill is assigned.';
