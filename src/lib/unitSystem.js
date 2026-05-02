// src/lib/unitSystem.js
//
// Unit-system display helpers: "metric" (cm + GSM, the SI default the
// system stores internally) vs "imperial" (inches + oz/sq.yd, what
// US-based buyers + operators tend to read).
//
// Storage convention: ALL persisted numeric values stay in metric SI
// units (width_cm, gsm). The unit system is purely a display + input
// preference — when the caller picks imperial we convert at the edge.
// This means switching the toggle never alters DB rows or breaks any
// historical numbers.
//
// 2026-05-03 — switched from a global per-user toggle (localStorage)
// to a per-PO selection persisted on purchase_orders.unit_system.
// Different customers / orders use different conventions; saving on
// the PO row means everyone working that PO sees the same units.
// Callers read activePo?.unit_system || DEFAULT_UNIT_SYSTEM and pass
// it into the formatters below.

export const UNIT_SYSTEMS = ["metric", "imperial"];
export const DEFAULT_UNIT_SYSTEM = "metric";

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
 * Format a width stored in cm into the caller's chosen unit string.
 * Returns "—" for null/empty input so callers can drop it directly into
 * a table cell.
 */
export function formatWidth(cm, system = DEFAULT_UNIT_SYSTEM) {
  if (cm == null || cm === "" || isNaN(Number(cm))) return "—";
  if (system === "imperial") {
    const inches = cmToInches(cm);
    return `${inches.toFixed(1)} in`;
  }
  return `${Number(cm).toFixed(0)} cm`;
}

/**
 * Format a fabric weight stored in GSM (g/m²) into the caller's chosen
 * unit string.
 */
export function formatWeight(gsm, system = DEFAULT_UNIT_SYSTEM) {
  if (gsm == null || gsm === "" || isNaN(Number(gsm))) return "—";
  if (system === "imperial") {
    const oz = gsmToOzSqYd(gsm);
    return `${oz.toFixed(2)} oz/sq.yd`;
  }
  return `${Number(gsm).toFixed(0)} GSM`;
}

/** Returns the unit suffix for the current system, used in headers/labels. */
export function widthUnitLabel(system = DEFAULT_UNIT_SYSTEM) {
  return system === "imperial" ? "in" : "cm";
}

export function weightUnitLabel(system = DEFAULT_UNIT_SYSTEM) {
  return system === "imperial" ? "oz/sq.yd" : "GSM";
}
