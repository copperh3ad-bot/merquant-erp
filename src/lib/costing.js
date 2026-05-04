// src/lib/costing.js
//
// Phase-3 hardening (Q3). Centralised pure-function helpers for costing
// and BOM math. Extracted from inline definitions in CostingSheet.jsx
// and YarnPlanning.jsx so they can be unit-tested without rendering a
// React tree.
//
// All functions are pure: same inputs → same outputs, no side effects,
// no Supabase calls. The formulas are the single source of truth and
// the inline copies in the pages now re-export from here.
//
// Conventions:
//   • Numbers are coerced via Number(...) || 0 so missing fields don't
//     poison the math.
//   • Currency-like results are rounded to 4 decimals (matches the
//     existing CostingSheet behaviour and the costing_sheets DB
//     column scale).
//   • Percentages are rounded to 2 decimals.

/**
 * Cost-of-goods-sold and gross margin from a costing-sheet row's raw
 * fields. Mirrors the formula in `costing_sheets`:
 *
 *   subtotal       = fabric + trim + accessory + embellishment + cm + wash
 *   overhead       = subtotal × overhead_pct%
 *   commission     = buyer_price × agent_commission_pct%
 *   total_cogs     = subtotal + overhead + freight + commission
 *   gross_margin   = buyer_price − total_cogs
 *   gross_margin_% = gross_margin / buyer_price × 100   (0 when buyer_price ≤ 0)
 *
 * @param {object} f raw form / row with the cost fields
 * @returns {{ total_cogs:number, gross_margin:number, gross_margin_pct:number }}
 */
export function calcCosting(f) {
  const fabric = Number(f.fabric_cost) || 0;
  const trim   = Number(f.trim_cost) || 0;
  const acc    = Number(f.accessory_cost) || 0;
  const emb    = Number(f.embellishment_cost) || 0;
  const cm     = Number(f.cm_cost) || 0;
  const wash   = Number(f.washing_cost) || 0;
  const subtotal   = fabric + trim + acc + emb + cm + wash;
  const overhead   = +(subtotal * (Number(f.overhead_pct) || 0) / 100).toFixed(4);
  const freight    = Number(f.freight_cost) || 0;
  const buyer_price = Number(f.buyer_price) || 0;
  const commission = +(buyer_price * (Number(f.agent_commission_pct) || 0) / 100).toFixed(4);
  const total_cogs   = +(subtotal + overhead + freight + commission).toFixed(4);
  const gross_margin = +(buyer_price - total_cogs).toFixed(4);
  const gross_margin_pct = buyer_price > 0
    ? +((gross_margin / buyer_price) * 100).toFixed(2)
    : 0;
  return { total_cogs, gross_margin, gross_margin_pct };
}

/**
 * Yarn weight in kg from fabric specifications.
 *
 *   yarn_kg = meters × GSM × width(cm) / 39.37 / 1000
 *
 * Returns 0 if any of the three inputs is falsy (so an empty form
 * doesn't render NaN).
 */
export function toYarnKg(meters, gsm, width) {
  if (!meters || !gsm || !width) return 0;
  return +(meters * gsm * width / 39.37 / 1000).toFixed(2);
}

/**
 * Total fabric required for a single article component:
 *
 *   total = consumption_per_unit × order_qty × (1 + wastage_percent/100)
 *
 * Mirrors recalcComponents() in articleUtils.js but operates on a
 * single component triple, which is more convenient for tests and ad-hoc
 * callers that don't have the full components array handy.
 */
export function fabricTotalRequired(consumption_per_unit, order_qty, wastage_percent) {
  const cpu = Number(consumption_per_unit) || 0;
  const qty = Number(order_qty) || 0;
  const wp  = Number(wastage_percent) || 0;
  const net = cpu * qty;
  return +(net * (1 + wp / 100)).toFixed(4);
}

/**
 * Trim quantity for `Per Piece` calc-type:
 *   ceil(order_qty × consumption × (1 + wastage%))
 */
export function trimQtyPerPiece(order_qty, consumption, wastage_percent) {
  const qty = Number(order_qty) || 0;
  const c   = Number(consumption) || 0;
  const wp  = Number(wastage_percent) || 0;
  return Math.ceil(qty * c * (1 + wp / 100));
}

/**
 * Trim quantity for `Per Meter` calc-type:
 *   ceil(fabric_meters × consumption × (1 + wastage%))
 */
export function trimQtyPerMeter(fabric_meters, consumption, wastage_percent) {
  const m  = Number(fabric_meters) || 0;
  const c  = Number(consumption) || 0;
  const wp = Number(wastage_percent) || 0;
  return Math.ceil(m * c * (1 + wp / 100));
}

/**
 * Trim quantity for `Percentage` calc-type:
 *   ceil(order_qty × pct% × (1 + wastage%))
 */
export function trimQtyPercentage(order_qty, pct, wastage_percent) {
  const qty = Number(order_qty) || 0;
  const p   = Number(pct) || 0;
  const wp  = Number(wastage_percent) || 0;
  return Math.ceil(qty * (p / 100) * (1 + wp / 100));
}

/**
 * Packaging incl. wastage:
 *   ceil(qty × multiplier × (1 + wastage%))
 */
export function packagingQty(qty, multiplier, wastage_percent) {
  const q  = Number(qty) || 0;
  const m  = Number(multiplier) || 1;
  const wp = Number(wastage_percent) || 0;
  return Math.ceil(q * m * (1 + wp / 100));
}

/**
 * Carton CBM from physical dimensions (cm) × number of cartons.
 *   cbm = (L × W × H) / 1,000,000 × num_cartons
 */
export function cbmFromDimensions(L, W, H, num_cartons) {
  const l = Number(L) || 0;
  const w = Number(W) || 0;
  const h = Number(H) || 0;
  const n = Number(num_cartons) || 0;
  return +((l * w * h) / 1_000_000 * n).toFixed(6);
}

/**
 * Carton CBM looked up via the price-list cbm_per_carton:
 *   cbm = ceil(qty / pcs_per_carton) × cbm_per_carton
 */
export function cbmFromPriceList(qty, pcs_per_carton, cbm_per_carton) {
  const q   = Number(qty) || 0;
  const ppc = Number(pcs_per_carton) || 0;
  const cpc = Number(cbm_per_carton) || 0;
  if (ppc <= 0) return 0;
  return +(Math.ceil(q / ppc) * cpc).toFixed(6);
}
