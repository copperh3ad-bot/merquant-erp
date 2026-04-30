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

// Common abbreviation expansions seen in BOB barcode-image labels. The vision
// model often returns the abbreviated text printed under the barcode while
// the SKU's stored size is the full size name. Pairs are bidirectional —
// either side may appear in the OCR result OR the tech-pack row's size field,
// and we match if any expansion of one form is contained in the other.
const ABBREVIATIONS = [
  ["CAL KING",         "CK"],
  ["SPLIT CAL KING",   "SCK"],
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

// Build the union of normalised aliases for a given size string. Includes
// the original form plus any abbreviation expansion in either direction.
function sizeAliases(sizeStr) {
  const base = norm(sizeStr);
  if (!base) return new Set();
  const out = new Set([base]);
  for (const [longF, shortF] of ABBREVIATIONS) {
    if (base === norm(longF)) out.add(norm(shortF));
    if (base === norm(shortF)) out.add(norm(longF));
    // Substring relationship — the SKU size may include extra qualifiers
    // ("KING PILLOW PROTECTOR" contains "KING") so the abbreviation is
    // also a valid alias when the long form appears as a substring.
    if (base.includes(norm(longF))) out.add(norm(shortF));
    if (base.includes(norm(shortF))) out.add(norm(longF));
  }
  return out;
}

// Score how well two size strings match. Higher = more specific.
//   3  exact normalised equality (handles whitespace + punctuation)
//   2  alias / abbreviation equivalence (CAL KING ↔ CK)
//   1  word-token containment (KING ⊂ KING PILLOW PROTECTOR)
//   0  no match
//
// Used by matchOcrResultsToTechPacks to PREFER exact matches over fuzzy
// ones — without scoring, a greedy first-match would let "QUEEN" shadow
// "SLEEPER - QUEEN" simply because it appeared earlier in the OCR list.
export function sizeMatchScore(skuSize, ocrSize) {
  const a = norm(skuSize);
  const b = norm(ocrSize);
  if (!a || !b) return 0;
  if (a === b) return 3;

  const aliasesA = sizeAliases(a);
  const aliasesB = sizeAliases(b);
  for (const x of aliasesA) if (aliasesB.has(x)) return 2;

  // Word-token containment. Require at least one multi-letter word on each
  // side to avoid spurious "K" / "Q" hits.
  const wordsA = a.split(" ").filter(Boolean);
  const wordsB = b.split(" ").filter(Boolean);
  const hasSignificantWord = (ws) => ws.some((w) => w.length >= 3);
  if (!hasSignificantWord(wordsA) || !hasSignificantWord(wordsB)) return 0;
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  return shorter.every((w) => longer.includes(w)) ? 1 : 0;
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

  const pairs = [];
  for (const tp of techPacks) {
    const skuSize = getTechPackSize(tp);
    if (!skuSize) continue;

    // Score every OCR result and pick the highest-scoring one. Without
    // scoring, a greedy first-match would let a generic "QUEEN" entry
    // shadow a more-specific "SLEEPER - QUEEN" entry just because it
    // appeared earlier in the result array.
    let best = null;
    let bestScore = 0;
    for (const r of ocrResults) {
      if (!r || !r.size || !r.barcode) continue;
      const score = sizeMatchScore(skuSize, r.size);
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    if (best) pairs.push({ tp, match: best });
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
