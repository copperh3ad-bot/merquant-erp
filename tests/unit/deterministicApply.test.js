import { describe, it, expect } from 'vitest';
import {
  applyLayout,
  coerceNumeric,
  emptyMasterDataExtraction,
  NUMERIC_FIELDS,
  ALLOWED_TARGET_FIELDS_BY_PURPOSE,
  REQUIRED_FIELDS_BY_PURPOSE,
} from '../../supabase/functions/extract-document/deterministicApply.js';

// Phase 2 of format-agnostic extraction. These tests pin the behaviour of
// the deterministic post-processor so future prompt changes (or LLM drift)
// can't silently re-introduce shape errors. The whole point of step 2 is
// reproducibility: same (sheets, layout) -> same output, every time.

describe('coerceNumeric', () => {
  it('passes finite numbers through', () => {
    expect(coerceNumeric(170)).toBe(170);
    expect(coerceNumeric(0)).toBe(0);
    expect(coerceNumeric(-2.5)).toBe(-2.5);
  });

  it('strips trailing units and percent signs', () => {
    expect(coerceNumeric('170 GSM')).toBe(170);
    expect(coerceNumeric('300GSM')).toBe(300);
    expect(coerceNumeric('85%')).toBe(85);
    expect(coerceNumeric('112 cm')).toBe(112);
    expect(coerceNumeric('-2.5cm')).toBe(-2.5);
  });

  it('strips thousands commas', () => {
    expect(coerceNumeric('1,234.5')).toBe(1234.5);
    expect(coerceNumeric('1,000')).toBe(1000);
  });

  it('returns null for garbage and empty', () => {
    expect(coerceNumeric('')).toBeNull();
    expect(coerceNumeric('   ')).toBeNull();
    expect(coerceNumeric(null)).toBeNull();
    expect(coerceNumeric(undefined)).toBeNull();
    expect(coerceNumeric('Jersey Knit')).toBeNull();
    expect(coerceNumeric(NaN)).toBeNull();
    expect(coerceNumeric(Infinity)).toBeNull();
  });
});

describe('schema constants stay in sync with the legacy tool schema', () => {
  // These constants must match prompts.ts MASTER_DATA_TOOL — if anyone bumps
  // the tool schema without updating deterministicApply, this test fires.
  it('NUMERIC_FIELDS covers every numeric target field across purposes', () => {
    const expectedNumeric = [
      'gsm', 'width_cm', 'consumption_per_unit', 'wastage_percent',
      'units_per_carton', 'carton_length_cm', 'carton_width_cm',
      'carton_height_cm', 'price_usd', 'daily_capacity',
    ];
    for (const f of expectedNumeric) expect(NUMERIC_FIELDS.has(f)).toBe(true);
  });

  it('REQUIRED_FIELDS_BY_PURPOSE keys match ALLOWED_TARGET_FIELDS_BY_PURPOSE keys', () => {
    expect(Object.keys(REQUIRED_FIELDS_BY_PURPOSE).sort())
      .toEqual(Object.keys(ALLOWED_TARGET_FIELDS_BY_PURPOSE).sort());
  });

  it('every required field is in the allowed-target set for that purpose', () => {
    for (const [purpose, required] of Object.entries(REQUIRED_FIELDS_BY_PURPOSE)) {
      const allowed = ALLOWED_TARGET_FIELDS_BY_PURPOSE[purpose];
      for (const f of required) expect(allowed.has(f)).toBe(true);
    }
  });
});

describe('emptyMasterDataExtraction', () => {
  it('returns the legacy shape with empty arrays and zero confidence', () => {
    const e = emptyMasterDataExtraction();
    expect(e.articles).toEqual([]);
    expect(e.fabric_consumption).toEqual([]);
    expect(e.accessory_consumption).toEqual([]);
    expect(e.carton_master).toEqual([]);
    expect(e.price_list).toEqual([]);
    expect(e.suppliers).toEqual([]);
    expect(e.seasons).toEqual([]);
    expect(e.production_lines).toEqual([]);
    expect(e._confidence).toEqual({ overall: 0 });
    expect(e._notes).toBeNull();
  });
});

describe('applyLayout — happy path', () => {
  it('applies a 1:1 column mapping verbatim', () => {
    const sheets = [{
      name: 'Articles',
      headers: ['SKU', 'Brand', 'Type', 'Size'],
      rows: [
        { SKU: 'SLPCSS-001', Brand: 'PureCare', Type: 'Sheet Set', Size: 'Queen' },
        { SKU: 'SLPCSS-002', Brand: 'PureCare', Type: 'Sheet Set', Size: 'King' },
      ],
    }];
    const layout = {
      sheets: [{
        name: 'Articles',
        purpose: 'articles',
        column_mapping: { SKU: 'item_code', Brand: 'brand', Type: 'product_type', Size: 'size' },
        confidence_per_column: { SKU: 0.99, Brand: 0.95, Type: 0.92, Size: 0.97 },
      }],
      _confidence: { overall: 0.95 },
    };
    const { extracted, summary } = applyLayout(sheets, layout);
    expect(extracted.articles).toEqual([
      { item_code: 'SLPCSS-001', brand: 'PureCare', product_type: 'Sheet Set', size: 'Queen' },
      { item_code: 'SLPCSS-002', brand: 'PureCare', product_type: 'Sheet Set', size: 'King' },
    ]);
    expect(summary.rows_in).toBe(2);
    expect(summary.rows_out).toBe(2);
    expect(summary.sheets_processed).toBe(1);
    expect(extracted._extraction_meta.path).toBe('two_step');
  });

  it('coerces numeric target fields and leaves strings alone', () => {
    const sheets = [{
      name: 'Fabric',
      headers: ['SKU', 'Part', 'Material', 'GSM', 'Width', 'Cut/Unit', 'Wastage'],
      rows: [
        { SKU: 'SLP-001', Part: 'Flat Sheet', Material: '85% Modal Jersey Knit', GSM: '170 GSM', Width: '112 cm', 'Cut/Unit': '2.5 m', Wastage: '5%' },
      ],
    }];
    const layout = {
      sheets: [{
        name: 'Fabric', purpose: 'fabric_consumption',
        column_mapping: {
          SKU: 'item_code', Part: 'component_type', Material: 'fabric_type',
          GSM: 'gsm', Width: 'width_cm', 'Cut/Unit': 'consumption_per_unit',
          Wastage: 'wastage_percent',
        },
      }],
    };
    const { extracted } = applyLayout(sheets, layout);
    expect(extracted.fabric_consumption).toEqual([{
      item_code: 'SLP-001',
      component_type: 'Flat Sheet',
      fabric_type: '85% Modal Jersey Knit',
      gsm: 170,
      width_cm: 112,
      consumption_per_unit: 2.5,
      wastage_percent: 5,
    }]);
  });

  it('trims whitespace on string fields', () => {
    const sheets = [{
      name: 'A', headers: ['SKU'], rows: [{ SKU: '   SLP-1   ' }],
    }];
    const layout = { sheets: [{ name: 'A', purpose: 'articles', column_mapping: { SKU: 'item_code' } }] };
    const { extracted } = applyLayout(sheets, layout);
    expect(extracted.articles).toEqual([{ item_code: 'SLP-1' }]);
  });
});

describe('applyLayout — defensive behaviour', () => {
  it('drops sheets with purpose "ignore" without touching output', () => {
    const sheets = [
      { name: 'Cover', headers: ['x'], rows: [{ x: 'intro text' }] },
      { name: 'Articles', headers: ['SKU'], rows: [{ SKU: 'A1' }] },
    ];
    const layout = {
      sheets: [
        { name: 'Cover', purpose: 'ignore', column_mapping: {} },
        { name: 'Articles', purpose: 'articles', column_mapping: { SKU: 'item_code' } },
      ],
    };
    const { extracted, summary } = applyLayout(sheets, layout);
    expect(extracted.articles).toEqual([{ item_code: 'A1' }]);
    expect(summary.sheets_ignored).toBe(1);
    expect(summary.sheets_processed).toBe(1);
  });

  it('skips columns mapped to "skip" or unmapped', () => {
    const sheets = [{
      name: 'A',
      headers: ['SKU', 'Brand', 'Notes'],
      rows: [{ SKU: 'A1', Brand: 'PureCare', Notes: 'irrelevant' }],
    }];
    const layout = {
      sheets: [{
        name: 'A', purpose: 'articles',
        column_mapping: { SKU: 'item_code', Brand: 'brand', Notes: 'skip' },
      }],
    };
    const { extracted } = applyLayout(sheets, layout);
    expect(extracted.articles).toEqual([{ item_code: 'A1', brand: 'PureCare' }]);
  });

  it('omits empty cells from the output object (does not write empty strings)', () => {
    const sheets = [{
      name: 'A', headers: ['SKU', 'Brand'],
      rows: [{ SKU: 'A1', Brand: '' }, { SKU: 'A2', Brand: '   ' }],
    }];
    const layout = {
      sheets: [{ name: 'A', purpose: 'articles', column_mapping: { SKU: 'item_code', Brand: 'brand' } }],
    };
    const { extracted } = applyLayout(sheets, layout);
    expect(extracted.articles).toEqual([{ item_code: 'A1' }, { item_code: 'A2' }]);
  });

  it('drops rows missing required fields and counts them', () => {
    const sheets = [{
      name: 'F', headers: ['SKU', 'Part'],
      rows: [
        { SKU: 'A1', Part: 'Flat Sheet' },        // ok
        { SKU: '', Part: 'Pillow Case' },         // missing item_code -> drop
        { SKU: 'A2', Part: '' },                  // missing component_type -> drop
        { SKU: 'A3', Part: 'Fitted Sheet' },      // ok
        { SKU: '', Part: '' },                    // fully blank -> drop, NOT counted
      ],
    }];
    const layout = {
      sheets: [{
        name: 'F', purpose: 'fabric_consumption',
        column_mapping: { SKU: 'item_code', Part: 'component_type' },
      }],
    };
    const { extracted, summary } = applyLayout(sheets, layout);
    expect(extracted.fabric_consumption).toEqual([
      { item_code: 'A1', component_type: 'Flat Sheet' },
      { item_code: 'A3', component_type: 'Fitted Sheet' },
    ]);
    expect(summary.rows_in).toBe(5);
    expect(summary.rows_out).toBe(2);
    expect(summary.rows_dropped_missing_required).toBe(2);
  });

  it('records invalid target fields without crashing', () => {
    const sheets = [{
      name: 'A', headers: ['SKU', 'X'],
      rows: [{ SKU: 'A1', X: 'something' }],
    }];
    const layout = {
      sheets: [{
        name: 'A', purpose: 'articles',
        column_mapping: { SKU: 'item_code', X: 'unknown_field' },
      }],
    };
    const { extracted, summary } = applyLayout(sheets, layout);
    expect(extracted.articles).toEqual([{ item_code: 'A1' }]);
    expect(summary.invalid_target_fields).toEqual([
      { sheet: 'A', header: 'X', target: 'unknown_field' },
    ]);
  });

  it('counts unmatched sheets when the layout names a sheet that does not exist', () => {
    const sheets = [{ name: 'Real', headers: ['SKU'], rows: [{ SKU: 'A1' }] }];
    const layout = {
      sheets: [
        { name: 'Real', purpose: 'articles', column_mapping: { SKU: 'item_code' } },
        { name: 'Phantom', purpose: 'articles', column_mapping: { SKU: 'item_code' } },
      ],
    };
    const { extracted, summary } = applyLayout(sheets, layout);
    expect(extracted.articles).toEqual([{ item_code: 'A1' }]);
    expect(summary.sheets_unmatched).toBe(1);
    expect(summary.sheets_processed).toBe(1);
  });

  it('concatenates multiple sheets feeding the same purpose', () => {
    const sheets = [
      { name: 'East', headers: ['SKU'], rows: [{ SKU: 'E1' }, { SKU: 'E2' }] },
      { name: 'West', headers: ['SKU'], rows: [{ SKU: 'W1' }] },
    ];
    const layout = {
      sheets: [
        { name: 'East', purpose: 'articles', column_mapping: { SKU: 'item_code' } },
        { name: 'West', purpose: 'articles', column_mapping: { SKU: 'item_code' } },
      ],
    };
    const { extracted } = applyLayout(sheets, layout);
    expect(extracted.articles.map((a) => a.item_code)).toEqual(['E1', 'E2', 'W1']);
  });

  it('keeps the first source header when two map to the same target field', () => {
    const sheets = [{
      name: 'A', headers: ['SKU1', 'SKU2'],
      rows: [{ SKU1: 'X1', SKU2: 'X2' }],
    }];
    const layout = {
      sheets: [{
        name: 'A', purpose: 'articles',
        column_mapping: { SKU1: 'item_code', SKU2: 'item_code' },
      }],
    };
    const { extracted } = applyLayout(sheets, layout);
    expect(extracted.articles).toEqual([{ item_code: 'X1' }]);
  });

  it('handles missing/empty layout gracefully', () => {
    const { extracted, summary } = applyLayout([], { sheets: [], _confidence: { overall: 0 } });
    expect(extracted.articles).toEqual([]);
    expect(summary.rows_in).toBe(0);
    expect(extracted._extraction_meta.path).toBe('two_step');
  });

  it('handles null/undefined layout fields without throwing', () => {
    expect(() => applyLayout([], {})).not.toThrow();
    expect(() => applyLayout([], { sheets: null })).not.toThrow();
    expect(() => applyLayout([], { sheets: [{ name: 'X' }] })).not.toThrow();
  });
});

describe('applyLayout — confidence aggregation', () => {
  it('averages per-column confidences across processed sheets', () => {
    const sheets = [{ name: 'A', headers: ['SKU'], rows: [{ SKU: 'A1' }] }];
    const layout = {
      sheets: [{
        name: 'A', purpose: 'articles',
        column_mapping: { SKU: 'item_code' },
        confidence_per_column: { SKU: 0.9 },
      }],
      _confidence: { overall: 0.5 },  // should be ignored when per-column data exists
    };
    const { extracted } = applyLayout(sheets, layout);
    expect(extracted._confidence.overall).toBeCloseTo(0.9, 5);
  });

  it('falls back to layout._confidence.overall when no per-column data exists', () => {
    const sheets = [{ name: 'A', headers: ['SKU'], rows: [{ SKU: 'A1' }] }];
    const layout = {
      sheets: [{ name: 'A', purpose: 'articles', column_mapping: { SKU: 'item_code' } }],
      _confidence: { overall: 0.42 },
    };
    const { extracted } = applyLayout(sheets, layout);
    expect(extracted._confidence.overall).toBe(0.42);
  });

  it('clamps confidence to [0, 1]', () => {
    const sheets = [{ name: 'A', headers: ['SKU'], rows: [{ SKU: 'A1' }] }];
    const layoutHigh = {
      sheets: [{
        name: 'A', purpose: 'articles', column_mapping: { SKU: 'item_code' },
        confidence_per_column: { SKU: 1.5 },
      }],
    };
    expect(applyLayout(sheets, layoutHigh).extracted._confidence.overall).toBe(1);

    const layoutLow = {
      sheets: [{ name: 'A', purpose: 'articles', column_mapping: { SKU: 'item_code' } }],
      _confidence: { overall: -0.3 },
    };
    expect(applyLayout(sheets, layoutLow).extracted._confidence.overall).toBe(0);
  });
});

describe('applyLayout — MFRM regression fixture', () => {
  // The 2026-05-01 MFRM bug: source had a clearly-named "component_type"
  // column with values "Flat Sheet", "Fitted Sheet", "Pillow Case", "Fabric
  // bag" AND a "fabric_type" column with "85% Modal Jersey Knit". The
  // legacy single-shot prompt swapped them. Under Phase 2, as long as the
  // discovery step returns the obvious 1:1 mapping, the deterministic
  // post-processor cannot re-create that swap.
  it('preserves per-part component_type values when the mapping is honest', () => {
    const sheets = [{
      name: 'SKU Fabric Consumption',
      headers: ['item_code', 'component_type', 'fabric_type', 'gsm', 'width_cm', 'consumption_per_unit'],
      rows: [
        { item_code: 'MFRM-Q', component_type: 'Flat Sheet',   fabric_type: '85% Modal Jersey Knit', gsm: '170', width_cm: '112', consumption_per_unit: '2.4' },
        { item_code: 'MFRM-Q', component_type: 'Fitted Sheet', fabric_type: '85% Modal Jersey Knit', gsm: '170', width_cm: '112', consumption_per_unit: '2.1' },
        { item_code: 'MFRM-Q', component_type: 'Pillow Case',  fabric_type: '85% Modal Jersey Knit', gsm: '170', width_cm: '112', consumption_per_unit: '0.6' },
        { item_code: 'MFRM-Q', component_type: 'Fabric Bag',   fabric_type: '85% Modal Jersey Knit', gsm: '170', width_cm: '112', consumption_per_unit: '0.3' },
      ],
    }];
    const layout = {
      sheets: [{
        name: 'SKU Fabric Consumption',
        purpose: 'fabric_consumption',
        column_mapping: {
          item_code: 'item_code',
          component_type: 'component_type',
          fabric_type: 'fabric_type',
          gsm: 'gsm',
          width_cm: 'width_cm',
          consumption_per_unit: 'consumption_per_unit',
        },
        confidence_per_column: { item_code: 0.99, component_type: 0.97, fabric_type: 0.96, gsm: 0.95, width_cm: 0.95, consumption_per_unit: 0.94 },
      }],
    };
    const { extracted } = applyLayout(sheets, layout);
    const partNames = extracted.fabric_consumption.map((r) => r.component_type);
    expect(partNames).toEqual(['Flat Sheet', 'Fitted Sheet', 'Pillow Case', 'Fabric Bag']);
    // Every row keeps the fabric description in fabric_type, not component_type.
    for (const r of extracted.fabric_consumption) {
      expect(r.fabric_type).toBe('85% Modal Jersey Knit');
      expect(r.component_type).not.toMatch(/jersey|modal|gsm|%/i);
    }
  });
});
