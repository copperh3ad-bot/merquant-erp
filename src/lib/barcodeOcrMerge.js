/**
 * barcodeOcrMerge.js
 *
 * Shared helpers for merging extract-barcodes OCR results onto tech_packs
 * rows. Used in two places:
 *   1. Inline during BOB upload (TechPacks.jsx upload flow)
 *   2. The Re-extract barcodes button on the TechPacks page
 *
 * Keeps the matching + merge logic pure so it can be unit-tested without
 * mocking Supabase storage / edge functions.
 */

// Normalize a size string for matching: uppercase, trim, collapse whitespace,
// strip punctuation that varies between sources ("." / "-" / "_" / "/").
// Examples:
//   "SPLIT  CAL KING"     → "SPLIT CAL KING"     (double space → single)
//   " Cal-King "          → "CAL KING"           (case + dash + trim)
//   "FT2 / Cool-S Frio"   → "FT2 COOL S FRIO"
const norm = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[._\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Common abbreviation pairs seen in BOB barcode-image labels. The vision
// model may return either the abbreviated form ("CK") or the full long
// name ("CALIFORNIA KING") while the SKU's stored size is something else
// (typically "CAL KING"). Pairs are bidirectional, EXACT-match only —
// substring expansion was dropped in v3 because it produced false
// positives (e.g. "KING" aliasing to "KING PILLOW PROTECTOR").
const ABBREVIATIONS = [
  ["CAL KING",         "CK"],
  ["CAL KING",         "CALIFORNIA KING"],     // full name from Vision
  ["SPLIT CAL KING",   "SCK"],
  ["SPLIT CAL KING",   "SPLIT CALIFORNIA KING"],
  ["SPLIT HEAD QUEEN", "SHQ"],
  ["SPLIT HEAD KING",  "SHK"],
  ["SLEEPER QUEEN",    "SQ"],
  ["SLEEPER KING",     "SK"],
  ["SLEEPER TWIN",     "ST"],
  ["SLEEPER FULL",     "SF"],
  ["TWIN XL",          "TXL"],
  ["FULL XL",          "FXL"],
  ["KING PILLOW PROTECTOR",  "KING PP"],
  ["QUEEN PILLOW PROTECTOR", "QUEEN PP"],
  ["KING PILLOW PROTECTOR",  "K PP"],
  ["QUEEN PILLOW PROTECTOR", "Q PP"],
];

// Build the union of normalised aliases for a size string. EXACT-pair only;
// no substring expansion (which previously let "KING" alias as "KING PILLOW
// PROTECTOR" via containment).
function sizeAliases(sizeStr) {
  const base = norm(sizeStr);
  if (!base) return new Set();
  const out = new Set([base]);
  for (const [a, b] of ABBREVIATIONS) {
    if (base === norm(a)) out.add(norm(b));
    if (base === norm(b)) out.add(norm(a));
  }
  return out;
}

function wordSet(s) {
  return new Set(norm(s).split(" ").filter(Boolean));
}
function sameWordSet(a, b) {
  if (a.size !== b.size || a.size === 0) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// Score how well two size strings match. Higher = more specific.
//   3.0  exact normalised equality (handles whitespace + punctuation)
//   2.0  alias / abbreviation equivalence (CAL KING ↔ CK ↔ CALIFORNIA KING)
//   1.5  same word set, different order (SPLIT HEAD KING ↔ KING SPLIT HEAD)
//   1.0  word containment (KING ⊂ KING PILLOW PROTECTOR) — lowest priority
//   0    no match
//
// Score-priority + 1:1 assignment in matchOcrResultsToTechPacks() ensures
// generic OCR labels only fill in for SKUs that didn't get a more-specific
// match. Without that, a "KING" entry could greedily steal a barcode
// from CAL KING / SPLIT HEAD KING / KING PILLOW PROTECTOR all at once.
export function sizeMatchScore(skuSize, ocrSize) {
  const a = norm(skuSize);
  const b = norm(ocrSize);
  if (!a || !b) return 0;
  if (a === b) return 3;

  const aliasesA = sizeAliases(a);
  const aliasesB = sizeAliases(b);
  for (const x of aliasesA) if (aliasesB.has(x)) return 2;

  const wA = wordSet(a);
  const wB = wordSet(b);
  if (sameWordSet(wA, wB)) return 1.5;

  // Word containment — require at least one significant (3+ char) word on
  // each side to avoid "K" / "Q" style false positives.
  const hasSig = (set) => Array.from(set).some((w) => w.length >= 3);
  if (!hasSig(wA) || !hasSig(wB)) return 0;
  const [smaller, bigger] = wA.size <= wB.size ? [wA, wB] : [wB, wA];
  for (const w of smaller) if (!bigger.has(w)) return 0;
  return 1;
}

// Convenience boolean wrapper kept for backward compatibility with tests.
export function sizesMatch(skuSize, ocrSize) {
  return sizeMatchScore(skuSize, ocrSize) > 0;
}

/**
 * Find the SKU size carried by a tech_packs row. The size lives in slightly
 * different places depending on whether the row was created by the BOB fast
 * path (extracted_data.this_sku.size) or the AI path (extracted_data.size).
 */
export function getTechPackSize(tp) {
  return norm(tp?.extracted_data?.this_sku?.size || tp?.extracted_data?.size || "");
}

/**
 * Pair each tech-pack row with the OCR result whose `size` matches the row's
 * SKU size. Rows that don't match any OCR result are dropped from the output.
 *
 * Matching uses the lenient `sizesMatch()` rules so OCR-printed
 * abbreviations ("CK", "SHQ"), whitespace artefacts ("SPLIT  CAL KING" with
 * a double space), and partial labels ("KING" vs "KING PILLOW PROTECTOR")
 * all pair correctly with their canonical SKU size string.
 *
 * @param {Array<{size?:string, barcode?:string, image_index?:number, image_path?:string}>} ocrResults
 * @param {Array} techPacks
 * @returns {Array<{tp: object, match: object}>}
 */
export function matchOcrResultsToTechPacks(ocrResults, techPacks) {
  if (!Array.isArray(ocrResults) || ocrResults.length === 0) return [];
  if (!Array.isArray(techPacks) || techPacks.length === 0) return [];

  // 1:1 greedy assignment. Build all (tp, ocr, score) triples, sort by score
  // descending, then walk through claiming each side at most once. Ensures
  // a generic "KING" entry can't steal the barcode from CAL KING /
  // SPLIT HEAD KING / KING PILLOW PROTECTOR all at once — the most-specific
  // match (highest score) wins for each barcode, and any leftover SKU only
  // pairs with a leftover OCR result.
  const candidates = [];
  for (let tpIdx = 0; tpIdx < techPacks.length; tpIdx++) {
    const skuSize = getTechPackSize(techPacks[tpIdx]);
    if (!skuSize) continue;
    for (let ocrIdx = 0; ocrIdx < ocrResults.length; ocrIdx++) {
      const r = ocrResults[ocrIdx];
      if (!r || !r.size || !r.barcode) continue;
      const score = sizeMatchScore(skuSize, r.size);
      if (score > 0) candidates.push({ tpIdx, ocrIdx, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);

  const usedTp = new Set();
  const usedOcr = new Set();
  const pairs = [];
  for (const c of candidates) {
    if (usedTp.has(c.tpIdx) || usedOcr.has(c.ocrIdx)) continue;
    usedTp.add(c.tpIdx);
    usedOcr.add(c.ocrIdx);
    pairs.push({ tp: techPacks[c.tpIdx], match: ocrResults[c.ocrIdx] });
  }
  return pairs;
}

/**
 * Build the new extracted_data JSON for a tech-pack row when applying an
 * OCR match. Preserves all existing extracted_data fields and only adds /
 * overwrites `upc`. The `upc` shape matches what descriptionResolver.js
 * reads when populating pc_ean_code on Sticker / Insert Card tabs.
 *
 * @param {object} tp     - tech_packs row
 * @param {object} match  - { size, barcode } from extract-barcodes
 * @returns {object}      - new extracted_data JSON
 */
export function buildUpcUpdate(tp, match) {
  const upc = [
    {
      size: match.size,
      our_sku: tp?.article_code || null,
      bob_sku: match.barcode,
    },
  ];
  return { ...(tp?.extracted_data || {}), upc };
}

/**
 * One-shot helper: given OCR results and a list of tech_packs rows from the
 * same upload, return an array of update commands `[{ id, extracted_data }]`
 * ready to push to Supabase. Rows with no matching OCR result are omitted.
 *
 * @param {Array} ocrResults
 * @param {Array} techPacks
 * @returns {Array<{id: string, extracted_data: object}>}
 */
export function computeBarcodeUpdates(ocrResults, techPacks) {
  return matchOcrResultsToTechPacks(ocrResults, techPacks).map(({ tp, match }) => ({
    id: tp.id,
    extracted_data: buildUpcUpdate(tp, match),
  }));
}
