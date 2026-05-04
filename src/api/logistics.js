// src/api/logistics.js
//
// Domain module: shipments, invoices, packing, shipping documentation.
// Re-exports from supabaseClient.js — see orders.js header for rationale.

export {
  shippingDocs,
  packingLists,
  commercialInvoices,
} from './supabaseClient';
