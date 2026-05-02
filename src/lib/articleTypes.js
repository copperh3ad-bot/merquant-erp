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

export const PRODUCT_TYPES = {
  MATTRESS_PROTECTOR: {
    key: "mattress_protector",
    label: "Mattress Protector",
    components: ["Platform", "Skirt", "Piping", "Binding"],
    accessories: ["Law Tag", "Size Label", "PVC Bag", "Insert Card", "Stiffener", "Size Sticker", "Barcode Sticker"],
  },
  TOTAL_ENCASEMENT: {
    key: "total_encasement",
    label: "Total Encasement Protector",
    components: ["Platform", "Bottom + Skirt", "Piping", "Binding", "Zipper"],
    accessories: ["Law Tag", "Size Label", "Zipper Tape", "PVC Bag", "Insert Card", "Stiffener", "Size Sticker", "Barcode Sticker"],
  },
  SLEEPER_ENCASEMENT: {
    key: "sleeper_encasement",
    label: "Sleeper Sofa Encasement",
    components: ["Platform", "Bottom + Skirt", "Piping", "Binding", "Sleeper Flap", "Evalon Membrane", "Zipper"],
    accessories: ["Law Tag", "Size Label", "Zipper Tape", "PVC Bag", "Insert Card", "Stiffener"],
  },
  PILLOW_PROTECTOR: {
    key: "pillow_protector",
    label: "Pillow Protector",
    components: ["Platform", "Zipper"],
    accessories: ["Law Tag", "Size Label", "PVC Bag", "Insert Card", "Stiffener"],
  },
  BOLSTER_PROTECTOR: {
    key: "bolster_protector",
    label: "Bolster Protector",
    components: ["Platform", "Zipper"],
    accessories: ["Law Tag", "Size Label", "PVC Bag"],
  },
  BED_SHEET_SET: {
    key: "bed_sheet_set",
    label: "Bed Sheet Set",
    components: ["Flat Sheet Fabric", "Fitted Sheet Fabric", "Pillowcase Fabric", "Elastic"],
    accessories: ["Law Tag", "Size Label", "PVC Bag", "Insert Card"],
    isSet: true,
  },
  COMFORTER_SET: {
    key: "comforter_set",
    label: "Comforter Set",
    components: ["Shell Fabric", "Lining Fabric", "Filling"],
    accessories: ["Law Tag", "Care Label", "PVC Bag", "Hangtag"],
    isSet: true,
  },
  GENERIC: {
    key: "generic",
    label: "Generic / Other",
    components: null, // null = accept any component
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
  "Comforter":          "COMFORTER_SET",
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

// Does this component apply to the given product type?
// null = generic, accept everything
export function componentApplies(productType, componentName) {
  if (!productType || !productType.components) return true; // generic
  if (!componentName) return false;
  const normalized = componentName.trim().toLowerCase();
  return productType.components.some(c => c.toLowerCase() === normalized ||
         // tolerate synonyms / subtle differences
         c.toLowerCase().includes(normalized) || normalized.includes(c.toLowerCase()));
}

export function accessoryApplies(productType, accessoryName) {
  if (!productType || !productType.accessories) return true;
  if (!accessoryName) return false;
  const normalized = accessoryName.trim().toLowerCase();
  return productType.accessories.some(a => a.toLowerCase() === normalized ||
         a.toLowerCase().includes(normalized) || normalized.includes(a.toLowerCase()));
}

// For "set" products: split a set into its sub-components if codes can be teased apart.
// Not implemented beyond flagging — caller can handle via article_name notes.
export function isSetProduct(productType) {
  return !!productType?.isSet;
}
