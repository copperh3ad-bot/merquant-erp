-- migrations/up/0003_ai_extraction_rpcs.sql
--
-- Phase E of the AI extraction pipeline (spec 2026-04-25-ai-extraction).
-- Adds the three apply/reject RPCs that move data from ai_extractions
-- into the live tables (tech_packs, articles, consumption_library, etc.)
-- after a user has reviewed and approved an extraction.
--
-- All three RPCs are SECURITY DEFINER with search_path locked to public.
-- They are idempotent — re-applying returns the previously-recorded target
-- ids without re-inserting.
--
-- Spec deviation: the spec described per-key overwrite via `p_overwrite`.
-- v1 ships with a coarser `p_force boolean` switch. Per-key overwrite is
-- deferred to v2 (frontend can re-call with a narrowed p_row_filter that
-- omits the conflicting keys, achieving the same effect).

-- =========================================================================
-- fn_reject_extraction
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_reject_extraction(
    p_extraction_id uuid,
    p_reason        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT review_status INTO v_status
        FROM public.ai_extractions
        WHERE id = p_extraction_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND',
            'user_message', 'This extraction does not exist or you do not have access.',
            'dev_detail', format('extraction_id=%s', p_extraction_id));
    END IF;

    IF v_status = 'rejected' THEN
        RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_REJECTED',
            'review_status', 'rejected');
    END IF;

    IF v_status IN ('approved', 'partially_approved') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPLY_NOT_REVIEWABLE',
            'user_message', 'This extraction was already applied; reject is no longer available.',
            'dev_detail', format('review_status=%s', v_status));
    END IF;

    UPDATE public.ai_extractions
        SET review_status   = 'rejected',
            rejected_at     = now(),
            rejected_by     = auth.uid(),
            rejection_reason = p_reason
        WHERE id = p_extraction_id;

    RETURN jsonb_build_object('ok', true, 'code', 'REJECTED', 'review_status', 'rejected');
END;
$$;

-- =========================================================================
-- fn_apply_tech_pack_extraction
-- =========================================================================
-- Inserts one tech_packs row per requested SKU. No conflict detection here
-- because tech_packs has no UNIQUE on (article_code) — every apply creates
-- new rows. This matches the existing BOB import path's behaviour.

CREATE OR REPLACE FUNCTION public.fn_apply_tech_pack_extraction(
    p_extraction_id uuid,
    p_sku_codes     text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_ext         public.ai_extractions%ROWTYPE;
    v_skus        jsonb;
    v_sku         jsonb;
    v_inserted    uuid[] := '{}';
    v_new_id      uuid;
    v_uploader    text;
    v_total_skus  int;
BEGIN
    SELECT * INTO v_ext FROM public.ai_extractions WHERE id = p_extraction_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND',
            'user_message', 'This extraction does not exist or you do not have access.',
            'dev_detail', format('extraction_id=%s', p_extraction_id));
    END IF;

    IF v_ext.kind <> 'tech_pack' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'WRONG_KIND',
            'user_message', 'This RPC applies tech_pack extractions only.',
            'dev_detail', format('kind=%s', v_ext.kind));
    END IF;

    IF v_ext.applied_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'code', 'APPLY_ALREADY_APPLIED',
            'applied_target_ids', v_ext.applied_target_ids,
            'review_status', v_ext.review_status);
    END IF;

    IF v_ext.review_status NOT IN ('pending_review', 'partially_approved') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPLY_NOT_REVIEWABLE',
            'user_message', 'This extraction can no longer be applied.',
            'dev_detail', format('review_status=%s', v_ext.review_status));
    END IF;

    IF v_ext.validation_status = 'failed' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPLY_VALIDATION_FAILED',
            'user_message', 'This extraction has blocking errors and can''t be imported. Fix the source file or reject this extraction.',
            'dev_detail', 'validation_status=failed');
    END IF;

    IF p_sku_codes IS NULL OR array_length(p_sku_codes, 1) IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPLY_NO_ROWS_SELECTED',
            'user_message', 'No rows were selected — please tick at least one row to import.',
            'dev_detail', 'p_sku_codes empty');
    END IF;

    v_skus := COALESCE(v_ext.extracted_data -> 'skus', '[]'::jsonb);
    v_total_skus := jsonb_array_length(v_skus);

    -- Resolve uploader display name
    SELECT COALESCE(full_name, email, 'AI Extraction') INTO v_uploader
        FROM public.user_profiles WHERE id = v_ext.created_by;
    IF v_uploader IS NULL THEN v_uploader := 'AI Extraction'; END IF;

    -- One tech_packs row per matched SKU. Whole-extraction JSONB blocks
    -- (fabric_specs, labels, accessories, packaging) are copied to every
    -- row so the existing display logic can filter them per-SKU.
    FOR v_sku IN SELECT jsonb_array_elements(v_skus)
    LOOP
        IF NOT (v_sku ->> 'item_code' = ANY(p_sku_codes)) THEN
            CONTINUE;
        END IF;

        INSERT INTO public.tech_packs (
            article_code,
            article_name,
            file_name,
            file_url,
            file_type,
            file_size_kb,
            extraction_status,
            crosscheck_status,
            uploaded_by,
            extracted_data,
            extracted_fabric_specs,
            extracted_label_specs,
            extracted_accessory_specs,
            extracted_trim_specs,
            extracted_measurements,
            extracted_construction,
            notes
        ) VALUES (
            v_sku ->> 'item_code',
            COALESCE(
                NULLIF(trim(concat_ws(' — ',
                    v_ext.extracted_data -> 'header' ->> 'product_type',
                    v_sku ->> 'size',
                    v_sku ->> 'color')), ''),
                v_sku ->> 'item_code'
            ),
            v_ext.file_name,
            'storage://ai-extraction-sources/' || v_ext.storage_path,
            split_part(v_ext.file_name, '.', -1),
            ceil(v_ext.file_size_bytes::numeric / 1024)::integer,
            'extracted',
            'not_run',
            v_uploader,
            v_ext.extracted_data,
            COALESCE(v_ext.extracted_data -> 'fabric_specs', '[]'::jsonb),
            COALESCE(v_ext.extracted_data -> 'labels',       '[]'::jsonb),
            COALESCE(v_ext.extracted_data -> 'accessories',  '[]'::jsonb),
            -- Packaging maps to extracted_trim_specs by existing convention
            COALESCE(v_ext.extracted_data -> 'packaging',    '[]'::jsonb),
            jsonb_build_object('this_sku', v_sku),
            COALESCE(v_ext.extracted_data -> 'zipper', '{}'::jsonb),
            format('Extracted via AI pipeline (extraction_id=%s, prompt=%s)',
                v_ext.id, v_ext.prompt_version)
        )
        RETURNING id INTO v_new_id;

        v_inserted := array_append(v_inserted, v_new_id);
    END LOOP;

    -- Update the extraction record
    UPDATE public.ai_extractions
        SET applied_at         = now(),
            applied_by         = auth.uid(),
            applied_target_ids = jsonb_build_object('tech_packs', to_jsonb(v_inserted)),
            review_status      = CASE WHEN array_length(v_inserted, 1) >= v_total_skus
                                      THEN 'approved' ELSE 'partially_approved' END
        WHERE id = p_extraction_id;

    RETURN jsonb_build_object(
        'ok', true,
        'applied_target_ids', jsonb_build_object('tech_packs', to_jsonb(v_inserted)),
        'review_status', CASE WHEN array_length(v_inserted, 1) >= v_total_skus
                              THEN 'approved' ELSE 'partially_approved' END,
        'inserted_count', COALESCE(array_length(v_inserted, 1), 0)
    );
END;
$$;

-- =========================================================================
-- fn_apply_master_data_extraction
-- =========================================================================
-- Two phases:
--   1. Conflict scan: find rows in p_row_filter that already exist in target
--      tables by upsert key. If any AND NOT p_force, return them and apply nothing.
--   2. Apply: upsert each requested row into its target table.
--
-- p_row_filter shape (sections optional):
--   {
--     "articles":               ["A1","A2"],                              -- by item_code (= articles.article_code)
--     "fabric_consumption":     [{"item_code":"A1","component_type":"shell","color":"white"}],
--     "accessory_consumption":  [{"item_code":"A1","category":"label","material":"satin"}],
--     "carton_master":          ["A1"],                                   -- by item_code (target: price_list)
--     "price_list":             ["A1"],                                   -- by item_code
--     "suppliers":              ["Sample Inc"],
--     "seasons":                ["SS25"],
--     "production_lines":       ["Line A"]
--   }

CREATE OR REPLACE FUNCTION public.fn_apply_master_data_extraction(
    p_extraction_id uuid,
    p_row_filter    jsonb,
    p_force         boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_ext        public.ai_extractions%ROWTYPE;
    v_data       jsonb;
    v_conflicts  jsonb := '[]'::jsonb;
    v_applied    jsonb := '{}'::jsonb;
    v_today      date := current_date;
    -- per-row scratch
    v_row        jsonb;
    v_keys       jsonb;
    v_key        jsonb;
    v_match_id   uuid;
    v_existing   uuid;
    v_keys_arr   text[];
    v_section    text;
    -- accumulators
    v_articles_ids   uuid[] := '{}';
    v_cons_ids       uuid[] := '{}';
    v_carton_ids     uuid[] := '{}';
    v_price_ids      uuid[] := '{}';
    v_supplier_ids   uuid[] := '{}';
    v_season_ids     uuid[] := '{}';
    v_line_ids       uuid[] := '{}';
BEGIN
    SELECT * INTO v_ext FROM public.ai_extractions WHERE id = p_extraction_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND',
            'user_message', 'This extraction does not exist or you do not have access.',
            'dev_detail', format('extraction_id=%s', p_extraction_id));
    END IF;

    IF v_ext.kind <> 'master_data' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'WRONG_KIND',
            'user_message', 'This RPC applies master_data extractions only.',
            'dev_detail', format('kind=%s', v_ext.kind));
    END IF;

    IF v_ext.applied_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'code', 'APPLY_ALREADY_APPLIED',
            'applied_target_ids', v_ext.applied_target_ids,
            'review_status', v_ext.review_status);
    END IF;

    IF v_ext.review_status NOT IN ('pending_review', 'partially_approved') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPLY_NOT_REVIEWABLE',
            'user_message', 'This extraction can no longer be applied.',
            'dev_detail', format('review_status=%s', v_ext.review_status));
    END IF;

    IF v_ext.validation_status = 'failed' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPLY_VALIDATION_FAILED',
            'user_message', 'This extraction has blocking errors and can''t be imported. Fix the source file or reject this extraction.',
            'dev_detail', 'validation_status=failed');
    END IF;

    IF p_row_filter IS NULL OR p_row_filter = '{}'::jsonb THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPLY_NO_ROWS_SELECTED',
            'user_message', 'No rows were selected — please tick at least one row to import.',
            'dev_detail', 'p_row_filter empty');
    END IF;

    v_data := COALESCE(v_ext.extracted_data, '{}'::jsonb);

    ---------------------------------------------------------------- conflict scan
    -- articles: key = item_code → articles.article_code UNIQUE
    IF p_row_filter ? 'articles' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'articles'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'articles', '[]'::jsonb))
        LOOP
            IF v_row ->> 'item_code' = ANY(v_keys_arr) THEN
                SELECT id INTO v_existing FROM public.articles
                    WHERE article_code = v_row ->> 'item_code' LIMIT 1;
                IF FOUND THEN
                    v_conflicts := v_conflicts || jsonb_build_object(
                        'section', 'articles',
                        'key', v_row ->> 'item_code',
                        'existing_id', v_existing);
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- fabric_consumption: key = (item_code, component_type, color) → consumption_library UNIQUE (item_code, kind, component_type, color, material)
    IF p_row_filter ? 'fabric_consumption' THEN
        FOR v_key IN SELECT jsonb_array_elements(p_row_filter -> 'fabric_consumption')
        LOOP
            FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'fabric_consumption', '[]'::jsonb))
            LOOP
                IF v_row ->> 'item_code'      = v_key ->> 'item_code'
                   AND v_row ->> 'component_type' = v_key ->> 'component_type'
                   AND COALESCE(v_row ->> 'color','') = COALESCE(v_key ->> 'color','')
                THEN
                    SELECT id INTO v_existing FROM public.consumption_library
                        WHERE item_code = v_row ->> 'item_code'
                          AND kind = 'fabric'
                          AND component_type = v_row ->> 'component_type'
                          AND COALESCE(color, '') = COALESCE(v_row ->> 'color', '')
                          AND COALESCE(material, '') = ''
                        LIMIT 1;
                    IF FOUND THEN
                        v_conflicts := v_conflicts || jsonb_build_object(
                            'section', 'fabric_consumption',
                            'key', v_key,
                            'existing_id', v_existing);
                    END IF;
                END IF;
            END LOOP;
        END LOOP;
    END IF;

    -- accessory_consumption
    IF p_row_filter ? 'accessory_consumption' THEN
        FOR v_key IN SELECT jsonb_array_elements(p_row_filter -> 'accessory_consumption')
        LOOP
            FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'accessory_consumption', '[]'::jsonb))
            LOOP
                IF v_row ->> 'item_code' = v_key ->> 'item_code'
                   AND v_row ->> 'category' = v_key ->> 'category'
                   AND COALESCE(v_row ->> 'material','') = COALESCE(v_key ->> 'material','')
                THEN
                    SELECT id INTO v_existing FROM public.consumption_library
                        WHERE item_code = v_row ->> 'item_code'
                          AND kind = 'accessory'
                          AND component_type = v_row ->> 'category'
                          AND COALESCE(color, '') = ''
                          AND COALESCE(material, '') = COALESCE(v_row ->> 'material', '')
                        LIMIT 1;
                    IF FOUND THEN
                        v_conflicts := v_conflicts || jsonb_build_object(
                            'section', 'accessory_consumption',
                            'key', v_key,
                            'existing_id', v_existing);
                    END IF;
                END IF;
            END LOOP;
        END LOOP;
    END IF;

    -- carton_master and price_list both target price_list (UNIQUE item_code)
    FOR v_section IN SELECT unnest(ARRAY['carton_master','price_list'])
    LOOP
        IF p_row_filter ? v_section THEN
            v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> v_section));
            FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> v_section, '[]'::jsonb))
            LOOP
                IF v_row ->> 'item_code' = ANY(v_keys_arr) THEN
                    SELECT id INTO v_existing FROM public.price_list
                        WHERE item_code = v_row ->> 'item_code' LIMIT 1;
                    IF FOUND THEN
                        v_conflicts := v_conflicts || jsonb_build_object(
                            'section', v_section,
                            'key', v_row ->> 'item_code',
                            'existing_id', v_existing);
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    -- suppliers, seasons, production_lines: name-keyed
    IF p_row_filter ? 'suppliers' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'suppliers'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'suppliers', '[]'::jsonb))
        LOOP
            IF v_row ->> 'name' = ANY(v_keys_arr) THEN
                SELECT id INTO v_existing FROM public.suppliers WHERE name = v_row ->> 'name' LIMIT 1;
                IF FOUND THEN
                    v_conflicts := v_conflicts || jsonb_build_object(
                        'section', 'suppliers', 'key', v_row ->> 'name', 'existing_id', v_existing);
                END IF;
            END IF;
        END LOOP;
    END IF;

    IF p_row_filter ? 'seasons' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'seasons'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'seasons', '[]'::jsonb))
        LOOP
            IF v_row ->> 'name' = ANY(v_keys_arr) THEN
                SELECT id INTO v_existing FROM public.seasons WHERE name = v_row ->> 'name' LIMIT 1;
                IF FOUND THEN
                    v_conflicts := v_conflicts || jsonb_build_object(
                        'section', 'seasons', 'key', v_row ->> 'name', 'existing_id', v_existing);
                END IF;
            END IF;
        END LOOP;
    END IF;

    IF p_row_filter ? 'production_lines' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'production_lines'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'production_lines', '[]'::jsonb))
        LOOP
            IF v_row ->> 'name' = ANY(v_keys_arr) THEN
                SELECT id INTO v_existing FROM public.production_lines WHERE name = v_row ->> 'name' LIMIT 1;
                IF FOUND THEN
                    v_conflicts := v_conflicts || jsonb_build_object(
                        'section', 'production_lines', 'key', v_row ->> 'name', 'existing_id', v_existing);
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- Bail out on conflicts unless force-mode
    IF jsonb_array_length(v_conflicts) > 0 AND NOT p_force THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'APPLY_TARGET_CONFLICT',
            'user_message', 'Some rows clash with existing data. Review the conflict list, then re-apply with the conflicting keys removed, or pass p_force=true to overwrite.',
            'dev_detail', jsonb_build_object('conflict_count', jsonb_array_length(v_conflicts)),
            'conflicts', v_conflicts);
    END IF;

    ---------------------------------------------------------------- apply

    -- articles
    IF p_row_filter ? 'articles' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'articles'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'articles', '[]'::jsonb))
        LOOP
            IF v_row ->> 'item_code' = ANY(v_keys_arr) THEN
                INSERT INTO public.articles (article_code, article_name, size, product_category, order_quantity)
                VALUES (
                    v_row ->> 'item_code',
                    COALESCE(
                        NULLIF(trim(concat_ws(' — ',
                            v_row ->> 'brand', v_row ->> 'product_type', v_row ->> 'size')), ''),
                        v_row ->> 'item_code'),
                    v_row ->> 'size',
                    v_row ->> 'product_type',
                    0
                )
                ON CONFLICT (article_code) DO UPDATE
                    SET article_name      = EXCLUDED.article_name,
                        size              = EXCLUDED.size,
                        product_category  = EXCLUDED.product_category
                RETURNING id INTO v_match_id;
                v_articles_ids := array_append(v_articles_ids, v_match_id);
            END IF;
        END LOOP;
    END IF;

    -- fabric_consumption (kind=fabric, color forced non-null per UNIQUE)
    IF p_row_filter ? 'fabric_consumption' THEN
        FOR v_key IN SELECT jsonb_array_elements(p_row_filter -> 'fabric_consumption')
        LOOP
            FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'fabric_consumption', '[]'::jsonb))
            LOOP
                IF v_row ->> 'item_code' = v_key ->> 'item_code'
                   AND v_row ->> 'component_type' = v_key ->> 'component_type'
                   AND COALESCE(v_row ->> 'color','') = COALESCE(v_key ->> 'color','')
                THEN
                    INSERT INTO public.consumption_library
                        (item_code, kind, component_type, color, material,
                         fabric_type, gsm, width_cm, consumption_per_unit, wastage_percent)
                    VALUES (
                        v_row ->> 'item_code', 'fabric', v_row ->> 'component_type',
                        COALESCE(v_row ->> 'color', ''), '',
                        v_row ->> 'fabric_type',
                        NULLIF(v_row ->> 'gsm', '')::integer,
                        NULLIF(v_row ->> 'width_cm', '')::numeric,
                        NULLIF(v_row ->> 'consumption_per_unit', '')::numeric,
                        NULLIF(v_row ->> 'wastage_percent', '')::numeric)
                    ON CONFLICT (item_code, kind, component_type, color, material) DO UPDATE
                        SET fabric_type           = EXCLUDED.fabric_type,
                            gsm                   = EXCLUDED.gsm,
                            width_cm              = EXCLUDED.width_cm,
                            consumption_per_unit  = EXCLUDED.consumption_per_unit,
                            wastage_percent       = EXCLUDED.wastage_percent,
                            updated_at            = now()
                    RETURNING id INTO v_match_id;
                    v_cons_ids := array_append(v_cons_ids, v_match_id);
                END IF;
            END LOOP;
        END LOOP;
    END IF;

    -- accessory_consumption (kind=accessory, material from AI as-is, color forced empty)
    IF p_row_filter ? 'accessory_consumption' THEN
        FOR v_key IN SELECT jsonb_array_elements(p_row_filter -> 'accessory_consumption')
        LOOP
            FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'accessory_consumption', '[]'::jsonb))
            LOOP
                IF v_row ->> 'item_code' = v_key ->> 'item_code'
                   AND v_row ->> 'category' = v_key ->> 'category'
                   AND COALESCE(v_row ->> 'material','') = COALESCE(v_key ->> 'material','')
                THEN
                    INSERT INTO public.consumption_library
                        (item_code, kind, component_type, color, material,
                         size_spec, placement, consumption_per_unit)
                    VALUES (
                        v_row ->> 'item_code', 'accessory', v_row ->> 'category',
                        '', COALESCE(v_row ->> 'material', ''),
                        v_row ->> 'size_spec', v_row ->> 'placement',
                        NULLIF(v_row ->> 'consumption_per_unit', '')::numeric)
                    ON CONFLICT (item_code, kind, component_type, color, material) DO UPDATE
                        SET size_spec            = EXCLUDED.size_spec,
                            placement            = EXCLUDED.placement,
                            consumption_per_unit = EXCLUDED.consumption_per_unit,
                            updated_at           = now()
                    RETURNING id INTO v_match_id;
                    v_cons_ids := array_append(v_cons_ids, v_match_id);
                END IF;
            END LOOP;
        END LOOP;
    END IF;

    -- carton_master → price_list (carton dims only)
    IF p_row_filter ? 'carton_master' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'carton_master'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'carton_master', '[]'::jsonb))
        LOOP
            IF v_row ->> 'item_code' = ANY(v_keys_arr) THEN
                INSERT INTO public.price_list
                    (item_code, qty_per_carton, carton_length, carton_width, carton_height,
                     cbm_per_carton, pricing_status)
                VALUES (
                    v_row ->> 'item_code',
                    NULLIF(v_row ->> 'units_per_carton', '')::integer,
                    NULLIF(v_row ->> 'carton_length_cm', '')::numeric,
                    NULLIF(v_row ->> 'carton_width_cm',  '')::numeric,
                    NULLIF(v_row ->> 'carton_height_cm', '')::numeric,
                    CASE WHEN (v_row ->> 'carton_length_cm') IS NOT NULL
                          AND (v_row ->> 'carton_width_cm')  IS NOT NULL
                          AND (v_row ->> 'carton_height_cm') IS NOT NULL
                         THEN round(
                             (v_row ->> 'carton_length_cm')::numeric *
                             (v_row ->> 'carton_width_cm')::numeric *
                             (v_row ->> 'carton_height_cm')::numeric / 1000000.0, 4)
                         ELSE NULL END,
                    'pending')
                ON CONFLICT (item_code) DO UPDATE
                    SET qty_per_carton  = COALESCE(EXCLUDED.qty_per_carton,  public.price_list.qty_per_carton),
                        carton_length   = COALESCE(EXCLUDED.carton_length,   public.price_list.carton_length),
                        carton_width    = COALESCE(EXCLUDED.carton_width,    public.price_list.carton_width),
                        carton_height   = COALESCE(EXCLUDED.carton_height,   public.price_list.carton_height),
                        cbm_per_carton  = COALESCE(EXCLUDED.cbm_per_carton,  public.price_list.cbm_per_carton)
                RETURNING id INTO v_match_id;
                v_carton_ids := array_append(v_carton_ids, v_match_id);
            END IF;
        END LOOP;
    END IF;

    -- price_list (price + effective dates)
    IF p_row_filter ? 'price_list' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'price_list'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'price_list', '[]'::jsonb))
        LOOP
            IF v_row ->> 'item_code' = ANY(v_keys_arr) THEN
                INSERT INTO public.price_list
                    (item_code, price_usd, currency, effective_from, pricing_status, is_active)
                VALUES (
                    v_row ->> 'item_code',
                    NULLIF(v_row ->> 'price_usd', '')::numeric,
                    'USD',
                    COALESCE(NULLIF(v_row ->> 'effective_from','')::date, v_today),
                    CASE WHEN NULLIF(v_row ->> 'price_usd','') IS NOT NULL THEN 'active' ELSE 'pending' END,
                    true)
                ON CONFLICT (item_code) DO UPDATE
                    SET price_usd       = COALESCE(EXCLUDED.price_usd,      public.price_list.price_usd),
                        effective_from  = COALESCE(EXCLUDED.effective_from, public.price_list.effective_from),
                        pricing_status  = CASE WHEN COALESCE(EXCLUDED.price_usd, public.price_list.price_usd) IS NOT NULL
                                               THEN 'active'::public.pricing_status_t ELSE 'pending'::public.pricing_status_t END,
                        is_active       = true
                RETURNING id INTO v_match_id;
                v_price_ids := array_append(v_price_ids, v_match_id);
            END IF;
        END LOOP;
    END IF;

    -- suppliers
    IF p_row_filter ? 'suppliers' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'suppliers'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'suppliers', '[]'::jsonb))
        LOOP
            IF v_row ->> 'name' = ANY(v_keys_arr) THEN
                INSERT INTO public.suppliers (name, email, phone, currency, status)
                VALUES (
                    v_row ->> 'name',
                    v_row ->> 'contact_email',
                    v_row ->> 'contact_phone',
                    'USD',
                    'active')
                ON CONFLICT (name) DO UPDATE
                    SET email   = COALESCE(EXCLUDED.email, public.suppliers.email),
                        phone   = COALESCE(EXCLUDED.phone, public.suppliers.phone)
                RETURNING id INTO v_match_id;
                v_supplier_ids := array_append(v_supplier_ids, v_match_id);
            END IF;
        END LOOP;
    END IF;

    -- seasons (no updated_at column)
    IF p_row_filter ? 'seasons' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'seasons'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'seasons', '[]'::jsonb))
        LOOP
            IF v_row ->> 'name' = ANY(v_keys_arr) THEN
                INSERT INTO public.seasons (name, start_date, end_date, status)
                VALUES (
                    v_row ->> 'name',
                    NULLIF(v_row ->> 'start_date', '')::date,
                    NULLIF(v_row ->> 'end_date',   '')::date,
                    'Active')
                ON CONFLICT (name) DO UPDATE
                    SET start_date = COALESCE(EXCLUDED.start_date, public.seasons.start_date),
                        end_date   = COALESCE(EXCLUDED.end_date,   public.seasons.end_date)
                RETURNING id INTO v_match_id;
                v_season_ids := array_append(v_season_ids, v_match_id);
            END IF;
        END LOOP;
    END IF;

    -- production_lines (line_type/daily_capacity required by table — required by validator too)
    IF p_row_filter ? 'production_lines' THEN
        v_keys_arr := ARRAY(SELECT jsonb_array_elements_text(p_row_filter -> 'production_lines'));
        FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_data -> 'production_lines', '[]'::jsonb))
        LOOP
            IF v_row ->> 'name' = ANY(v_keys_arr) THEN
                INSERT INTO public.production_lines (name, line_type, daily_capacity, is_active)
                VALUES (
                    v_row ->> 'name',
                    COALESCE(v_row ->> 'line_type', 'stitching'),
                    COALESCE(NULLIF(v_row ->> 'daily_capacity','')::integer, 0),
                    true)
                ON CONFLICT (name) DO UPDATE
                    SET line_type      = EXCLUDED.line_type,
                        daily_capacity = EXCLUDED.daily_capacity,
                        updated_at     = now()
                RETURNING id INTO v_match_id;
                v_line_ids := array_append(v_line_ids, v_match_id);
            END IF;
        END LOOP;
    END IF;

    ---------------------------------------------------------------- bookkeeping
    v_applied := jsonb_build_object();
    IF array_length(v_articles_ids,  1) IS NOT NULL THEN v_applied := v_applied || jsonb_build_object('articles',              to_jsonb(v_articles_ids));  END IF;
    IF array_length(v_cons_ids,      1) IS NOT NULL THEN v_applied := v_applied || jsonb_build_object('consumption_library',   to_jsonb(v_cons_ids));      END IF;
    IF array_length(v_carton_ids,    1) IS NOT NULL THEN v_applied := v_applied || jsonb_build_object('carton_master',         to_jsonb(v_carton_ids));    END IF;
    IF array_length(v_price_ids,     1) IS NOT NULL THEN v_applied := v_applied || jsonb_build_object('price_list',            to_jsonb(v_price_ids));     END IF;
    IF array_length(v_supplier_ids,  1) IS NOT NULL THEN v_applied := v_applied || jsonb_build_object('suppliers',             to_jsonb(v_supplier_ids));  END IF;
    IF array_length(v_season_ids,    1) IS NOT NULL THEN v_applied := v_applied || jsonb_build_object('seasons',               to_jsonb(v_season_ids));    END IF;
    IF array_length(v_line_ids,      1) IS NOT NULL THEN v_applied := v_applied || jsonb_build_object('production_lines',      to_jsonb(v_line_ids));      END IF;

    UPDATE public.ai_extractions
        SET applied_at         = now(),
            applied_by         = auth.uid(),
            applied_target_ids = v_applied,
            review_status      = 'approved'
        WHERE id = p_extraction_id;

    RETURN jsonb_build_object(
        'ok', true,
        'applied_target_ids', v_applied,
        'conflicts_overwritten', CASE WHEN p_force AND jsonb_array_length(v_conflicts) > 0
                                      THEN v_conflicts ELSE '[]'::jsonb END,
        'review_status', 'approved');
END;
$$;

-- =========================================================================
-- Grants
-- =========================================================================

GRANT EXECUTE ON FUNCTION public.fn_reject_extraction(uuid, text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_tech_pack_extraction(uuid, text[])        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_master_data_extraction(uuid, jsonb, boolean) TO authenticated;
