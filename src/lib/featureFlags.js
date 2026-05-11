// Feature-flag helper.
//
// Phase-2 SOP modules (Samples, RFQs, Compliance, MTA KPI dashboard
// widget, PO strategy badge) ship on the feature branch but stay UI-
// invisible until the flag is flipped. This lets us merge the feature
// branch into main without exposing unfinished work to beta testers.
//
// The flag is read from a Vite env var at build time:
//   VITE_ENABLE_MTA_EXTENSIONS=true   → modules visible
//   (anything else, or unset)         → modules hidden
//
// To enable in dev: add to .env.local
//   VITE_ENABLE_MTA_EXTENSIONS=true
// then restart `npm run dev`.
//
// To enable in production: set the env var on the build host (Netlify
// site env vars, Vercel project env, etc.) and trigger a rebuild.
//
// Runtime override (dev/QA only — owner-only): localStorage flag wins
// over the env var when set. Lets us flip a single browser session on
// without redeploying.
//   localStorage.setItem('mq_flag_mta_extensions', 'on')
//   localStorage.removeItem('mq_flag_mta_extensions')
//
// To remove the flag entirely (after the modules have shipped to all
// users), inline `mtaExtensionsEnabled()` calls as `true` and delete
// this file.

const FLAG_KEY = "mq_flag_mta_extensions";

export function mtaExtensionsEnabled() {
  // Local storage override takes priority — lets the Owner flip a single
  // session without rebuilding.
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const ls = window.localStorage.getItem(FLAG_KEY);
      if (ls === "on")  return true;
      if (ls === "off") return false;
    }
  } catch { /* SSR / private mode — fall through to env */ }

  // Vite static replacement at build time. Will be `undefined` if the
  // env var isn't set in the build host.
  const envFlag = (import.meta.env?.VITE_ENABLE_MTA_EXTENSIONS ?? "").toString().trim().toLowerCase();
  return envFlag === "true" || envFlag === "1" || envFlag === "yes";
}

// ── Gap-closure feature flags (MAS → ERP backport, 2026-05) ─────────────────
// Each flag is on by default (safe, additive). Set localStorage key to "off"
// to disable in a specific browser session without redeploying:
//   localStorage.setItem('mq_flag_<key>', 'off')

function _readFlag(key, defaultOn = true) {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const ls = window.localStorage.getItem(`mq_flag_${key}`);
      if (ls === "on")  return true;
      if (ls === "off") return false;
    }
  } catch { /* SSR / private mode */ }
  return defaultOn;
}

// Unapply extraction: show "Undo Apply" button in AIExtractionReview for editors
export const ENABLE_UNAPPLY_EXTRACTION = () => _readFlag("unapply_extraction", true);

// BOM blocked state: render inline error card instead of crashing when
// explode_po_bom returns { status: "blocked" }
export const ENABLE_BOM_BLOCKED_UI    = () => _readFlag("bom_blocked_ui", true);

// Data-gaps banner: async completeness check shown in PODetail header
export const ENABLE_DATA_GAPS_BANNER  = () => _readFlag("data_gaps_banner", true);

// Price backfill: useEffect that fills missing unit prices from price_list
export const ENABLE_PRICE_BACKFILL    = () => _readFlag("price_backfill", true);

// logDataError in critical upload paths (FileFeeder, PO import, CSV upload)
export const ENABLE_UPLOAD_ERROR_LOG  = () => _readFlag("upload_error_log", true);

// Master data gaps banner: dashboard nag for consumption_library fabric
// components that have a fabric_type set but no consumption_per_unit.
export const ENABLE_MASTER_DATA_GAPS_BANNER = () => _readFlag("master_data_gaps_banner", true);
