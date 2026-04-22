// src/lib/codes.js
// Single source of truth for item_code / article_code normalization
// and case-insensitive database lookup helpers.
//
// Mirrors the DB triggers (fn_normalize_item_code) that run BEFORE INSERT/UPDATE
// on price_list, master_articles, and po_items. Any code the UI touches should
// go through normalizeItemCode() before being written to state, compared, or
// used in a query so that 'gpte38', ' GPTE38 ', and 'GPTE38' all behave identically.

/**
 * Normalize an item/article code to the canonical DB form (UPPER + TRIM).
 * Returns empty string for null/undefined so it's safe in template literals.
 *
 * @param {string|null|undefined} code
 * @returns {string}
 */
export function normalizeItemCode(code) {
  if (code === null || code === undefined) return '';
  return String(code).trim().toUpperCase();
}

/** Alias — some call sites read nicer as normalizeCode. */
export const normalizeCode = normalizeItemCode;

/**
 * True if two codes refer to the same SKU, ignoring case/whitespace.
 */
export function codesEqual(a, b) {
  return normalizeItemCode(a) === normalizeItemCode(b);
}

/**
 * Build a Supabase PostgREST filter fragment for case-insensitive exact match.
 * Because the DB trigger forces uppercase, a plain .eq() on the normalized
 * value is sufficient and fast (hits the unique index).
 *
 * Usage: supabase.from('price_list').select('*').eq('item_code', canonicalCode(code))
 */
export function canonicalCode(code) {
  return normalizeItemCode(code);
}

/**
 * Coerce a numeric value that may arrive as a string from PostgREST (numeric
 * columns come back stringified). Returns null for null/undefined/''.
 */
export function toNumber(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pieces-per-carton field name differs between tables:
 *   - price_list uses `qty_per_carton` (authoritative)
 *   - master_articles + po_items use `pieces_per_carton`
 * This helper reads whichever exists, preferring the first argument.
 */
export function readPiecesPerCarton(row) {
  if (!row) return null;
  return (
    toNumber(row.qty_per_carton) ??
    toNumber(row.pieces_per_carton) ??
    null
  );
}

/**
 * Compute CBM per carton from dimensions (in cm) → cubic meters.
 * cbm = L * W * H / 1,000,000
 */
export function computeCbmFromDims(length, width, height) {
  const L = toNumber(length);
  const W = toNumber(width);
  const H = toNumber(height);
  if (L === null || W === null || H === null) return null;
  return Number(((L * W * H) / 1_000_000).toFixed(6));
}

/**
 * Given a price_list row, return the canonical carton profile used elsewhere
 * in the UI. price_list is authoritative (post-Session 8 sync); callers
 * should prefer this over master_articles when both are available.
 */
export function cartonProfileFromPriceList(priceRow) {
  if (!priceRow) return null;
  return {
    pieces_per_carton: readPiecesPerCarton(priceRow),
    carton_length: toNumber(priceRow.carton_length),
    carton_width: toNumber(priceRow.carton_width),
    carton_height: toNumber(priceRow.carton_height),
    cbm_per_carton: toNumber(priceRow.cbm_per_carton),
  };
}
