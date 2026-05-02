/**
 * headerNormalizer.js
 *
 * Maps free-form spreadsheet headers ("Article Code", "Pieces/Carton",
 * "Carton L (cm)", "Wastage %") to MerQuant's canonical snake_case keys
 * (item_code, units_per_carton, carton_length_cm, wastage_percent).
 *
 * Why this exists: master-data XLSX files come in two flavours —
 *   - "Template v4" with pretty Title Case headers ("Article Code")
 *   - The MerQuant importer's expected snake_case ("item_code")
 * Without normalization the importer rejects v4-style files because
 * its transform functions read keys verbatim (r.item_code) and find
 * nothing under "Article Code".
 *
 * This module is pure: takes a header string in, returns a string out.
 * Per-sheet alias overrides handle context-specific cases where the
 * generic regex can't infer the right canonical (e.g. "Pieces/Carton"
 * means `units_per_carton` in Articles/Carton Master, but
 * `pieces_per_carton` in Price List).
 */

/**
 * Generic normalizer: lower-case, replace any run of non-alphanumeric
 * characters with "_", trim. Examples:
 *   "Article Code"     → "article_code"
 *   "Pieces/Carton"    → "pieces_carton"
 *   "Carton L (cm)"    → "carton_l_cm"
 *   "Wastage %"        → "wastage"
 *   "Width (cm)"       → "width_cm"
 *   "GSM"              → "gsm"
 *   "  Item  Code  "   → "item_code"
 */
export function normalizeHeaderKey(h) {
  if (h == null) return "";
  return String(h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Global alias table — applied AFTER normalizeHeaderKey for every sheet.
 * Map "what the spreadsheet's normalized header is" → "what the importer's
 * transform function reads".
 *
 * Only put unambiguous mappings here. Sheet-specific overrides (e.g.
 * "pieces_carton" in Price List vs Articles) live in PER_SHEET_ALIASES.
 */
const GLOBAL_ALIASES = {
  // Article identity
  article_code:    "item_code",
  sku:             "item_code",
  product_code:    "item_code",
  // Sub-component naming
  comp_type:       "component_type",
  // Carton dimensions — short forms
  carton_l_cm:     "carton_length_cm",
  carton_w_cm:     "carton_width_cm",
  carton_h_cm:     "carton_height_cm",
  carton_l:        "carton_length_cm",
  carton_w:        "carton_width_cm",
  carton_h:        "carton_height_cm",
  // Wastage forms
  wastage:         "wastage_percent",
  wastage_pct:     "wastage_percent",
  wastage_percentage: "wastage_percent",
  // Consumption
  consumption_unit:        "consumption_per_unit",
  cons_per_unit:           "consumption_per_unit",
  // Price List
  price:           "price_usd",
  unit_price:      "price_usd",
  description:     "item_description",
  active:          "is_active",
  // Carton Master
  cbm_carton:           "cbm_per_carton",
  cbm_per_ctn:          "cbm_per_carton",
  // Variants
  bob_id:          "bob_sku",
  // Dates
  effective:       "effective_from",
};

/**
 * Per-sheet alias overrides. The sheet name is the key (matches MerQuant's
 * SHEETS config). Each value is a flat map applied AFTER global aliases —
 * so a sheet-specific alias overrides the global one.
 *
 * Disambiguates context-dependent cases like "Pieces/Carton" which means
 * different things on different sheets.
 */
const PER_SHEET_ALIASES = {
  "1. Articles (SKUs)": {
    pieces_carton:     "units_per_carton",
    pieces_per_carton: "units_per_carton",
    units_carton:      "units_per_carton",
    program_code:      "tech_pack_code",
    customer:          "brand",
    article_type:      "product_category",
  },
  "2. SKU Fabric Consumption": {
    treatment:         "finish",
  },
  "3. SKU Accessory Consumption": {
    component_type:    "category",  // v4 template uses Component Type; importer reads r.category
  },
  "4. Carton Master": {
    pieces_carton:     "units_per_carton",
    pieces_per_carton: "units_per_carton",
  },
  "5. Price List": {
    // Price List transform reads r.pieces_per_carton, so map both common
    // forms to that. (Articles/Carton Master use units_per_carton instead;
    // those overrides are above.)
    pieces_carton: "pieces_per_carton",
  },
};

/**
 * Normalize and alias-rewrite a row's keys for a given sheet.
 *
 * Walks every (key, value) pair in the row, normalizes the key, applies
 * the global alias map, then the sheet-specific alias map. When two
 * source headers map to the same canonical key, the FIRST non-empty
 * value wins (deterministic — input order from sheet_to_json).
 *
 * @param {object} row     a single row object straight from sheet_to_json
 * @param {string} sheet   the sheet name (for per-sheet aliases)
 * @returns {object}       a new row with canonical keys
 */
export function normalizeRowKeys(row, sheet) {
  if (!row || typeof row !== "object") return row;
  const sheetAliases = PER_SHEET_ALIASES[sheet] || {};
  const out = {};
  for (const [rawKey, val] of Object.entries(row)) {
    const norm = normalizeHeaderKey(rawKey);
    if (!norm) continue;
    const afterGlobal = GLOBAL_ALIASES[norm] || norm;
    const canonical = sheetAliases[afterGlobal] || sheetAliases[norm] || afterGlobal;
    // First-seen-wins when two source columns map to the same canonical.
    if (out[canonical] == null || String(out[canonical]).trim() === "") {
      out[canonical] = val;
    }
  }
  return out;
}
