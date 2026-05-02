// src/lib/skuSizeInference.js
//
// Infer a human-readable size label (e.g. "Queen", "Cal King", "Twin XL")
// from an SKU article code. Used by the PO import flow as a last-resort
// fallback when neither po_items nor consumption_library carry a size.
//
// Convention across MerQuant SKU codes:
//   - Sheet sets / sheet-set variants (PCSJMO-, SLPCSS-): SIZE is the
//     middle hyphen-delimited segment, e.g. PCSJMO-CK-MB → "CK".
//   - Pillow / mattress protectors (GPMP, GPSE, GPTE, GPFRIOMP, ...):
//     SIZE is a numeric suffix matching the encoded mattress size,
//     e.g. GPMP38 → 38" deep, GPMP78 → 78" wide.
//
// We only handle the alphabetic suffix family for now; numeric sizes
// (38/46/50/...) are passed through unchanged because they're already
// human-meaningful.
//
// 2026-05-02 — migrated to read sizes + colour codes from the central
// textileVocabulary. Both lists used to live here as a hardcoded copy of
// the vocab — the duplication caused drift (e.g. when the vocab grew a
// new "Cloud Gray" canonical we'd forget to mirror it here, and SKUs
// ending in -CG would get mis-classified as a size). Now there's one
// source of truth: textileVocabulary.SIZES + .COLOURS.

import { canonical, isInCategory } from "@/lib/textileVocabulary";

/**
 * Extract the SIZE token from an SKU code, then map to a label.
 *
 * @param {string} articleCode  e.g. "SLPCSS-KCK-GY", "PCSJMO-Q-MB", "GPMP38"
 * @returns {string|null}       e.g. "King/Cal King", "Queen", "38"
 */
export function inferSizeFromSku(articleCode) {
  if (!articleCode || typeof articleCode !== "string") return null;
  const code = articleCode.trim();
  if (!code) return null;

  // Strategy 1 — hyphenated SKU. The size is typically the second
  // segment (between the first and second hyphen): "FAMILY-SIZE-COLOR".
  const segments = code.split("-").map((s) => s.trim()).filter(Boolean);
  if (segments.length >= 2) {
    // Try second segment first (the standard PCSJMO / SLPCSS layout).
    const candidate = segments[1];
    const sizeLabel = canonical("size", candidate);
    if (sizeLabel) return sizeLabel;

    // Some SKUs are just "FAMILY-SIZE" without a color. If the second
    // segment isn't a known color, try treating it as a size anyway —
    // but only return if we have a label for it, otherwise fall through.
    if (!isInCategory("colour", candidate)) {
      // Unknown alphabetic code — return the raw code so the operator at
      // least sees it on the working sheet rather than blank. Numeric
      // codes pass through too (e.g. "38" for GPMP38 if it was hyphenated).
      if (/^[A-Z0-9]{1,5}$/i.test(candidate)) return candidate;
    }
  }

  // Strategy 2 — non-hyphenated SKU with numeric tail (e.g. GPMP38, GPTE50).
  // The trailing digits are the size in inches.
  const numericTail = code.match(/^([A-Z]+?)(\d+)$/i);
  if (numericTail) {
    return numericTail[2]; // e.g. "38", "50", "78"
  }

  return null;
}

/**
 * Compose a productSize fallback chain. Caller passes its own primary
 * sources; we add SKU inference as the FINAL fallback.
 *
 * @param {object} sources
 * @param {string} [sources.finishDimensions]
 * @param {string} [sources.itemSize]
 * @param {string} [sources.consumptionLibrarySize]
 * @param {string} [sources.articleCode]
 * @returns {string|null}
 */
export function resolveProductSize({ finishDimensions, itemSize, consumptionLibrarySize, articleCode } = {}) {
  return (
    (finishDimensions && String(finishDimensions).trim()) ||
    (itemSize && String(itemSize).trim()) ||
    (consumptionLibrarySize && String(consumptionLibrarySize).trim()) ||
    inferSizeFromSku(articleCode) ||
    null
  );
}
