-- 0012_explode_po_bom_field_fallbacks.sql
-- 2026-05-02
--
-- The original explode_po_bom function (migration 0001) reads each tech-pack
-- JSONB element using fixed field names: 'color', 'size_spec',
-- 'quantity_per_unit', 'unit'. AI extractions and the BOB parser have
-- historically written DIFFERENT names — 'colours', 'size', 'dimensions',
-- 'consumption_per_unit' — leaving trim_items and accessory_items rows with
-- empty cells in the planning UI.
--
-- This migration:
--   1. Defines a tiny helper jsonb_first_text(elem, keys...) that returns
--      the first non-null/non-empty text value across a list of keys.
--   2. Defines a sibling jsonb_first_numeric(elem, keys...) for numbers.
--   3. CREATE OR REPLACEs explode_po_bom so it reads via these helpers,
--      tolerating both legacy and v2-prompt-shaped JSONB. Pulls a few new
--      fields too (color, size_spec on labels; supplier on accessories;
--      explicit unit per row).
--
-- Re-applying is safe (CREATE OR REPLACE) and does not require redoing the
-- BOM for already-exploded POs unless the caller passes p_force_redo=true.

-- ── Helper: first non-empty text across a variadic list of keys ─────────
CREATE OR REPLACE FUNCTION public.jsonb_first_text(elem jsonb, VARIADIC keys text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
  v text;
BEGIN
  IF elem IS NULL THEN RETURN NULL; END IF;
  FOREACH k IN ARRAY keys LOOP
    v := elem->>k;
    IF v IS NOT NULL AND btrim(v) <> '' THEN
      RETURN v;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ── Helper: first non-null numeric across a variadic list of keys ───────
CREATE OR REPLACE FUNCTION public.jsonb_first_numeric(elem jsonb, VARIADIC keys text[])
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
  v text;
BEGIN
  IF elem IS NULL THEN RETURN NULL; END IF;
  FOREACH k IN ARRAY keys LOOP
    v := elem->>k;
    IF v IS NOT NULL AND btrim(v) <> '' THEN
      BEGIN
        RETURN v::numeric;
      EXCEPTION WHEN OTHERS THEN
        -- value not numeric — try next key
        CONTINUE;
      END;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ── explode_po_bom: rewritten to use field-name fallbacks ───────────────
CREATE OR REPLACE FUNCTION public.explode_po_bom(p_po_id uuid, p_force_redo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_po record;
  v_item record;
  v_master record;
  v_tp record;
  v_comp jsonb;
  v_qty numeric;
  v_wastage numeric;
  v_final_qty numeric;
  v_created_id uuid;
  v_qty_per_unit numeric;
  v_color text;
  v_size_spec text;
  v_unit text;
  v_supplier text;
  v_desc text;
  v_type text;
  v_result jsonb := jsonb_build_object('fabrics',0,'yarns',0,'trims',0,'accessories',0,'cartons',0,'errors','[]'::jsonb);
  v_errors jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;

  IF v_po.bom_exploded AND NOT p_force_redo THEN
    RETURN jsonb_build_object('status','already_exploded','at',v_po.bom_exploded_at);
  END IF;

  IF p_force_redo THEN
    DELETE FROM bom_explosion_log WHERE po_id = p_po_id;
    DELETE FROM yarn_requirements WHERE po_id = p_po_id;
    DELETE FROM trim_items WHERE po_id = p_po_id;
    DELETE FROM accessory_items WHERE po_id = p_po_id;
    DELETE FROM fabric_orders WHERE po_id = p_po_id;
  END IF;

  FOR v_item IN SELECT * FROM po_items WHERE po_id = p_po_id LOOP
    SELECT * INTO v_master FROM master_articles
      WHERE article_code = v_item.item_code AND is_active = true LIMIT 1;

    SELECT * INTO v_tp FROM tech_packs
      WHERE (article_code = v_item.item_code OR po_id = p_po_id)
      AND extraction_status = 'extracted'
      ORDER BY CASE WHEN article_code = v_item.item_code THEN 0 ELSE 1 END
      LIMIT 1;

    -- 1. FABRICS (master, then tech pack)
    IF v_master.id IS NOT NULL AND jsonb_array_length(COALESCE(v_master.fabric_components,'[]'::jsonb)) > 0 THEN
      FOR v_comp IN SELECT jsonb_array_elements(v_master.fabric_components) LOOP
        v_qty_per_unit := COALESCE(jsonb_first_numeric(v_comp, 'consumption_per_unit', 'quantity_per_unit'), 0);
        v_wastage := COALESCE(jsonb_first_numeric(v_comp, 'wastage_percent'), 5);
        v_final_qty := v_qty_per_unit * v_item.quantity * (1 + v_wastage / 100);
        INSERT INTO fabric_orders (po_id, po_number, mill_name, fabric_type, gsm, width_cm, color, quantity_meters, currency, status, notes)
        VALUES (p_po_id, v_po.po_number,
          COALESCE(v_comp->>'supplier','TBD'),
          v_comp->>'fabric_type',
          NULLIF(v_comp->>'gsm','')::numeric,
          NULLIF(v_comp->>'width_cm','')::numeric,
          jsonb_first_text(v_comp, 'color', 'colour', 'colours'),
          v_final_qty, v_po.currency, 'Pending',
          CONCAT('Auto-exploded from master ',v_master.article_code,' · item ',v_item.item_code))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_comp->>'component_type', 'fabric', 'master_article', v_master.id, v_created_id, 'fabric_orders', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{fabrics}', to_jsonb((v_result->>'fabrics')::int + 1));
      END LOOP;
    ELSIF v_tp.id IS NOT NULL AND jsonb_array_length(COALESCE(v_tp.extracted_fabric_specs,'[]'::jsonb)) > 0 THEN
      FOR v_comp IN SELECT jsonb_array_elements(v_tp.extracted_fabric_specs) LOOP
        v_qty_per_unit := COALESCE(jsonb_first_numeric(v_comp, 'consumption_per_unit', 'quantity_per_unit'), 0);
        v_wastage := COALESCE(jsonb_first_numeric(v_comp, 'wastage_percent'), 5);
        v_final_qty := v_qty_per_unit * v_item.quantity * (1 + v_wastage / 100);
        INSERT INTO fabric_orders (po_id, po_number, mill_name, fabric_type, gsm, width_cm, color, quantity_meters, currency, status, notes)
        VALUES (p_po_id, v_po.po_number, 'TBD', v_comp->>'fabric_type',
          NULLIF(v_comp->>'gsm','')::numeric, NULLIF(v_comp->>'width_cm','')::numeric,
          jsonb_first_text(v_comp, 'color', 'colour', 'colours'),
          v_final_qty, v_po.currency, 'Pending',
          CONCAT('Auto-exploded from techpack ',v_tp.article_code,' · item ',v_item.item_code,' (FALLBACK — no master)'))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_comp->>'component_type', 'fabric', 'tech_pack', v_tp.id, v_created_id, 'fabric_orders', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{fabrics}', to_jsonb((v_result->>'fabrics')::int + 1));
      END LOOP;
    END IF;

    -- 2. TRIMS (from tech pack: extracted_trim_specs)
    IF v_tp.id IS NOT NULL AND jsonb_array_length(COALESCE(v_tp.extracted_trim_specs,'[]'::jsonb)) > 0 THEN
      FOR v_comp IN SELECT jsonb_array_elements(v_tp.extracted_trim_specs) LOOP
        v_qty_per_unit := COALESCE(jsonb_first_numeric(v_comp, 'quantity_per_unit', 'consumption_per_unit'), 1);
        v_wastage := COALESCE(jsonb_first_numeric(v_comp, 'wastage_percent'), 5);
        v_qty := v_qty_per_unit * v_item.quantity;
        v_final_qty := v_qty * (1 + v_wastage / 100);
        v_color := jsonb_first_text(v_comp, 'color', 'colour', 'colours');
        v_size_spec := jsonb_first_text(v_comp, 'size_spec', 'dimensions', 'size');
        v_unit := COALESCE(jsonb_first_text(v_comp, 'unit'), 'Pcs');
        v_supplier := jsonb_first_text(v_comp, 'supplier');
        v_desc := jsonb_first_text(v_comp, 'description', 'item_description', 'material', 'value');
        v_type := jsonb_first_text(v_comp, 'trim_type', 'trim_category', 'category', 'accessory_type');

        INSERT INTO trim_items (po_id, po_number, article_code, trim_category, item_description, color, size_spec, order_quantity, quantity_required, unit, supplier, status, consumption_per_unit, wastage_percent, notes)
        VALUES (p_po_id, v_po.po_number, v_item.item_code,
          v_type, v_desc, v_color, v_size_spec,
          v_item.quantity, v_final_qty, v_unit, v_supplier, 'Planned',
          v_qty_per_unit, v_wastage,
          CONCAT('Auto-exploded from techpack ',v_tp.article_code))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_type, 'trim', 'tech_pack', v_tp.id, v_created_id, 'trim_items', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{trims}', to_jsonb((v_result->>'trims')::int + 1));
      END LOOP;
    END IF;

    -- 3. ACCESSORIES (from tech pack, including labels)
    IF v_tp.id IS NOT NULL THEN
      FOR v_comp IN SELECT jsonb_array_elements(COALESCE(v_tp.extracted_accessory_specs,'[]'::jsonb)) LOOP
        v_qty_per_unit := COALESCE(jsonb_first_numeric(v_comp, 'quantity_per_unit', 'consumption_per_unit'), 1);
        v_wastage := COALESCE(jsonb_first_numeric(v_comp, 'wastage_percent'), 3);
        v_qty := v_qty_per_unit * v_item.quantity;
        v_final_qty := v_qty * (1 + v_wastage / 100);
        v_color := jsonb_first_text(v_comp, 'color', 'colour', 'colours');
        v_size_spec := jsonb_first_text(v_comp, 'size_spec', 'dimensions', 'size');
        v_unit := COALESCE(jsonb_first_text(v_comp, 'unit'), 'Pcs');
        v_supplier := jsonb_first_text(v_comp, 'supplier');
        v_desc := jsonb_first_text(v_comp, 'description', 'item_description', 'material');
        v_type := jsonb_first_text(v_comp, 'accessory_type', 'category', 'label_type');

        INSERT INTO accessory_items (po_id, po_number, article_code, category, item_description, color, size_spec, quantity_required, unit, supplier, status, consumption_per_unit, wastage_percent, notes)
        VALUES (p_po_id, v_po.po_number, v_item.item_code,
          v_type, v_desc, v_color, v_size_spec,
          v_final_qty, v_unit, v_supplier, 'Planned',
          v_qty_per_unit, v_wastage,
          CONCAT('Auto-exploded from techpack ',v_tp.article_code))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_type, 'accessory', 'tech_pack', v_tp.id, v_created_id, 'accessory_items', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{accessories}', to_jsonb((v_result->>'accessories')::int + 1));
      END LOOP;

      -- Labels (extracted_label_specs) flow into accessory_items
      FOR v_comp IN SELECT jsonb_array_elements(COALESCE(v_tp.extracted_label_specs,'[]'::jsonb)) LOOP
        v_qty_per_unit := COALESCE(jsonb_first_numeric(v_comp, 'quantity_per_unit', 'consumption_per_unit'), 1);
        v_wastage := COALESCE(jsonb_first_numeric(v_comp, 'wastage_percent'), 3);
        v_qty := v_qty_per_unit * v_item.quantity;
        v_final_qty := v_qty * (1 + v_wastage / 100);
        v_color := jsonb_first_text(v_comp, 'color', 'colour', 'colours');
        v_size_spec := jsonb_first_text(v_comp, 'size_spec', 'dimensions', 'size');
        v_unit := COALESCE(jsonb_first_text(v_comp, 'unit'), 'Pcs');
        v_supplier := jsonb_first_text(v_comp, 'supplier');
        v_desc := jsonb_first_text(v_comp, 'description', 'item_description', 'material');
        v_type := COALESCE(jsonb_first_text(v_comp, 'label_type', 'type', 'category'), 'Label');

        INSERT INTO accessory_items (po_id, po_number, article_code, category, item_description, color, size_spec, quantity_required, unit, supplier, status, consumption_per_unit, wastage_percent, notes)
        VALUES (p_po_id, v_po.po_number, v_item.item_code,
          v_type, v_desc, v_color, v_size_spec,
          v_final_qty, v_unit, v_supplier, 'Planned',
          v_qty_per_unit, v_wastage,
          CONCAT('Auto-exploded label from techpack ',v_tp.article_code))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_type, 'label', 'tech_pack', v_tp.id, v_created_id, 'accessory_items', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{accessories}', to_jsonb((v_result->>'accessories')::int + 1));
      END LOOP;
    END IF;

    -- 4. CARTONS from master
    IF v_master.id IS NOT NULL AND v_master.pieces_per_carton > 0 THEN
      INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, details)
      VALUES (p_po_id, v_po.po_number, v_item.item_code, 'Master Carton', 'carton', 'master_article', v_master.id, v_item.id, 'po_items',
        v_item.quantity::numeric / v_master.pieces_per_carton,
        jsonb_build_object('pieces_per_carton', v_master.pieces_per_carton, 'cbm_per_carton', v_master.cbm_per_carton));
      UPDATE po_items SET
        units_per_carton = COALESCE(units_per_carton, v_master.pieces_per_carton),
        carton_length = COALESCE(carton_length, v_master.carton_length),
        carton_width = COALESCE(carton_width, v_master.carton_width),
        carton_height = COALESCE(carton_height, v_master.carton_height),
        cbm = COALESCE(cbm, v_master.cbm_per_carton * CEIL(v_item.quantity::numeric / v_master.pieces_per_carton))
      WHERE id = v_item.id;
      v_result := jsonb_set(v_result, '{cartons}', to_jsonb((v_result->>'cartons')::int + 1));
    END IF;

    IF v_master.id IS NULL AND v_tp.id IS NULL THEN
      INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, details)
      VALUES (p_po_id, v_po.po_number, v_item.item_code, 'NO_SOURCE', 'skipped', 'skipped_no_source',
        jsonb_build_object('reason','No master article or tech pack found for item_code'));
      v_errors := v_errors || jsonb_build_object('item_code', v_item.item_code, 'reason','No BOM source');
    END IF;
  END LOOP;

  UPDATE purchase_orders SET
    bom_exploded = true,
    bom_exploded_at = now(),
    bom_explosion_notes = v_result::text
  WHERE id = p_po_id;

  v_result := jsonb_set(v_result, '{errors}', v_errors);
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.explode_po_bom(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jsonb_first_text(jsonb, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jsonb_first_numeric(jsonb, text[]) TO authenticated, service_role;
