/**
 * thread-formula-engine.ts
 * Thread consumption calculation engine for bedding manufacturing.
 * Place at: supabase/functions/_shared/thread-formula-engine.ts
 *
 * Formula basis (ISO 4915):
 *   thread_per_stitch  = thread_ratio / SPI
 *   seam_thread_inches = seam_length_inches × SPI × thread_per_stitch
 *   seam_thread_metres = seam_thread_inches / 39.3701
 *   with_wastage       = seam_thread_metres × (1 + wastage% / 100)
 *
 * Seam length derivation:
 *   perimeter       → 2 × (L + W) of the size spec
 *   skirt_perimeter → same as perimeter_skirt fabric formula perimeter
 *   length          → L only
 *   width           → W only
 *   skirt_depth     → derived_multiplier × component.skirt_depth_inches
 *   manual          → fixed manual_length_inches regardless of size
 */

import type { SizeSpec, ComponentSpec } from "./bom-formula-engine.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StitchSpec {
  iso_code:      string;
  common_name:   string;
  thread_count:  number;
  thread_ratio:  number;   // thread consumed per inch of seam (not per stitch)
}

export interface SeamSpec {
  id:                          string;
  seam_name:                   string;
  stitch_iso_code:             string;
  spi:                         number;
  threads:                     ThreadDef[];
  length_source:               string;
  derived_from_component_id?:  string | null;
  derived_dimension?:          string | null;
  derived_multiplier:          number;
  derived_add_inches:          number;
  manual_length_inches?:       number | null;
  wastage_pct:                 number;
  set_piece_name?:             string | null;
}

export interface ThreadDef {
  thread_number: number;
  colour:        string;
  ticket:        string;   // e.g. '120/2', '80/3'
}

export interface ThreadConsumptionResult {
  seam_id:               string;
  seam_name:             string;
  size_code:             string;
  size_label:            string;
  seam_length_inches:    number;
  seam_length_metres:    number;
  total_stitches:        number;
  thread_consumption:    ThreadResult[];
  calculation_steps:     CalcStep[];
  formula_used:          string;
  inputs_snapshot:       Record<string, number | string | null>;
  error?:                string;
}

export interface ThreadResult {
  thread_number:       number;
  colour:              string;
  ticket:              string;
  raw_metres:          number;   // before wastage
  metres_per_piece:    number;   // after wastage
}

export interface ThreadTotalResult {
  thread_colour:              string;
  thread_ticket:              string;
  total_metres_per_piece:     number;
  total_metres_with_wastage:  number;
  total_metres_per_dozen:     number;
  seam_breakdown:             Record<string, number>;
  seam_ids:                   string[];
}

interface CalcStep {
  step:        string;
  description: string;
  value:       number;
  unit:        string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INCHES_PER_METRE = 39.3701;

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------------
// Seam length derivation
-- Given a seam spec + component spec + size spec, calculate seam_length_inches
// ---------------------------------------------------------------------------

export function deriveSeamLength(
  seam:      SeamSpec,
  component: ComponentSpec | null,
  size:      SizeSpec
): { length_inches: number; derivation: string } {

  if (seam.length_source === 'manual') {
    const len = seam.manual_length_inches ?? 0;
    return {
      length_inches: len + seam.derived_add_inches,
      derivation: `Manual: ${len}" + add(${seam.derived_add_inches}")`,
    };
  }

  if (seam.length_source === 'derived' && seam.derived_dimension) {
    const seam_allowance = component?.seam_allowance_inches ?? 0.5;
    const skirt_depth    = component?.skirt_depth_inches ?? 14;
    const mult           = seam.derived_multiplier ?? 1.0;
    const add            = seam.derived_add_inches ?? 0;

    switch (seam.derived_dimension) {

      case 'perimeter': {
        // Full 4-side perimeter of the mattress
        const perim = 2 * (size.length_inches + size.width_inches);
        const total = perim * mult + add;
        return {
          length_inches: round4(total),
          derivation: `Perimeter: 2×(${size.length_inches}+${size.width_inches})×${mult}+${add} = ${round2(total)}"`,
        };
      }

      case 'skirt_perimeter': {
        // Perimeter including seam allowances (matches fabric skirt perimeter calc)
        const perim = 2 * (size.length_inches + seam_allowance) +
                      2 * (size.width_inches  + seam_allowance);
        const total = perim * mult + add;
        return {
          length_inches: round4(total),
          derivation: `Skirt perimeter: 2×(L+seam)+2×(W+seam) = ${round2(perim)}" × ${mult} + ${add}`,
        };
      }

      case 'length': {
        const total = size.length_inches * mult + add;
        return {
          length_inches: round4(total),
          derivation: `Length: ${size.length_inches}" × ${mult} + ${add} = ${round2(total)}"`,
        };
      }

      case 'width': {
        const total = size.width_inches * mult + add;
        return {
          length_inches: round4(total),
          derivation: `Width: ${size.width_inches}" × ${mult} + ${add} = ${round2(total)}"`,
        };
      }

      case 'skirt_depth': {
        // e.g. 4 corner side seams: multiplier=4
        const total = skirt_depth * mult + add;
        return {
          length_inches: round4(total),
          derivation: `Skirt depth: ${skirt_depth}" × ${mult} (${mult === 4 ? '4 corners' : 'sides'}) + ${add} = ${round2(total)}"`,
        };
      }

      default: {
        return {
          length_inches: seam.manual_length_inches ?? 0,
          derivation: `Unknown dimension: ${seam.derived_dimension} — using manual fallback`,
        };
      }
    }
  }

  // Fallback
  return {
    length_inches: seam.manual_length_inches ?? 0,
    derivation:    'Fallback to manual',
  };
}

// ---------------------------------------------------------------------------
// Core thread consumption calculator per seam
// ---------------------------------------------------------------------------

export function calculateSeamThreadConsumption(
  seam:      SeamSpec,
  stitch:    StitchSpec,
  component: ComponentSpec | null,
  size:      SizeSpec
): ThreadConsumptionResult {
  const steps: CalcStep[] = [];

  try {
    // Step 1: Derive seam length
    const { length_inches, derivation } = deriveSeamLength(seam, component, size);
    const length_metres = round4(length_inches / INCHES_PER_METRE);

    steps.push({
      step: "1",
      description: `Seam length: ${derivation}`,
      value: round2(length_inches),
      unit: "inches",
    });
    steps.push({
      step: "1b",
      description: `Seam length in metres: ${length_inches}" ÷ ${INCHES_PER_METRE}`,
      value: length_metres,
      unit: "metres",
    });

    // Step 2: Total stitches
    const total_stitches = round4(length_inches * seam.spi);
    steps.push({
      step: "2",
      description: `Total stitches = ${length_inches}" × ${seam.spi} SPI`,
      value: round2(total_stitches),
      unit: "stitches",
    });

    // Step 3: Thread ratio check
    // thread_ratio is already expressed as "thread length per inch of seam"
    // So: thread_inches_per_seam_inch = thread_ratio (already accounts for SPI)
    // Total thread inches = seam_length_inches × thread_ratio
    // Divide by thread_count to get per-thread consumption
    // (thread_ratio represents total for all threads in stitch)
    const total_thread_inches = length_inches * stitch.thread_ratio;
    const per_thread_inches   = total_thread_inches / stitch.thread_count;

    steps.push({
      step: "3",
      description:
        `Total thread inches = seam(${round2(length_inches)}") × ` +
        `ratio(${stitch.thread_ratio}) = ${round2(total_thread_inches)}"`,
      value: round2(total_thread_inches),
      unit: "inches (all threads combined)",
    });
    steps.push({
      step: "3b",
      description:
        `Per thread = ${round2(total_thread_inches)}" ÷ ${stitch.thread_count} threads`,
      value: round2(per_thread_inches),
      unit: "inches per thread",
    });

    // Step 4: Convert per-thread to metres
    const per_thread_metres = round4(per_thread_inches / INCHES_PER_METRE);
    steps.push({
      step: "4",
      description: `Per thread metres = ${round2(per_thread_inches)}" ÷ ${round4(INCHES_PER_METRE)}`,
      value: per_thread_metres,
      unit: "metres per thread",
    });

    // Step 5: Add wastage per thread
    const wastage = seam.wastage_pct ?? 5;
    const with_wastage = round4(per_thread_metres * (1 + wastage / 100));
    steps.push({
      step: "5",
      description: `After wastage (+${wastage}%) = ${per_thread_metres}m × ${1 + wastage / 100}`,
      value: with_wastage,
      unit: "metres per thread (final)",
    });

    // Build per-thread results
    // Use actual thread definitions; if threads array is empty, create defaults
    const threadDefs: ThreadDef[] = seam.threads.length > 0
      ? seam.threads
      : Array.from({ length: stitch.thread_count }, (_, i) => ({
          thread_number: i + 1,
          colour:        "Unspecified",
          ticket:        "120/2",
        }));

    const thread_consumption: ThreadResult[] = threadDefs.map((td) => ({
      thread_number:    td.thread_number,
      colour:           td.colour,
      ticket:           td.ticket,
      raw_metres:       per_thread_metres,
      metres_per_piece: with_wastage,
    }));

    const formulaStr =
      `Thread: seam_length(${round2(length_inches)}") × ratio(${stitch.thread_ratio}) ÷ ` +
      `threads(${stitch.thread_count}) ÷ 39.37 × (1+${wastage}%)`;

    return {
      seam_id:            seam.id,
      seam_name:          seam.seam_name,
      size_code:          size.size_code,
      size_label:         size.size_label,
      seam_length_inches: round4(length_inches),
      seam_length_metres: length_metres,
      total_stitches:     round2(total_stitches),
      thread_consumption,
      calculation_steps:  steps,
      formula_used:       formulaStr,
      inputs_snapshot: {
        seam_length_inches:  length_inches,
        spi:                 seam.spi,
        thread_ratio:        stitch.thread_ratio,
        thread_count:        stitch.thread_count,
        wastage_pct:         wastage,
        stitch_iso:          stitch.iso_code,
        length_derivation:   derivation,
      },
    };

  } catch (err) {
    return {
      seam_id:            seam.id,
      seam_name:          seam.seam_name,
      size_code:          size.size_code,
      size_label:         size.size_label,
      seam_length_inches: 0,
      seam_length_metres: 0,
      total_stitches:     0,
      thread_consumption: [],
      calculation_steps:  steps,
      formula_used:       "Error",
      inputs_snapshot:    {},
      error:              err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Aggregate thread across all seams → group by colour + ticket
// ---------------------------------------------------------------------------

export function aggregateThreadBOM(
  results: ThreadConsumptionResult[]
): Record<string, ThreadTotalResult> {
  const totals: Record<string, ThreadTotalResult> = {};

  for (const result of results) {
    if (result.error) continue;

    for (const thread of result.thread_consumption) {
      const key = `${thread.colour}__${thread.ticket}`;

      if (!totals[key]) {
        totals[key] = {
          thread_colour:              thread.colour,
          thread_ticket:              thread.ticket,
          total_metres_per_piece:     0,
          total_metres_with_wastage:  0,
          total_metres_per_dozen:     0,
          seam_breakdown:             {},
          seam_ids:                   [],
        };
      }

      totals[key].total_metres_per_piece    += thread.raw_metres;
      totals[key].total_metres_with_wastage += thread.metres_per_piece;
      totals[key].seam_ids.push(result.seam_id);

      const seamLabel = `${result.seam_name} (thread ${thread.thread_number})`;
      totals[key].seam_breakdown[seamLabel] = thread.metres_per_piece;
    }
  }

  // Round totals + compute per dozen
  for (const key of Object.keys(totals)) {
    const t = totals[key];
    t.total_metres_per_piece    = round4(t.total_metres_per_piece);
    t.total_metres_with_wastage = round4(t.total_metres_with_wastage);
    t.total_metres_per_dozen    = round4(t.total_metres_with_wastage * 12);
  }

  return totals;
}

// ---------------------------------------------------------------------------
// Standard seam templates for bedding — auto-suggest seams based on article type
-- Called when a new article has components but no seams defined yet
// ---------------------------------------------------------------------------

export function suggestSeamsForArticle(
  productCategory: string,
  components:      ComponentSpec[]
): Partial<SeamSpec>[] {
  const hasSkirt   = components.some((c) => c.component_type === 'skirt');
  const hasReverse = components.some((c) => c.component_type === 'reverse');
  const hasFill    = components.some((c) => c.component_type === 'fill');
  const hasElastic = components.some((c) => c.component_type === 'elastic');

  const skirtComp   = components.find((c) => c.component_type === 'skirt');
  const topComp     = components.find((c) => c.component_type === 'top_panel');

  const suggestions: Partial<SeamSpec>[] = [];

  if (hasSkirt && topComp) {
    // Main join: top panel to skirt
    suggestions.push({
      seam_name:                  'Top Panel + Skirt Join',
      seam_description:           'Primary seam joining top panel to perimeter skirt',
      stitch_iso_code:            '516',   // safety stitch
      spi:                        10,
      threads: [
        { thread_number: 1, colour: 'Match Top Panel', ticket: '120/2' },
        { thread_number: 2, colour: 'Match Top Panel', ticket: '120/2' },
        { thread_number: 3, colour: 'Match Skirt',     ticket: '120/2' },
        { thread_number: 4, colour: 'Match Skirt',     ticket: '120/2' },
      ],
      length_source:              'derived',
      derived_from_component_id:  skirtComp?.id,
      derived_dimension:          'skirt_perimeter',
      derived_multiplier:         1.0,
      derived_add_inches:         2,  // tie-off allowance
      wastage_pct:                5,
      display_order:              1,
    });

    // Skirt side seams (4 corners)
    suggestions.push({
      seam_name:                  'Skirt Corner Seams',
      seam_description:           '4 corner seams joining skirt panels',
      stitch_iso_code:            '301',
      spi:                        12,
      threads: [
        { thread_number: 1, colour: 'Match Skirt', ticket: '120/2' },
        { thread_number: 2, colour: 'Match Skirt', ticket: '120/2' },
      ],
      length_source:              'derived',
      derived_from_component_id:  skirtComp?.id,
      derived_dimension:          'skirt_depth',
      derived_multiplier:         4,  // 4 corners
      derived_add_inches:         4,  // 1" tie-off per seam × 4
      wastage_pct:                5,
      display_order:              2,
    });

    // Skirt bottom hem
    suggestions.push({
      seam_name:                  'Skirt Bottom Hem',
      seam_description:           'Hemming the bottom edge of the skirt',
      stitch_iso_code:            '301',
      spi:                        10,
      threads: [
        { thread_number: 1, colour: 'Match Skirt', ticket: '120/2' },
        { thread_number: 2, colour: 'Match Skirt', ticket: '120/2' },
      ],
      length_source:              'derived',
      derived_from_component_id:  skirtComp?.id,
      derived_dimension:          'perimeter',
      derived_multiplier:         1.0,
      derived_add_inches:         2,
      wastage_pct:                5,
      display_order:              3,
    });
  }

  if (hasElastic) {
    suggestions.push({
      seam_name:                  'Elastic Casing',
      seam_description:           'Encasing elastic in hem or channel',
      stitch_iso_code:            '301',
      spi:                        10,
      threads: [
        { thread_number: 1, colour: 'Match Skirt', ticket: '120/2' },
        { thread_number: 2, colour: 'Match Skirt', ticket: '120/2' },
      ],
      length_source:              'derived',
      derived_from_component_id:  skirtComp?.id,
      derived_dimension:          'perimeter',
      derived_multiplier:         1.0,
      derived_add_inches:         3,
      wastage_pct:                5,
      display_order:              4,
    });
  }

  if (productCategory === 'flat_sheet') {
    suggestions.push({
      seam_name:                  'Top Hem (Wide)',
      seam_description:           'Wide decorative hem at top of flat sheet',
      stitch_iso_code:            '301',
      spi:                        10,
      threads: [
        { thread_number: 1, colour: 'Match Fabric', ticket: '120/2' },
        { thread_number: 2, colour: 'Match Fabric', ticket: '120/2' },
      ],
      length_source:              'derived',
      derived_dimension:          'width',
      derived_multiplier:         2.0,  // 2 rows of stitching for wide hem
      derived_add_inches:         2,
      wastage_pct:                5,
      display_order:              1,
    });

    suggestions.push({
      seam_name:                  'Side + Bottom Hems',
      seam_description:           '2 sides + bottom edge hemming',
      stitch_iso_code:            '103',   // blindstitch
      spi:                        8,
      threads: [
        { thread_number: 1, colour: 'Match Fabric', ticket: '120/2' },
      ],
      length_source:              'derived',
      derived_dimension:          'length',
      derived_multiplier:         2.0,  // 2 sides
      derived_add_inches:         0,
      wastage_pct:                5,
      display_order:              2,
    });
  }

  if (productCategory === 'pillowcase') {
    suggestions.push({
      seam_name:                  'Pillowcase Side + Bottom Seams',
      seam_description:           'Joining front to back panels',
      stitch_iso_code:            '504',  // serge/overlock
      spi:                        12,
      threads: [
        { thread_number: 1, colour: 'Match Fabric', ticket: '120/2' },
        { thread_number: 2, colour: 'Match Fabric', ticket: '120/2' },
        { thread_number: 3, colour: 'Match Fabric', ticket: '120/2' },
      ],
      length_source:              'derived',
      derived_dimension:          'length',
      derived_multiplier:         2.0,  // 2 sides
      derived_add_inches:         0,
      wastage_pct:                5,
      display_order:              1,
    });
  }

  // Label — always present
  suggestions.push({
    seam_name:                'Care Label Attachment',
    seam_description:         'Sewing in care/brand label',
    stitch_iso_code:          '301',
    spi:                      12,
    threads: [
      { thread_number: 1, colour: 'Match Background', ticket: '120/2' },
      { thread_number: 2, colour: 'Match Background', ticket: '120/2' },
    ],
    length_source:            'manual',
    manual_length_inches:     4,  // standard label attachment ~4"
    derived_multiplier:       1,
    derived_add_inches:       0,
    wastage_pct:              10, // higher wastage for short seam tie-offs
    display_order:            99,
  });

  return suggestions;
}

// ---------------------------------------------------------------------------
// Self-tests for thread formula engine
// ---------------------------------------------------------------------------

export function runThreadEngineTests(): {
  passed: number;
  failed: number;
  results: string[];
} {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(label: string, actual: number, expected: number, tolerance: number) {
    const diff = Math.abs(actual - expected);
    if (diff <= tolerance) {
      results.push(`✓ ${label}: ${actual} (expected ~${expected})`);
      passed++;
    } else {
      results.push(`✗ ${label}: got ${actual}, expected ~${expected} (diff: ${round4(diff)})`);
      failed++;
    }
  }

  const queenSize: SizeSpec = {
    size_code: "Q", size_label: "Queen",
    length_inches: 80, width_inches: 60, depth_inches: 14,
  };

  const mockSkirtComp: ComponentSpec = {
    id: "comp-skirt", component_type: "skirt", component_name: "Skirt",
    formula_type: "perimeter_skirt", fabric_width_inches: 58,
    seam_allowance_inches: 0.5, hem_allowance_inches: 1.5,
    skirt_depth_inches: 14, wastage_pct: 8, shrinkage_pct: 3,
    overlap_inches: 0, size_overrides: {},
  };

  const mockStitch516: StitchSpec = {
    iso_code: "516", common_name: "Safety Stitch",
    thread_count: 4, thread_ratio: 19.0,
  };

  const mockStitch301: StitchSpec = {
    iso_code: "301", common_name: "Lockstitch",
    thread_count: 2, thread_ratio: 2.5,
  };

  // Test 1: Queen protector top+skirt join — safety stitch 516, 10 SPI
  // Perimeter with seam = 2×(80.5) + 2×(60.5) = 282"
  // Total thread = 282" × 19 = 5358" ÷ 4 threads = 1339.5" per thread
  // = 34.04m per thread, +5% wastage = 35.74m per thread
  const seamJoin: SeamSpec = {
    id: "s1", seam_name: "Top Panel + Skirt Join",
    stitch_iso_code: "516", spi: 10,
    threads: [
      { thread_number: 1, colour: "Ecru", ticket: "120/2" },
      { thread_number: 2, colour: "Ecru", ticket: "120/2" },
      { thread_number: 3, colour: "Ecru", ticket: "120/2" },
      { thread_number: 4, colour: "Ecru", ticket: "120/2" },
    ],
    length_source: "derived",
    derived_from_component_id: "comp-skirt",
    derived_dimension: "skirt_perimeter",
    derived_multiplier: 1.0,
    derived_add_inches: 2,
    wastage_pct: 5,
  };
  const r1 = calculateSeamThreadConsumption(seamJoin, mockStitch516, mockSkirtComp, queenSize);
  assert(
    "Queen top+skirt join — metres per thread (516 safety stitch)",
    r1.thread_consumption[0]?.metres_per_piece ?? 0,
    35.74, 3.0  // ±3m tolerance
  );

  // Test 2: Skirt corner seams — lockstitch 301, 4 corners × 14" depth
  // Seam length = 14 × 4 + 4 = 60"
  // Total thread = 60" × 2.5 = 150" ÷ 2 threads = 75" per thread
  // = 1.905m per thread, +5% wastage = 2.0m
  const seamCorners: SeamSpec = {
    id: "s2", seam_name: "Skirt Corner Seams",
    stitch_iso_code: "301", spi: 12,
    threads: [
      { thread_number: 1, colour: "Ecru", ticket: "120/2" },
      { thread_number: 2, colour: "Ecru", ticket: "120/2" },
    ],
    length_source: "derived",
    derived_from_component_id: "comp-skirt",
    derived_dimension: "skirt_depth",
    derived_multiplier: 4,
    derived_add_inches: 4,
    wastage_pct: 5,
  };
  const r2 = calculateSeamThreadConsumption(seamCorners, mockStitch301, mockSkirtComp, queenSize);
  assert(
    "Queen corner seams — metres per thread (301 lockstitch, 4 corners)",
    r2.thread_consumption[0]?.metres_per_piece ?? 0,
    2.0, 0.5  // ±0.5m tolerance
  );

  // Test 3: Perimeter hem — lockstitch 301, Queen perimeter
  // Perimeter = 2×(80+60) = 280" + 2" = 282"
  // Total thread = 282" × 2.5 = 705" ÷ 2 = 352.5" per thread
  // = 8.95m per thread, +5% = 9.4m
  const seamHem: SeamSpec = {
    id: "s3", seam_name: "Skirt Bottom Hem",
    stitch_iso_code: "301", spi: 10,
    threads: [
      { thread_number: 1, colour: "Ecru", ticket: "120/2" },
      { thread_number: 2, colour: "Ecru", ticket: "120/2" },
    ],
    length_source: "derived",
    derived_dimension: "perimeter",
    derived_multiplier: 1.0,
    derived_add_inches: 2,
    wastage_pct: 5,
  };
  const r3 = calculateSeamThreadConsumption(seamHem, mockStitch301, mockSkirtComp, queenSize);
  assert(
    "Queen perimeter hem — metres per thread (301 lockstitch)",
    r3.thread_consumption[0]?.metres_per_piece ?? 0,
    9.4, 1.0
  );

  // Test 4: Aggregation — total Ecru 120/2 thread across all 3 seams
  // Expected total ≈ (35.74 × 4 threads) + (2.0 × 2 threads) + (9.4 × 2 threads)
  // = 142.96 + 4.0 + 18.8 = 165.76m total Ecru 120/2
  const allResults = [r1, r2, r3];
  const aggregated = aggregateThreadBOM(allResults);
  const ecruTotal  = aggregated["Ecru__120/2"]?.total_metres_with_wastage ?? 0;
  assert(
    "Queen total Ecru 120/2 thread (all seams aggregated)",
    ecruTotal,
    165.0, 20.0  // ±20m tolerance (loose — mainly verifying aggregation works)
  );

  // Test 5: Seam length derivation — manual fixed length
  const seamLabel: SeamSpec = {
    id: "s5", seam_name: "Label",
    stitch_iso_code: "301", spi: 12,
    threads: [{ thread_number: 1, colour: "White", ticket: "120/2" },
               { thread_number: 2, colour: "White", ticket: "120/2" }],
    length_source: "manual",
    manual_length_inches: 4,
    derived_multiplier: 1,
    derived_add_inches: 0,
    wastage_pct: 10,
  };
  const r5 = calculateSeamThreadConsumption(seamLabel, mockStitch301, null, queenSize);
  // 4" × 2.5 = 10" ÷ 2 = 5" = 0.127m + 10% = 0.14m
  assert(
    "Label attachment — metres per thread (manual 4\" seam)",
    r5.thread_consumption[0]?.metres_per_piece ?? 0,
    0.14, 0.05
  );

  return { passed, failed, results };
}
