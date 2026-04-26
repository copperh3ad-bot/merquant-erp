-- migrations/down/0002_ai_extractions.sql
--
-- Reverses 0002_ai_extractions.sql. Simple drops; rolling back will destroy
-- any rows in ai_extractions and any objects in the ai-extraction-sources
-- bucket. Back up first if production data is present.

DROP POLICY IF EXISTS ai_extraction_sources_delete ON storage.objects;
DROP POLICY IF EXISTS ai_extraction_sources_insert ON storage.objects;
DROP POLICY IF EXISTS ai_extraction_sources_select ON storage.objects;

DELETE FROM storage.objects WHERE bucket_id = 'ai-extraction-sources';
DELETE FROM storage.buckets WHERE id = 'ai-extraction-sources';

DROP TRIGGER IF EXISTS trg_audit_ai_extractions    ON public.ai_extractions;
DROP TRIGGER IF EXISTS trg_ai_extractions_updated  ON public.ai_extractions;

DROP TABLE IF EXISTS public.ai_extractions;
