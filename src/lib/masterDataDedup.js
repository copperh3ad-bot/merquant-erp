// src/lib/masterDataDedup.js
//
// Master-data extractions sometimes contain multiple rows that share the
// same DB unique key — e.g. when the AI mis-categorises and uses the same
// component_type for all parts of a sheet set. The DB enforces uniqueness
// on (item_code, component_type, color) for fabric_consumption (and
// (item_code, category, material) for accessory_consumption), so any
// duplicate is a blocking DUPLICATE_KEY validation error.
//
// Why we don't auto-sum aggressively (changed 2026-05-01 after data loss
// incident): summing duplicate rows under one component_type loses the
// per-part breakdown the Fabric Working Sheet needs. If a sheet set has
// 4 fabric rows that all collapsed to "Jersey Knit", summing them gives
// the right TOTAL but you can no longer see the Flat Sheet vs Fitted
// Sheet vs Pillow Case parts.
//
// Behaviour now:
//   1. EXACT duplicates (every numeric field identical too) → silently
//      collapse to one row. These are pure data-entry duplicates with
//      no information loss.
//   2. KEY-only duplicates (different consumption / wastage) → flag.
//      These usually mean the AI mis-categorised — different parts got
//      labelled with the same component_type. Returned as `flagged`
//      so the caller can warn the user instead of guessing.
//   3. Rows with distinct keys → unchanged.
//
// Returns:
//   { data, summary: {
//     fabric:    { before, after, flagged: [keyString...] },
//     accessory: { before, after, flagged: [keyString...] },
//   }}

/**
 * @param {object} extractedData - the AI's extracted_data JSON object.
 * @returns {{ data: object, summary: { fabric: SectionSummary, accessory: SectionSummary } }}
 *
 * SectionSummary = { before, after, flagged: string[] }
 *   `flagged` lists key strings of groups where rows shared the same DB
 *   unique key but had different consumption/wastage values — likely an
 *   AI miscategorisation (e.g. all parts labelled with the same
 *   component_type). The caller should surface these to the user so they
 *   can re-extract or fix manually instead of trusting an auto-collapse.
 */
export function dedupeMasterData(extractedData) {
  const empty = { before: 0, after: 0, flagged: [] };
  if (!extractedData || typeof extractedData !== "object") {
    return { data: extractedData, summary: { fabric: empty, accessory: empty } };
  }

  const out = { ...extractedData };
  // Per docs/architecture.md §2: dedup keys are
  //   fabric    → (item_code, component_type, color)
  //   accessory → (item_code, category, material, item_name)   ← 4-col since mig 0024
  // The accessory key MUST include item_name; without it, two distinct
  // accessory rows that share (item_code, category, material) but differ
  // on item_name (e.g. "Brand Label" vs "Care Label" both Polyester
  // labels) would be falsely collapsed.
  const summary = {
    fabric:    dedupSection(out, "fabric_consumption",    ["item_code", "component_type", "color"]),
    accessory: dedupSection(out, "accessory_consumption", ["item_code", "category", "material", "item_name"]),
  };
  return { data: out, summary };
}

function dedupSection(obj, sectionKey, keyFields) {
  const before = Array.isArray(obj[sectionKey]) ? obj[sectionKey].length : 0;
  if (before === 0) return { before: 0, after: 0, flagged: [] };

  // Bucket rows by their DB key.
  const groups = new Map(); // keyString → { keyValues, rows: [] }
  for (const row of obj[sectionKey]) {
    if (!row || typeof row !== "object") continue;
    const keyString = keyFields.map((f) => normalizeKeyValue(row[f])).join("|");
    if (!groups.has(keyString)) {
      groups.set(keyString, { keyValues: keyFields.map((f) => row[f]), rows: [] });
    }
    groups.get(keyString).rows.push(row);
  }

  const merged = [];
  const flagged = [];
  for (const [keyString, { keyValues, rows }] of groups) {
    if (rows.length === 1) {
      merged.push(rows[0]);
      continue;
    }
    // Multiple rows under the same key. Are they EXACT duplicates?
    if (allRowsAreExactDups(rows)) {
      // Safe to collapse — every field matches.
      merged.push(rows[0]);
    } else {
      // Different consumption/wastage values — this is suspicious.
      // Keep the first row but flag for user review. Do NOT auto-sum:
      // a "duplicate" that varies in consumption is almost always an
      // AI categorisation mistake (e.g. multiple parts of a sheet set
      // labelled with the same component_type).
      merged.push(rows[0]);
      flagged.push({
        key: keyValues.filter(Boolean).join(" / "),
        rowCount: rows.length,
        consumptionValues: rows
          .map((r) => parseNumeric(r.consumption_per_unit))
          .filter((v) => v != null),
      });
    }
  }

  obj[sectionKey] = merged;
  return { before, after: merged.length, flagged };
}

function allRowsAreExactDups(rows) {
  if (rows.length < 2) return true;
  const numFields = ["consumption_per_unit", "wastage_percent", "gsm", "width_cm"];
  const txtFields = ["fabric_type", "item_name", "size_spec", "placement"];
  const first = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    for (const f of numFields) {
      const a = parseNumeric(first[f]);
      const b = parseNumeric(r[f]);
      // Either both null/missing, or both equal within float tolerance.
      if (a == null && b == null) continue;
      if (a == null || b == null) return false;
      if (Math.abs(a - b) > 1e-6) return false;
    }
    for (const f of txtFields) {
      // Case-insensitive: Haiku is non-deterministic on capitalisation, so
      // "Cotton Jersey" vs "COTTON JERSEY" are the same row for dedup.
      const a = (first[f] ?? "").toString().trim().toLowerCase();
      const b = (r[f] ?? "").toString().trim().toLowerCase();
      if (a !== b) return false;
    }
  }
  return true;
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
