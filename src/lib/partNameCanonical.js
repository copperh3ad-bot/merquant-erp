// src/lib/partNameCanonical.js
//
// Thin shim over the central textileVocabulary. Kept as a separate module
// because it adds variant-stripping (parenthesized qualifier extraction)
// on top of the canonical-name lookup, and several call sites already
// import from here.
//
// canonicalisePart returns BOTH:
//   - canonical short name (via textileVocabulary.canonical("part", ...))
//   - variant qualifier extracted from "Foo (variant)" form
//
// The vocabulary module owns the alias table; don't duplicate part-name
// aliases here. Add new ones to textileVocabulary.PART_NAMES.

import { canonical as vocabCanonical } from "./textileVocabulary";

const VARIANT_REGEX = /\s*\(([^)]+)\)\s*$/;

/**
 * Canonicalise a part name and split off any (qualifier).
 *
 * @param {string} input  e.g. "Fitted Sheet (Split Head)"
 * @returns {{ canonical: string, variant: string|null, raw: string }}
 *   canonical: short canonical name from textileVocabulary, or
 *              title-cased fallback for unknown inputs.
 *   variant:   the stripped qualifier ("split head") or null
 *   raw:       the trimmed input as given
 */
export function canonicalisePart(input) {
  if (input == null) return { canonical: "", variant: null, raw: "" };
  const raw = String(input).trim();
  if (!raw) return { canonical: "", variant: null, raw: "" };

  // 1. Try direct lookup in the vocabulary
  const direct = vocabCanonical("part", raw);
  if (direct) return { canonical: direct, variant: null, raw };

  // 2. Strip "(qualifier)" and retry
  const m = raw.match(VARIANT_REGEX);
  if (m) {
    const variant = m[1].trim().toLowerCase();
    const stripped = raw.replace(VARIANT_REGEX, "").trim();
    const c = vocabCanonical("part", stripped);
    if (c) return { canonical: c, variant, raw };
    // Even the stripped form isn't recognised; return title-cased + variant
    return { canonical: titleCase(stripped), variant, raw };
  }

  // 3. No alias and no qualifier. Title-case fallback.
  return { canonical: titleCase(raw), variant: null, raw };
}

/** Convenience: canonical name only. */
export function canonicalPartName(input) {
  return canonicalisePart(input).canonical;
}

/** True iff two part names refer to the same canonical part. */
export function partsEquivalent(a, b) {
  return canonicalPartName(a) === canonicalPartName(b);
}

function titleCase(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
