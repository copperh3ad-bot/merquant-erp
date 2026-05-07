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
