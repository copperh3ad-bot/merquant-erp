// src/api/tracking.js
//
// Domain module: T&A, lab dips, samples, QC, tech packs, job cards,
// print layouts. Re-exports from supabaseClient.js — see orders.js
// header for rationale.

export {
  tna,
  labDips,
  samples,
  qcInspections,
  techPacks,
  jobCards,
  printLayouts,
} from './supabaseClient';
