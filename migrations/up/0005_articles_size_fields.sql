-- 0005_articles_size_fields.sql
-- Adds five per-SKU dimension columns to the articles table so that
-- master-data uploads (Articles sheet in MasterDataImport.jsx) can
-- persist them. Without these columns, the import currently drops the
-- carton_size_cm / stiffener_size / pvc_bag_dimensions / insert_dimensions
-- / zipper_length_cm fields silently, leaving the Packaging Planning page's
-- Carton, Stiffener, Polybag, Insert Card, and Zipper tabs unable to look
-- up sizes from master data.
--
-- Stored as text (not numeric) because the source spreadsheets carry
-- non-numeric forms like "27X27.5X6.5cm" or "58*28.5*43" that don't fit
-- a single numeric column.
--
-- Idempotent (uses IF NOT EXISTS) so re-running this migration is safe.

ALTER TABLE public.articles
    ADD COLUMN IF NOT EXISTS carton_size_cm     text,
    ADD COLUMN IF NOT EXISTS stiffener_size     text,
    ADD COLUMN IF NOT EXISTS pvc_bag_dimensions text,
    ADD COLUMN IF NOT EXISTS insert_dimensions  text,
    ADD COLUMN IF NOT EXISTS zipper_length_cm   text;

COMMENT ON COLUMN public.articles.carton_size_cm     IS 'Per-SKU outer carton dimensions, free-text (e.g. "58*28.5*43"). Sourced from Articles sheet column carton_size_cm; falls through to Packaging Planning Carton tab.';
COMMENT ON COLUMN public.articles.stiffener_size     IS 'Per-SKU stiffener dimensions, free-text (e.g. "27X27.5X6.5cm"). Sourced from Articles sheet column stiffener_size; falls through to Packaging Planning Stiffener tab.';
COMMENT ON COLUMN public.articles.pvc_bag_dimensions IS 'Per-SKU PVC/poly bag dimensions, free-text. Sourced from Articles sheet; falls through to Packaging Planning Polybag tab.';
COMMENT ON COLUMN public.articles.insert_dimensions  IS 'Per-SKU insert card dimensions, free-text. Sourced from Articles sheet; falls through to Packaging Planning Insert Card tab.';
COMMENT ON COLUMN public.articles.zipper_length_cm   IS 'Per-SKU zipper length, free-text. Sourced from Articles sheet; falls through to Packaging Planning Zipper tab.';
