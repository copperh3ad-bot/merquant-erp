/**
 * masterDataTemplates.js
 *
 * Runtime XLSX template generators for the Master Data Import page. Two
 * templates ship today:
 *
 *   1. Bulk template — all 8 sheets, full column set. For periodic master-data
 *      refreshes via the deterministic XLSX importer. No size limit.
 *
 *   2. Per-program AI template — essential columns only, capped at 50 SKUs.
 *      Designed so the AI extraction pipeline can complete in a single
 *      Anthropic call (output stays well within the 32K token cap).
 *
 * Generating the templates from this single config (TEMPLATE_DEFS) ensures
 * they stay in sync with the importer in MasterDataImport.jsx — change a
 * column here and the next download reflects it. The importer's SHEETS
 * object accepts a SUPERSET of these columns, so anything missing from a
 * template just gets defaulted at import time.
 */

const PER_PROGRAM_SKU_LIMIT = 50;

// ─────────────────────────────────────────────────────────────────────────
// Column definitions per sheet, per template variant.
// Column NAMES match what MasterDataImport's SHEETS config expects (so the
// downloaded files Just Work with the existing importer).
// Comments describe what each column is for, in case a future maintainer
// adds new columns here without touching the importer.
// ─────────────────────────────────────────────────────────────────────────

const BULK_COLUMNS = {
  "1. Articles (SKUs)": [
    "tech_pack_code",      // Optional cross-reference to a tech pack
    "brand",               // Buyer brand name
    "product_type",        // e.g. Mattress Protector, Pillow, Sheet Set
    "product_category",    // Internal taxonomy category
    "size",                // Twin / Queen / King / etc.
    "item_code",           // PRIMARY KEY — unique across all SKUs
    "bob_sku",             // Buyer's own SKU code (BOB only — leave blank for others)
    "color",               // Primary fabric colour
    "product_length_in",   // Finished product L (inches)
    "product_width_in",    // Finished product W (inches)
    "product_depth_in",    // Finished product D (inches)
    "finish_dimensions",   // Free-text dimensions (if not L×W×D)
    "insert_dimensions",   // For sets — insert pillow / shams
    "pvc_bag_dimensions",  // Retail PVC bag size
    "stiffener_size",      // Card stiffener (cm)
    "zipper_length_cm",    // Zipper length (cm)
    "units_per_carton",    // Carton pack qty
    "carton_size_cm",      // L×W×H carton (cm)
    "remarks",             // Free-text notes; rows with ONLY remarks are skipped
  ],
  "2. SKU Fabric Consumption": [
    "tech_pack_code",
    "item_code",           // FK to Articles.item_code
    "size",
    "product_size",        // Buyer-stated finished size text
    "component_type",      // shell / lining / fill / piping / binding / etc.
    "direction",           // length / width
    "fabric_type",         // e.g. Knit Jersey, Woven Twill
    "construction",        // e.g. 144x76, plain weave
    "yarn_count",          // e.g. 30/1, 40s
    "composition",         // e.g. 100% cotton, 80/20 PC
    "gsm",                 // Fabric weight (g/m²)
    "finish",              // Treatment / coating
    "color",
    "width_cm",            // Roll width (cm)
    "consumption_per_unit",// Per piece consumption (m or yd — be consistent)
    "wastage_percent",     // 0.05 = 5%
    "total_required",      // Computed elsewhere; informational
    "supplier",            // Preferred supplier name
    "remarks",
  ],
  "3. SKU Accessory Consumption": [
    "tech_pack_code",
    "item_code",
    "size",
    "category",            // label / sticker / zipper / trim / etc.
    "item_name",           // Specific name within category
    "material",            // Material / composition
    "size_spec",           // e.g. 60mm, 8x4cm
    "placement",           // Where on the article
    "variant",             // Colour / variant
    "consumption_per_unit",
    "unit",                // pcs / m / set
    "wastage_percent",
    "total_required",
    "supplier",
    "remarks",
  ],
  "4. Carton Master": [
    "tech_pack_code",
    "size",
    "item_code",
    "units_per_carton",
    "carton_size_cm",      // Free-text combined L×W×H
    "carton_length_cm",
    "carton_width_cm",
    "carton_height_cm",
    "cbm_per_carton",      // m³ — auto-computed if dims present
    "weight_per_carton_kg",
    "remarks",
  ],
  "5. Price List": [
    "item_code",
    "item_description",
    "price_usd",
    "currency",
    "effective_from",      // YYYY-MM-DD; defaults to today if blank
    "effective_to",        // YYYY-MM-DD; optional
    "pieces_per_carton",
    "carton_length_cm",
    "carton_width_cm",
    "carton_height_cm",
    "cbm_per_carton",
    "is_active",           // true / false
    "notes",
  ],
  "6. Suppliers": [
    "name",                // PRIMARY KEY
    "code",
    "category",
    "supplier_type",       // fabric / trim / packaging / mfg
    "contact_person",
    "email",
    "phone",
    "whatsapp",
    "city",
    "country",
    "payment_terms",
    "currency",
    "lead_time_days",
    "rating",              // 1-5
    "notes",
  ],
  "7. Seasons": [
    "name",                // PRIMARY KEY
    "start_date",
    "end_date",
    "status",              // Planning / Active / Completed / Cancelled
    "notes",
  ],
  "8. Production Lines": [
    "name",                // PRIMARY KEY
    "line_type",           // stitching / cutting / packing / etc.
    "daily_capacity",
    "operator_count",
    "is_active",           // true / false
    "notes",
  ],
};

// Slimmed column set for the per-program AI template.
// Only the columns that materially feed downstream calculations OR are
// commonly populated by buyers. Anything missing here can still be added
// to a custom file later — the bulk importer will accept extra columns.
const PER_PROGRAM_COLUMNS = {
  "1. Articles (SKUs)": [
    "item_code", "brand", "product_type", "size", "color",
    "product_length_in", "product_width_in", "product_depth_in",
    "units_per_carton", "carton_size_cm",
  ],
  "2. SKU Fabric Consumption": [
    "item_code", "component_type", "fabric_type", "gsm", "color",
    "width_cm", "consumption_per_unit", "wastage_percent",
  ],
  "3. SKU Accessory Consumption": [
    "item_code", "category", "item_name", "material", "size_spec",
    "placement", "consumption_per_unit",
  ],
  "4. Carton Master": [
    "item_code", "units_per_carton",
    "carton_length_cm", "carton_width_cm", "carton_height_cm",
  ],
  "5. Price List": [
    "item_code", "price_usd", "currency", "effective_from",
  ],
  "6. Suppliers": [
    "name", "email", "phone", "country", "payment_terms",
  ],
  "7. Seasons": [
    "name", "start_date", "end_date",
  ],
  "8. Production Lines": [
    "name", "line_type", "daily_capacity",
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Instructions content
// ─────────────────────────────────────────────────────────────────────────

function bulkInstructionsRows() {
  return [
    ["MerQuant — Master Data Bulk Template"],
    [""],
    ["Use this template for periodic refreshes of your full master data via Master Data Import → Choose XLSX."],
    ["The deterministic importer reads every row that has the required fields filled. There is no size limit."],
    [""],
    ["────────────────────────────────────────"],
    ["How to use"],
    ["────────────────────────────────────────"],
    ["1. Fill in the 8 data sheets (next tabs). Sheets you don't need can be left empty."],
    ["2. Save as .xlsx (do not change the sheet names — the importer matches them by name)."],
    ["3. Upload via Master Data → Choose XLSX. The deterministic importer runs validation, shows you errors, then imports."],
    [""],
    ["────────────────────────────────────────"],
    ["Required fields per sheet"],
    ["────────────────────────────────────────"],
    ["1. Articles (SKUs):           item_code"],
    ["2. SKU Fabric Consumption:    item_code, component_type"],
    ["3. SKU Accessory Consumption: item_code, category"],
    ["4. Carton Master:             item_code"],
    ["5. Price List:                item_code"],
    ["6. Suppliers:                 name"],
    ["7. Seasons:                   name"],
    ["8. Production Lines:          name, line_type, daily_capacity"],
    [""],
    ["────────────────────────────────────────"],
    ["Conventions"],
    ["────────────────────────────────────────"],
    ["• Dates: YYYY-MM-DD (e.g. 2026-04-29). Empty dates default to today on import where applicable."],
    ["• wastage_percent: use decimals (0.06 = 6%). Whole-number ambiguity (1 < x < 2) triggers a warning."],
    ["• consumption_per_unit: be consistent on unit (m or yd). Pick one for your team and stick with it."],
    ["• gsm: 20–500 typical; outside this range triggers a warning, not an error."],
    ["• width_cm: 50–400 typical for fabric rolls."],
    ["• carton dimensions: L × W × H in cm. CBM auto-computed if all three are filled."],
    ["• Boolean fields (is_active): write 'true' or 'false', any case."],
    ["• Note-only rows: any row with ONLY 'remarks'/'notes' filled is skipped on import. Use these for inline comments."],
    [""],
    ["────────────────────────────────────────"],
    ["Tip — when to use the AI quickstart instead"],
    ["────────────────────────────────────────"],
    ["If you're adding ONE NEW PROGRAM (a buyer's tech pack with its accessories, not a full master refresh),"],
    ["use the Per-Program AI Template instead. It runs through Try AI Extraction and lands the same data with a review step."],
  ];
}

function perProgramInstructionsRows() {
  return [
    ["MerQuant — Per-Program AI Quickstart Template"],
    [""],
    ["Use this template to add ONE NEW PROGRAM at a time (a buyer's tech pack + its accessories + carton + price)."],
    ["Upload via Master Data → Try AI Extraction. The AI will read it, you review the rows, and apply."],
    [""],
    ["────────────────────────────────────────"],
    ["Hard rules"],
    ["────────────────────────────────────────"],
    [`1. ONE program per file. Do not combine multiple buyers or programs.`],
    [`2. Maximum ${PER_PROGRAM_SKU_LIMIT} SKUs per file. Beyond this, the AI extraction will run out of output budget mid-file.`],
    ["3. Sheets you don't need can be left empty (e.g., skip Seasons / Suppliers if not relevant)."],
    ["4. Do not rename sheets. Do not delete columns. Add data only into the rows below the header."],
    [""],
    ["────────────────────────────────────────"],
    ["Required fields per sheet"],
    ["────────────────────────────────────────"],
    ["1. Articles (SKUs):           item_code"],
    ["2. SKU Fabric Consumption:    item_code, component_type"],
    ["3. SKU Accessory Consumption: item_code, category"],
    ["4. Carton Master:             item_code"],
    ["5. Price List:                item_code"],
    ["6. Suppliers:                 name"],
    ["7. Seasons:                   name"],
    ["8. Production Lines:          name, line_type, daily_capacity"],
    [""],
    ["────────────────────────────────────────"],
    ["Conventions"],
    ["────────────────────────────────────────"],
    ["• Dates: YYYY-MM-DD format."],
    ["• wastage_percent as decimal (0.06 = 6%)."],
    ["• consumption_per_unit: pick m or yd and use it consistently within the file."],
    ["• gsm in g/m². width_cm in cm. price_usd in USD."],
    [""],
    ["────────────────────────────────────────"],
    ["What the AI does"],
    ["────────────────────────────────────────"],
    ["1. Reads every sheet you filled."],
    ["2. Normalises column names if they slightly drift."],
    ["3. Flags rows with missing required fields, duplicate keys, or out-of-range numbers."],
    ["4. Lets you review each row before anything lands in the live tables."],
    ["5. Applies via UPSERT — if an item_code already exists, the row is updated; otherwise inserted."],
    [""],
    ["────────────────────────────────────────"],
    ["Tip — for bulk refreshes use the other template"],
    ["────────────────────────────────────────"],
    ["If you're refreshing your entire master data (hundreds of rows across all programs),"],
    ["use the Bulk Template instead and upload it via Choose XLSX (deterministic importer, no size limit)."],
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Builder helpers
// ─────────────────────────────────────────────────────────────────────────

function makeReadMeSheet(XLSX, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Make column A wide enough that long lines don't wrap awkwardly.
  ws["!cols"] = [{ wch: 110 }];
  return ws;
}

function makeDataSheet(XLSX, columns) {
  const ws = XLSX.utils.aoa_to_sheet([columns]);
  // Default-width columns proportional to header length, capped sensibly.
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(12, Math.min(28, c.length + 4)) }));
  return ws;
}

function buildTemplate(XLSX, { instructionsRows, columnSet, sheetTabName = "Read Me" }) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeReadMeSheet(XLSX, instructionsRows), sheetTabName);
  for (const [sheetName, columns] of Object.entries(columnSet)) {
    XLSX.utils.book_append_sheet(wb, makeDataSheet(XLSX, columns), sheetName);
  }
  // Returns a Uint8Array suitable for a Blob → download or for direct bytes use.
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/** Bulk template — full 8-sheet schema for the deterministic importer. */
export function buildBulkTemplate(XLSX) {
  return buildTemplate(XLSX, {
    instructionsRows: bulkInstructionsRows(),
    columnSet: BULK_COLUMNS,
  });
}

/** Per-program AI quickstart template — slimmed columns + 50-SKU cap. */
export function buildPerProgramTemplate(XLSX) {
  return buildTemplate(XLSX, {
    instructionsRows: perProgramInstructionsRows(),
    columnSet: PER_PROGRAM_COLUMNS,
  });
}

export { PER_PROGRAM_SKU_LIMIT, BULK_COLUMNS, PER_PROGRAM_COLUMNS };
