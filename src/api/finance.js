// src/api/finance.js
//
// Domain module: costing, payments, pricing.
// Re-exports from supabaseClient.js — see orders.js header for rationale.

export {
  costing,
  payments,
  priceList,
  priceListV2,
  masterArticlesV2,
  accessoryPOs,
} from './supabaseClient';
