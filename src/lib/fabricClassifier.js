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

/**
 * Fabric component_type values that appear on the fabric working sheet.
 * Extend this list when a new fabric component enters the consumption library.
 */
export const FABRIC_TYPES = new Set([
  "platform", "skirt", "piping", "binding", "bottom", "bottom + skirt",
  "sleeper flap", "evalon membrane", "flat sheet", "fitted sheet",
  "fitted sheet (2pc split)", "fitted sheet (split head)",
  "pillow case (1pc)", "pillow case (2pc)", "fabric bag",
  "front", "back", "top fabric", "filling", "lamination",
]);

/**
 * Accessory / trim / packaging component_type values. These NEVER appear on
 * the fabric working sheet regardless of whether fabric_type is populated.
 *
 * Covers all 13 distinct component_type values in the live accessory
 * consumption library (357 rows, verified against merquant-master-data-v4.xlsx
 * on 2026-04-21). The last three ("care label", "hang tag", "poly bag") are
 * not yet in the data but are common enough additions that we include them
 * defensively so a merchandiser entering one of those strings cannot leak it
 * onto the fabric printout.
 */
export const ACCESSORY_TYPES = new Set([
  "zipper", "thread", "elastic", "law tag", "size label", "label",
  "pvc bag", "insert card", "stiffener", "stiffener size",
  "size sticker", "barcode sticker", "barcode sticker size", "packaging",
  "care label", "hang tag", "poly bag",
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
 *      a. In FABRIC_TYPES                          → INCLUDE
 *      b. In ACCESSORY_TYPES                       → EXCLUDE
 *      c. Unknown                                  → EXCLUDE (fail-closed)
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
  if (FABRIC_TYPES.has(t)) return true;
  if (ACCESSORY_TYPES.has(t)) return false;

  // Unknown component_type on a legacy row. Fail closed.
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
