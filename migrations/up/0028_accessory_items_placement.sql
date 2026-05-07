-- 0028_accessory_items_placement.sql
-- 2026-05-07
--
-- MAS-alignment migration. accessory_items needs a `placement` column
-- to support the per-row placement field (e.g. "Inside neck seam",
-- "Hem fold") that the procurement / floor team uses when issuing
-- supplier POs and when guiding stitching staff.
--
-- MAS already has this column live; ERP doesn't. The §7 PackagingPlanning
-- port that lands alongside this migration adds the editable Placement
-- column to the UI table and persists row.placement → accessory_items
-- .placement on save.
--
-- Idempotent — re-running is safe.

ALTER TABLE public.accessory_items
  ADD COLUMN IF NOT EXISTS placement text;

COMMENT ON COLUMN public.accessory_items.placement IS
  'Where the accessory goes on the article (e.g. "Inside neck seam"). Surfaced in PackagingPlanning UI; populated by AI extraction or manual entry.';
