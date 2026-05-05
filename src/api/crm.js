// src/api/crm.js
//
// Domain module: RFQs, quotations, buyers, suppliers, complaints, comms.
// Re-exports from supabaseClient.js — see orders.js header for rationale.
//
// Note: there is no top-level `suppliers` API in supabaseClient today;
// suppliers are accessed directly via `supabase.from('suppliers')` in
// the few pages that need them. Wrapping that into a helper is a
// future cleanup, not part of S1.

export {
  rfqs,
  quotations,
  buyerContacts,
  complaints,
  commsLog,
} from './supabaseClient';
