// supabase/functions/extract-document/deterministicApply.js
//
// Phase 2 of the format-agnostic extraction pipeline. Given:
//   sheets: [{ name: string, headers: string[], rows: object[] }]
//          where each row is keyed by source column header (verbatim).
//   layout: the JSON returned by the discover_master_data_layout tool call.
// Produces a master_data extraction in the legacy extract_master_data shape,
// plus an _extraction_meta block describing how it was produced. No AI is
// invoked at this stage — the mapping is applied 1:1, deterministically.
//
// Pure ESM JS, no Deno-only imports, so the same file is imported by both
// the edge function (Deno) and vitest (Node).

// Target fields whose values must be coerced to a number after mapping.
// Strings like "170 GSM", "85%", "1,234.5" are common; coerceNumeric handles
// these. Anything that doesn't reduce to a finite number becomes null.
export const NUMERIC_FIELDS = new Set([
  'gsm',
  'width_cm',
  'consumption_per_unit',
  'wastage_percent',
  'units_per_carton',
  'carton_length_cm',
  'carton_width_cm',
  'carton_height_cm',
  'price_usd',
  'daily_capacity',
]);

// purpose -> output section key in the master_data shape.
export const PURPOSE_TO_OUTPUT_KEY = {
  articles: 'articles',
  fabric_consumption: 'fabric_consumption',
  accessory_consumption: 'accessory_consumption',
  carton_master: 'carton_master',
  price_list: 'price_list',
  suppliers: 'suppliers',
  seasons: 'seasons',
  production_lines: 'production_lines',
};

// Whitelist of legal target fields per purpose. Mirrors the tool schema
// defined in prompts.ts (extract_master_data). Any column_mapping value
// pointing outside this set is recorded as invalid_target_fields and
// silently dropped.
export const ALLOWED_TARGET_FIELDS_BY_PURPOSE = {
  articles: new Set(['item_code', 'brand', 'product_type', 'size']),
  fabric_consumption: new Set([
    'item_code', 'component_type', 'fabric_type', 'gsm', 'width_cm',
    'consumption_per_unit', 'wastage_percent', 'color',
  ]),
  accessory_consumption: new Set([
    'item_code', 'category', 'item_name', 'material', 'size_spec',
    'placement', 'consumption_per_unit',
  ]),
  carton_master: new Set([
    'item_code', 'units_per_carton', 'carton_length_cm', 'carton_width_cm',
    'carton_height_cm',
  ]),
  price_list: new Set(['item_code', 'price_usd', 'effective_from']),
  suppliers: new Set(['name', 'contact_email', 'contact_phone']),
  seasons: new Set(['name', 'start_date', 'end_date']),
  production_lines: new Set(['name', 'line_type', 'daily_capacity']),
};

// Per-purpose required-field guards. Rows missing any of these are dropped
// post-mapping (they would otherwise fail validateExtraction's MISSING_REQUIRED
// check anyway). Mirrors the tool schema's `required` arrays in prompts.ts.
export const REQUIRED_FIELDS_BY_PURPOSE = {
  articles: ['item_code'],
  fabric_consumption: ['item_code', 'component_type'],
  accessory_consumption: ['item_code', 'category'],
  carton_master: ['item_code'],
  price_list: ['item_code'],
  suppliers: ['name'],
  seasons: ['name'],
  production_lines: ['name'],
};

// Coerce a raw cell value to a number for numeric target fields. Strips
// thousands commas and pulls the first signed-decimal token. Returns null
// on garbage.
export function coerceNumeric(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  const match = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function clamp01(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function emptyMasterDataExtraction() {
  return {
    articles: [],
    fabric_consumption: [],
    accessory_consumption: [],
    carton_master: [],
    price_list: [],
    suppliers: [],
    seasons: [],
    production_lines: [],
    _confidence: { overall: 0 },
    _notes: null,
  };
}

/**
 * Apply a layout-discovery result to the parsed sheets and emit the
 * standardized master_data extraction shape.
 *
 * @param {Array<{name: string, headers: string[], rows: object[]}>} sheets
 * @param {object} layout - the discover_master_data_layout tool output
 * @returns {{ extracted: object, summary: object }}
 */
export function applyLayout(sheets, layout) {
  const out = emptyMasterDataExtraction();
  const summary = {
    sheets_processed: 0,
    sheets_ignored: 0,
    sheets_unmatched: 0,
    rows_in: 0,
    rows_out: 0,
    rows_dropped_missing_required: 0,
    invalid_target_fields: [],
  };

  const sheetsByName = new Map();
  for (const s of (sheets || [])) {
    if (s && typeof s.name === 'string') sheetsByName.set(s.name, s);
  }

  const layoutSheets = Array.isArray(layout?.sheets) ? layout.sheets : [];
  const confidenceValues = [];

  for (const meta of layoutSheets) {
    const purpose = meta?.purpose;
    if (purpose === 'ignore' || !PURPOSE_TO_OUTPUT_KEY[purpose]) {
      summary.sheets_ignored += 1;
      continue;
    }
    const sheet = sheetsByName.get(meta?.name);
    if (!sheet) {
      summary.sheets_unmatched += 1;
      continue;
    }
    summary.sheets_processed += 1;

    const allowed = ALLOWED_TARGET_FIELDS_BY_PURPOSE[purpose];
    const required = REQUIRED_FIELDS_BY_PURPOSE[purpose];
    const mapping = (meta?.column_mapping && typeof meta.column_mapping === 'object')
      ? meta.column_mapping
      : {};

    const usableMapping = {};
    const seenTargets = new Set();
    for (const [src, target] of Object.entries(mapping)) {
      if (target === 'skip' || target == null) continue;
      if (typeof target !== 'string') continue;
      if (!allowed.has(target)) {
        summary.invalid_target_fields.push({ sheet: sheet.name, header: src, target });
        continue;
      }
      // If two source headers map to the same target field, the first one wins.
      // The discovery prompt forbids this, but defend against it anyway.
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);
      usableMapping[src] = target;
    }

    if (meta?.confidence_per_column && typeof meta.confidence_per_column === 'object') {
      for (const v of Object.values(meta.confidence_per_column)) {
        if (typeof v === 'number' && Number.isFinite(v)) confidenceValues.push(v);
      }
    }

    const targetSection = out[PURPOSE_TO_OUTPUT_KEY[purpose]];

    for (const row of sheet.rows) {
      summary.rows_in += 1;
      const obj = {};
      for (const [src, target] of Object.entries(usableMapping)) {
        const value = row?.[src];
        if (!nonEmpty(value)) continue;
        if (NUMERIC_FIELDS.has(target)) {
          const n = coerceNumeric(value);
          if (n != null) obj[target] = n;
        } else {
          obj[target] = String(value).trim();
        }
      }
      const ok = required.every((f) => nonEmpty(obj[f]));
      if (!ok) {
        if (Object.keys(obj).length > 0) summary.rows_dropped_missing_required += 1;
        continue;
      }
      targetSection.push(obj);
      summary.rows_out += 1;
    }
  }

  if (confidenceValues.length > 0) {
    const mean = confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length;
    out._confidence.overall = clamp01(mean);
  } else if (typeof layout?._confidence?.overall === 'number') {
    out._confidence.overall = clamp01(layout._confidence.overall);
  }

  out._notes = (typeof layout?._notes === 'string') ? layout._notes : null;

  out._extraction_meta = {
    path: 'two_step',
    layout: {
      sheets: layoutSheets.map((s) => ({
        name: (s && typeof s.name === 'string') ? s.name : null,
        purpose: (s && typeof s.purpose === 'string') ? s.purpose : null,
        column_mapping: (s && s.column_mapping && typeof s.column_mapping === 'object') ? s.column_mapping : {},
      })),
    },
    summary,
  };

  return { extracted: out, summary };
}
