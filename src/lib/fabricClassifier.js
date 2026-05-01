// src/lib/fabricClassifier.js
// Fabric-vs-accessory classifier. Used by the Fabric Working Sheet so the
// printout that goes to the Union Fabrics central ERP data-entry operators
// contains fabric rows ONLY — no trims, accessories, or packaging.
//
// Contract: fail-closed. If a component cannot be positively identified as
// fabric, it is EXCLUDED from the fabric sheet. Accessories/trims/packaging
// belong on the separate Accessories/Trims pages and their own printouts.
//
// Session 10 — hardened from the Session 9 blacklist approach after we
// confirmed all 357 rows of the live accessory consumption data are covered,
// but any future unknown component_type would have leaked under the old
// `!!c.fabric_type` fallback rule.
//
// 2026-05-02 — migrated off two locally-maintained Sets onto the central
// textileVocabulary. The fabric whitelist is now expressed in CANONICAL
// part names (e.g. "Flat Sheet"), and inputs go through the canonicaliser
// before lookup, so variants like "Fitted Sheet (Split Head)" and aliases
// like "top sheet" route to the same answer. The accessory blocklist is
// fully delegated to `isInCategory("accessory", x)`.

import { canonical, isInCategory } from "@/lib/textileVocabulary";
import { canonicalPartName } from "@/lib/partNameCanonical";

/**
 * The subset of canonical part names that count as FABRIC on the working
 * sheet. Other parts in the textileVocabulary (Outer, Inner, Quilting,
 * Pillow Compression, Window, Sham) are intentionally NOT on this list:
 * they are either accessory-side parts or aren't in the live consumption
 * library. Add a part here only after confirming the consumption library
 * actually drives a fabric line item from it.
 */
export const FABRIC_PART_NAMES = new Set([
  "Flat Sheet",
  "Fitted Sheet",
  "Pillow Case",
  "Fabric Bag",
  "Top Fabric",
  "Bottom",
  "Skirt",
  "Platform",
  "Binding",
  "Piping",
  "Filling",
  "Lamination",
  "Evalon Membrane",
  "Sleeper Flap",
  "Front",
  "Back",
]);

/**
 * Compound component_type values that explicitly count as fabric. These are
 * legacy strings from the consumption library that combine two parts in one
 * row (e.g. an upholstery panel cut as bottom + skirt together). Kept as a
 * separate set because the canonical vocabulary stores parts atomically.
 */
const COMPOUND_FABRIC_TOKENS = new Set([
  "bottom + skirt",
]);

/** Accepted values of the explicit c.kind field. */
const KIND_FABRIC = "fabric";
const KIND_NON_FABRIC = new Set(["accessory", "trim", "packaging"]);

/**
 * Returns true iff the component should appear on the Fabric Working sheet.
 *
 * Decision order:
 *   1. Explicit c.kind === "fabric"                → INCLUDE
 *   2. Explicit c.kind ∈ {accessory,trim,packaging} → EXCLUDE
 *   3. Legacy (no kind) — component_type lookup:
 *      a. Compound fabric token (e.g. "bottom + skirt") → INCLUDE
 *      b. Canonical part name in FABRIC_PART_NAMES     → INCLUDE
 *      c. In accessory vocabulary                       → EXCLUDE
 *      d. Unknown                                       → EXCLUDE (fail-closed)
 *
 * The old fallback `!!c.fabric_type` is deliberately removed: an accessory
 * row with a mistakenly-populated fabric_type field used to leak through.
 *
 * @param {object|null|undefined} c        The component row.
 * @param {object} [opts]
 * @param {(info:object)=>void} [opts.onUnknown]  Optional callback invoked
 *     when a component hits the fail-closed branch, for observability.
 * @returns {boolean}
 */
export function isFabricComponent(c, opts = {}) {
  if (!c) return false;

  if (c.kind === KIND_FABRIC) return true;
  if (KIND_NON_FABRIC.has(c.kind)) return false;

  const t = (c.component_type || "").toLowerCase().trim();
  if (!t) return false;

  // 3a. Compound forms first — they wouldn't match a single canonical part.
  if (COMPOUND_FABRIC_TOKENS.has(t)) return true;

  // 3b. Canonicalise (this strips "(qualifier)" suffixes and resolves
  //     aliases like "top sheet" → "Flat Sheet"), then check the whitelist.
  const canon = canonicalPartName(t);
  if (canon && FABRIC_PART_NAMES.has(canon)) return true;

  // 3c. Anything in the accessory vocabulary is explicitly NOT fabric.
  if (isInCategory("accessory", t)) return false;

  // Defensive: if the part canonicalises into vocab but isn't on our fabric
  // whitelist (e.g. "Outer", "Quilting"), it's a non-fabric part — exclude
  // without warning.
  if (canonical("part", t)) return false;

  // 3d. Unknown component_type on a legacy row. Fail closed.
  if (typeof opts.onUnknown === "function") {
    try {
      opts.onUnknown({
        component_type: c.component_type,
        fabric_type: c.fabric_type,
        article_code: c.__article_code,
      });
    } catch {
      /* callback errors must not affect classification */
    }
  }
  return false;
}

/**
 * Convenience wrapper: emits a single console.warn per unknown component.
 * Kept as a separate helper so callers can opt in to logging without paying
 * the console overhead when rendering thousands of rows.
 */
export function isFabricComponentWithWarn(c) {
  return isFabricComponent(c, {
    onUnknown: (info) => {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "[FabricWorking] Excluding unknown component_type from fabric sheet:",
          info,
        );
      }
    },
  });
}
