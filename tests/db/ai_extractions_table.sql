-- tests/db/ai_extractions_table.sql
-- Spec §8 tests 15–17: ai_extractions defaults, trigger, check constraint.
-- Manual run: paste into Supabase SQL Editor section by section.
-- Cleanup: the final block removes the rows this script created.

DO $$
DECLARE
    v_id uuid;
    v_initial_updated timestamptz;
    v_after_update timestamptz;
    v_status text;
BEGIN
    ----------------------------------------------------------------------
    -- §8.15: minimal insert succeeds; defaults populated
    ----------------------------------------------------------------------
    INSERT INTO public.ai_extractions (
        kind, prompt_version, model,
        file_name, file_mime, file_size_bytes, file_hash, storage_path,
        created_by
    ) VALUES (
        'tech_pack', 'tech_pack.test', 'test_model',
        'test.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        1024, 'a'||repeat('0', 63), 'test/test.xlsx',
        '00000000-0000-0000-0000-000000000001'
    ) RETURNING id, updated_at, validation_status INTO v_id, v_initial_updated, v_status;

    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'TEST 15 FAILED: expected validation_status=pending, got %', v_status;
    END IF;
    RAISE NOTICE 'TEST 15 OK: insert defaults populated (id=%)', v_id;

    ----------------------------------------------------------------------
    -- §8.16: update bumps updated_at via trigger
    ----------------------------------------------------------------------
    PERFORM pg_sleep(1); -- ensure timestamp resolution
    UPDATE public.ai_extractions SET review_notes = 'updated by test' WHERE id = v_id
        RETURNING updated_at INTO v_after_update;

    IF v_after_update <= v_initial_updated THEN
        RAISE EXCEPTION 'TEST 16 FAILED: updated_at did not advance';
    END IF;
    RAISE NOTICE 'TEST 16 OK: updated_at advanced from % to %', v_initial_updated, v_after_update;

    ----------------------------------------------------------------------
    -- §8.17: invalid kind rejected by check constraint
    ----------------------------------------------------------------------
    BEGIN
        INSERT INTO public.ai_extractions (
            kind, prompt_version, model,
            file_name, file_mime, file_size_bytes, file_hash, storage_path, created_by
        ) VALUES (
            'other', 'x.v1', 'm', 'f', 'application/octet-stream',
            1, repeat('0', 64), 'p', '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION 'TEST 17 FAILED: insert with kind=other was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 17 OK: kind=other rejected by check constraint';
    END;

    ----------------------------------------------------------------------
    -- Cleanup
    ----------------------------------------------------------------------
    DELETE FROM public.ai_extractions WHERE id = v_id;
    RAISE NOTICE 'Cleanup done.';
END $$;
