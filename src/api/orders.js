// src/api/orders.js
//
// Domain module: PO + order-flow APIs. Re-exports from the canonical
// supabaseClient.js so we keep a single source of truth (the brief's
// "Never modify existing business logic, function signatures, or API
// response shapes" rule rules out moving the implementations). Pages
// can opt-in to importing from this module for clarity, but anything
// already importing from supabaseClient continues to work unchanged.
//
// If the canonical implementations are ever moved into this file,
// supabaseClient.js can flip to importing FROM here. For now, this
// is a thin re-export shell.

export {
  db,                  // .purchaseOrders, .poItems
  skuQueue,
  poBatches,
  batchItems,
  splitSnapshots,
  changeLog,
  discrepancies,
} from './supabaseClient';
