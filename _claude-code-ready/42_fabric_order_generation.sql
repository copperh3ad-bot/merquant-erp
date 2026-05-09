-- Migration: 42_fabric_order_generation
-- Auto-generates fabric orders from po_fabric_requirements
-- Routes to in-house facilities or external suppliers based on capability
-- All generated orders land as drafts for Merchandiser review
-- Additive only — extends existing fabric_orders table minimally

-- ============================================================
-- 1. facility_capabilities
--    Defines what each in-house facility can produce and at what capacity
--    The routing engine checks this FIRST before going external
-- ============================================================

CREATE TABLE IF NOT EXISTS facility_capabilities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Facility identity
  facility_name         TEXT NOT NULL,    -- e.g. 'Weaving Unit A', 'Knitting Dept', 'Dyeing Plant'
  facility_type         TEXT NOT NULL
                        CHECK (facility_type IN (
                          'weaving',        -- woven fabrics
                          'knitting',       -- knit fabrics (jersey, terry, fleece)
                          'dyeing',         -- fabric dyeing / printing
                          'finishing',      -- calendering, laminating, coating
                          'cutting',        -- cutting room
                          'stitching',      -- sewing / assembly
                          'embroidery',
                          'printing',
                          'washing',
                          'other'
                        )),
  location              TEXT,             -- physical location / building
  contact_person        TEXT,
  contact_email         TEXT,

  -- What this facility can produce (keyword matching against material_description)
  -- Array of keywords: if material_description contains any of these → can produce
  capable_materials     TEXT[] DEFAULT '{}',
  -- e.g. ['microfibre','polyester','brushed poly','100% polyester']

  -- Component types this facility handles
  capable_component_types TEXT[] DEFAULT '{}',
  -- e.g. ['top_panel','skirt','reverse'] for a weaving unit
  -- or ['fill'] for a batting/wadding facility

  -- Capacity
  weekly_capacity_metres    NUMERIC(12,2),
  weekly_capacity_kg        NUMERIC(12,2),
  capacity_unit             TEXT DEFAULT 'metres'
                            CHECK (capacity_unit IN ('metres','kg','yards','pieces')),

  -- Lead time from order to ready (working days)
  lead_time_days            INTEGER DEFAULT 14,

  -- Minimum order quantities
  moq_metres                NUMERIC(10,2),
  moq_kg                    NUMERIC(10,2),

  -- Cost rates (for internal costing)
  cost_per_metre            NUMERIC(10,4),
  cost_per_kg               NUMERIC(10,4),
  currency                  TEXT DEFAULT 'USD',

  -- Status
  is_active                 BOOLEAN DEFAULT true,
  notes                     TEXT,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_facility_cap_type     ON facility_capabilities(facility_type);
CREATE INDEX idx_facility_cap_active   ON facility_capabilities(is_active) WHERE is_active = true;
CREATE INDEX idx_facility_cap_materials ON facility_capabilities USING gin(capable_materials);

ALTER TABLE facility_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_facilities"
  ON facility_capabilities FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 2. fabric_order_drafts
--    Staging table for all auto-generated fabric orders
--    Merchandiser reviews and confirms before they become fabric_orders
-- ============================================================

CREATE TABLE IF NOT EXISTS fabric_order_drafts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source traceability
  po_id                   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  requirement_id          UUID REFERENCES po_fabric_requirements(id) ON DELETE SET NULL,

  -- Fulfillment routing
  fulfillment_type        TEXT NOT NULL
                          CHECK (fulfillment_type IN (
                            'inhouse',      -- routed to own facility
                            'outsourced',   -- routed to external mill/supplier
                            'processing',   -- buy greige + send for processing
                            'split'         -- partial inhouse + partial outsourced
                          )),

  -- Facility (for inhouse orders)
  facility_id             UUID REFERENCES facility_capabilities(id) ON DELETE SET NULL,
  facility_name           TEXT,

  -- Supplier (for outsourced orders)
  supplier_id             UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name           TEXT,

  -- What to order
  material_description    TEXT NOT NULL,
  composition             TEXT,
  gsm                     NUMERIC(8,2),
  fabric_width_inches     NUMERIC(8,2),
  colour_code             TEXT,
  colour_description      TEXT,

  -- Quantities — BOTH units always populated
  quantity_yards          NUMERIC(12,4),
  quantity_metres         NUMERIC(12,4),
  quantity_kg             NUMERIC(10,4),

  -- Which unit is primary for this specific order
  primary_unit            TEXT NOT NULL DEFAULT 'metres'
                          CHECK (primary_unit IN ('yards','metres','kg')),

  -- Net vs with-buffer quantities
  quantity_net_yards      NUMERIC(12,4),   -- from po_fabric_requirements
  quantity_net_metres     NUMERIC(12,4),
  buffer_pct_applied      NUMERIC(5,2),

  -- Pricing (filled by Merchandiser before confirming)
  unit_price              NUMERIC(10,4),
  price_unit              TEXT,            -- 'per_metre','per_yard','per_kg'
  total_amount            NUMERIC(14,4),
  currency                TEXT DEFAULT 'USD',

  -- Dates
  required_by_date        DATE,            -- derived from PO delivery date - lead time
  order_date              DATE,

  -- Split order details (when fulfillment_type = 'split')
  split_inhouse_metres    NUMERIC(12,4),
  split_outsourced_metres NUMERIC(12,4),
  split_facility_id       UUID REFERENCES facility_capabilities(id) ON DELETE SET NULL,
  split_supplier_id       UUID REFERENCES suppliers(id) ON DELETE SET NULL,

  -- Routing rationale (shown to Merchandiser so they understand why this routing)
  routing_reason          TEXT,
  -- e.g. "In-house knitting unit capable — capacity available"
  -- or   "No in-house capability for TPU laminate — routing to external supplier"
  -- or   "In-house capacity: 800m/week, requirement: 1,200m — split 800 inhouse + 400 external"

  -- Review workflow
  status                  TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN (
                            'draft',          -- auto-generated, awaiting review
                            'reviewed',       -- Merchandiser has reviewed
                            'confirmed',      -- confirmed → creates fabric_order
                            'rejected',       -- Merchandiser rejected / will handle manually
                            'split_confirmed' -- split order confirmed
                          )),

  reviewed_by             UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  confirmed_by            UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  confirmed_at            TIMESTAMPTZ,
  rejection_reason        TEXT,

  -- Link to created fabric_order (set on confirmation)
  fabric_order_id         UUID REFERENCES fabric_orders(id) ON DELETE SET NULL,

  -- Agent metadata
  generated_by            TEXT DEFAULT 'fabric-order-generator',
  generation_notes        TEXT,

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fabric_drafts_po       ON fabric_order_drafts(po_id);
CREATE INDEX idx_fabric_drafts_status   ON fabric_order_drafts(status);
CREATE INDEX idx_fabric_drafts_type     ON fabric_order_drafts(fulfillment_type);
CREATE INDEX idx_fabric_drafts_facility ON fabric_order_drafts(facility_id);
CREATE INDEX idx_fabric_drafts_supplier ON fabric_order_drafts(supplier_id);
CREATE INDEX idx_fabric_drafts_created  ON fabric_order_drafts(created_at DESC);

CREATE OR REPLACE FUNCTION update_fabric_order_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fabric_order_drafts_updated_at
  BEFORE UPDATE ON fabric_order_drafts
  FOR EACH ROW EXECUTE FUNCTION update_fabric_order_drafts_updated_at();

ALTER TABLE fabric_order_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners_managers_all_drafts"
  ON fabric_order_drafts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner','Manager')
    )
  );

CREATE POLICY "merchandisers_read_update"
  ON fabric_order_drafts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Merchandiser'
    )
  );

CREATE POLICY "merchandisers_update_drafts"
  ON fabric_order_drafts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner','Manager','Merchandiser')
    )
  );

-- ============================================================
-- 3. Extend fabric_orders — minimal additive changes
--    Add traceability columns linking back to source PO/requirement
-- ============================================================

ALTER TABLE fabric_orders
  ADD COLUMN IF NOT EXISTS fulfillment_type    TEXT DEFAULT 'outsourced'
    CHECK (fulfillment_type IN ('inhouse','outsourced','processing','split')),
  ADD COLUMN IF NOT EXISTS facility_id         UUID REFERENCES facility_capabilities(id)
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_po_id        UUID REFERENCES purchase_orders(id)
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_requirement_id UUID REFERENCES po_fabric_requirements(id)
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_draft_id     UUID REFERENCES fabric_order_drafts(id)
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity_yards      NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS quantity_metres     NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS quantity_kg         NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS primary_unit        TEXT DEFAULT 'metres'
    CHECK (primary_unit IN ('yards','metres','kg')),
  ADD COLUMN IF NOT EXISTS routing_reason      TEXT;

CREATE INDEX IF NOT EXISTS idx_fabric_orders_po
  ON fabric_orders(source_po_id) WHERE source_po_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fabric_orders_facility
  ON fabric_orders(facility_id) WHERE facility_id IS NOT NULL;

-- ============================================================
-- 4. RPC: match_facility_for_material
--    Core routing logic — find best in-house facility for a material
--    Returns NULL if no capable facility found → route external
-- ============================================================

CREATE OR REPLACE FUNCTION match_facility_for_material(
  p_material_description TEXT,
  p_component_type       TEXT DEFAULT NULL,
  p_quantity_metres      NUMERIC DEFAULT 0
)
RETURNS TABLE (
  facility_id           UUID,
  facility_name         TEXT,
  facility_type         TEXT,
  available_capacity_m  NUMERIC,
  lead_time_days        INTEGER,
  cost_per_metre        NUMERIC,
  match_reason          TEXT,
  can_fulfill_fully     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_material_lower TEXT := LOWER(p_material_description);
BEGIN
  RETURN QUERY
  SELECT
    fc.id                               AS facility_id,
    fc.facility_name,
    fc.facility_type,
    fc.weekly_capacity_metres           AS available_capacity_m,
    fc.lead_time_days,
    fc.cost_per_metre,
    CASE
      WHEN p_component_type IS NOT NULL
        AND fc.capable_component_types @> ARRAY[p_component_type]
        THEN 'Component type match: ' || p_component_type
      WHEN EXISTS (
        SELECT 1 FROM unnest(fc.capable_materials) AS m
        WHERE v_material_lower LIKE '%' || LOWER(m) || '%'
      ) THEN 'Material keyword match'
      ELSE 'General capability'
    END                                 AS match_reason,
    COALESCE(fc.weekly_capacity_metres, 0) >= p_quantity_metres
                                        AS can_fulfill_fully
  FROM facility_capabilities fc
  WHERE
    fc.is_active = true
    AND (
      -- Component type match (highest priority)
      (p_component_type IS NOT NULL
        AND fc.capable_component_types @> ARRAY[p_component_type])
      OR
      -- Material keyword match
      EXISTS (
        SELECT 1 FROM unnest(fc.capable_materials) AS m
        WHERE v_material_lower LIKE '%' || LOWER(m) || '%'
      )
    )
  ORDER BY
    -- Prefer component-type matches over material matches
    CASE WHEN fc.capable_component_types @> ARRAY[COALESCE(p_component_type,'')]
         THEN 0 ELSE 1 END,
    -- Prefer facilities that can fully fulfill
    CASE WHEN fc.weekly_capacity_metres >= p_quantity_metres THEN 0 ELSE 1 END,
    fc.lead_time_days ASC
  LIMIT 1;
END;
$$;

-- ============================================================
-- 5. Seed example facilities (edit to match your actual setup)
-- ============================================================

INSERT INTO facility_capabilities
  (facility_name, facility_type, capable_materials, capable_component_types,
   weekly_capacity_metres, weekly_capacity_kg, lead_time_days,
   moq_metres, cost_per_metre, currency, notes)
VALUES
  (
    'Knitting Unit',
    'knitting',
    ARRAY['polyester','brushed poly','microfibre','jersey','fleece','terry',
          'interlock','single jersey'],
    ARRAY['skirt','reverse','top_panel'],
    5000, 3000, 7,
    100, 0.85, 'USD',
    'Main knitting department — circular and flat bed knitting machines'
  ),
  (
    'Dyeing & Finishing Plant',
    'finishing',
    ARRAY['polyester','cotton','blended','microfibre','brushed'],
    ARRAY['top_panel','skirt','reverse','flat_panel'],
    8000, NULL, 5,
    200, 0.40, 'USD',
    'Piece dyeing, reactive and disperse dyes. Also handles calendering and brushing.'
  ),
  (
    'Wadding / Batting Unit',
    'other',
    ARRAY['polyester fill','batting','wadding','3d spacer','hollow fibre',
          'siliconized fibre'],
    ARRAY['fill'],
    3000, 2000, 5,
    50, 0.65, 'USD',
    'In-house batting production — bonded, through-air, and needle-punch'
  )
ON CONFLICT DO NOTHING;

COMMENT ON TABLE facility_capabilities IS
  'In-house production facility profiles with capability and capacity data. '
  'Used by fabric order routing engine to decide inhouse vs outsourced fulfillment.';

COMMENT ON TABLE fabric_order_drafts IS
  'Auto-generated fabric order drafts from po_fabric_requirements. '
  'Routing is capacity-first: in-house if capable, external if not, split if partial. '
  'All start as draft status requiring Merchandiser review before confirmation.';
