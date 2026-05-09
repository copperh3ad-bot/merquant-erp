-- Migration: 38_bom_consumption_schema
-- BOM Consumption Engine for bedding/mattress protector products
-- Adds component-level fabric tracking, size masters, and consumption results
-- Designed as ADDITIVE-ONLY — zero changes to existing tables
-- All new tables are independent children; articles table untouched

-- ============================================================
-- 1. size_masters — standard finished dimensions per product category
--    Populated with US bedding standards. Editable per buyer.
-- ============================================================

CREATE TABLE IF NOT EXISTS size_masters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL,      -- 'mattress_protector' | 'fitted_sheet' | 'flat_sheet' | 'pillowcase' | 'duvet_cover' | 'custom'
  size_code       TEXT NOT NULL,      -- 'TXL' | 'F' | 'Q' | 'K' | 'CK' | 'EURO' | 'STD' | 'KG'
  size_label      TEXT NOT NULL,      -- 'Twin XL' | 'Full' | 'Queen' | 'King' | 'Cal King'
  length_inches   NUMERIC(8,2),       -- finished length
  width_inches    NUMERIC(8,2),       -- finished width
  depth_inches    NUMERIC(8,2),       -- mattress depth / pillow depth (for skirt calc)
  buyer_id        TEXT,               -- NULL = global standard; buyer name = buyer-specific override
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (category, size_code, COALESCE(buyer_id, ''))
);

CREATE INDEX idx_size_masters_category ON size_masters(category, size_code);

-- Seed US bedding standard sizes
INSERT INTO size_masters (category, size_code, size_label, length_inches, width_inches, depth_inches) VALUES
  -- Mattress Protectors / Fitted Sheets (finished flat dimensions)
  ('mattress_protector', 'TW',  'Twin',        75, 39,  14),
  ('mattress_protector', 'TXL', 'Twin XL',     80, 39,  14),
  ('mattress_protector', 'F',   'Full',         75, 54,  14),
  ('mattress_protector', 'Q',   'Queen',        80, 60,  14),
  ('mattress_protector', 'K',   'King',         80, 76,  14),
  ('mattress_protector', 'CK',  'Cal King',     84, 72,  14),
  ('fitted_sheet',       'TW',  'Twin',        75, 39,  15),
  ('fitted_sheet',       'TXL', 'Twin XL',     80, 39,  15),
  ('fitted_sheet',       'F',   'Full',         75, 54,  15),
  ('fitted_sheet',       'Q',   'Queen',        80, 60,  15),
  ('fitted_sheet',       'K',   'King',         80, 76,  15),
  ('fitted_sheet',       'CK',  'Cal King',     84, 72,  15),
  -- Flat Sheets
  ('flat_sheet',         'TW',  'Twin',        96, 66,   NULL),
  ('flat_sheet',         'TXL', 'Twin XL',    102, 66,   NULL),
  ('flat_sheet',         'F',   'Full',        96, 81,   NULL),
  ('flat_sheet',         'Q',   'Queen',      102, 90,   NULL),
  ('flat_sheet',         'K',   'King',       108,108,   NULL),
  ('flat_sheet',         'CK',  'Cal King',   110,102,   NULL),
  -- Pillowcases
  ('pillowcase',         'STD', 'Standard',    20, 26,   NULL),
  ('pillowcase',         'KG',  'King',         20, 36,   NULL),
  ('pillowcase',         'EURO','Euro',         26, 26,   NULL),
  -- Duvet Covers
  ('duvet_cover',        'TW',  'Twin',        86, 68,   NULL),
  ('duvet_cover',        'Q',   'Queen',       90, 90,   NULL),
  ('duvet_cover',        'K',   'King',        90,106,   NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. article_components — sub-component fabric breakdown per article
--    One row per fabric zone per article
-- ============================================================

CREATE TABLE IF NOT EXISTS article_components (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id            UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  -- Component identity
  component_name        TEXT NOT NULL,   -- e.g. 'Top Panel', 'Skirt', 'Reverse', 'Fill', 'Border'
  component_type        TEXT NOT NULL
                        CHECK (component_type IN (
                          'top_panel',    -- main face fabric
                          'skirt',        -- perimeter drop / gusset
                          'reverse',      -- back/bottom panel (different from top)
                          'fill',         -- batting/wadding/foam
                          'border',       -- decorative border strip
                          'elastic',      -- elastic tape/band
                          'binding',      -- binding tape
                          'label',        -- care/brand label
                          'other'
                        )),
  display_order         INTEGER DEFAULT 1,  -- order in BOM display

  -- Material specification
  material_description  TEXT,           -- e.g. '200GSM Microfibre Brushed'
  composition           TEXT,           -- e.g. '100% Polyester'
  gsm                   NUMERIC(8,2),   -- grams per square metre
  fabric_width_inches   NUMERIC(8,2),   -- usable width after selvedge
  colour_code           TEXT,           -- if different from main article colour

  -- Formula type determines calculation method
  formula_type          TEXT NOT NULL
                        CHECK (formula_type IN (
                          'perimeter_skirt',    -- full 4-side perimeter × depth
                          'flat_panel',         -- length × width (top/reverse/flat sheet)
                          'fill_weight',        -- area × gsm / 1000 (fill in grams)
                          'trim_length',        -- linear metres (elastic, binding, piping)
                          'fixed_quantity',     -- e.g. labels: fixed count per piece
                          'manual'              -- no formula, manually entered
                        )),

  -- Formula parameters (interpreted by formula engine)
  seam_allowance_inches NUMERIC(6,3) DEFAULT 0.5,
  hem_allowance_inches  NUMERIC(6,3) DEFAULT 1.5,
  skirt_depth_inches    NUMERIC(6,2),            -- for perimeter_skirt only
  wastage_pct           NUMERIC(5,2) DEFAULT 8.0,-- % wastage/cutting loss
  shrinkage_pct         NUMERIC(5,2) DEFAULT 3.0,-- % pre-shrinkage allowance
  overlap_inches        NUMERIC(6,3) DEFAULT 0,  -- for envelope closures etc.

  -- Size overrides (if skirt depth varies by size)
  -- JSON: { "Q": {"skirt_depth_inches": 15}, "K": {"skirt_depth_inches": 16} }
  size_overrides        JSONB DEFAULT '{}'::jsonb,

  -- Set membership (for multi-piece sets)
  set_piece_name        TEXT,    -- e.g. 'Protector', 'Fitted Sheet', 'Pillow Case 1'
  set_piece_index       INTEGER DEFAULT 1,  -- 1=first piece, 2=second etc.

  -- Source tracking
  source                TEXT DEFAULT 'manual'
                        CHECK (source IN ('manual', 'tech_pack', 'imported', 'agent')),
  tech_pack_id          UUID REFERENCES tech_packs(id) ON DELETE SET NULL,
  confidence            NUMERIC(4,3) DEFAULT 1.0,  -- agent extraction confidence

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (article_id, component_type, COALESCE(set_piece_name, ''), display_order)
);

CREATE INDEX idx_article_components_article ON article_components(article_id);
CREATE INDEX idx_article_components_type    ON article_components(component_type);
CREATE INDEX idx_article_components_source  ON article_components(source);

CREATE OR REPLACE FUNCTION update_article_components_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_article_components_updated_at
  BEFORE UPDATE ON article_components
  FOR EACH ROW EXECUTE FUNCTION update_article_components_updated_at();

ALTER TABLE article_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_components"
  ON article_components FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 3. bom_results — calculated consumption output per article per size
--    Written by the formula engine; read by costing and ordering
-- ============================================================

CREATE TABLE IF NOT EXISTS bom_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id            UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  component_id          UUID NOT NULL REFERENCES article_components(id) ON DELETE CASCADE,

  -- Size this result applies to
  size_code             TEXT NOT NULL,
  size_label            TEXT,

  -- Consumption output
  consumption_yards     NUMERIC(10,4),  -- primary unit for fabric
  consumption_metres    NUMERIC(10,4),
  consumption_grams     NUMERIC(10,4),  -- for fill weight
  consumption_unit      TEXT NOT NULL DEFAULT 'yards',

  -- Working shown (for audit / review)
  calculation_steps     JSONB,  -- shows each step: perimeter, area, wastage addition etc.
  formula_used          TEXT,   -- human-readable formula string

  -- Input snapshot (frozen at calc time)
  inputs_snapshot       JSONB,  -- width, depth, seam allowances etc. used in calc

  -- Status
  is_confirmed          BOOLEAN DEFAULT false,  -- human-verified
  confirmed_by          UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  confirmed_at          TIMESTAMPTZ,
  notes                 TEXT,

  -- Versioning
  calculated_at         TIMESTAMPTZ DEFAULT NOW(),
  calculated_by         TEXT DEFAULT 'system',  -- 'system' | 'agent' | user name
  version               INTEGER DEFAULT 1,

  UNIQUE (article_id, component_id, size_code, version)
);

CREATE INDEX idx_bom_results_article   ON bom_results(article_id);
CREATE INDEX idx_bom_results_component ON bom_results(component_id);
CREATE INDEX idx_bom_results_size      ON bom_results(size_code);
CREATE INDEX idx_bom_results_confirmed ON bom_results(is_confirmed);

ALTER TABLE bom_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_bom"
  ON bom_results FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 4. bom_set_totals — aggregated BOM across all pieces in a set
--    Groups consumption by material across all components
-- ============================================================

CREATE TABLE IF NOT EXISTS bom_set_totals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id            UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  size_code             TEXT NOT NULL,

  -- Aggregated by material description (consolidates same fabric across pieces)
  material_description  TEXT NOT NULL,
  composition           TEXT,
  gsm                   NUMERIC(8,2),
  fabric_width_inches   NUMERIC(8,2),

  total_yards           NUMERIC(10,4),
  total_metres          NUMERIC(10,4),
  total_grams           NUMERIC(10,4),
  consumption_unit      TEXT DEFAULT 'yards',

  -- Which components contributed to this total
  component_ids         UUID[],
  piece_breakdown       JSONB,   -- { "Protector Skirt": 2.42, "Fitted Sheet Skirt": 2.18 }

  calculated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (article_id, size_code, material_description)
);

CREATE INDEX idx_bom_set_totals_article ON bom_set_totals(article_id, size_code);

ALTER TABLE bom_set_totals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_set_totals"
  ON bom_set_totals FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 5. tech_pack_construction_specs — raw parsed specs from tech packs
--    Intermediate table between tech pack extraction and article_components
-- ============================================================

CREATE TABLE IF NOT EXISTS tech_pack_construction_specs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tech_pack_id          UUID REFERENCES tech_packs(id) ON DELETE CASCADE,
  article_id            UUID REFERENCES articles(id) ON DELETE SET NULL,

  -- Extracted by Claude from tech pack PDF
  raw_fabric_table      JSONB,    -- raw table rows as extracted
  parsed_components     JSONB,    -- Claude's interpretation mapped to component_types
  size_chart            JSONB,    -- extracted size/dimension table
  construction_notes    TEXT,     -- any free-text construction details
  set_composition       JSONB,    -- { pieces: ["Protector","Fitted Sheet","Pillow Case×2"] }

  extraction_confidence NUMERIC(4,3),
  extraction_model      TEXT DEFAULT 'claude-sonnet-4-5',
  extracted_at          TIMESTAMPTZ DEFAULT NOW(),
  reviewed              BOOLEAN DEFAULT false,
  review_notes          TEXT
);

CREATE INDEX idx_tp_specs_tech_pack ON tech_pack_construction_specs(tech_pack_id);
CREATE INDEX idx_tp_specs_article   ON tech_pack_construction_specs(article_id);

ALTER TABLE tech_pack_construction_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_tp_specs"
  ON tech_pack_construction_specs FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 6. wastage_memory — historical wastage by material + supplier
--    Written by memory consolidation, read by formula engine
-- ============================================================

CREATE TABLE IF NOT EXISTS wastage_memory (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_description  TEXT,
  composition           TEXT,
  gsm_range_min         NUMERIC(8,2),
  gsm_range_max         NUMERIC(8,2),
  fabric_width_inches   NUMERIC(8,2),
  supplier_name         TEXT,
  buyer_name            TEXT,
  component_type        TEXT,    -- 'skirt' | 'top_panel' etc.

  observed_wastage_pct  NUMERIC(5,2) NOT NULL,
  sample_count          INTEGER DEFAULT 1,
  confidence            NUMERIC(4,3) DEFAULT 0.7,

  source                TEXT DEFAULT 'agent',   -- 'agent' | 'manual' | 'consolidation'
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wastage_memory_material  ON wastage_memory(material_description);
CREATE INDEX idx_wastage_memory_supplier  ON wastage_memory(supplier_name);
CREATE INDEX idx_wastage_memory_component ON wastage_memory(component_type);

ALTER TABLE wastage_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_wastage"
  ON wastage_memory FOR ALL
  USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE article_components IS
  'Sub-component fabric breakdown per article. One row per fabric zone. '
  'Supports multi-piece sets (protector + fitted sheet + pillowcase) via set_piece_name. '
  'Drives the BOM consumption formula engine.';

COMMENT ON TABLE bom_results IS
  'Calculated fabric consumption per component per size. '
  'Written by bom-calculator edge function. Shows full calculation workings.';

COMMENT ON TABLE bom_set_totals IS
  'Aggregated BOM across all pieces in a set, grouped by material. '
  'Used for fabric ordering and costing sheet population.';

COMMENT ON TABLE wastage_memory IS
  'Historical wastage percentages by material type and supplier. '
  'Fed by agent corrections; used by formula engine to override defaults.';
