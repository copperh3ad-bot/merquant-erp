-- Migration: 0039_po_fabric_requirements (was MAS 41_po_fabric_requirements)
-- ERP-adapted: po_items column names rewritten per Appendix A.7 of mega-exploration.md.
-- ERP po_items has master_article_id, style_sku, item_code, item_description, size_breakdown (jsonb).
-- Already applied to live DB on 2026-05-08 via mcp__supabase__apply_migration.

CREATE TABLE IF NOT EXISTS po_fabric_requirements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id                    UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_description     TEXT NOT NULL,
  composition              TEXT,
  gsm                      NUMERIC(8,2),
  fabric_width_inches      NUMERIC(8,2),
  colour_code              TEXT,
  total_yards_net          NUMERIC(12,4),
  total_metres_net         NUMERIC(12,4),
  total_grams_net          NUMERIC(12,4),
  consumption_unit         TEXT DEFAULT 'yards',
  buffer_pct               NUMERIC(5,2) DEFAULT 5.0,
  total_yards_with_buffer  NUMERIC(12,4),
  total_metres_with_buffer NUMERIC(12,4),
  line_item_breakdown      JSONB DEFAULT '[]'::jsonb,
  component_breakdown      JSONB DEFAULT '{}'::jsonb,
  bom_complete             BOOLEAN DEFAULT true,
  missing_bom_items        JSONB DEFAULT '[]'::jsonb,
  calculated_at            TIMESTAMPTZ DEFAULT NOW(),
  calculated_by            TEXT DEFAULT 'system',
  version                  INTEGER DEFAULT 1,
  UNIQUE (po_id, material_description, version)
);

CREATE INDEX IF NOT EXISTS idx_po_fabric_req_po       ON po_fabric_requirements(po_id);
CREATE INDEX IF NOT EXISTS idx_po_fabric_req_material ON po_fabric_requirements(material_description);
CREATE INDEX IF NOT EXISTS idx_po_fabric_req_complete ON po_fabric_requirements(bom_complete)
  WHERE bom_complete = false;

ALTER TABLE po_fabric_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_users_all_po_fabric_req" ON po_fabric_requirements;
CREATE POLICY "auth_users_all_po_fabric_req" ON po_fabric_requirements FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- RPC: calculate_po_fabric_requirements
-- ERP-adapted: fans out per (po_item, size) using jsonb_each_text(size_breakdown).
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_po_fabric_requirements(
  p_po_id      UUID,
  p_buffer_pct NUMERIC DEFAULT 5.0
)
RETURNS TABLE (
  material_description     TEXT,
  composition              TEXT,
  gsm                      NUMERIC,
  fabric_width_inches      NUMERIC,
  total_yards_net          NUMERIC,
  total_yards_with_buffer  NUMERIC,
  total_metres_with_buffer NUMERIC,
  line_item_count          INTEGER,
  bom_complete             BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item            RECORD;
  v_bom             RECORD;
  v_material_key    TEXT;
  v_material_totals JSONB := '{}'::jsonb;
  v_missing         JSONB := '[]'::jsonb;
BEGIN
  -- Recalculate from scratch
  DELETE FROM po_fabric_requirements WHERE po_id = p_po_id;

  -- Iterate over (po_item, size) pairs.
  -- ERP stores per-size quantities in po_items.size_breakdown (jsonb).
  -- If size_breakdown is missing/empty, fall back to a single 'ONE SIZE'
  -- row with the line's full quantity.
  FOR v_item IN
    SELECT
      pi.id                                   AS po_item_id,
      sz.size_code                            AS size_code,
      sz.qty                                  AS quantity,
      pi.item_description                     AS item_description,
      COALESCE(pi.master_article_id, a_sku.id) AS resolved_article_id,
      COALESCE(pi.style_sku, pi.item_code, pi.item_description) AS sku_ref
    FROM po_items pi
    LEFT JOIN articles a_sku
      ON LOWER(TRIM(a_sku.article_code)) =
         LOWER(TRIM(COALESCE(pi.style_sku, pi.item_code, '')))
    CROSS JOIN LATERAL (
      -- Explode size_breakdown if non-empty; otherwise emit one ONE SIZE row.
      SELECT
        COALESCE(NULLIF(kv.key, ''), 'ONE SIZE') AS size_code,
        COALESCE((kv.value)::NUMERIC, 0)         AS qty
      FROM jsonb_each_text(COALESCE(pi.size_breakdown, '{}'::jsonb)) AS kv(key, value)
      WHERE COALESCE((kv.value)::NUMERIC, 0) > 0
      UNION ALL
      SELECT 'ONE SIZE'::TEXT, COALESCE(pi.quantity, 0)::NUMERIC
      WHERE COALESCE(pi.size_breakdown, '{}'::jsonb) = '{}'::jsonb
        AND COALESCE(pi.quantity, 0) > 0
    ) sz
    WHERE pi.po_id = p_po_id
      AND sz.qty > 0
  LOOP

    IF v_item.resolved_article_id IS NULL THEN
      v_missing := v_missing || jsonb_build_object(
        'sku',       v_item.sku_ref,
        'size_code', v_item.size_code,
        'reason',    'article not found'
      );
      CONTINUE;
    END IF;

    PERFORM 1 FROM bom_set_totals
    WHERE article_id = v_item.resolved_article_id
      AND size_code  = v_item.size_code
    LIMIT 1;

    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_object(
        'sku',       v_item.sku_ref,
        'size_code', v_item.size_code,
        'reason',    'BOM not calculated — run BOM calculator first'
      );
      CONTINUE;
    END IF;

    FOR v_bom IN
      SELECT bst.material_description, bst.composition, bst.gsm,
             bst.fabric_width_inches, bst.total_yards, bst.total_metres,
             bst.total_grams, bst.consumption_unit, bst.component_ids,
             bst.piece_breakdown
      FROM bom_set_totals bst
      WHERE bst.article_id = v_item.resolved_article_id
        AND bst.size_code  = v_item.size_code
    LOOP
      v_material_key := v_bom.material_description;

      IF v_material_totals ? v_material_key THEN
        v_material_totals := jsonb_set(
          v_material_totals,
          ARRAY[v_material_key],
          (v_material_totals->v_material_key) || jsonb_build_object(
            'total_yards',  ((v_material_totals->v_material_key->>'total_yards')::NUMERIC
                              + COALESCE(v_bom.total_yards,  0) * v_item.quantity),
            'total_metres', ((v_material_totals->v_material_key->>'total_metres')::NUMERIC
                              + COALESCE(v_bom.total_metres, 0) * v_item.quantity),
            'total_grams',  ((v_material_totals->v_material_key->>'total_grams')::NUMERIC
                              + COALESCE(v_bom.total_grams,  0) * v_item.quantity),
            'line_count',   ((v_material_totals->v_material_key->>'line_count')::INTEGER + 1),
            'line_items',   (v_material_totals->v_material_key->'line_items') ||
                            jsonb_build_array(jsonb_build_object(
                              'po_item_id',      v_item.po_item_id,
                              'sku',             v_item.sku_ref,
                              'size_code',       v_item.size_code,
                              'quantity',        v_item.quantity,
                              'yards_per_piece', v_bom.total_yards,
                              'subtotal_yards',  ROUND(COALESCE(v_bom.total_yards, 0) * v_item.quantity, 4)
                            ))
          )
        );
      ELSE
        v_material_totals := v_material_totals || jsonb_build_object(
          v_material_key, jsonb_build_object(
            'material_description', v_bom.material_description,
            'composition',          v_bom.composition,
            'gsm',                  v_bom.gsm,
            'fabric_width_inches',  v_bom.fabric_width_inches,
            'consumption_unit',     v_bom.consumption_unit,
            'total_yards',          ROUND(COALESCE(v_bom.total_yards,  0) * v_item.quantity, 4),
            'total_metres',         ROUND(COALESCE(v_bom.total_metres, 0) * v_item.quantity, 4),
            'total_grams',          ROUND(COALESCE(v_bom.total_grams,  0) * v_item.quantity, 4),
            'line_count',           1,
            'line_items', jsonb_build_array(jsonb_build_object(
              'po_item_id',      v_item.po_item_id,
              'sku',             v_item.sku_ref,
              'size_code',       v_item.size_code,
              'quantity',        v_item.quantity,
              'yards_per_piece', v_bom.total_yards,
              'subtotal_yards',  ROUND(COALESCE(v_bom.total_yards, 0) * v_item.quantity, 4)
            ))
          )
        );
      END IF;

    END LOOP;
  END LOOP;

  DECLARE
    v_mat_data    JSONB;
    v_mat_key     TEXT;
    v_net_yards   NUMERIC;
    v_buf_yards   NUMERIC;
    v_buf_metres  NUMERIC;
    v_is_complete BOOLEAN := (jsonb_array_length(v_missing) = 0);
  BEGIN
    FOR v_mat_key IN SELECT jsonb_object_keys(v_material_totals)
    LOOP
      v_mat_data   := v_material_totals->v_mat_key;
      v_net_yards  := (v_mat_data->>'total_yards')::NUMERIC;
      v_buf_yards  := ROUND(v_net_yards * (1 + p_buffer_pct / 100), 4);
      v_buf_metres := ROUND((v_mat_data->>'total_metres')::NUMERIC * (1 + p_buffer_pct / 100), 4);

      INSERT INTO po_fabric_requirements (
        po_id, material_description, composition, gsm, fabric_width_inches,
        total_yards_net, total_metres_net, total_grams_net, consumption_unit,
        buffer_pct, total_yards_with_buffer, total_metres_with_buffer,
        line_item_breakdown, bom_complete, missing_bom_items, calculated_by
      ) VALUES (
        p_po_id,
        v_mat_data->>'material_description',
        v_mat_data->>'composition',
        (v_mat_data->>'gsm')::NUMERIC,
        (v_mat_data->>'fabric_width_inches')::NUMERIC,
        v_net_yards,
        (v_mat_data->>'total_metres')::NUMERIC,
        (v_mat_data->>'total_grams')::NUMERIC,
        v_mat_data->>'consumption_unit',
        p_buffer_pct,
        v_buf_yards,
        v_buf_metres,
        v_mat_data->'line_items',
        v_is_complete,
        v_missing,
        'rpc'
      );
    END LOOP;
  END;

  RETURN QUERY
  SELECT
    pfr.material_description,
    pfr.composition,
    pfr.gsm,
    pfr.fabric_width_inches,
    pfr.total_yards_net,
    pfr.total_yards_with_buffer,
    pfr.total_metres_with_buffer,
    jsonb_array_length(pfr.line_item_breakdown)::INTEGER AS line_item_count,
    pfr.bom_complete
  FROM po_fabric_requirements pfr
  WHERE pfr.po_id = p_po_id
  ORDER BY pfr.material_description;
END;
$$;

CREATE OR REPLACE VIEW po_fabric_summary AS
SELECT
  pfr.po_id,
  po.po_number,
  po.buyer_name,
  COUNT(DISTINCT pfr.material_description)              AS material_count,
  SUM(pfr.total_yards_net)                              AS total_yards_net,
  SUM(pfr.total_yards_with_buffer)                      AS total_yards_with_buffer,
  SUM(pfr.total_metres_with_buffer)                     AS total_metres_with_buffer,
  BOOL_AND(pfr.bom_complete)                            AS all_bom_complete,
  MAX(pfr.calculated_at)                                AS last_calculated,
  (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM po_fabric_requirements pfr2
    CROSS JOIN LATERAL jsonb_array_elements(pfr2.missing_bom_items) AS elem
    WHERE pfr2.po_id = pfr.po_id
  )                                                     AS missing_bom_items
FROM po_fabric_requirements pfr
JOIN purchase_orders po ON po.id = pfr.po_id
GROUP BY pfr.po_id, po.po_number, po.buyer_name;

COMMENT ON TABLE po_fabric_requirements IS
  'Calculated total fabric required per material per PO. ERP-adapted: '
  'joins po_items × bom_set_totals; fans out per (po_item, size) using '
  'po_items.size_breakdown jsonb. Includes over-order buffer.';
COMMENT ON VIEW po_fabric_summary IS
  'Quick summary per PO: total materials, total yards, completeness flag, '
  'and any SKUs missing BOM data.';
