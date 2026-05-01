// src/lib/partNameCanonical.js
//
// One job: turn any garment-part name (with whatever customer-specific
// qualifier or variant suffix) into a canonical short name PLUS the
// stripped variant info as separate metadata. Used in two places:
//
//   1. extract-document — when the AI extracts component_type, run it
//      through here so what gets stored in consumption_library and
//      tech_packs.part_dimensions is the canonical form. This means
//      different customer-spelled names line up automatically.
//
//   2. FabricWorking.resolveDims — defensive fallback at render time,
//      in case some legacy data has un-canonicalised values.
//
// Why we need this: the user's Fabric Working Sheet (2026-05-02) had
// blank dimensions for "Fitted Sheet (Split Head)" because the tech
// pack's part_dimensions used the bare key "Fitted Sheet". Different
// data sources spell the same physical part differently:
//
//     "Fitted Sheet"                     ← canonical
//     "Fitted Sheet (Split Head)"        ← variant
//     "Fitted Sheet (Split Top)"         ← variant
//     "Fitted Sheet (2pc Split)"         ← variant
//     "Fitted sheet and Split top..."    ← long-form descriptor
//
// All of these refer to a fitted-sheet COMPONENT. They differ only in
// construction detail, which is information that belongs in a separate
// `variant` column, not the canonical name.

// Aliases. Lower-cased for case-insensitive matching. Add more as
// real-world customer data exposes them.
const ALIASES = {
  // Sheet-set parts
  "flat sheet":                            "Flat Sheet",
  "flatsheet":                             "Flat Sheet",
  "top sheet":                             "Flat Sheet",
  "fitted sheet":                          "Fitted Sheet",
  "fittedsheet":                           "Fitted Sheet",
  "deep pocket fitted sheet":              "Fitted Sheet",
  "pillow case":                           "Pillow Case",
  "pillowcase":                            "Pillow Case",
  "pillow cases":                          "Pillow Case",
  "sham":                                  "Sham",
  "pillow sham":                           "Sham",
  "fabric bag":                            "Fabric Bag",
  "self fabric bag":                       "Fabric Bag",
  "self-fabric bag":                       "Fabric Bag",
  "drawstring bag":                        "Fabric Bag",

  // Mattress / encasement / protector parts
  "top fabric":                            "Top Fabric",
  "top":                                   "Top Fabric",
  "bottom":                                "Bottom",
  "bottom fabric":                         "Bottom",
  "skirt":                                 "Skirt",
  "border":                                "Skirt",
  "platform":                              "Platform",
  "binding":                               "Binding",
  "piping":                                "Piping",
  "filling":                               "Filling",
  "fill":                                  "Filling",
  "lamination":                            "Lamination",
  "evalon membrane":                       "Evalon Membrane",
  "sleeper flap":                          "Sleeper Flap",
  "front":                                 "Front",
  "back":                                  "Back",

  // Variant alternates (parens form is handled by VARIANT_REGEX strip-and-retry,
  // so only non-paren variants need explicit aliases)
  "pillow case 1pc":                       "Pillow Case",
  "pillow case 2pc":                       "Pillow Case",
  "split top fitted sheet":                "Fitted Sheet",
  "split head fitted sheet":               "Fitted Sheet",
  "fitted sheet and split top fitted sheet": "Fitted Sheet",
};

// Variant suffixes we recognise in parenthesized form. When stripped,
// they're recorded as the `variant` so downstream code can still tell
// "Fitted Sheet" apart from "Fitted Sheet (Split Head)" when it cares.
const VARIANT_REGEX = /\s*\(([^)]+)\)\s*$/;

/**
 * Canonicalise a part name.
 *
 * @param {string} input  e.g. "Fitted Sheet (Split Head)"
 * @returns {{ canonical: string, variant: string|null, raw: string }}
 *   canonical: short canonical name suitable for matching across data sources
 *              ("Fitted Sheet"); empty string if input is empty/unrecognised
 *              and we couldn't even extract a base form.
 *   variant:   the stripped qualifier ("split head") or null
 *   raw:       the trimmed input as given
 */
export function canonicalisePart(input) {
  if (input == null) return { canonical: "", variant: null, raw: "" };
  const raw = String(input).trim();
  if (!raw) return { canonical: "", variant: null, raw: "" };

  const lower = raw.toLowerCase();

  // 1. Direct hit on the alias table
  if (ALIASES[lower]) {
    return { canonical: ALIASES[lower], variant: null, raw };
  }

  // 2. Strip a trailing "(qualifier)" and try again
  const m = lower.match(VARIANT_REGEX);
  if (m) {
    const variant = m[1].trim();
    const stripped = lower.replace(VARIANT_REGEX, "").trim();
    if (ALIASES[stripped]) {
      return { canonical: ALIASES[stripped], variant, raw };
    }
    // Fall through: even the stripped form isn't recognised
    return {
      canonical: titleCase(stripped),
      variant,
      raw,
    };
  }

  // 3. No alias and no qualifier. Fall back to title-cased input.
  return { canonical: titleCase(lower), variant: null, raw };
}

/**
 * Convenience: canonical name only.
 */
export function canonicalPartName(input) {
  return canonicalisePart(input).canonical;
}

/**
 * True iff two part names refer to the same canonical part (regardless
 * of variant qualifier or capitalisation).
 */
export function partsEquivalent(a, b) {
  return canonicalPartName(a) === canonicalPartName(b);
}

function titleCase(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
