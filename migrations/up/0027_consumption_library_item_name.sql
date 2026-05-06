-- 0027_consumption_library_item_name.sql
-- 2026-05-06
--
-- Spec audit fix (docs/architecture.md §8). The architecture spec
-- mandates that consumption_library.upsert_key UNIQUE covers SIX
-- columns:
--
--   (item_code, kind, component_type, color, material, item_name)
--
-- The live DB had FIVE — item_name was never added. Without it, two
-- accessory rows that share (item_code, kind, component_type, color,
-- material) but differ on item_name (e.g. "Brand Label" vs "Care
-- Label" both Polyester labels) collide on upsert and one silently
-- merges or errors. The JS-side dedup in src/lib/masterDataDedup.js
-- already accounts for item_name (fix in commit 6d4beef), so adding
-- the DB column + constraint completes the round-trip.
--
-- This migration is idempotent — re-running is safe.
--
-- DOWN: drop item_name and revert the constraint to the 5-col form.

-- Add the column. NULL is allowed — existing rows have no item_name
-- and shouldn't be invented.
ALTER TABLE public.consumption_library
  ADD COLUMN IF NOT EXISTS item_name text;

-- Replace the constraint atomically. The old name was
-- `consumption_library_upsert_key` per the audit query. We keep the
-- same name for the new constraint so callers / docs stay aligned.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'consumption_library'
      AND constraint_name = 'consumption_library_upsert_key'
  ) THEN
    ALTER TABLE public.consumption_library
      DROP CONSTRAINT consumption_library_upsert_key;
  END IF;
END $$;

ALTER TABLE public.consumption_library
  ADD CONSTRAINT consumption_library_upsert_key
  UNIQUE (item_code, kind, component_type, color, material, item_name);

COMMENT ON CONSTRAINT consumption_library_upsert_key
  ON public.consumption_library IS
  '6-col upsert key per docs/architecture.md §8. item_name discriminates accessories that share item_code/kind/component_type/color/material but represent semantically distinct items (e.g. Brand Label vs Care Label).';
