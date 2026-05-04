// src/api/admin.js
//
// Domain module: user profiles, teams, notifications, RBAC, seasons,
// production reference data, email crawler, compliance docs.
// Re-exports from supabaseClient.js — see orders.js header for rationale.

export {
  rbac,
  customerTeams,
  notificationsAPI,
  seasons,
  production,
  emailCrawl,
  compliance,
} from './supabaseClient';
