-- Migration: 39_thread_consumption_schema
-- Thread consumption tracking for bedding manufacturing
-- Additive only — zero changes to existing tables
-- Seam lengths auto-derived from article_components dimensions

-- ============================================================
-- 1. stitch_library — reference table for all stitch types
--    ISO 4915 stitch classifications with thread ratios
-- ============================================================

CREATE TABLE IF NOT EXISTS stitch_library (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_code              TEXT NOT NULL UNIQUE,   -- e.g. '301', '504', '516', '605'
  common_name           TEXT NOT NULL,          -- e.g. 'Lockstitch', 'Safety Stitch'
  thread_count          INTEGER NOT NULL,       -- number of thread spools/cones needed
  thread_ratio          NUMERIC(6,3) NOT NULL,  -- thread consumed per inch of seam
                                                -- (thread_length = seam_length × ratio)
  ratio_basis           TEXT,                   -- explanation of ratio derivation
  typical_spi_min       INTEGER DEFAULT 8,
  typical_spi_max       INTEGER DEFAULT 12,
  typical_use           TEXT,                   -- where this stitch is used in bedding
  is_active             BOOLEAN DEFAULT true
);

-- Seed with all relevant stitch types for bedding manufacturing
INSERT INTO stitch_library
  (iso_code, common_name, thread_count, thread_ratio, ratio_basis,
   typical_spi_min, typical_spi_max, typical_use)
VALUES
  -- Two-thread stitches
  ('101', 'Single Thread Chain Stitch',   1,  3.0,
   '1 needle thread loops: ~3× seam length',
   8, 10, 'Temporary basting, button attachment'),

  ('301', 'Lockstitch',                   2,  2.5,
   'Top thread: ~1.4× + bobbin: ~1.1× = ~2.5× seam length',
   10, 12, 'Label attachment, general seaming, elastic casing'),

  ('401', 'Two-Thread Chain Stitch',      2,  5.0,
   'Needle thread ~1.5× + looper thread ~3.5× = ~5× seam length',
   8, 12, 'General seaming where bobbin is impractical'),

  ('401x2', '2-Needle Chain Stitch',      4,  10.0,
   '2 needle threads (3×each) + 2 loopers (2×each) = ~10× seam length',
   8, 10, 'Skirt top edge, waistband-style seams'),

  ('301x2', 'Twin Needle Lockstitch',     4,  5.0,
   '2× lockstitch side by side = ~5× seam length',
   10, 12, 'Decorative top-stitching, reinforced seams'),

  -- Overedge stitches (serging)
  ('504', '3-Thread Overlock / Serge',    3,  15.0,
   'Needle ~1.5× + upper looper ~7× + lower looper ~6.5× = ~15× per seam inch',
   10, 14, 'Raw edge finishing on skirt bottom, panel edges'),

  ('505', '2-Thread Overedge',            2,  10.0,
   'Needle ~2.5× + looper ~7.5× = ~10× seam length',
   10, 12, 'Lightweight edge finishing'),

  ('514', '4-Thread Overlock',            4,  20.0,
   '2 needles + 2 loopers ≈ 20× seam length',
   10, 14, 'Stronger edge finish on heavier fabrics'),

  -- Safety stitches (overedge + chainstitch combined)
  ('516', '4-Thread Safety Stitch',       4,  19.0,
   '3-thread overlock (15×) + chain seam (4×) running together = ~19× seam length',
   10, 12, 'Primary seam joining skirt to top panel on protectors'),

  ('519', '5-Thread Safety Stitch',       5,  23.0,
   '3-thread overlock + 2-needle chain = ~23× seam length',
   10, 12, 'Heavy-duty seam for high-stress joins'),

  -- Cover / Flatlock stitches
  ('602', '3-Thread Flatlock',            3,  16.0,
   'Needle ~2× + 2 loopers ~7× each = ~16× seam length',
   10, 14, 'Flat joining seam on pillow panels'),

  ('605', '5-Thread Cover Stitch (Flatseam)', 5, 22.0,
   '2 needles + 3 loopers = ~22× seam length; flat on both sides',
   10, 14, 'Top panel joins on mattress protectors, sportswear-style flat seam'),

  ('607', '6-Thread Flatlock',            6,  26.0,
   '3 needles + 3 loopers = ~26× seam length',
   10, 12, 'Widest cover stitch, decorative flat seam'),

  -- Single-thread blind stitches
  ('103', 'Single-Thread Blindstitch',    1,  2.0,
   '1 thread catches fabric fold: ~2× seam length',
   6, 10, 'Invisible hem on flat sheets, duvet covers'),

  ('304', 'Zigzag Lockstitch',            2,  3.5,
   'Wider stitch path ≈ 3.5× seam length',
   8, 12, 'Elastic attachment, stretch seams')

ON CONFLICT (iso_code) DO NOTHING;

-- ============================================================
-- 2. article_seams — seam definitions per article
--    Seam lengths auto-derived from linked component dimensions
-- ============================================================

CREATE TABLE IF NOT EXISTS article_seams (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id            UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  -- Seam identity
  seam_name             TEXT NOT NULL,
  -- e.g. 'Top Panel + Skirt Join', 'Skirt Hem', 'Elastic Casing', 'Label'
  seam_description      TEXT,
  display_order         INTEGER DEFAULT 1,

  -- Stitch specification
  stitch_iso_code       TEXT NOT NULL REFERENCES stitch_library(iso_code),
  spi                   INTEGER NOT NULL DEFAULT 10
                        CHECK (spi BETWEEN 4 AND 24),
  -- Which threads: array of { thread_number: 1, colour: 'Ecru', ticket: '120/2' }
  threads               JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- thread_number = position in stitch (1=needle, 2=looper etc.)
  -- colour = thread colour name or code
  -- ticket = thread weight e.g. '120/2', '80/3', '40/2'

  -- Seam length source — how to compute seam_length_inches per size
  length_source         TEXT NOT NULL DEFAULT 'derived'
                        CHECK (length_source IN (
                          'derived',  -- auto-calculated from linked component(s)
                          'manual',   -- fixed length, size-agnostic
                          'formula'   -- custom formula string
                        )),

  -- For derived lengths: which dimension of which component
  derived_from_component_id UUID REFERENCES article_components(id) ON DELETE SET NULL,
  derived_dimension     TEXT
                        CHECK (derived_dimension IN (
                          'perimeter',      -- 2×(L+W) of the size spec
                          'length',         -- L only
                          'width',          -- W only
                          'skirt_depth',    -- skirt_depth × occurrence_count
                          'skirt_perimeter',-- perimeter for skirt seam (same as perimeter_skirt formula)
                          'seam_count'      -- fixed count × a dimension
                        )),
  derived_multiplier    NUMERIC(6,3) DEFAULT 1.0,
  -- e.g. 4 corner seams: derived_dimension=skirt_depth, derived_multiplier=4
  derived_add_inches    NUMERIC(6,3) DEFAULT 0,
  -- extra inches added after derivation (e.g. tie-off allowance)

  -- For manual lengths: fixed value regardless of size
  manual_length_inches  NUMERIC(8,2),

  -- For set pieces
  set_piece_name        TEXT,

  -- Wastage
  wastage_pct           NUMERIC(5,2) DEFAULT 5.0,
  -- Thread wastage: accounts for tie-offs, tension, run-outs

  -- Source tracking
  source                TEXT DEFAULT 'manual'
                        CHECK (source IN ('manual', 'tech_pack', 'agent')),

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_article_seams_article   ON article_seams(article_id);
CREATE INDEX idx_article_seams_stitch    ON article_seams(stitch_iso_code);
CREATE INDEX idx_article_seams_component ON article_seams(derived_from_component_id);

CREATE OR REPLACE FUNCTION update_article_seams_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_article_seams_updated_at
  BEFORE UPDATE ON article_seams
  FOR EACH ROW EXECUTE FUNCTION update_article_seams_updated_at();

ALTER TABLE article_seams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_seams"
  ON article_seams FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 3. thread_bom_results — calculated thread consumption per seam per size
-- ============================================================

CREATE TABLE IF NOT EXISTS thread_bom_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id            UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  seam_id               UUID NOT NULL REFERENCES article_seams(id) ON DELETE CASCADE,
  size_code             TEXT NOT NULL,
  size_label            TEXT,

  -- Seam geometry (derived at calculation time)
  seam_length_inches    NUMERIC(10,4),
  total_stitches        NUMERIC(12,2),    -- seam_length × SPI

  -- Per-thread consumption (one entry per thread in the stitch)
  thread_consumption    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Array: [
  --   { thread_number: 1, colour: "Ecru", ticket: "120/2",
  --     metres_per_piece: 12.4, with_wastage_metres: 13.0 },
  --   { thread_number: 2, colour: "Ecru", ticket: "120/2",
  --     metres_per_piece: 8.6, with_wastage_metres: 9.0 }
  -- ]

  -- Calculation audit
  calculation_steps     JSONB,
  formula_used          TEXT,
  inputs_snapshot       JSONB,

  calculated_at         TIMESTAMPTZ DEFAULT NOW(),
  calculated_by         TEXT DEFAULT 'system',

  UNIQUE (article_id, seam_id, size_code)
);

CREATE INDEX idx_thread_bom_article ON thread_bom_results(article_id);
CREATE INDEX idx_thread_bom_seam    ON thread_bom_results(seam_id);
CREATE INDEX idx_thread_bom_size    ON thread_bom_results(size_code);

ALTER TABLE thread_bom_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_thread_bom"
  ON thread_bom_results FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 4. thread_bom_totals — aggregated thread by colour+ticket per size
--    Groups all seams, consolidates same colour+ticket across seams and pieces
-- ============================================================

CREATE TABLE IF NOT EXISTS thread_bom_totals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id            UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  size_code             TEXT NOT NULL,

  -- Thread identity (the grouping key)
  thread_colour         TEXT NOT NULL,
  thread_ticket         TEXT NOT NULL,   -- weight e.g. '120/2', '80/3'

  -- Totals
  total_metres_per_piece    NUMERIC(10,4) NOT NULL,
  total_metres_with_wastage NUMERIC(10,4) NOT NULL,
  total_metres_per_dozen    NUMERIC(10,4),  -- × 12

  -- Which seams contributed
  seam_ids              UUID[],
  seam_breakdown        JSONB,
  -- { "Top Panel + Skirt Join (needle)": 12.4, "Skirt Hem (looper)": 3.2 }

  calculated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (article_id, size_code, thread_colour, thread_ticket)
);

CREATE INDEX idx_thread_totals_article ON thread_bom_totals(article_id, size_code);

ALTER TABLE thread_bom_totals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_all_thread_totals"
  ON thread_bom_totals FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 5. Extend bom_calculator edge function trigger
--    When bom_results are written, also trigger thread calculation
--    via agent_events (non-blocking)
-- ============================================================

-- Note: thread calculation is called from bom-calculator edge function
-- after fabric BOM is complete. No separate DB trigger needed.
-- The bom-calculator handles both fabric + thread in one call.

COMMENT ON TABLE stitch_library IS
  'ISO 4915 stitch type reference with thread ratios. '
  'thread_ratio = thread consumed per linear inch of seam. '
  'actual_thread_metres = seam_length_inches × (1/39.37) × SPI × (thread_ratio/SPI) × threads_per_stitch.';

COMMENT ON TABLE article_seams IS
  'Seam definitions per article. Seam lengths auto-derived from '
  'linked article_components dimensions (perimeter, depth etc.). '
  'thread consumption = seam_length × SPI × (thread_ratio / SPI) per thread position.';

COMMENT ON TABLE thread_bom_results IS
  'Calculated thread consumption per seam per size. '
  'metres_per_piece includes all tie-offs and wastage allowance.';

COMMENT ON TABLE thread_bom_totals IS
  'Aggregated thread consumption grouped by colour + ticket across all seams. '
  'Primary output for thread ordering and costing.';
