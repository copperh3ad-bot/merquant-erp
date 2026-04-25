/**
 * Master Data Validator — Layer 1 deterministic checks
 *
 * Purpose: catch structural problems in master data xlsx BEFORE importing to DB.
 * The checks here mirror what Postgres would reject (duplicate upsert keys,
 * missing required fields, orphaned references) plus reasonable range sanity.
 *
 * Design choices:
 *   - Pure JS, no React, no async, no external deps — runs in <500ms
 *   - Returns a structured result the UI can render
 *   - Every issue identifies sheet, row (1-indexed for humans), and suggests a fix
 *   - ERROR = blocks import; WARN = allowed but shown; INFO = purely informational
 *
 * If you add a new sheet to the importer, add its checks below. If you change the
 * upsert key for a sheet (matchBy in MasterDataImport.jsx), update the dup-check
 * keys here to match.
 */

const ERROR = "error";
const WARN = "warn";
const INFO = "info";

function issue(severity, sheet, row, code, message, suggestion) {
  return { severity, sheet, row, code, message, suggestion: suggestion || null };
}

// Fast case+trim normalization for key comparison
function normKey(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

// Detects duplicate rows by a composite key. Returns array of issue objects.
function findDuplicates(sheetName, rows, keyCols, itemCodeCol = "item_code") {
  const issues = [];
  const seen = new Map(); // key → first row number (1-indexed, header = row 1)
  rows.forEach((r, i) => {
    const rowNum = i + 2; // +2 because row 1 is headers, arrays are 0-indexed
    const key = keyCols.map((c) => normKey(r[c])).join("||");
    if (!key.replace(/\|/g, "")) return; // skip totally empty rows
    if (seen.has(key)) {
      issues.push(
        issue(
          ERROR,
          sheetName,
          rowNum,
          "DUPLICATE_KEY",
          `Duplicate upsert key: ${keyCols.map((c) => `${c}="${r[c] || ""}"`).join(", ")} — same as row ${seen.get(key)}`,
          `Each row in "${sheetName}" must have a unique combination of (${keyCols.join(", ")}). Fix: change one of the rows or delete the duplicate.`
        )
      );
    } else {
      seen.set(key, rowNum);
    }
  });
  return issues;
}

// Required field present (non-null, non-empty after trim)
function requireField(sheetName, rows, field, severity = ERROR) {
  const issues = [];
  rows.forEach((r, i) => {
    if (isNoteOnlyRow(r)) return; // skip rows that are pure annotations
    const rowNum = i + 2;
    const v = r[field];
    if (v == null || String(v).trim() === "") {
      issues.push(
        issue(
          severity,
          sheetName,
          rowNum,
          "MISSING_REQUIRED",
          `Required field "${field}" is empty`,
          `Every row in "${sheetName}" must have "${field}".`
        )
      );
    }
  });
  return issues;
}

// Note-only row: ALL fields empty/null EXCEPT 'remarks' or 'notes'.
// Used to allow annotation rows in xlsx without tripping required-field checks.
function isNoteOnlyRow(r) {
  if (!r || typeof r !== "object") return false;
  const NOTE_COLS = new Set(["remarks", "notes", "comment", "comments"]);
  let hasNote = false;
  let hasOther = false;
  for (const [k, v] of Object.entries(r)) {
    if (v == null || String(v).trim() === "") continue;
    if (NOTE_COLS.has(k.toLowerCase())) hasNote = true;
    else hasOther = true;
  }
  return hasNote && !hasOther;
}

// Numeric range check
function requireNumericRange(sheetName, rows, field, min, max, severity = WARN) {
  const issues = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const v = r[field];
    if (v == null || v === "") return; // missing handled elsewhere
    const n = Number(v);
    if (isNaN(n)) {
      issues.push(
        issue(
          ERROR,
          sheetName,
          rowNum,
          "NOT_NUMERIC",
          `Field "${field}" has non-numeric value "${v}"`,
          `"${field}" must be a number.`
        )
      );
    } else if (n < min || n > max) {
      issues.push(
        issue(
          severity,
          sheetName,
          rowNum,
          "OUT_OF_RANGE",
          `${field} = ${n} is outside expected range ${min}–${max}`,
          `Unusual value. Double-check. If intentional, override this warning.`
        )
      );
    }
  });
  return issues;
}

// Validator: Articles (SKUs)
function validateArticles(rows) {
  const s = "1. Articles (SKUs)";
  const out = [];
  out.push(...requireField(s, rows, "item_code", ERROR));
  out.push(...requireField(s, rows, "brand", WARN));
  out.push(...requireField(s, rows, "product_type", WARN));
  out.push(...requireField(s, rows, "size", WARN));
  out.push(...findDuplicates(s, rows, ["item_code"]));
  return out;
}

// Validator: SKU Fabric Consumption
function validateFabricConsumption(rows) {
  const s = "2. SKU Fabric Consumption";
  const out = [];
  out.push(...requireField(s, rows, "item_code", ERROR));
  out.push(...requireField(s, rows, "component_type", ERROR));
  // matchBy in importer: ["item_code","kind","component_type","color"]
  // kind is hardcoded to "fabric" so only these three distinguish rows
  out.push(...findDuplicates(s, rows, ["item_code", "component_type", "color"]));
  // Components where 0 consumption is normal (placeholders, swatches, samples)
  const ZERO_CONSUMPTION_OK = new Set(["fabric bag","fabric swatch","swatch","sample","spare","reserve"]);
  rows.forEach((r, i) => {
    if (isNoteOnlyRow(r)) return;
    const rowNum = i + 2;
    const cons = Number(r.consumption_per_unit);
    const comp = String(r.component_type || "").toLowerCase().trim();
    if (!isNaN(cons) && cons === 0 && ZERO_CONSUMPTION_OK.has(comp)) return; // expected zero
    if (isNaN(cons) || cons < 0.001 || cons > 50) {
      out.push(issue(WARN, s, rowNum, "OUT_OF_RANGE",
        `consumption_per_unit = ${r.consumption_per_unit} is outside expected range 0.001–50`,
        "Unusual value. Double-check. If intentional, override this warning."));
    }
  });
  out.push(...requireNumericRange(s, rows, "gsm", 20, 500, WARN));
  out.push(...requireNumericRange(s, rows, "width_cm", 50, 400, WARN));
  // Wastage: allow 0-1 (decimal) or 0-100 (percent)
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const w = Number(r.wastage_percent);
    if (!isNaN(w) && w > 1 && w < 2) {
      out.push(
        issue(
          WARN,
          s,
          rowNum,
          "WASTAGE_AMBIGUOUS",
          `wastage_percent = ${w} — is this 1.5% or 150%? Use 0.015 for 1.5%.`,
          "Convention: use decimals (0.06 = 6%)."
        )
      );
    }
  });
  return out;
}

// Validator: SKU Accessory Consumption
function validateAccessoryConsumption(rows) {
  const s = "3. SKU Accessory Consumption";
  const out = [];
  out.push(...requireField(s, rows, "item_code", ERROR));
  out.push(...requireField(s, rows, "category", ERROR));
  // matchBy in importer: ["item_code","kind","component_type","material"]
  // kind=accessory constant, component_type = category, material = item_name || material
  // Here we use category + material as the distinguishing pair (what importer uses)
  // Mirror importer: combine name+material+size+placement, then drop byte-identical dupes
  const seen = new Set();
  const rowsForDupCheck = [];
  rows.forEach(r => {
    const itemName = (r.item_name == null ? "" : String(r.item_name).trim());
    const rawMat = (r.material == null ? "" : String(r.material).trim());
    const sizeSpec = (r.size_spec == null ? "" : String(r.size_spec).trim());
    const placement = (r.placement == null ? "" : String(r.placement).trim());
    const parts = [itemName, rawMat, sizeSpec, placement].filter(Boolean);
    const unique = parts.filter((p, i) => p !== parts[i - 1]);
    const material = unique.join(" — ");
    // Match importer's postProcess: skip byte-identical duplicates entirely
    const ic = (r.item_code == null ? "" : String(r.item_code).trim());
    const cat = (r.category == null ? "" : String(r.category).trim());
    const cons = r.consumption_per_unit;
    const dedupKey = `${ic}||${cat}||${material}||${sizeSpec}||${placement}||${cons}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    rowsForDupCheck.push({ ...r, material });
  });
  out.push(...findDuplicates(s, rowsForDupCheck, ["item_code", "category", "material"]));
  out.push(...requireNumericRange(s, rows, "consumption_per_unit", 0.001, 100, WARN));
  return out;
}

// Validator: Carton Master
function validateCartonMaster(rows) {
  const s = "4. Carton Master";
  const out = [];
  out.push(...requireField(s, rows, "item_code", ERROR));
  out.push(...findDuplicates(s, rows, ["item_code"]));
  out.push(...requireNumericRange(s, rows, "units_per_carton", 1, 500, WARN));
  // CBM sanity — reject obviously wrong
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const L = Number(r.carton_length_cm);
    const W = Number(r.carton_width_cm);
    const H = Number(r.carton_height_cm);
    if (!isNaN(L) && !isNaN(W) && !isNaN(H) && L > 0 && W > 0 && H > 0) {
      const cbm = (L * W * H) / 1_000_000;
      if (cbm < 0.003 || cbm > 1) {
        out.push(
          issue(
            WARN,
            s,
            rowNum,
            "CBM_UNUSUAL",
            `CBM = ${cbm.toFixed(4)} is outside typical carton range 0.003–1.0 m³`,
            `Carton dims ${L}×${W}×${H} cm produce unusual volume. Verify.`
          )
        );
      }
    }
  });
  return out;
}

// Validator: Price List
function validatePriceList(rows) {
  const s = "5. Price List";
  const out = [];
  out.push(...requireField(s, rows, "item_code", ERROR));
  out.push(...findDuplicates(s, rows, ["item_code"]));
  out.push(...requireNumericRange(s, rows, "price_usd", 0.01, 10000, WARN));
  return out;
}

// Validator: Suppliers
function validateSuppliers(rows) {
  const s = "6. Suppliers";
  const out = [];
  out.push(...requireField(s, rows, "name", ERROR));
  // Case-insensitive unique check
  out.push(...findDuplicates(s, rows, ["name"]));
  return out;
}

// Cross-sheet checks: referential integrity
function validateCrossSheet(sheets) {
  const out = [];
  const articles = sheets["1. Articles (SKUs)"] || [];
  const articleCodes = new Set(articles.map((r) => normKey(r.item_code)).filter(Boolean));

  // Strip a trailing color/variant suffix (e.g. PCSJMO-T-WH -> PCSJMO-T).
  // A "suffix" is a final hyphen-segment of 1-4 alphanumeric chars.
  // If stripping yields the same string (no hyphen), returns null.
  const stripSuffix = (code) => {
    if (!code) return null;
    const m = /^(.+)-([A-Z0-9]{1,4})$/i.exec(code);
    return m ? normKey(m[1]) : null;
  };

  // Article matches a downstream code if either:
  //   - exact match (PCSJMO-T-WH in articles AND fabric)
  //   - article is suffixed and base appears in downstream (PCSJMO-T-WH article, PCSJMO-T fabric)
  //   - article is base and downstream has a suffixed variant (rare; reverse case)
  const articleMatchesAny = (articleCode, downstreamSet) => {
    if (downstreamSet.has(articleCode)) return true;
    const base = stripSuffix(articleCode);
    if (base && downstreamSet.has(base)) return true;
    return false;
  };

  // For orphan check (downstream sheet -> article), reverse logic:
  // a fabric row's item_code matches if articles has it OR has a suffixed variant of it.
  const articleSet = articleCodes;
  const articleBaseToVariants = new Map();
  articleCodes.forEach(ac => {
    const b = stripSuffix(ac);
    if (b) {
      if (!articleBaseToVariants.has(b)) articleBaseToVariants.set(b, []);
      articleBaseToVariants.get(b).push(ac);
    }
  });
  const orphanMatches = (code) => {
    if (articleSet.has(code)) return true;
    if (articleBaseToVariants.has(code)) return true; // fabric uses base; articles have variants
    const base = stripSuffix(code);
    if (base && articleSet.has(base)) return true;
    return false;
  };

  const checkOrphans = (sheetName, rows) => {
    if (!rows || rows.length === 0) return;
    rows.forEach((r, i) => {
      if (isNoteOnlyRow(r)) return;
      const rowNum = i + 2;
      const code = normKey(r.item_code);
      if (code && !orphanMatches(code)) {
        out.push(
          issue(
            WARN,
            sheetName,
            rowNum,
            "ORPHAN_ITEM_CODE",
            `item_code "${r.item_code}" not found in Articles sheet`,
            `Either add "${r.item_code}" to the Articles sheet, or fix the typo here.`
          )
        );
      }
    });
  };

  checkOrphans("2. SKU Fabric Consumption", sheets["2. SKU Fabric Consumption"]);
  checkOrphans("3. SKU Accessory Consumption", sheets["3. SKU Accessory Consumption"]);
  checkOrphans("4. Carton Master", sheets["4. Carton Master"]);
  checkOrphans("5. Price List", sheets["5. Price List"]);

  // Reverse check — articles without fabric/accessory rows (INFO only)
  const fabricCodes = new Set(
    (sheets["2. SKU Fabric Consumption"] || []).map((r) => normKey(r.item_code)).filter(Boolean)
  );
  const accCodes = new Set(
    (sheets["3. SKU Accessory Consumption"] || []).map((r) => normKey(r.item_code)).filter(Boolean)
  );

  articles.forEach((r, i) => {
    const rowNum = i + 2;
    const code = normKey(r.item_code);
    if (!code) return;
    if (!articleMatchesAny(code, fabricCodes)) {
      out.push(
        issue(
          INFO,
          "1. Articles (SKUs)",
          rowNum,
          "NO_FABRIC_ROWS",
          `"${r.item_code}" has no rows in SKU Fabric Consumption`,
          `This article won't have fabric BOM. Usually an oversight.`
        )
      );
    }
    if (!articleMatchesAny(code, accCodes)) {
      out.push(
        issue(
          INFO,
          "1. Articles (SKUs)",
          rowNum,
          "NO_ACCESSORY_ROWS",
          `"${r.item_code}" has no rows in SKU Accessory Consumption`,
          `This article won't have accessory BOM. Usually an oversight.`
        )
      );
    }
  });

  return out;
}

/**
 * Main entry point. Takes a map of { sheetName → rows[] } and returns
 * a structured validation result.
 *
 * @param {Object} sheets - { "1. Articles (SKUs)": [...], "2. SKU Fabric Consumption": [...], ... }
 * @returns {{ errors: Issue[], warnings: Issue[], info: Issue[], stats: {...}, ok: boolean }}
 */
export function validateMasterData(sheets) {
  const all = [];

  const runIfPresent = (name, fn) => {
    const rows = sheets[name];
    if (Array.isArray(rows) && rows.length > 0) all.push(...fn(rows));
  };

  runIfPresent("1. Articles (SKUs)", validateArticles);
  runIfPresent("2. SKU Fabric Consumption", validateFabricConsumption);
  runIfPresent("3. SKU Accessory Consumption", validateAccessoryConsumption);
  runIfPresent("4. Carton Master", validateCartonMaster);
  runIfPresent("5. Price List", validatePriceList);
  runIfPresent("6. Suppliers", validateSuppliers);
  all.push(...validateCrossSheet(sheets));

  const errors = all.filter((i) => i.severity === ERROR);
  const warnings = all.filter((i) => i.severity === WARN);
  const info = all.filter((i) => i.severity === INFO);

  // Per-sheet stats
  const sheetStats = {};
  Object.entries(sheets).forEach(([name, rows]) => {
    if (!Array.isArray(rows)) return;
    sheetStats[name] = {
      totalRows: rows.length,
      errors: errors.filter((i) => i.sheet === name).length,
      warnings: warnings.filter((i) => i.sheet === name).length,
    };
  });

  return {
    errors,
    warnings,
    info,
    stats: {
      totalSheets: Object.keys(sheetStats).length,
      totalRows: Object.values(sheetStats).reduce((s, v) => s + v.totalRows, 0),
      sheetsWithErrors: Object.values(sheetStats).filter((v) => v.errors > 0).length,
      perSheet: sheetStats,
    },
    ok: errors.length === 0,
  };
}

// Exported for tests / advanced usage
export const validators = {
  validateArticles,
  validateFabricConsumption,
  validateAccessoryConsumption,
  validateCartonMaster,
  validatePriceList,
  validateSuppliers,
  validateCrossSheet,
};
