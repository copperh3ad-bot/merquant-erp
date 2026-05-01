// src/lib/masterDataDedup.js
//
// Master-data extractions sometimes contain multiple rows that share the
// same DB unique key — e.g. when the source XLSX has a row per part (Flat
// Sheet, Fitted Sheet, Pillow Case, Sham) but each part records the same
// (item_code, component_type, color) triple. The DB enforces uniqueness
// on those triples, so the validator flags every duplicate as a blocking
// DUPLICATE_KEY error and the apply RPC refuses.
//
// This module deduplicates such rows BEFORE staging by collapsing
// duplicates to a single row, summing consumption_per_unit so the total
// fabric/accessory consumption per SKU is preserved (which is what
// downstream PO BOM-explosion needs).
//
// Behaviour:
//   - fabric_consumption    keyed by (item_code, component_type, color)
//   - accessory_consumption keyed by (item_code, category, material)
//   - For each duplicate group:
//       * consumption_per_unit  = SUM (skipping null/empty)
//       * wastage_percent       = MAX (most conservative)
//       * other fields          = first non-null wins (stable per source order)
//   - Original count + dedup'd count are surfaced so the UI can tell the
//     user "we collapsed N rows to M".

/**
 * @param {object} extractedData - the AI's extracted_data JSON object.
 * @returns {{ data: object, summary: { fabric: {before,after}, accessory: {before,after} } }}
 */
export function dedupeMasterData(extractedData) {
  if (!extractedData || typeof extractedData !== "object") {
    return { data: extractedData, summary: { fabric: { before: 0, after: 0 }, accessory: { before: 0, after: 0 } } };
  }

  const out = { ...extractedData };
  const summary = {
    fabric:    dedupSection(out, "fabric_consumption",    ["item_code", "component_type", "color"]),
    accessory: dedupSection(out, "accessory_consumption", ["item_code", "category",       "material"]),
  };
  return { data: out, summary };
}

function dedupSection(obj, sectionKey, keyFields) {
  const before = Array.isArray(obj[sectionKey]) ? obj[sectionKey].length : 0;
  if (before === 0) return { before: 0, after: 0 };

  const groups = new Map(); // key → { rep, sumConsumption, maxWastage, count }
  for (const row of obj[sectionKey]) {
    if (!row || typeof row !== "object") continue;
    const key = keyFields.map((f) => normalizeKeyValue(row[f])).join("|");
    if (!groups.has(key)) {
      groups.set(key, { rep: row, sumConsumption: 0, maxWastage: null, count: 0 });
    }
    const g = groups.get(key);
    g.count++;

    // Accumulate consumption (skip empty/non-numeric).
    const cpu = parseNumeric(row.consumption_per_unit);
    if (cpu != null) g.sumConsumption += cpu;

    // Track max wastage (more conservative).
    const w = parseNumeric(row.wastage_percent);
    if (w != null && (g.maxWastage == null || w > g.maxWastage)) g.maxWastage = w;

    // First non-null wins for every other field (rep is set on first sight).
    if (g.rep !== row) {
      for (const [k, v] of Object.entries(row)) {
        if ((g.rep[k] == null || g.rep[k] === "") && v != null && v !== "") {
          g.rep[k] = v;
        }
      }
    }
  }

  const merged = [];
  for (const g of groups.values()) {
    const r = { ...g.rep };
    if (g.sumConsumption > 0) r.consumption_per_unit = round4(g.sumConsumption);
    if (g.maxWastage != null) r.wastage_percent = round4(g.maxWastage);
    merged.push(r);
  }

  obj[sectionKey] = merged;
  return { before, after: merged.length };
}

function normalizeKeyValue(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

function parseNumeric(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
