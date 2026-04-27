-- tests/db/apply_tech_pack.sql
-- Spec §8 tests 18–20: fn_apply_tech_pack_extraction.
-- Manual run: paste into Supabase SQL Editor section by section.
-- Cleanup at the end removes both the test extraction and any tech_packs rows it created.

DO $$
DECLARE
    v_id uuid;
    v_failed_id uuid;
    v_result jsonb;
    v_inserted_count int;
    v_tps uuid[];
BEGIN
    ----------------------------------------------------------------------
    -- §8.18: validation_status=failed → APPLY_VALIDATION_FAILED
    ----------------------------------------------------------------------
    INSERT INTO public.ai_extractions (
        kind, prompt_version, model, file_name, file_mime, file_size_bytes, file_hash, storage_path,
        validation_status, extracted_data, created_by
    ) VALUES (
        'tech_pack', 'tech_pack.test', 'test_model', 'fail.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        1024, 'b'||repeat('0', 63), 'test/fail.xlsx',
        'failed',
        '{"skus":[{"item_code":"TEST-FAIL-1","size":"M"}]}'::jsonb,
        '00000000-0000-0000-0000-000000000001'
    ) RETURNING id INTO v_failed_id;

    SELECT public.fn_apply_tech_pack_extraction(v_failed_id, ARRAY['TEST-FAIL-1']) INTO v_result;
    IF (v_result->>'code') <> 'APPLY_VALIDATION_FAILED' THEN
        RAISE EXCEPTION 'TEST 18 FAILED: expected APPLY_VALIDATION_FAILED, got %', v_result;
    END IF;
    RAISE NOTICE 'TEST 18 OK: validation_status=failed rejected with %', v_result->>'code';

    ----------------------------------------------------------------------
    -- §8.20 (run before §8.19 because we need a successful apply first)
    -- Happy path: inserts N tech_packs rows; review_status=approved when N=all SKUs
    ----------------------------------------------------------------------
    INSERT INTO public.ai_extractions (
        kind, prompt_version, model, file_name, file_mime, file_size_bytes, file_hash, storage_path,
        validation_status, extracted_data, created_by
    ) VALUES (
        'tech_pack', 'tech_pack.test', 'test_model', 'happy.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        1024, 'c'||repeat('0', 63), 'test/happy.xlsx',
        'passed',
        '{"skus":[{"item_code":"TEST-HAPPY-1","size":"M"},{"item_code":"TEST-HAPPY-2","size":"L"}]}'::jsonb,
        '00000000-0000-0000-0000-000000000001'
    ) RETURNING id INTO v_id;

    SELECT public.fn_apply_tech_pack_extraction(v_id, ARRAY['TEST-HAPPY-1','TEST-HAPPY-2']) INTO v_result;
    IF (v_result->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST 20 FAILED (apply): %', v_result;
    END IF;
    v_inserted_count := (v_result->>'inserted_count')::int;
    IF v_inserted_count <> 2 THEN
        RAISE EXCEPTION 'TEST 20 FAILED: expected 2 inserted, got %', v_inserted_count;
    END IF;
    IF (v_result->>'review_status') <> 'approved' THEN
        RAISE EXCEPTION 'TEST 20 FAILED: expected review_status=approved, got %', v_result->>'review_status';
    END IF;
    SELECT ARRAY(SELECT (e)::uuid FROM jsonb_array_elements_text(v_result->'applied_target_ids'->'tech_packs') e) INTO v_tps;
    RAISE NOTICE 'TEST 20 OK: % tech_packs rows inserted, review_status=approved', v_inserted_count;

    ----------------------------------------------------------------------
    -- §8.19: re-applying the same extraction returns APPLY_ALREADY_APPLIED
    -- and does not insert a second copy
    ----------------------------------------------------------------------
    SELECT public.fn_apply_tech_pack_extraction(v_id, ARRAY['TEST-HAPPY-1','TEST-HAPPY-2']) INTO v_result;
    IF (v_result->>'code') <> 'APPLY_ALREADY_APPLIED' THEN
        RAISE EXCEPTION 'TEST 19 FAILED: expected APPLY_ALREADY_APPLIED, got %', v_result;
    END IF;
    IF (SELECT COUNT(*) FROM public.tech_packs WHERE article_code IN ('TEST-HAPPY-1','TEST-HAPPY-2')) <> 2 THEN
        RAISE EXCEPTION 'TEST 19 FAILED: tech_packs count diverged from 2 — re-apply duplicated rows';
    END IF;
    RAISE NOTICE 'TEST 19 OK: re-apply idempotent, no second insert';

    ----------------------------------------------------------------------
    -- Cleanup
    ----------------------------------------------------------------------
    DELETE FROM public.tech_packs WHERE id = ANY(v_tps);
    DELETE FROM public.ai_extractions WHERE id IN (v_id, v_failed_id);
    RAISE NOTICE 'Cleanup done.';
END $$;
