-- tests/db/apply_master_data.sql
-- Spec §8 test 21: fn_apply_master_data_extraction happy path.
-- Manual run: paste into Supabase SQL Editor.
-- WARNING: this writes to public.articles. Cleanup removes test rows by
-- article_code prefix 'TEST-MD-'. Do not use that prefix for real data.

DO $$
DECLARE
    v_id uuid;
    v_result jsonb;
    v_dry_run jsonb;
BEGIN
    INSERT INTO public.ai_extractions (
        kind, prompt_version, model, file_name, file_mime, file_size_bytes, file_hash, storage_path,
        validation_status, extracted_data, created_by
    ) VALUES (
        'master_data', 'master_data.test', 'test_model', 'md.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        1024, 'd'||repeat('0', 63), 'test/md.xlsx',
        'passed',
        '{
          "articles": [
            {"item_code":"TEST-MD-A1","brand":"TestBrand","product_type":"Pillow","size":"M"},
            {"item_code":"TEST-MD-A2","brand":"TestBrand","product_type":"Pillow","size":"L"}
          ]
        }'::jsonb,
        '00000000-0000-0000-0000-000000000001'
    ) RETURNING id INTO v_id;

    -- Dry run first: should report 0 conflicts (assuming the test prefix is unused)
    SELECT public.fn_apply_master_data_extraction(
        v_id,
        '{"articles":["TEST-MD-A1","TEST-MD-A2"]}'::jsonb,
        false, true
    ) INTO v_dry_run;
    IF (v_dry_run->>'code') <> 'DRY_RUN_PREVIEW' THEN
        RAISE EXCEPTION 'TEST 21 FAILED (dry run): %', v_dry_run;
    END IF;
    IF (v_dry_run->>'conflict_count')::int <> 0 THEN
        RAISE NOTICE 'WARNING: dry run found pre-existing TEST-MD-* rows. Clean up before re-running.';
    END IF;

    -- Real apply
    SELECT public.fn_apply_master_data_extraction(
        v_id,
        '{"articles":["TEST-MD-A1","TEST-MD-A2"]}'::jsonb,
        false, false
    ) INTO v_result;
    IF (v_result->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST 21 FAILED (apply): %', v_result;
    END IF;
    IF jsonb_array_length(v_result->'applied_target_ids'->'articles') <> 2 THEN
        RAISE EXCEPTION 'TEST 21 FAILED: expected 2 articles applied, got %', v_result->'applied_target_ids';
    END IF;
    RAISE NOTICE 'TEST 21 OK: applied_target_ids.articles has 2 entries';

    ----------------------------------------------------------------------
    -- Cleanup
    ----------------------------------------------------------------------
    DELETE FROM public.articles WHERE article_code IN ('TEST-MD-A1','TEST-MD-A2');
    DELETE FROM public.ai_extractions WHERE id = v_id;
    RAISE NOTICE 'Cleanup done.';
END $$;
