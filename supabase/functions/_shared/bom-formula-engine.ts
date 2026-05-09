/**
 * bom-formula-engine.ts
 * Pure deterministic consumption formula engine for bedding products.
 * No AI involved — all arithmetic is explicit and auditable.
 * Place at: supabase/functions/_shared/bom-formula-engine.ts
 *
 * Formulas verified against industry standards for:
 *   - Mattress protectors (perimeter skirt)
 *   - Fitted sheets (perimeter skirt)
 *   - Flat sheets (flat panel)
 *   - Pillowcases (flat panel with overlap/envelope)
 *   - Duvet covers (flat panel × 2 sides)
 *   - Fill/batting (area × gsm weight)
 *   - Elastic/binding (linear trim)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SizeSpec {
  size_code:      string;
  size_label:     string;
  length_inches:  number;
  width_inches:   number;
  depth_inches?:  number | null;   // mattress depth for skirt calc
}

export interface ComponentSpec {
  id:                    string;
  component_type:        string;
  component_name:        string;
  formula_type:          string;
  fabric_width_inches:   number;
  gsm?:                  number | null;
  seam_allowance_inches: number;
  hem_allowance_inches:  number;
  skirt_depth_inches?:   number | null;
  wastage_pct:           number;
  shrinkage_pct:         number;
  overlap_inches:        number;
  size_overrides?:       Record<string, Record<string, number>>;
  set_piece_name?:       string | null;
}

export interface BOMCalculationResult {
  component_id:       string;
  component_name:     string;
  component_type:     string;
  size_code:          string;
  size_label:         string;
  consumption_yards:  number;
  consumption_metres: number;
  consumption_grams:  number | null;
  consumption_unit:   string;
  formula_used:       string;
  calculation_steps:  CalculationStep[];
  inputs_snapshot:    Record<string, number | string | null>;
  error?:             string;
}

export interface CalculationStep {
  step:        string;
  description: string;
  value:       number;
  unit:        string;
}

// ---------------------------------------------------------------------------
// Unit conversion constants
// ---------------------------------------------------------------------------

const INCHES_PER_YARD   = 36;
const INCHES_PER_METRE  = 39.3701;
const SQ_IN_PER_SQ_METRE = INCHES_PER_METRE * INCHES_PER_METRE;

function inchesToYards(inches: number): number {
  return round4(inches / INCHES_PER_YARD);
}

function inchesToMetres(inches: number): number {
  return round4(inches / INCHES_PER_METRE);
}

function yardsToMetres(yards: number): number {
  return round4(yards * 0.9144);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Apply size overrides to component spec
// ---------------------------------------------------------------------------

function applyOverrides(
  comp: ComponentSpec,
  sizeCode: string
): ComponentSpec {
  const overrides = comp.size_overrides?.[sizeCode];
  if (!overrides) return comp;
  return { ...comp, ...overrides };
}

// ---------------------------------------------------------------------------
// FORMULA 1: Perimeter Skirt
// Full 4-side skirt running around the mattress perimeter
// Used for: mattress protector skirt, fitted sheet skirt/drop
//
// Formula:
//   effective_skirt_depth = skirt_depth + seam_top + hem_bottom
//   perimeter = 2 × (length + seam) + 2 × (width + seam)
//   raw_area_sq_inches = perimeter × effective_skirt_depth
//   add_shrinkage = raw_area × (1 + shrinkage% / 100)
//   add_wastage = after_shrinkage × (1 + wastage% / 100)
//   linear_inches = add_wastage / fabric_width_inches
//   yards = linear_inches / 36
// ---------------------------------------------------------------------------

function calculatePerimeterSkirt(
  comp: ComponentSpec,
  size: SizeSpec
): BOMCalculationResult {
  const steps: CalculationStep[] = [];

  // Resolve skirt depth (size override possible)
  const effectiveComp = applyOverrides(comp, size.size_code);
  const skirtDepth    = effectiveComp.skirt_depth_inches ?? 14;
  const seam          = effectiveComp.seam_allowance_inches;
  const hem           = effectiveComp.hem_allowance_inches;
  const wastage       = effectiveComp.wastage_pct;
  const shrinkage     = effectiveComp.shrinkage_pct;
  const fabricWidth   = effectiveComp.fabric_width_inches;

  // Step 1: Effective skirt height (cut height)
  const cutHeight = skirtDepth + seam + hem;
  steps.push({
    step: "1",
    description: `Cut height = skirt_depth(${skirtDepth}") + seam(${seam}") + hem(${hem}")`,
    value: round2(cutHeight),
    unit: "inches",
  });

  // Step 2: Perimeter calculation
  // Each corner is shared — standard method adds one seam per side = 4 seams
  const length   = size.length_inches;
  const width    = size.width_inches;
  const perimeter = 2 * (length + seam) + 2 * (width + seam);
  steps.push({
    step: "2",
    description: `Perimeter = 2×(L${length}" + seam) + 2×(W${width}" + seam)`,
    value: round2(perimeter),
    unit: "inches",
  });

  // Step 3: Raw fabric area
  const rawArea = perimeter * cutHeight;
  steps.push({
    step: "3",
    description: `Raw area = perimeter(${round2(perimeter)}") × cut_height(${round2(cutHeight)}")`,
    value: round2(rawArea),
    unit: "sq inches",
  });

  // Step 4: Add shrinkage
  const afterShrinkage = rawArea * (1 + shrinkage / 100);
  steps.push({
    step: "4",
    description: `After shrinkage (+${shrinkage}%) = ${round2(rawArea)} × ${1 + shrinkage / 100}`,
    value: round2(afterShrinkage),
    unit: "sq inches",
  });

  // Step 5: Add wastage/cutting loss
  const afterWastage = afterShrinkage * (1 + wastage / 100);
  steps.push({
    step: "5",
    description: `After wastage (+${wastage}%) = ${round2(afterShrinkage)} × ${1 + wastage / 100}`,
    value: round2(afterWastage),
    unit: "sq inches",
  });

  // Step 6: Linear fabric needed at given width
  const linearInches = afterWastage / fabricWidth;
  steps.push({
    step: "6",
    description: `Linear inches = area(${round2(afterWastage)} sq") ÷ fabric_width(${fabricWidth}")`,
    value: round2(linearInches),
    unit: "linear inches",
  });

  // Step 7: Convert to yards
  const yards = inchesToYards(linearInches);
  steps.push({
    step: "7",
    description: `Yards = ${round2(linearInches)}" ÷ 36`,
    value: yards,
    unit: "yards",
  });

  const formulaStr =
    `Perimeter Skirt: [2×(L+seam)+2×(W+seam)] × [depth+seam+hem] × (1+shrink%) × (1+waste%) ÷ width ÷ 36`;

  return {
    component_id:       comp.id,
    component_name:     comp.component_name,
    component_type:     comp.component_type,
    size_code:          size.size_code,
    size_label:         size.size_label,
    consumption_yards:  yards,
    consumption_metres: yardsToMetres(yards),
    consumption_grams:  null,
    consumption_unit:   "yards",
    formula_used:       formulaStr,
    calculation_steps:  steps,
    inputs_snapshot: {
      length_inches:         size.length_inches,
      width_inches:          size.width_inches,
      skirt_depth_inches:    skirtDepth,
      seam_allowance_inches: seam,
      hem_allowance_inches:  hem,
      wastage_pct:           wastage,
      shrinkage_pct:         shrinkage,
      fabric_width_inches:   fabricWidth,
    },
  };
}

// ---------------------------------------------------------------------------
// FORMULA 2: Flat Panel
// For top panels, reverse panels, flat sheets, pillowcase fronts/backs
//
// Formula:
//   cut_length = finished_length + (2 × seam) + shrinkage_allowance
//   cut_width  = finished_width  + (2 × seam)
//   if cut_width > fabric_width → panels needed = ceil(cut_width / fabric_width)
//   linear_inches = cut_length × panels_needed × (1 + wastage%)
//   yards = linear_inches / 36
// ---------------------------------------------------------------------------

function calculateFlatPanel(
  comp: ComponentSpec,
  size: SizeSpec
): BOMCalculationResult {
  const steps: CalculationStep[] = [];

  const effectiveComp = applyOverrides(comp, size.size_code);
  const seam        = effectiveComp.seam_allowance_inches;
  const hem         = effectiveComp.hem_allowance_inches;
  const wastage     = effectiveComp.wastage_pct;
  const shrinkage   = effectiveComp.shrinkage_pct;
  const fabricWidth = effectiveComp.fabric_width_inches;

  // Step 1: Cut length (length + 2 seams + shrinkage)
  const shrinkageInches = size.length_inches * (shrinkage / 100);
  const cutLength = size.length_inches + (2 * seam) + shrinkageInches;
  steps.push({
    step: "1",
    description: `Cut length = L(${size.length_inches}") + 2×seam(${seam}") + shrinkage(${round2(shrinkageInches)}")`,
    value: round2(cutLength),
    unit: "inches",
  });

  // Step 2: Cut width
  const cutWidth = size.width_inches + (2 * seam);
  steps.push({
    step: "2",
    description: `Cut width = W(${size.width_inches}") + 2×seam(${seam}")`,
    value: round2(cutWidth),
    unit: "inches",
  });

  // Step 3: Panels needed (if panel wider than fabric)
  const panelsNeeded = Math.ceil(cutWidth / fabricWidth);
  steps.push({
    step: "3",
    description: `Panels = ceil(cut_width(${round2(cutWidth)}") ÷ fabric_width(${fabricWidth}")) = ${panelsNeeded}`,
    value: panelsNeeded,
    unit: "panels",
  });

  // Step 4: Raw linear inches
  const rawLinear = cutLength * panelsNeeded;
  steps.push({
    step: "4",
    description: `Raw linear = cut_length(${round2(cutLength)}") × ${panelsNeeded} panel(s)`,
    value: round2(rawLinear),
    unit: "linear inches",
  });

  // Step 5: Add wastage
  const afterWastage = rawLinear * (1 + wastage / 100);
  steps.push({
    step: "5",
    description: `After wastage (+${wastage}%) = ${round2(rawLinear)} × ${1 + wastage / 100}`,
    value: round2(afterWastage),
    unit: "linear inches",
  });

  // Step 6: Convert to yards
  const yards = inchesToYards(afterWastage);
  steps.push({
    step: "6",
    description: `Yards = ${round2(afterWastage)}" ÷ 36`,
    value: yards,
    unit: "yards",
  });

  const formulaStr =
    `Flat Panel: (L + 2×seam + shrink) × ceil((W + 2×seam) ÷ fabric_width) × (1+waste%) ÷ 36`;

  return {
    component_id:       comp.id,
    component_name:     comp.component_name,
    component_type:     comp.component_type,
    size_code:          size.size_code,
    size_label:         size.size_label,
    consumption_yards:  yards,
    consumption_metres: yardsToMetres(yards),
    consumption_grams:  null,
    consumption_unit:   "yards",
    formula_used:       formulaStr,
    calculation_steps:  steps,
    inputs_snapshot: {
      length_inches:         size.length_inches,
      width_inches:          size.width_inches,
      seam_allowance_inches: seam,
      hem_allowance_inches:  hem,
      wastage_pct:           wastage,
      shrinkage_pct:         shrinkage,
      fabric_width_inches:   fabricWidth,
    },
  };
}

// ---------------------------------------------------------------------------
// FORMULA 3: Fill Weight
// For batting, wadding, foam inserts
// Output in grams (weight) not yards (length)
//
// Formula:
//   fill_area_sq_metres = (length_inches / 39.37) × (width_inches / 39.37)
//   add_seam_area = (length + 2×seam) × (width + 2×seam)
//   weight_grams = fill_area_sq_metres × gsm × (1 + wastage%)
// ---------------------------------------------------------------------------

function calculateFillWeight(
  comp: ComponentSpec,
  size: SizeSpec
): BOMCalculationResult {
  const steps: CalculationStep[] = [];

  const effectiveComp = applyOverrides(comp, size.size_code);
  const seam    = effectiveComp.seam_allowance_inches;
  const wastage = effectiveComp.wastage_pct;
  const gsm     = effectiveComp.gsm ?? 200;

  // Step 1: Cut dimensions
  const cutLength = size.length_inches + (2 * seam);
  const cutWidth  = size.width_inches  + (2 * seam);
  steps.push({
    step: "1",
    description: `Cut dimensions = (${size.length_inches}+${2*seam})" × (${size.width_inches}+${2*seam})"`,
    value: round2(cutLength * cutWidth),
    unit: "sq inches",
  });

  // Step 2: Convert to sq metres
  const sqMetres = (cutLength / INCHES_PER_METRE) * (cutWidth / INCHES_PER_METRE);
  steps.push({
    step: "2",
    description: `Area in sq metres = ${round2(cutLength)}" × ${round2(cutWidth)}" ÷ ${round2(INCHES_PER_METRE)}²`,
    value: round4(sqMetres),
    unit: "sq metres",
  });

  // Step 3: Weight before wastage
  const rawGrams = sqMetres * gsm;
  steps.push({
    step: "3",
    description: `Raw weight = ${round4(sqMetres)} m² × ${gsm} GSM`,
    value: round2(rawGrams),
    unit: "grams",
  });

  // Step 4: Add wastage
  const finalGrams = rawGrams * (1 + wastage / 100);
  steps.push({
    step: "4",
    description: `After wastage (+${wastage}%) = ${round2(rawGrams)}g × ${1 + wastage / 100}`,
    value: round2(finalGrams),
    unit: "grams",
  });

  const formulaStr =
    `Fill Weight: (L+2×seam) × (W+2×seam) [converted to m²] × GSM × (1+waste%)`;

  return {
    component_id:       comp.id,
    component_name:     comp.component_name,
    component_type:     comp.component_type,
    size_code:          size.size_code,
    size_label:         size.size_label,
    consumption_yards:  0,
    consumption_metres: 0,
    consumption_grams:  round2(finalGrams),
    consumption_unit:   "grams",
    formula_used:       formulaStr,
    calculation_steps:  steps,
    inputs_snapshot: {
      length_inches:         size.length_inches,
      width_inches:          size.width_inches,
      seam_allowance_inches: seam,
      wastage_pct:           wastage,
      gsm:                   gsm,
    },
  };
}

// ---------------------------------------------------------------------------
// FORMULA 4: Trim Length (elastic, binding, piping)
// Linear metres based on perimeter + overlap + wastage
// For full-perimeter elastic on fitted sheets/protectors
// ---------------------------------------------------------------------------

function calculateTrimLength(
  comp: ComponentSpec,
  size: SizeSpec
): BOMCalculationResult {
  const steps: CalculationStep[] = [];

  const effectiveComp = applyOverrides(comp, size.size_code);
  const wastage = effectiveComp.wastage_pct;
  const overlap = effectiveComp.overlap_inches;

  // Perimeter in inches
  const perimeter = 2 * (size.length_inches + size.width_inches);
  steps.push({
    step: "1",
    description: `Perimeter = 2×(L${size.length_inches}" + W${size.width_inches}")`,
    value: round2(perimeter),
    unit: "inches",
  });

  // Add overlap/join
  const withOverlap = perimeter + overlap;
  steps.push({
    step: "2",
    description: `With join overlap (+${overlap}")`,
    value: round2(withOverlap),
    unit: "inches",
  });

  // Add wastage
  const afterWastage = withOverlap * (1 + wastage / 100);
  steps.push({
    step: "3",
    description: `After wastage (+${wastage}%)`,
    value: round2(afterWastage),
    unit: "inches",
  });

  const metres = inchesToMetres(afterWastage);
  const yards  = inchesToYards(afterWastage);
  steps.push({
    step: "4",
    description: `Convert: ${round2(afterWastage)}" = ${metres} metres = ${yards} yards`,
    value: metres,
    unit: "metres",
  });

  const formulaStr = `Trim Length: 2×(L+W) + overlap × (1+waste%)`;

  return {
    component_id:       comp.id,
    component_name:     comp.component_name,
    component_type:     comp.component_type,
    size_code:          size.size_code,
    size_label:         size.size_label,
    consumption_yards:  yards,
    consumption_metres: metres,
    consumption_grams:  null,
    consumption_unit:   "metres",
    formula_used:       formulaStr,
    calculation_steps:  steps,
    inputs_snapshot: {
      length_inches: size.length_inches,
      width_inches:  size.width_inches,
      overlap_inches: overlap,
      wastage_pct:    wastage,
    },
  };
}

// ---------------------------------------------------------------------------
// FORMULA 5: Fixed Quantity (labels, tags, buttons)
// ---------------------------------------------------------------------------

function calculateFixedQuantity(
  comp: ComponentSpec,
  size: SizeSpec
): BOMCalculationResult {
  return {
    component_id:       comp.id,
    component_name:     comp.component_name,
    component_type:     comp.component_type,
    size_code:          size.size_code,
    size_label:         size.size_label,
    consumption_yards:  0,
    consumption_metres: 0,
    consumption_grams:  null,
    consumption_unit:   "pieces",
    formula_used:       "Fixed quantity — 1 per garment",
    calculation_steps: [{
      step: "1", description: "Fixed: 1 per piece", value: 1, unit: "pieces",
    }],
    inputs_snapshot: {},
  };
}

// ---------------------------------------------------------------------------
// Main dispatch function
// Routes each component to its formula based on formula_type
// ---------------------------------------------------------------------------

export function calculateComponentConsumption(
  comp: ComponentSpec,
  size: SizeSpec
): BOMCalculationResult {
  try {
    switch (comp.formula_type) {
      case "perimeter_skirt":
        return calculatePerimeterSkirt(comp, size);
      case "flat_panel":
        return calculateFlatPanel(comp, size);
      case "fill_weight":
        return calculateFillWeight(comp, size);
      case "trim_length":
        return calculateTrimLength(comp, size);
      case "fixed_quantity":
        return calculateFixedQuantity(comp, size);
      case "manual":
        return {
          component_id:       comp.id,
          component_name:     comp.component_name,
          component_type:     comp.component_type,
          size_code:          size.size_code,
          size_label:         size.size_label,
          consumption_yards:  0,
          consumption_metres: 0,
          consumption_grams:  null,
          consumption_unit:   "manual",
          formula_used:       "Manual entry required",
          calculation_steps:  [],
          inputs_snapshot:    {},
        };
      default:
        throw new Error(`Unknown formula_type: ${comp.formula_type}`);
    }
  } catch (err) {
    return {
      component_id:       comp.id,
      component_name:     comp.component_name,
      component_type:     comp.component_type,
      size_code:          size.size_code,
      size_label:         size.size_label,
      consumption_yards:  0,
      consumption_metres: 0,
      consumption_grams:  null,
      consumption_unit:   "error",
      formula_used:       "Error",
      calculation_steps:  [],
      inputs_snapshot:    {},
      error:              err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Set aggregation — consolidates BOM across all components/pieces
// Groups by material_description, summing consumption across all pieces
// ---------------------------------------------------------------------------

export function aggregateSetBOM(
  results: BOMCalculationResult[],
  components: ComponentSpec[]
): Record<string, {
  material_description: string;
  total_yards:          number;
  total_metres:         number;
  total_grams:          number;
  consumption_unit:     string;
  component_ids:        string[];
  piece_breakdown:      Record<string, number>;
}> {
  const compMap = new Map(components.map((c) => [c.id, c]));
  const aggregated: Record<string, ReturnType<typeof aggregateSetBOM>[string]> = {};

  for (const result of results) {
    if (result.error) continue;

    const comp = compMap.get(result.component_id);
    const key  = comp?.material_description ?? result.component_name;

    if (!aggregated[key]) {
      aggregated[key] = {
        material_description: key,
        total_yards:          0,
        total_metres:         0,
        total_grams:          0,
        consumption_unit:     result.consumption_unit,
        component_ids:        [],
        piece_breakdown:      {},
      };
    }

    aggregated[key].total_yards   += result.consumption_yards;
    aggregated[key].total_metres  += result.consumption_metres;
    aggregated[key].total_grams   += result.consumption_grams ?? 0;
    aggregated[key].component_ids.push(result.component_id);

    const pieceLabel = comp?.set_piece_name
      ? `${comp.set_piece_name} — ${result.component_name}`
      : result.component_name;
    aggregated[key].piece_breakdown[pieceLabel] = result.consumption_yards || result.consumption_metres;
  }

  // Round totals
  for (const key of Object.keys(aggregated)) {
    aggregated[key].total_yards  = round4(aggregated[key].total_yards);
    aggregated[key].total_metres = round4(aggregated[key].total_metres);
    aggregated[key].total_grams  = round4(aggregated[key].total_grams);
  }

  return aggregated;
}

// ---------------------------------------------------------------------------
// Test vectors — run these to validate engine correctness
// ---------------------------------------------------------------------------

export function runEngineTests(): { passed: number; failed: number; results: string[] } {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(label: string, actual: number, expected: number, tolerance = 0.05) {
    const diff = Math.abs(actual - expected);
    if (diff <= tolerance) {
      results.push(`✓ ${label}: ${actual} (expected ~${expected})`);
      passed++;
    } else {
      results.push(`✗ ${label}: got ${actual}, expected ~${expected} (diff: ${round4(diff)})`);
      failed++;
    }
  }

  // Test 1: Queen mattress protector skirt
  // Queen: 60×80", skirt 14", 58" fabric, 8% wastage, 3% shrinkage, 0.5" seam, 1.5" hem
  // Expected: ~2.42 yards
  const queenSkirtComp: ComponentSpec = {
    id: "test-1", component_type: "skirt", component_name: "Skirt",
    formula_type: "perimeter_skirt", fabric_width_inches: 58,
    seam_allowance_inches: 0.5, hem_allowance_inches: 1.5,
    skirt_depth_inches: 14, wastage_pct: 8, shrinkage_pct: 3,
    overlap_inches: 0, size_overrides: {},
  };
  const queenSize: SizeSpec = {
    size_code: "Q", size_label: "Queen",
    length_inches: 80, width_inches: 60, depth_inches: 14,
  };
  const r1 = calculatePerimeterSkirt(queenSkirtComp, queenSize);
  assert("Queen protector skirt (yards)", r1.consumption_yards, 2.42, 0.15);

  // Test 2: King skirt (larger perimeter)
  // King: 76×80", same params. Expected: ~2.85 yards
  const kingSize: SizeSpec = {
    size_code: "K", size_label: "King",
    length_inches: 80, width_inches: 76, depth_inches: 14,
  };
  const r2 = calculatePerimeterSkirt(queenSkirtComp, kingSize);
  assert("King protector skirt (yards)", r2.consumption_yards, 2.85, 0.20);

  // Test 3: Queen flat sheet (flat panel)
  // Queen flat: 90×102", 94" fabric, 5% wastage, 2% shrinkage
  // Expected: ~3.0 yards (single panel, no piecing needed)
  const flatSheetComp: ComponentSpec = {
    id: "test-3", component_type: "top_panel", component_name: "Top Panel",
    formula_type: "flat_panel", fabric_width_inches: 94,
    seam_allowance_inches: 1.0, hem_allowance_inches: 2.0,
    wastage_pct: 5, shrinkage_pct: 2,
    overlap_inches: 0, size_overrides: {},
  };
  const flatSheetSize: SizeSpec = {
    size_code: "Q", size_label: "Queen",
    length_inches: 102, width_inches: 90, depth_inches: null,
  };
  const r3 = calculateFlatPanel(flatSheetComp, flatSheetSize);
  assert("Queen flat sheet top panel (yards)", r3.consumption_yards, 3.0, 0.25);

  // Test 4: Fill weight — Queen protector 200GSM fill
  // Queen: 60×80", 200GSM, 5% wastage, 0.5" seam
  // Expected: ~630g per piece
  const fillComp: ComponentSpec = {
    id: "test-4", component_type: "fill", component_name: "Fill",
    formula_type: "fill_weight", fabric_width_inches: 60, gsm: 200,
    seam_allowance_inches: 0.5, hem_allowance_inches: 0,
    wastage_pct: 5, shrinkage_pct: 0, overlap_inches: 0, size_overrides: {},
  };
  const r4 = calculateFillWeight(fillComp, queenSize);
  assert("Queen 200GSM fill weight (grams)", r4.consumption_grams ?? 0, 630, 50);

  // Test 5: Elastic perimeter — Queen protector
  // Queen: 60×80", 2" overlap, 5% wastage
  // Expected: ~7.5 metres elastic
  const elasticComp: ComponentSpec = {
    id: "test-5", component_type: "elastic", component_name: "Elastic",
    formula_type: "trim_length", fabric_width_inches: 1,
    seam_allowance_inches: 0, hem_allowance_inches: 0,
    wastage_pct: 5, shrinkage_pct: 0, overlap_inches: 2, size_overrides: {},
  };
  const r5 = calculateTrimLength(elasticComp, queenSize);
  assert("Queen elastic perimeter (metres)", r5.consumption_metres, 7.5, 0.5);

  return { passed, failed, results };
}
