/**
 * Article type classification — infers product category from code/name,
 * then tells us which fabric/accessory components apply.
 *
 * This lets the audit skip "missing component" warnings on items where that
 * component is legitimately not part of the product (e.g. pillow protector
 * has no Skirt).
 *
 * 2026-05-02 — code-pattern detection delegated to
 * textileVocabulary.productFamilyOf so MerQuant has ONE place where SKU
 * code → product family rules live. The PRODUCT_TYPES taxonomy below
 * (component/accessory applicability lists) stays local because it
 * encodes audit-policy decisions, not raw vocabulary.
 */

import { productFamilyOf } from "@/lib/textileVocabulary";

/* ──── Product-type taxonomy ──────────────────────────────────────────── */

// Taxonomy convention:
//   `components`   = pieces of fabric the article is cut from (Flat Sheet,
//                    Platform, Skirt, ...). Drives the Fabric Working sheet.
//   `accessories`  = sewn-in trims + attached items (Elastic, Zipper, Thread,
//                    Labels, Stickers, Polybag, ...). Drives the Trims and
//                    Accessories & Packaging pages.
//
// Items that straddle both buckets historically (e.g. Elastic on a Sheet
// Set is both a sewn-in trim AND structurally part of the Fitted Sheet
// pattern) are listed in `accessories` only — that's the bucket the
// Trims/Accessories pages read from. Use the unified `applies()` helper
// below if you need to ask "does this product type need this item at
// all?" without caring which bucket.

export const PRODUCT_TYPES = {
  MATTRESS_PROTECTOR: {
    key: "mattress_protector",
    label: "Mattress Protector",
    components: ["Platform", "Skirt", "Piping", "Binding"],
    accessories: [
      "Law Tag", "Size Label", "Care Label", "PVC Bag", "Polybag",
      "Insert Card", "Stiffener", "Size Sticker", "Barcode Sticker",
      "Elastic", "Thread",
      // Cap elastic wraps the platform around the mattress. Distinct from
      // the corner-piecing elastic on a Fitted Sheet but routes through
      // the same accessory category.
    ],
  },
  TOTAL_ENCASEMENT: {
    key: "total_encasement",
    label: "Total Encasement Protector",
    components: ["Platform", "Bottom + Skirt", "Piping", "Binding", "Zipper"],
    accessories: [
      "Law Tag", "Size Label", "Care Label", "Zipper", "Zipper Tape",
      "PVC Bag", "Polybag", "Insert Card", "Stiffener",
      "Size Sticker", "Barcode Sticker", "Thread",
    ],
  },
  SLEEPER_ENCASEMENT: {
    key: "sleeper_encasement",
    label: "Sleeper Sofa Encasement",
    components: ["Platform", "Bottom + Skirt", "Piping", "Binding", "Sleeper Flap", "Evalon Membrane", "Zipper"],
    accessories: [
      "Law Tag", "Size Label", "Care Label", "Zipper", "Zipper Tape",
      "PVC Bag", "Polybag", "Insert Card", "Stiffener", "Thread",
    ],
  },
  PILLOW_PROTECTOR: {
    key: "pillow_protector",
    label: "Pillow Protector",
    components: ["Platform", "Zipper"],
    accessories: [
      "Law Tag", "Size Label", "Care Label", "Zipper", "Zipper Tape",
      "PVC Bag", "Polybag", "Insert Card", "Stiffener", "Thread",
    ],
  },
  BOLSTER_PROTECTOR: {
    key: "bolster_protector",
    label: "Bolster Protector",
    components: ["Platform", "Zipper"],
    accessories: [
      "Law Tag", "Size Label", "Zipper", "Zipper Tape",
      "PVC Bag", "Polybag", "Thread",
    ],
  },
  BED_SHEET_SET: {
    key: "bed_sheet_set",
    label: "Bed Sheet Set",
    components: ["Flat Sheet Fabric", "Fitted Sheet Fabric", "Pillowcase Fabric"],
    accessories: [
      "Law Tag", "Size Label", "Care Label", "Brand Label",
      "Elastic", // fitted-sheet corner elastic + bottom-hem elastic band
      "Thread",
      "PVC Bag", "Polybag", "Insert Card", "Hang Tag",
    ],
    isSet: true,
  },
  PILLOW_CASE: {
    key: "pillow_case",
    label: "Pillow Case",
    components: ["Flat Sheet Fabric", "Pillowcase Fabric"],
    accessories: [
      "Law Tag", "Size Label", "Care Label", "Brand Label",
      "Thread", "PVC Bag", "Polybag", "Hang Tag", "Insert Card",
      // Note: NO Elastic here — pillow cases use envelope or hem closures,
      // not sewn-in elastic. NO Zipper unless explicitly a zippered case.
    ],
  },
  COMFORTER_SET: {
    key: "comforter_set",
    label: "Comforter Set",
    components: ["Shell Fabric", "Lining Fabric", "Filling"],
    accessories: [
      "Law Tag", "Care Label", "Size Label", "Brand Label",
      "PVC Bag", "Polybag", "Hang Tag", "Insert Card", "Thread",
    ],
    isSet: true,
  },
  DUVET_COVER: {
    key: "duvet_cover",
    label: "Duvet Cover",
    components: ["Shell Fabric", "Lining Fabric"],
    accessories: [
      "Law Tag", "Care Label", "Size Label", "Brand Label",
      "Zipper", "Button", "Thread",
      "PVC Bag", "Polybag", "Hang Tag", "Insert Card",
    ],
  },
  MATTRESS_TOPPER: {
    key: "mattress_topper",
    label: "Mattress Topper",
    components: ["Top Fabric", "Bottom", "Filling", "Skirt", "Binding"],
    accessories: [
      "Law Tag", "Care Label", "Size Label", "Elastic",
      "PVC Bag", "Polybag", "Insert Card", "Stiffener", "Thread",
    ],
  },
  THROW: {
    key: "throw",
    label: "Throw / Blanket",
    components: ["Top Fabric"],
    accessories: [
      "Law Tag", "Care Label", "Size Label", "Brand Label",
      "PVC Bag", "Polybag", "Hang Tag", "Insert Card", "Thread",
    ],
  },
  GENERIC: {
    key: "generic",
    label: "Generic / Other",
    components: null, // null = accept anything
    accessories: null,
  },
};

/* ──── Inference rules ────────────────────────────────────────────────── */

// Map vocab's product-family canonical names → the PRODUCT_TYPES entry that
// carries this module's component/accessory applicability lists. Vocab
// returns "Pillow Protector"; we return PRODUCT_TYPES.PILLOW_PROTECTOR.
// Families without a 1:1 match (Pillow Case, Duvet Cover, Mattress
// Topper, Bed Skirt, Throw) fall through to GENERIC for now — extend
// PRODUCT_TYPES above when audit rules for them are added.
const VOCAB_TO_PRODUCT_TYPE = {
  "Pillow Protector":   "PILLOW_PROTECTOR",
  "Total Encasement":   "TOTAL_ENCASEMENT",
  "Sleeper Encasement": "SLEEPER_ENCASEMENT",
  "Mattress Protector": "MATTRESS_PROTECTOR",
  "Sheet Set":          "BED_SHEET_SET",
  "Pillow Case":        "PILLOW_CASE",
  "Comforter":          "COMFORTER_SET",
  "Duvet Cover":        "DUVET_COVER",
  "Mattress Topper":    "MATTRESS_TOPPER",
  "Throw":              "THROW",
};

// Classify an article by its code and/or name. Returns PRODUCT_TYPES[...] key.
// Priority: code-pattern via productFamilyOf > name keywords > GENERIC.
export function classifyArticle({ article_code = "", article_name = "", product_type = "" }) {
  // Step 1 — vocab-driven SKU pattern match (covers PP/MP/SE/TE/CSS/SS/etc.)
  const family = productFamilyOf(article_code) || productFamilyOf(article_name) || productFamilyOf(product_type);
  if (family) {
    const key = VOCAB_TO_PRODUCT_TYPE[family];
    if (key) return PRODUCT_TYPES[key];
  }

  // Step 2 — name-only signals that vocab regexes don't catch.
  const txt = `${article_code} ${article_name} ${product_type}`.toLowerCase();

  // Encasement disambiguation when only the name carries the signal —
  // "sleeper encasement" inside a generic-coded article.
  if (/total\s*encasement/.test(txt)) return PRODUCT_TYPES.TOTAL_ENCASEMENT;
  if (/sleeper/.test(txt) && /(protector|encasement)/.test(txt)) return PRODUCT_TYPES.SLEEPER_ENCASEMENT;
  if (/\bencasement\b/.test(txt))    return PRODUCT_TYPES.TOTAL_ENCASEMENT;

  // Bolster — not in vocab's PRODUCT_FAMILIES yet.
  if (/bolster/.test(txt)) return PRODUCT_TYPES.BOLSTER_PROTECTOR;

  // Sheet set / comforter set — name-driven catches when SKU code is opaque.
  if (/sheet\s*set|bed\s*sheet/.test(txt)) return PRODUCT_TYPES.BED_SHEET_SET;
  if (/comforter/.test(txt))               return PRODUCT_TYPES.COMFORTER_SET;
  if (/pillow\s*protector/.test(txt))      return PRODUCT_TYPES.PILLOW_PROTECTOR;
  if (/mattress\s*protector/.test(txt))    return PRODUCT_TYPES.MATTRESS_PROTECTOR;

  return PRODUCT_TYPES.GENERIC;
}

/* ──── Helpers for audit ──────────────────────────────────────────────── */

// Internal: tolerant list-membership check. Matches exact, substring, and
// reverse substring so "Elastic" matches "Cap Elastic" and vice versa.
function listIncludes(list, name) {
  if (!Array.isArray(list)) return false;
  if (!name) return false;
  const normalized = String(name).trim().toLowerCase();
  if (!normalized) return false;
  return list.some(c => {
    const lc = c.toLowerCase();
    return lc === normalized || lc.includes(normalized) || normalized.includes(lc);
  });
}

/**
 * Unified "does this name belong on this product type?" check. Looks in
 * BOTH the components and accessories lists, because items like Elastic
 * and Zipper straddle both categories depending on the product (Elastic
 * is a sewn-in trim on Sheet Sets, but it's also conceptually part of
 * the Fitted Sheet construction). Querying just one list false-rejects
 * legitimate items.
 *
 * Returns true for the GENERIC product type (no constraints).
 *
 * Use this when filtering tech-pack-extracted accessories/trims/labels
 * to a per-SKU list — see TechPacks.jsx.
 */
export function applies(productType, name) {
  if (!productType) return true; // unknown product — be permissive
  const { components, accessories } = productType;
  // Both null → GENERIC product, accept anything
  if (components == null && accessories == null) return true;
  if (!name) return false;
  return listIncludes(components, name) || listIncludes(accessories, name);
}

// Backwards-compatible: only the components list. Used by the audit and
// the Fabric Working filter that intentionally care about fabric pieces
// only. Falls through to applies() semantics when the product type is
// generic or unknown.
export function componentApplies(productType, componentName) {
  if (!productType) return true;
  if (productType.components == null && productType.accessories == null) return true;
  return listIncludes(productType.components, componentName);
}

// Backwards-compatible: only the accessories list. Most callers should
// prefer `applies()` because items like Elastic appear in components on
// Sheet Sets but conceptually belong on the Trims page (an accessory).
export function accessoryApplies(productType, accessoryName) {
  if (!productType) return true;
  if (productType.components == null && productType.accessories == null) return true;
  return listIncludes(productType.accessories, accessoryName);
}

// For "set" products: split a set into its sub-components if codes can be teased apart.
// Not implemented beyond flagging — caller can handle via article_name notes.
export function isSetProduct(productType) {
  return !!productType?.isSet;
}
