-- Migration: add_product_dimensions_to_articles
-- Date: 2026-04-23
-- Purpose:
--   The Fabric Working Sheet needs to display garment dimensions
--   (e.g. QUEEN = 60x80x13.5") for every article. Most tech packs
--   already contain this data inside
--   tech_packs.extracted_measurements.size_chart[<size>].product_dimensions,
--   but some articles have no tech pack uploaded at all (e.g. pillow
--   protectors in the Bob's Discount dataset). This column gives
--   operators a direct editable override that is queryable as a plain
--   string and does not require a tech pack.
--
--   Resolution order at render time (highest priority first):
--     1. articles.product_dimensions   (this column, manual entry)
--     2. tech_packs.size_chart match by item_code
--     3. tech_packs.size_chart match by article_code + size
--     4. "—"
--
-- Safe to re-run: uses IF NOT EXISTS on the column add.
-- No data backfill is required; nulls render as a dash.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS product_dimensions text;

COMMENT ON COLUMN public.articles.product_dimensions IS
  'Garment/finished-product dimensions (e.g. "60x80x13.5in"). Optional manual override. If null, the UI derives dimensions from the linked tech pack size_chart.';
