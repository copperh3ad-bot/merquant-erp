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

const norm = (s) => String(s || "").toUpperCase().trim();

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
    const match = ocrResults.find(
      (r) => r && r.size && r.barcode && norm(r.size) === skuSize
    );
    if (match) pairs.push({ tp, match });
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
