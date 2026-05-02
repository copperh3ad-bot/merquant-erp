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
//
// Migrated 2026-05-02 onto src/lib/textileVocabulary as the single source of
// truth. The local lists used to drift from the canonical vocabulary (e.g.
// fabricClassifier had a different cut), so anomaly detection sometimes
// disagreed with the printout gate. Now both consult the same registry.

import { canonical, isInCategory, _internals } from "@/lib/textileVocabulary";
import { canonicalPartName } from "@/lib/partNameCanonical";

// Format/measurement patterns. Kept hardcoded because they're units, not
// vocabulary terms — GSM, percentages, thread count, denier, yarn count.
// If component_type matches ANY of these, it's almost certainly a fabric
// descriptor that landed in the wrong column.
const MEASUREMENT_PATTERNS = [
  /\b\d{2,4}\s*gsm\b/i,                  // "170 GSM", "300GSM"
  /\b\d{1,3}\s*%/i,                      // "85%", "100%"
  /\b\d+s?\s*(?:single|d|denier)\b/i,    // yarn count / denier
  /\bthread\s+count\b/i,
  /\b\d+tc\b/i,                          // "300TC"
];

// Build a single OR-regex from every alias registered under a category.
// Lets us ask "does this string mention ANY fibre / fabric_type word?"
// while keeping the source of truth in textileVocabulary.
function buildContainsAnyRegex(category) {
  const idx = _internals.REVERSE_INDEX[category];
  if (!idx || idx.size === 0) return null;
  const parts = [];
  for (const alias of idx.keys()) {
    const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    parts.push(`\\b${esc}\\b`);
  }
  // Sort longest-first so multi-word aliases (e.g. "egyptian cotton") win
  // over their single-word substrings.
  parts.sort((a, b) => b.length - a.length);
  return new RegExp(parts.join("|"), "i");
}

const FIBRE_REGEX = buildContainsAnyRegex("fibre");
const FABRIC_TYPE_REGEX = buildContainsAnyRegex("fabric_type");

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

  // 1. Vocabulary fast-path. A component_type is "ok" if it resolves to a
  //    canonical part, accessory, or trim. Variant qualifiers like
  //    "(Split Head)" are stripped by canonicalPartName and the stripped
  //    form is then re-checked against the part vocabulary.
  if (canonical("part", v)) return "ok";
  const stripped = canonicalPartName(v); // strips "(qualifier)" suffix
  if (stripped && canonical("part", stripped)) return "ok";
  if (isInCategory("accessory", v)) return "ok";
  if (isInCategory("trim", v)) return "ok";

  // 2. Looks like a fabric descriptor → wrong column.
  for (const re of MEASUREMENT_PATTERNS) {
    if (re.test(value)) return "fabric";
  }
  if (FIBRE_REGEX && FIBRE_REGEX.test(value)) return "fabric";
  if (FABRIC_TYPE_REGEX && FABRIC_TYPE_REGEX.test(value)) return "fabric";

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
  for (const re of MEASUREMENT_PATTERNS) {
    if (re.test(value)) hits++;
    if (hits >= 2) return true; // 2+ fabric markers = high confidence
  }
  if (FIBRE_REGEX && FIBRE_REGEX.test(value)) hits++;
  if (hits >= 2) return true;
  if (FABRIC_TYPE_REGEX && FABRIC_TYPE_REGEX.test(value)) hits++;
  return hits >= 2;
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
    // Vocabulary covers accessory + trim categories. (Trim items like
    // "Binding" historically appeared in the accessory consumption list.)
    const isKnown = isInCategory("accessory", cat) || isInCategory("trim", cat);
    if (cat && !isKnown && !cat.includes(" ")) {
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
