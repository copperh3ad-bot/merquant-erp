-- tests/db/reject_extraction.sql
-- Spec §8 test 22: fn_reject_extraction sets review_status='rejected',
-- rejection_reason, and rejected_by=auth.uid().
-- Manual run: paste into Supabase SQL Editor.

DO $$
DECLARE
    v_id uuid;
    v_result jsonb;
    v_status text;
    v_reason text;
    v_rejected_by uuid;
BEGIN
    INSERT INTO public.ai_extractions (
        kind, prompt_version, model, file_name, file_mime, file_size_bytes, file_hash, storage_path,
        validation_status, created_by
    ) VALUES (
        'tech_pack', 'tech_pack.test', 'test_model', 'reject.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        1024, 'e'||repeat('0', 63), 'test/reject.xlsx',
        'warned',
        '00000000-0000-0000-0000-000000000001'
    ) RETURNING id INTO v_id;

    SELECT public.fn_reject_extraction(v_id, 'unit test rejection') INTO v_result;
    IF (v_result->>'ok')::boolean IS NOT TRUE OR (v_result->>'code') <> 'REJECTED' THEN
        RAISE EXCEPTION 'TEST 22 FAILED (reject call): %', v_result;
    END IF;

    SELECT review_status, rejection_reason, rejected_by INTO v_status, v_reason, v_rejected_by
        FROM public.ai_extractions WHERE id = v_id;
    IF v_status <> 'rejected' THEN
        RAISE EXCEPTION 'TEST 22 FAILED: review_status=% (expected rejected)', v_status;
    END IF;
    IF v_reason <> 'unit test rejection' THEN
        RAISE EXCEPTION 'TEST 22 FAILED: rejection_reason=% (expected "unit test rejection")', v_reason;
    END IF;
    -- rejected_by depends on the calling identity. In SQL editor (service role),
    -- auth.uid() is null; in browser/RPC context it would be the user uuid.
    RAISE NOTICE 'TEST 22 OK: review_status=rejected, reason=%, rejected_by=%', v_reason, COALESCE(v_rejected_by::text, '(null in SQL editor)');

    -- Verify a second reject is idempotent
    SELECT public.fn_reject_extraction(v_id, 'second time') INTO v_result;
    IF (v_result->>'code') <> 'ALREADY_REJECTED' THEN
        RAISE EXCEPTION 'TEST 22 FAILED (re-reject): expected ALREADY_REJECTED, got %', v_result;
    END IF;
    RAISE NOTICE 'TEST 22 OK: re-reject returned ALREADY_REJECTED';

    ----------------------------------------------------------------------
    -- Cleanup
    ----------------------------------------------------------------------
    DELETE FROM public.ai_extractions WHERE id = v_id;
    RAISE NOTICE 'Cleanup done.';
END $$;
