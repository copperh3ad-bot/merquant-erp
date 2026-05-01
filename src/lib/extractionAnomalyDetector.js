// src/lib/extractionAnomalyDetector.js
//
// Catches the most common AI extraction mistakes WITHOUT calling Claude
// again. Runs entirely client-side after extract-document returns.
//
// Why we need it: Claude is good at reading column headers but
// occasionally hallucinates the meaning. The MFRM Stretch Cool Modal
// XLSX (2026-05-01 incident) is the canonical example: source had a
// "component_type" column with values "Flat Sheet", "Fitted Sheet",
// "Pillow Case", "Fabric bag" AND a "fabric_type" column with values
// like "85% Modal Jersey Knit". Claude swapped them — used the fabric
// description as component_type, leaving the part name unused.
//
// We can detect this deterministically because:
//   - component_type should be a SHORT NOUN PHRASE describing a part
//     (Flat Sheet, Pillow Case, Skirt, Top Fabric, Filling, Binding...)
//   - fabric_type should describe MATERIAL + CONSTRUCTION + GSM
//     (85% Modal Jersey Knit, 170 GSM)
//   - These are easy to distinguish with regex / keyword checks.
//
// When detected, we either auto-fix (when there's an unambiguous swap
// candidate) or flag for the user.

// ── Lexicon ─────────────────────────────────────────────────────────────────

// Fabric descriptors — words/phrases that should NEVER appear in
// component_type. If component_type contains any of these, it's
// almost certainly a fabric description.
const FABRIC_DESCRIPTOR_PATTERNS = [
  /\b\d{2,4}\s*gsm\b/i,                                            // "170 GSM", "300GSM"
  /\b\d{1,3}\s*%/i,                                                // "85%", "100%"
  /\bjersey\s+knit\b/i,
  /\bmodal\b/i,
  /\bcotton\b/i,
  /\bspandex\b/i,
  /\bpolyester\b/i,
  /\bpoly\b/i,
  /\bnylon\b/i,
  /\bsilk\b/i,
  /\blinen\b/i,
  /\bbamboo\b/i,
  /\btencel\b/i,
  /\blyocell\b/i,
  /\bsateen\b/i,
  /\bpercale\b/i,
  /\bflannel\b/i,
  /\bmicrofiber\b/i,
  /\b\d+s?\s*(?:single|d|denier)\b/i,                              // yarn count
  /\bthread\s+count\b/i,
  /\b\d+tc\b/i,
  /\begyptian\b/i,
  /\bsupima\b/i,
  /\bpima\b/i,
];

// Known good component_type values (canonical part names). When
// component_type matches one of these (or a near-match), it's correct.
const KNOWN_COMPONENT_TYPES = new Set([
  // Sheet sets
  "flat sheet", "fitted sheet", "pillow case", "pillowcase", "sham", "fabric bag",
  // Mattress / pillow / encasement
  "top fabric", "bottom", "skirt", "platform", "binding", "piping", "filling",
  "front", "back", "lamination", "sleeper flap", "evalon membrane",
  // Pillow protectors
  "pillow case (1pc)", "pillow case (2pc)", "fitted sheet (2pc split)",
  "fitted sheet (split head)",
  // Other fabric components
  "quilting", "pillow compression", "outer", "inner",
  // Accessory + packaging (sometimes appear)
  "polybag", "poly bag", "pvc bag", "stiffener", "insert", "insert card",
  "label", "size label", "care label", "law tag", "hang tag", "barcode sticker",
  "size sticker", "zipper", "thread", "elastic",
]);

// Known good accessory categories.
const KNOWN_ACCESSORY_CATEGORIES = new Set([
  "polybag", "poly bag", "pvc bag", "stiffener", "insert card", "label",
  "size label", "care label", "law tag", "hang tag", "barcode sticker",
  "size sticker", "zipper", "thread", "elastic", "tape", "binding",
  "packaging", "sticker",
]);

// ── Per-row checks ──────────────────────────────────────────────────────────

/**
 * Returns severity classification for a component_type string.
 *   "ok"       — matches a known canonical value
 *   "fabric"   — looks like a fabric descriptor (DEFINITELY wrong)
 *   "unknown"  — doesn't match either set (suspicious, may need review)
 */
function classifyComponentType(value) {
  if (!value || typeof value !== "string") return "unknown";
  const v = value.trim().toLowerCase();
  if (!v) return "unknown";

  if (KNOWN_COMPONENT_TYPES.has(v)) return "ok";

  // Check fabric-descriptor patterns
  for (const re of FABRIC_DESCRIPTOR_PATTERNS) {
    if (re.test(value)) return "fabric";
  }

  return "unknown";
}

/**
 * Returns true if the value looks like a fabric description (multiple
 * material keywords, GSM, percentages, etc.). Used to validate that a
 * fabric_type field is actually a fabric description.
 */
function looksLikeFabricDescription(value) {
  if (!value || typeof value !== "string") return false;
  let hits = 0;
  for (const re of FABRIC_DESCRIPTOR_PATTERNS) {
    if (re.test(value)) hits++;
    if (hits >= 2) return true; // 2+ fabric markers = high confidence
  }
  return false;
}

// ── Anomaly detection over a fabric_consumption array ───────────────────────

/**
 * @param {Array<object>} fabricRows  extracted_data.fabric_consumption
 * @returns {{
 *   anomalies: Array<{ code, severity, message, path, fix? }>,
 *   autoFixed: Array<object>           // patched fabricRows after auto-fixes
 * }}
 */
export function detectFabricConsumptionAnomalies(fabricRows) {
  const anomalies = [];
  if (!Array.isArray(fabricRows) || fabricRows.length === 0) {
    return { anomalies, autoFixed: fabricRows ?? [] };
  }

  // Sniff for the column-swap pattern: many rows where component_type
  // looks like a fabric, AND fabric_type looks like nothing or is empty.
  // If so, propose swapping them.
  const swapEvidence = [];
  for (let i = 0; i < fabricRows.length; i++) {
    const r = fabricRows[i] || {};
    const ct = classifyComponentType(r.component_type);
    const ftLooksFabric = looksLikeFabricDescription(r.fabric_type);
    if (ct === "fabric" && !ftLooksFabric) {
      swapEvidence.push(i);
    }
  }

  // ALL rows show the swap pattern → safe to auto-fix.
  // Some rows show it → flag but don't auto-swap (data inconsistent).
  let autoFixed = fabricRows;
  if (swapEvidence.length > 0 && swapEvidence.length === fabricRows.length) {
    autoFixed = fabricRows.map((r) => ({
      ...r,
      component_type: r.fabric_type ?? "",
      fabric_type:    r.component_type ?? "",
    }));
    anomalies.push({
      code: "AUTO_FIXED_COMPONENT_FABRIC_SWAP",
      severity: "info",
      path: "fabric_consumption[*]",
      message: `Auto-corrected: every component_type looked like a fabric description (e.g. "${fabricRows[0]?.component_type}") while fabric_type was empty or generic. Swapped the two columns.`,
      fix: "swap_component_type_and_fabric_type",
    });
  } else if (swapEvidence.length > 0) {
    anomalies.push({
      code: "POSSIBLE_COMPONENT_FABRIC_SWAP",
      severity: "warn",
      path: `fabric_consumption[${swapEvidence.slice(0, 5).join(",")}${swapEvidence.length > 5 ? ",..." : ""}]`,
      message: `${swapEvidence.length} of ${fabricRows.length} rows have component_type that looks like a fabric description. Some rows look correct — manual review recommended.`,
    });
  }

  // Per-row checks on the (possibly auto-fixed) data.
  for (let i = 0; i < autoFixed.length; i++) {
    const r = autoFixed[i] || {};

    // Missing item_code — fatal-ish.
    if (!r.item_code || String(r.item_code).trim() === "") {
      anomalies.push({
        code: "MISSING_ITEM_CODE",
        severity: "error",
        path: `fabric_consumption[${i}].item_code`,
        message: "Row has no item_code — cannot link to any SKU.",
      });
    }

    // component_type still suspicious after auto-fix.
    const ct = classifyComponentType(r.component_type);
    if (ct === "fabric") {
      anomalies.push({
        code: "FABRIC_DESCRIPTOR_IN_COMPONENT_TYPE",
        severity: "warn",
        path: `fabric_consumption[${i}].component_type`,
        message: `component_type="${r.component_type}" looks like a fabric description, not a part name (e.g. "Flat Sheet", "Pillow Case").`,
      });
    } else if (ct === "unknown" && r.component_type) {
      anomalies.push({
        code: "UNKNOWN_COMPONENT_TYPE",
        severity: "info",
        path: `fabric_consumption[${i}].component_type`,
        message: `component_type="${r.component_type}" is not a recognised part name. Verify it's intentional.`,
      });
    }

    // fabric_type missing or doesn't look like a fabric.
    if (r.fabric_type && !looksLikeFabricDescription(r.fabric_type)) {
      anomalies.push({
        code: "WEAK_FABRIC_TYPE",
        severity: "info",
        path: `fabric_consumption[${i}].fabric_type`,
        message: `fabric_type="${r.fabric_type}" doesn't look like a typical fabric description (no GSM, no material %).`,
      });
    }
  }

  return { anomalies, autoFixed };
}

/**
 * @param {Array<object>} accessoryRows  extracted_data.accessory_consumption
 * @returns {{ anomalies, autoFixed }}
 */
export function detectAccessoryConsumptionAnomalies(accessoryRows) {
  const anomalies = [];
  if (!Array.isArray(accessoryRows) || accessoryRows.length === 0) {
    return { anomalies, autoFixed: accessoryRows ?? [] };
  }

  for (let i = 0; i < accessoryRows.length; i++) {
    const r = accessoryRows[i] || {};
    if (!r.item_code) {
      anomalies.push({
        code: "MISSING_ITEM_CODE",
        severity: "error",
        path: `accessory_consumption[${i}].item_code`,
        message: "Row has no item_code.",
      });
    }
    const cat = (r.category ?? "").toString().trim().toLowerCase();
    if (cat && !KNOWN_ACCESSORY_CATEGORIES.has(cat) && !cat.includes(" ")) {
      // Single-word unknown category — lightly warn.
      anomalies.push({
        code: "UNKNOWN_ACCESSORY_CATEGORY",
        severity: "info",
        path: `accessory_consumption[${i}].category`,
        message: `category="${r.category}" is not in the known accessory list.`,
      });
    }
  }
  return { anomalies, autoFixed: accessoryRows };
}

// ── Top-level entry ─────────────────────────────────────────────────────────

/**
 * Run all anomaly checks on a master_data extraction's extracted_data.
 *
 * @param {object} extractedData
 * @returns {{
 *   anomalies: Array,
 *   patchedData: object,
 *   summary: { auto_fixed: number, warnings: number, errors: number }
 * }}
 */
export function detectAndAutoFix(extractedData) {
  if (!extractedData || typeof extractedData !== "object") {
    return {
      anomalies: [],
      patchedData: extractedData,
      summary: { auto_fixed: 0, warnings: 0, errors: 0 },
    };
  }

  const all = [];
  const out = { ...extractedData };

  if (Array.isArray(extractedData.fabric_consumption)) {
    const { anomalies, autoFixed } = detectFabricConsumptionAnomalies(extractedData.fabric_consumption);
    out.fabric_consumption = autoFixed;
    all.push(...anomalies);
  }
  if (Array.isArray(extractedData.accessory_consumption)) {
    const { anomalies, autoFixed } = detectAccessoryConsumptionAnomalies(extractedData.accessory_consumption);
    out.accessory_consumption = autoFixed;
    all.push(...anomalies);
  }

  return {
    anomalies: all,
    patchedData: out,
    summary: {
      auto_fixed: all.filter((a) => a.severity === "info" && a.code.startsWith("AUTO_FIXED")).length,
      warnings:   all.filter((a) => a.severity === "warn").length,
      errors:     all.filter((a) => a.severity === "error").length,
    },
  };
}

// Export the lower-level helpers for testing.
export const _internal = { classifyComponentType, looksLikeFabricDescription };
