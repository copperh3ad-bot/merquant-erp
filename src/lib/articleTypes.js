/**
 * Article type classification — infers product category from code/name,
 * then tells us which fabric/accessory components apply.
 *
 * This lets the audit skip "missing component" warnings on items where that
 * component is legitimately not part of the product (e.g. pillow protector
 * has no Skirt).
 */

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

// Classify an article by its code and/or name. Returns PRODUCT_TYPES[...] key.
// Priority: explicit hints in name > code prefix > fallback GENERIC.
export function classifyArticle({ article_code = "", article_name = "", product_type = "" }) {
  const txt = `${article_code} ${article_name} ${product_type}`.toLowerCase();

  // Pillow protector — check first because MP codes can contain "PP"
  if (/pillow\s*protector/.test(txt) || /\bpp[kq]?\b/i.test(article_code) ||
      /GP(FRIO)?PP[kKQ]?/i.test(article_code)) {
    return PRODUCT_TYPES.PILLOW_PROTECTOR;
  }

  // Total encasement (must precede sleeper check and MP check)
  if (/total\s*encasement/.test(txt) || /\bencasement\b/.test(txt)) {
    if (/sleeper/.test(txt)) return PRODUCT_TYPES.SLEEPER_ENCASEMENT;
    return PRODUCT_TYPES.TOTAL_ENCASEMENT;
  }

  // Sleeper encasement explicit
  if (/sleeper/.test(txt) && /(protector|encasement)/.test(txt)) {
    return PRODUCT_TYPES.SLEEPER_ENCASEMENT;
  }
  // GPSE code prefix = Sleeper Encasement
  if (/^GPSE/i.test(article_code)) return PRODUCT_TYPES.SLEEPER_ENCASEMENT;

  // Total encasement codes
  if (/^GPTE/i.test(article_code)) return PRODUCT_TYPES.TOTAL_ENCASEMENT;

  // Bolster
  if (/bolster/.test(txt)) return PRODUCT_TYPES.BOLSTER_PROTECTOR;

  // Sheet set
  if (/sheet\s*set|bed\s*sheet/.test(txt)) return PRODUCT_TYPES.BED_SHEET_SET;

  // Comforter set
  if (/comforter\s*set|comforter/.test(txt)) return PRODUCT_TYPES.COMFORTER_SET;

  // Mattress protector (broadest — check last before generic)
  if (/mattress\s*protector/.test(txt) || /^GP(FRIO)?MP/i.test(article_code) ||
      /\bmp\d/i.test(article_code)) {
    return PRODUCT_TYPES.MATTRESS_PROTECTOR;
  }

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
