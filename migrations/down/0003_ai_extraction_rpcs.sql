-- migrations/down/0003_ai_extraction_rpcs.sql
--
-- Reverses 0003_ai_extraction_rpcs.sql. Drops the three apply/reject RPCs.
-- Existing ai_extractions rows are unaffected; they just can't be applied
-- until the RPCs are restored.

DROP FUNCTION IF EXISTS public.fn_apply_master_data_extraction(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.fn_apply_tech_pack_extraction(uuid, text[]);
DROP FUNCTION IF EXISTS public.fn_reject_extraction(uuid, text);
