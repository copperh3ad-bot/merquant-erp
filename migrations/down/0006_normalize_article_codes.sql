-- 0006_normalize_article_codes.sql (down)
-- Drops the case-normalization trigger. Does NOT restore previous mixed-case
-- article_codes (irretrievable) or recreate merged-out duplicate rows.

DROP TRIGGER IF EXISTS trg_normalize_article_code ON public.articles;
DROP FUNCTION IF EXISTS public.normalize_article_code();
