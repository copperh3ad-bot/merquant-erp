-- Backfill: two trigger functions and their triggers that exist on the
-- source DB but were not captured in any committed migration file. Found
-- via schema diff during the textile-manager-pro → MerQuant ERP migration.

CREATE OR REPLACE FUNCTION public.normalize_consumption_item_code()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.item_code IS NOT NULL THEN
    NEW.item_code = UPPER(TRIM(NEW.item_code));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_tech_pack_article_code()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.article_code IS NOT NULL THEN
    NEW.article_code = UPPER(TRIM(NEW.article_code));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_consumption_item_code ON public.consumption_library;
CREATE TRIGGER trg_normalize_consumption_item_code
  BEFORE INSERT OR UPDATE OF item_code ON public.consumption_library
  FOR EACH ROW EXECUTE FUNCTION normalize_consumption_item_code();

DROP TRIGGER IF EXISTS trg_normalize_tech_pack_article_code ON public.tech_packs;
CREATE TRIGGER trg_normalize_tech_pack_article_code
  BEFORE INSERT OR UPDATE OF article_code ON public.tech_packs
  FOR EACH ROW EXECUTE FUNCTION normalize_tech_pack_article_code();
