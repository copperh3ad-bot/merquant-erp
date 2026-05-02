// src/lib/unitSystem.js
//
// Per-user unit-system preference: "metric" (cm + GSM, the SI default
// the system stores internally) vs "imperial" (inches + oz/sq.yd, what
// US-based buyers + operators tend to read).
//
// Storage convention: ALL persisted numeric values stay in metric SI
// units (width_cm, gsm). The unit system is purely a display + input
// preference — when the user picks imperial we convert at the edge.
// This means switching the toggle never alters DB rows or breaks any
// historical numbers.
//
// 2026-05-02 — added per Waqas's request "by default system should
// allow user to select SI unit system, width should be in inches or cm,
// fabric weight in gsm or ozsqyd as per the SI unit selected".
//
// Phase 1 surface area: settings toggle + FabricWorking width column.
// Phase 2 (TODO): roll out to every width / GSM display point in
// Articles, Trims, Packaging, FabricEditDialog, SKUReviewDialog.

export const UNIT_SYSTEMS = ["metric", "imperial"];
export const DEFAULT_UNIT_SYSTEM = "metric";
const STORAGE_KEY = "mq_unit_system";

// ── Storage (localStorage; later: per-user DB row) ───────────────────

export function getUnitSystem() {
  try {
    const v = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) || DEFAULT_UNIT_SYSTEM;
    return UNIT_SYSTEMS.includes(v) ? v : DEFAULT_UNIT_SYSTEM;
  } catch {
    return DEFAULT_UNIT_SYSTEM;
  }
}

export function setUnitSystem(system) {
  if (!UNIT_SYSTEMS.includes(system)) return;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, system);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("mq-unit-system-changed"));
  } catch {
    /* no-op — preference is a UX nicety, not critical */
  }
}

// ── Conversions ──────────────────────────────────────────────────────

const CM_PER_INCH = 2.54;
// Standard textile conversion: 1 oz/sq.yd = 33.906 g/m². Source: ISO 3801.
const GSM_PER_OZSQYD = 33.9057;

export function cmToInches(cm) {
  if (cm == null || isNaN(cm)) return null;
  return Number(cm) / CM_PER_INCH;
}

export function inchesToCm(inches) {
  if (inches == null || isNaN(inches)) return null;
  return Number(inches) * CM_PER_INCH;
}

export function gsmToOzSqYd(gsm) {
  if (gsm == null || isNaN(gsm)) return null;
  return Number(gsm) / GSM_PER_OZSQYD;
}

export function ozSqYdToGsm(oz) {
  if (oz == null || isNaN(oz)) return null;
  return Number(oz) * GSM_PER_OZSQYD;
}

// ── Display formatters ───────────────────────────────────────────────

/**
 * Format a width stored in cm into the user's preferred unit string.
 * Returns "—" for null/empty input so callers can drop it directly into
 * a table cell.
 */
export function formatWidth(cm, system = getUnitSystem()) {
  if (cm == null || cm === "" || isNaN(Number(cm))) return "—";
  if (system === "imperial") {
    const inches = cmToInches(cm);
    return `${inches.toFixed(1)} in`;
  }
  return `${Number(cm).toFixed(0)} cm`;
}

/**
 * Format a fabric weight stored in GSM (g/m²) into the user's preferred
 * unit string.
 */
export function formatWeight(gsm, system = getUnitSystem()) {
  if (gsm == null || gsm === "" || isNaN(Number(gsm))) return "—";
  if (system === "imperial") {
    const oz = gsmToOzSqYd(gsm);
    return `${oz.toFixed(2)} oz/sq.yd`;
  }
  return `${Number(gsm).toFixed(0)} GSM`;
}

/** Returns the unit suffix for the current system, used in headers/labels. */
export function widthUnitLabel(system = getUnitSystem()) {
  return system === "imperial" ? "in" : "cm";
}

export function weightUnitLabel(system = getUnitSystem()) {
  return system === "imperial" ? "oz/sq.yd" : "GSM";
}
