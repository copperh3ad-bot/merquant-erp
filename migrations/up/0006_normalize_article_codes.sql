-- 0006_normalize_article_codes.sql
-- Make articles.article_code case-insensitive (uppercase canonical) so the
-- same SKU written in different cases ("GPFRIOPPk" vs "GPFRIOPPK") doesn't
-- create duplicate article rows.
--
-- Three steps:
--   1. Merge any existing duplicate (case-only) pairs — keep the uppercase
--      row, COALESCE missing fields from the lowercase row, delete the
--      lowercase row.
--   2. UPPER() every article_code that isn't already canonical.
--   3. Add a BEFORE INSERT/UPDATE trigger that uppercases article_code
--      automatically so future writes are normalized.

-- Step 1: Merge duplicates (one currently exists: GPFRIOPPK / GPFRIOPPk).
-- The keeper is the highest-letters row (uppercase wins). For each duplicate
-- group, COALESCE missing dimension columns onto the keeper from the loser.
WITH groups AS (
  SELECT
    UPPER(article_code) AS upper_code,
    array_agg(id ORDER BY (article_code = UPPER(article_code)) DESC, updated_at DESC) AS ids,
    array_agg(article_code ORDER BY (article_code = UPPER(article_code)) DESC, updated_at DESC) AS codes
  FROM articles
  GROUP BY UPPER(article_code)
  HAVING COUNT(*) > 1
),
keeper_data AS (
  SELECT
    g.ids[1] AS keeper_id,
    g.ids[2:] AS loser_ids,
    -- Pull each dim column COALESCE'd from keeper → losers (in order)
    (SELECT carton_size_cm     FROM articles WHERE id = ANY(g.ids) AND carton_size_cm     IS NOT NULL ORDER BY (id = g.ids[1]) DESC LIMIT 1) AS m_carton,
    (SELECT stiffener_size     FROM articles WHERE id = ANY(g.ids) AND stiffener_size     IS NOT NULL ORDER BY (id = g.ids[1]) DESC LIMIT 1) AS m_stiff,
    (SELECT pvc_bag_dimensions FROM articles WHERE id = ANY(g.ids) AND pvc_bag_dimensions IS NOT NULL ORDER BY (id = g.ids[1]) DESC LIMIT 1) AS m_pvc,
    (SELECT insert_dimensions  FROM articles WHERE id = ANY(g.ids) AND insert_dimensions  IS NOT NULL ORDER BY (id = g.ids[1]) DESC LIMIT 1) AS m_insert,
    (SELECT zipper_length_cm   FROM articles WHERE id = ANY(g.ids) AND zipper_length_cm   IS NOT NULL ORDER BY (id = g.ids[1]) DESC LIMIT 1) AS m_zipper,
    (SELECT finish_dimensions  FROM articles WHERE id = ANY(g.ids) AND finish_dimensions  IS NOT NULL ORDER BY (id = g.ids[1]) DESC LIMIT 1) AS m_finish
  FROM groups g
)
UPDATE articles a
SET
  carton_size_cm     = COALESCE(a.carton_size_cm,     k.m_carton),
  stiffener_size     = COALESCE(a.stiffener_size,     k.m_stiff),
  pvc_bag_dimensions = COALESCE(a.pvc_bag_dimensions, k.m_pvc),
  insert_dimensions  = COALESCE(a.insert_dimensions,  k.m_insert),
  zipper_length_cm   = COALESCE(a.zipper_length_cm,   k.m_zipper),
  finish_dimensions  = COALESCE(a.finish_dimensions,  k.m_finish)
FROM keeper_data k
WHERE a.id = k.keeper_id;

-- Now delete the loser rows (lowercase variants) of any duplicate group.
DELETE FROM articles
WHERE id IN (
  SELECT unnest(ids[2:])
  FROM (
    SELECT array_agg(id ORDER BY (article_code = UPPER(article_code)) DESC, updated_at DESC) AS ids
    FROM articles
    GROUP BY UPPER(article_code)
    HAVING COUNT(*) > 1
  ) g
);

-- Step 2: Uppercase every remaining article_code.
UPDATE articles SET article_code = UPPER(article_code) WHERE article_code != UPPER(article_code);

-- Step 3: Trigger to normalize on insert/update.
CREATE OR REPLACE FUNCTION public.normalize_article_code() RETURNS trigger AS $$
BEGIN
  IF NEW.article_code IS NOT NULL THEN
    NEW.article_code = UPPER(TRIM(NEW.article_code));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_article_code ON public.articles;
CREATE TRIGGER trg_normalize_article_code
  BEFORE INSERT OR UPDATE OF article_code ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_article_code();

COMMENT ON FUNCTION public.normalize_article_code() IS
  'Forces articles.article_code to UPPER(TRIM()) on every write so the unique constraint behaves case-insensitively. Prevents duplicate article rows when source XLSX has the same SKU written in different cases.';
