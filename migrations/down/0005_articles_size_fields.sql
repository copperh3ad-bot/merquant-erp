-- 0005_articles_size_fields.sql (down)
-- Reverses 0005 by dropping the five per-SKU dimension columns.
-- WARNING: data in those columns is unrecoverable after this runs.
-- Only execute if you are sure the data is also persisted elsewhere
-- (e.g. tech_packs.extracted_measurements).

ALTER TABLE public.articles
    DROP COLUMN IF EXISTS carton_size_cm,
    DROP COLUMN IF EXISTS stiffener_size,
    DROP COLUMN IF EXISTS pvc_bag_dimensions,
    DROP COLUMN IF EXISTS insert_dimensions,
    DROP COLUMN IF EXISTS zipper_length_cm;
