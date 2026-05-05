// src/api/materials.js
//
// Domain module: fabric, yarn, trims, accessories, packaging, templates.
// Re-exports from supabaseClient.js — see orders.js header for the
// rationale behind the re-export pattern.
//
// `mfg` is a compound containing articles + fabricTemplates + yarn +
// trims + accessories + jobCards. We re-export the whole compound
// here for materials-flow callers; jobCards is also re-exported from
// tracking.js since it logically straddles materials and tracking.

export {
  mfg,                  // .articles, .fabricTemplates, .yarn, .trims, .accessories, .jobCards
  accessoryTemplates,
  articlePackaging,
  fabricOrders,
} from './supabaseClient';
