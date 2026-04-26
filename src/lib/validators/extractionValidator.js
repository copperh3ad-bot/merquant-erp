/**
 * Extraction Validator — runs against the JSON shape Claude returns from the
 * extract-document edge function (kind = 'tech_pack' | 'master_data').
 *
 * Returns { issues, status } where status is one of:
 *   'passed'  — no errors, no warnings
 *   'warned'  — no errors, ≥1 warning
 *   'failed'  — ≥1 error (apply RPCs refuse this state)
 *
 * Issue shape: { severity, code, path, message, suggestion }
 *   severity: 'error' | 'warn' | 'info'
 *   path:     dot/bracket notation, e.g. 'skus[2].item_code', 'articles[5].item_code'
 *   code:     SHOUTY_SNAKE_CASE; one of the constants below
 *
 * Mirror at supabase/functions/extract-document/extractionValidator.js (Deno copy).
 * Keep these two files in sync. They are byte-for-byte identical aside from this header.
 *
 * Spec: 2026-04-25-ai-extraction §6.
 */

export const ERROR = 'error';
export const WARN  = 'warn';
export const INFO  = 'info';

// ---- helpers (self-contained; mirror style of masterDataValidator.js) ----

function issue(severity, code, path, message, suggestion) {
  return { severity, code, path, message, suggestion: suggestion || null };
}

function normKey(v) {
  if (v == null) return '';
  return String(v).trim().toLowerCase();
}

function isNoteOnlyRow(r) {
  if (!r || typeof r !== 'object') return false;
  const NOTE_COLS = new Set(['remarks', 'notes', 'comment', 'comments']);
  let hasNote = false;
  let hasOther = false;
  for (const [k, v] of Object.entries(r)) {
    if (v == null || String(v).trim() === '') continue;
    if (NOTE_COLS.has(k.toLowerCase())) hasNote = true;
    else hasOther = true;
  }
  return hasNote && !hasOther;
}

function requireFieldAt(rows, sectionPath, field, severity) {
  const out = [];
  rows.forEach((r, i) => {
    if (isNoteOnlyRow(r)) return;
    const v = r[field];
    if (v == null || String(v).trim() === '') {
      out.push(issue(
        severity,
        'MISSING_REQUIRED',
        `${sectionPath}[${i}].${field}`,
        `Required field "${field}" is empty`,
        `Every row in ${sectionPath} must have "${field}".`,
      ));
    }
  });
  return out;
}

function findDuplicatesAt(rows, sectionPath, keyCols) {
  const out = [];
  const seen = new Map(); // composite key → first row index
  rows.forEach((r, i) => {
    const key = keyCols.map((c) => normKey(r[c])).join('||');
    if (!key.replace(/\|/g, '')) return;
    if (seen.has(key)) {
      out.push(issue(
        ERROR,
        'DUPLICATE_KEY',
        `${sectionPath}[${i}]`,
        `Duplicate ${keyCols.join('+')}: ${keyCols.map((c) => `${c}="${r[c] ?? ''}"`).join(', ')} — same as ${sectionPath}[${seen.get(key)}]`,
        `Each row in ${sectionPath} must have a unique combination of (${keyCols.join(', ')}).`,
      ));
    } else {
      seen.set(key, i);
    }
  });
  return out;
}

function requireNumericRangeAt(rows, sectionPath, field, min, max, severity) {
  const out = [];
  rows.forEach((r, i) => {
    const v = r[field];
    if (v == null || v === '') return;
    const n = Number(v);
    if (Number.isNaN(n)) {
      out.push(issue(
        ERROR,
        'NOT_NUMERIC',
        `${sectionPath}[${i}].${field}`,
        `Field "${field}" has non-numeric value "${v}"`,
        `"${field}" must be a number.`,
      ));
    } else if (n < min || n > max) {
      out.push(issue(
        severity,
        'OUT_OF_RANGE',
        `${sectionPath}[${i}].${field}`,
        `${field} = ${n} is outside expected range ${min}–${max}`,
        'Unusual value. Double-check; if intentional, override this warning.',
      ));
    }
  });
  return out;
}

// ---- tech_pack validator (spec §6.1) ----

function validateTechPackHeader(header) {
  const out = [];
  if (!header || !header.product_no || String(header.product_no).trim() === '') {
    out.push(issue(WARN, 'MISSING_PRODUCT_NO', 'header.product_no',
      'No product number found — harder to deduplicate later.',
      'If this tech pack has a product number, please add it to the source file.'));
  }
  return out;
}

function validateTechPackSkus(skus) {
  if (!Array.isArray(skus) || skus.length === 0) {
    return [issue(ERROR, 'SKUS_EMPTY', 'skus',
      'No SKUs were extracted — this tech pack has nothing to import.',
      'The source file may not be a tech pack, or the SKU sheet may be empty.')];
  }
  const out = [];
  skus.forEach((sku, i) => {
    if (!sku || typeof sku !== 'object') {
      out.push(issue(ERROR, 'INVALID_ROW', `skus[${i}]`,
        'SKU row is missing or malformed.', null));
      return;
    }
    if (!sku.item_code || String(sku.item_code).trim() === '') {
      out.push(issue(ERROR, 'MISSING_REQUIRED', `skus[${i}].item_code`,
        'SKU is missing item_code.', 'Every SKU must have an item_code.'));
    }
    if (sku.size == null || String(sku.size).trim() === '') {
      out.push(issue(ERROR, 'MISSING_REQUIRED', `skus[${i}].size`,
        'SKU is missing size.', 'Every SKU must have a size.'));
    }
    if (sku.units_per_carton != null) {
      const n = Number(sku.units_per_carton);
      if (!Number.isNaN(n) && (n < 1 || n > 500)) {
        out.push(issue(WARN, 'OUT_OF_RANGE', `skus[${i}].units_per_carton`,
          `units_per_carton = ${n} is outside expected range 1–500`,
          'Unusual carton size. Verify.'));
      }
    }
  });
  out.push(...findDuplicatesAt(skus, 'skus', ['item_code']));
  return out;
}

function validateTechPackFabricSpecs(specs) {
  if (!Array.isArray(specs) || specs.length === 0) return [];
  const out = [];
  out.push(...requireNumericRangeAt(specs, 'fabric_specs', 'gsm', 20, 500, WARN));
  out.push(...requireNumericRangeAt(specs, 'fabric_specs', 'width_cm', 50, 400, WARN));
  return out;
}

function validateTechPackConfidence(conf) {
  if (!conf || typeof conf.overall !== 'number') return [];
  if (conf.overall < 0.4) {
    return [issue(WARN, 'LOW_CONFIDENCE', '_confidence.overall',
      `The model is only ${(conf.overall * 100).toFixed(0)}% confident in this extraction. Review carefully before applying.`,
      'Consider re-uploading a clearer version of the source file.')];
  }
  return [];
}

export function validateTechPackExtraction(data) {
  if (!data || typeof data !== 'object') {
    return summarise([issue(ERROR, 'INVALID_PAYLOAD', '', 'Extraction returned no data.', null)]);
  }
  const all = [];
  all.push(...validateTechPackHeader(data.header));
  all.push(...validateTechPackSkus(data.skus));
  all.push(...validateTechPackFabricSpecs(data.fabric_specs));
  all.push(...validateTechPackConfidence(data._confidence));
  return summarise(all);
}

// ---- master_data validator (spec §6.2) ----

function validateMdArticles(rows) {
  const out = [];
  out.push(...requireFieldAt(rows, 'articles', 'item_code', ERROR));
  out.push(...requireFieldAt(rows, 'articles', 'brand', WARN));
  out.push(...requireFieldAt(rows, 'articles', 'product_type', WARN));
  out.push(...requireFieldAt(rows, 'articles', 'size', WARN));
  out.push(...findDuplicatesAt(rows, 'articles', ['item_code']));
  return out;
}

function validateMdFabricConsumption(rows) {
  const out = [];
  out.push(...requireFieldAt(rows, 'fabric_consumption', 'item_code', ERROR));
  out.push(...requireFieldAt(rows, 'fabric_consumption', 'component_type', ERROR));
  out.push(...findDuplicatesAt(rows, 'fabric_consumption', ['item_code', 'component_type', 'color']));
  out.push(...requireNumericRangeAt(rows, 'fabric_consumption', 'consumption_per_unit', 0.001, 50, WARN));
  out.push(...requireNumericRangeAt(rows, 'fabric_consumption', 'gsm', 20, 500, WARN));
  out.push(...requireNumericRangeAt(rows, 'fabric_consumption', 'width_cm', 50, 400, WARN));
  return out;
}

function validateMdAccessoryConsumption(rows) {
  const out = [];
  out.push(...requireFieldAt(rows, 'accessory_consumption', 'item_code', ERROR));
  out.push(...requireFieldAt(rows, 'accessory_consumption', 'category', ERROR));
  out.push(...findDuplicatesAt(rows, 'accessory_consumption', ['item_code', 'category', 'material']));
  out.push(...requireNumericRangeAt(rows, 'accessory_consumption', 'consumption_per_unit', 0.001, 100, WARN));
  return out;
}

function validateMdCartonMaster(rows) {
  const out = [];
  out.push(...requireFieldAt(rows, 'carton_master', 'item_code', ERROR));
  out.push(...findDuplicatesAt(rows, 'carton_master', ['item_code']));
  out.push(...requireNumericRangeAt(rows, 'carton_master', 'units_per_carton', 1, 500, WARN));
  return out;
}

function validateMdPriceList(rows) {
  const out = [];
  out.push(...requireFieldAt(rows, 'price_list', 'item_code', ERROR));
  out.push(...findDuplicatesAt(rows, 'price_list', ['item_code']));
  out.push(...requireNumericRangeAt(rows, 'price_list', 'price_usd', 0.01, 10000, WARN));
  return out;
}

function validateMdSuppliers(rows) {
  const out = [];
  out.push(...requireFieldAt(rows, 'suppliers', 'name', ERROR));
  out.push(...findDuplicatesAt(rows, 'suppliers', ['name']));
  return out;
}

function validateMdSeasons(rows) {
  const out = [];
  out.push(...requireFieldAt(rows, 'seasons', 'name', ERROR));
  out.push(...findDuplicatesAt(rows, 'seasons', ['name']));
  return out;
}

function validateMdProductionLines(rows) {
  const out = [];
  out.push(...requireFieldAt(rows, 'production_lines', 'name', ERROR));
  out.push(...requireFieldAt(rows, 'production_lines', 'line_type', ERROR));
  out.push(...requireFieldAt(rows, 'production_lines', 'daily_capacity', ERROR));
  out.push(...findDuplicatesAt(rows, 'production_lines', ['name']));
  return out;
}

// Cross-section orphan check: downstream rows referencing item_codes not in articles[]
function validateMdCrossSection(data) {
  const out = [];
  const articles = Array.isArray(data.articles) ? data.articles : [];
  if (articles.length === 0) return out; // nothing to compare against
  const codes = new Set(articles.map((r) => normKey(r.item_code)).filter(Boolean));

  const checkOrphans = (sectionName, rows) => {
    if (!Array.isArray(rows)) return;
    rows.forEach((r, i) => {
      if (isNoteOnlyRow(r)) return;
      const code = normKey(r.item_code);
      if (code && !codes.has(code)) {
        out.push(issue(
          WARN,
          'ORPHAN_ITEM_CODE',
          `${sectionName}[${i}].item_code`,
          `item_code "${r.item_code}" is not in articles[]`,
          `Either add "${r.item_code}" to articles, or fix the typo here.`,
        ));
      }
    });
  };

  checkOrphans('fabric_consumption',    data.fabric_consumption);
  checkOrphans('accessory_consumption', data.accessory_consumption);
  checkOrphans('carton_master',         data.carton_master);
  checkOrphans('price_list',            data.price_list);
  return out;
}

export function validateMasterDataExtraction(data) {
  if (!data || typeof data !== 'object') {
    return summarise([issue(ERROR, 'INVALID_PAYLOAD', '', 'Extraction returned no data.', null)]);
  }
  const all = [];
  if (Array.isArray(data.articles)              && data.articles.length)              all.push(...validateMdArticles(data.articles));
  if (Array.isArray(data.fabric_consumption)    && data.fabric_consumption.length)    all.push(...validateMdFabricConsumption(data.fabric_consumption));
  if (Array.isArray(data.accessory_consumption) && data.accessory_consumption.length) all.push(...validateMdAccessoryConsumption(data.accessory_consumption));
  if (Array.isArray(data.carton_master)         && data.carton_master.length)         all.push(...validateMdCartonMaster(data.carton_master));
  if (Array.isArray(data.price_list)            && data.price_list.length)            all.push(...validateMdPriceList(data.price_list));
  if (Array.isArray(data.suppliers)             && data.suppliers.length)             all.push(...validateMdSuppliers(data.suppliers));
  if (Array.isArray(data.seasons)               && data.seasons.length)               all.push(...validateMdSeasons(data.seasons));
  if (Array.isArray(data.production_lines)      && data.production_lines.length)      all.push(...validateMdProductionLines(data.production_lines));
  all.push(...validateMdCrossSection(data));
  return summarise(all);
}

// ---- top-level dispatch & summarise ----

function summarise(issues) {
  const errors   = issues.filter((i) => i.severity === ERROR);
  const warnings = issues.filter((i) => i.severity === WARN);
  let status;
  if (errors.length > 0)        status = 'failed';
  else if (warnings.length > 0) status = 'warned';
  else                          status = 'passed';
  return { issues, status, error_count: errors.length, warning_count: warnings.length };
}

export function validateExtraction(kind, extractedData) {
  if (kind === 'tech_pack')   return validateTechPackExtraction(extractedData);
  if (kind === 'master_data') return validateMasterDataExtraction(extractedData);
  throw new Error(`Unknown kind: ${kind}`);
}

// Exported for tests
export const _internal = {
  validateTechPackHeader,
  validateTechPackSkus,
  validateTechPackFabricSpecs,
  validateTechPackConfidence,
  validateMdArticles,
  validateMdFabricConsumption,
  validateMdAccessoryConsumption,
  validateMdCartonMaster,
  validateMdPriceList,
  validateMdSuppliers,
  validateMdCrossSection,
  summarise,
  isNoteOnlyRow,
};
