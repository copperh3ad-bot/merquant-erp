/**
 * descriptionResolver.js
 *
 * Resolves Packaging / Trims / Accessory Planning row seeds for one article
 * and tab category from a fallback chain:
 *
 *   Tier 1 — consumption_library (master data, by item_code + component_type)
 *   Tier 2 — tech_pack JSONB columns (extracted_label/trim/accessory specs)
 *           + extracted_measurements (per-SKU dimensions: pvc_bag, stiffener,
 *             carton sizes that are NOT in the spec JSONB)
 *           + extracted_data.upc (per-size UPC/EAN codes)
 *
 * The caller decides whether to consult Tier 2 by passing techPack non-null.
 *
 * Field-name handling: AI-extracted and BOB-extracted tech packs use
 * different field names (e.g. AI puts "PVC Bag" / "Stiffener (Cardboard)"
 * in trim_type vs BOB's exact "Polybag" / "Stiffener"). The CATEGORY_ALIASES
 * map + matchesCategory() bridges both shapes onto the page's tab list.
 */

import { productFamilyOf } from "@/lib/textileVocabulary";
import { isMultiSizeBlob } from "@/lib/dimensionNormalizer";

// ── Category alias map ────────────────────────────────────────────────────
// Each tab's `cfg.category` (left key) maps to a list of substrings that,
// when found in a tech-pack element's category-flavoured field
// (trim_type / accessory_type / label_type / category / type / section),
// count as a match. Comparison is case-insensitive.
// Per docs/architecture.md §5 — Trim alias list aligned with the spec.
// The literal word "trim" still matches via the substring path in
// matchesCategory() (e.g. element category "Trim Detail" still hits the
// Trim tab), so dropping it from the alias list does not regress.
const CATEGORY_ALIASES = {
  "Label":       ["label", "law tag", "care label", "size label", "brand label", "hang tag", "wash label"],
  // Bare "insert" was too broad — it substring-matched into items like
  // "Sewing Insert Label", making a single label appear in BOTH the
  // Label tab and the Insert Card tab. Insert-card phrasing always
  // includes a qualifier (card / color paper insert / art card / bleach
  // card), so the bare token isn't needed. Removed per MAS alignment.
  "Insert Card": ["insert card", "color paper insert", "art card", "bleach card"],
  "Polybag":     ["polybag", "poly bag", "pvc bag", "pvc", "pe bag", "opp bag", "ldpe bag", "bag material"],
  "Stiffener":   ["stiffener", "cardboard", "card stiffener", "stiffener size"],
  // "carton box" intentionally removed — that label belongs to the
  // Printed Box tab below (retail printed display box, not the master
  // shipping carton). Keep the master-carton synonyms only.
  "Carton":      ["carton", "outer carton", "shipping carton", "carton size", "master carton", "shipper"],
  // Retail printed display box — distinct from the master shipping carton.
  // Source files label this row variously; we accept all common phrasings.
  "Printed Box": ["printed box", "color box", "colour box", "display box",
                  "outer box", "gift box", "retail box", "window box",
                  "box material", "carton box", "1pc/box", "1 pc per box",
                  "inner box", "individual box"],
  "Sticker":     ["sticker", "barcode sticker", "size sticker", "upc sticker", "barcode label", "qr code"],
  "Zipper":      ["zipper", "zip", "zipper end piecing"],
  // Match MAS — union of legacy aliases (binding/piping/drawcord/ribbon/
  // velcro) AND the spec's hardware/thread additions (thread, sewing
  // thread, stopper, cord lock, cord stopper, drawstring stopper,
  // drawcord stopper). Net 13 items. The earlier §5 commit dropped the
  // legacy 5 in favour of replacing with the spec's 8; MAS keeps both
  // and that's the intended state.
  "Trim":        ["trim", "binding", "piping", "elastic", "drawcord", "ribbon", "velcro",
                  "thread", "sewing thread", "stopper", "cord lock", "cord stopper",
                  "drawstring stopper", "drawcord stopper",
                  // 2026-05-07 audit — BOB tech-packs emit overlocking
                  // and bound-seam construction with their own category
                  // strings; without these, ~80 such rows are unrouted.
                  "overlocking", "overlock", "bound seam", "seam binding"],
};

// Polybag and Carton aliases — extended to absorb BOB's "Primary Packaging"
// (one-per-unit retail bag) and "Secondary Packaging" (master shipper) terms.
// These were emitted as accessory_items.category strings by explode_po_bom
// but didn't match any tab via matchesCategory.
//
// Note: bare "packaging" is intentionally NOT added — BOB tech-packs use it
// as a catch-all umbrella row that often duplicates content already split
// across PVC Bag / Stiffener / Insert Card. Adding "packaging" routes that
// row to Polybag tab and pre-empts the more specific PVC Bag row.
CATEGORY_ALIASES["Polybag"].push("primary packaging", "primary pack", "individual packaging");
CATEGORY_ALIASES["Carton"].push("secondary packaging", "secondary pack", "shipping pack");

// Per docs/architecture.md §5 — overlap suppression. Without these,
// alias substring-matching can route the same element to two tabs:
//   • "barcode label" hits Label (alias "label") AND Sticker (alias
//     "barcode label"). Spec: it belongs only to Sticker.
//   • "carton stiffener" hits Stiffener (alias "stiffener") AND Carton
//     (alias "carton"). Spec: it belongs only to Carton.
// CATEGORY_EXCLUSIONS lists substrings that, when present in the
// element's category text, disqualify the element from the named tab —
// regardless of any positive alias match.
const CATEGORY_EXCLUSIONS = {
  "Label":     ["sticker", "barcode", "qr code"],
  "Stiffener": ["carton", "printed box", "color box", "colour box", "display box"],
  // Carton tab is the master shipper — exclude retail printed boxes so
  // they don't double-route. They have their own tab.
  "Carton":    ["printed box", "color box", "colour box", "display box",
                "gift box", "retail box", "window box", "1pc/box"],
};

// Words/phrases that indicate an element is NOT a planning category at all
// (sewing/quality specs, not a trim or accessory). Used to suppress matches
// like "Stitching Density" or "Sewing Construction" from leaking into tabs
// via accidental substring matches.
const NON_CATEGORY_BLACKLIST = [
  "stitching density",
  "stitches per inch",
  "sewing construction",
  "sewing details",
  "needle",
  "fabric construction",
];

function isBlacklisted(elemCat) {
  if (!elemCat) return false;
  const e = String(elemCat).toLowerCase();
  return NON_CATEGORY_BLACKLIST.some((b) => e.includes(b));
}

// _internals exposes private helpers for direct unit testing without
// pulling them into the public API. Don't import from this in product
// code — use resolveDescription() instead.
export const _internals = {
  // populated below after function declarations
};

// Exported alongside the _internals path. MAS exports matchesCategory
// directly, so any caller doing `import { matchesCategory } from "@/lib/
// descriptionResolver"` works the same in both repos. _internals stays
// in place for tests that prefer the namespaced reference.
export function matchesCategory(elemCat, tab) {
  if (!elemCat) return false;
  if (isBlacklisted(elemCat)) return false;
  const e = String(elemCat).toLowerCase().trim();
  const t = String(tab).toLowerCase().trim();
  // Per docs/architecture.md §5 — exclusion check runs FIRST so it can
  // veto a match the alias / substring path would otherwise allow.
  const exclusions = CATEGORY_EXCLUSIONS[tab];
  if (Array.isArray(exclusions) && exclusions.some((x) => e.includes(x))) return false;
  // Exact / substring match (legacy + AI fuzzy)
  if (e === t || e.includes(t) || t.includes(e)) return true;
  // Alias map match
  const aliases = CATEGORY_ALIASES[tab];
  if (Array.isArray(aliases) && aliases.some((a) => e.includes(a))) return true;
  return false;
}

// Wire internal helpers up for tests now that they're declared.
_internals.matchesCategory = matchesCategory;
_internals.isBlacklisted   = isBlacklisted;
_internals.CATEGORY_ALIASES   = CATEGORY_ALIASES;
_internals.CATEGORY_EXCLUSIONS = CATEGORY_EXCLUSIONS;

// Synonym map for the Label tab's typeOption dropdown. Each key is one of
// the cfg.typeOptions values; the value is a list of keywords that, when
// found in the element's section / label_type / type / description /
// material text, count as a match. Lets pickLabelType classify a label
// from its description even when section/label_type are generic ("Hem",
// "Inside seam") and the type intent only appears in the description.
const LABEL_TYPE_SYNONYMS = {
  "Brand Label":               ["brand", "logo", "main label"],
  "Care Label":                ["care", "wash", "laundry", "care instruction", "law tag", "wash care"],
  "Size Label":                ["size", "size tag"],
  "Direction Label":           ["direction", "head end", "foot end", "this side up", "top-bottom"],
  "Hang Tag":                  ["hang tag", "hangtag", "swing tag", "ticket"],
  "Country of Origin Label":   ["country of origin", "made in", "origin label"],
  "Composition Label":         ["composition", "fiber content", "fibre content", "material content", "% cotton", "% polyester"],
  "Wash Label":                ["wash label", "washing", "wash instruction"],
  "Price Ticket":              ["price ticket", "price tag", "msrp", "retail price"],
  "Compliance Label":          ["compliance", "ce mark", "iso 9001"],
  "Retailer Label":            ["retailer", "store label", "private label"],
  "Eco Label":                 ["eco-friendly", "oeko-tex", "oeko tex", "fsc", "fair trade"],
  "GOTS Label":                ["gots"],
  "Barcode Label":             ["barcode", "upc", "ean"],
  "Custom Label":              ["custom"],
  "Care label in 3 Languages 1X3": ["3 language", "tri-lingual", "trilingual", "1x3"],
};

// Map a free-form label specification to one of cfg.typeOptions so the
// row's "Type" dropdown defaults to the right entry instead of always
// showing the first option (typically "Brand Label").
//
// Two layers of matching, in priority order:
//   1. Direct: typeOption literal appearance in section/label_type/type/
//      description/material — e.g. description "Brand label, woven" gets
//      "Brand Label" because the typeOption literal is a substring.
//   2. Synonym: LABEL_TYPE_SYNONYMS keyword appearance in any of the
//      same fields — e.g. description "Wash care, machine wash cold"
//      maps to "Care Label" via the "wash" / "care" synonyms.
//
// Direct matches always beat synonym matches (more specific). Among
// matches of the same tier, the longest matched string wins.
function pickLabelType(elem, cfg) {
  if (!Array.isArray(cfg?.typeOptions) || cfg.typeOptions.length === 0) return null;

  // Combine all label-bearing free-text fields into one searchable haystack.
  // Description and material are the new additions — they often carry the
  // intent ("3M non woven material...care label") even when section/
  // label_type are generic.
  const haystack = [
    elem?.section,
    elem?.label_type,
    elem?.type,
    elem?.description,
    elem?.material,
    elem?.value, // BOB packaging-sheet shape (defence-in-depth — labels rarely come this way, but guarding doesn't cost anything)
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .join(" | ");
  if (!haystack) return null;

  // Tier 1: direct typeOption literal match (longest wins).
  let bestDirect = null;
  let bestDirectLen = 0;
  for (const opt of cfg.typeOptions) {
    const oLower = opt.toLowerCase();
    if (haystack.includes(oLower) && oLower.length > bestDirectLen) {
      bestDirect = opt;
      bestDirectLen = oLower.length;
    }
  }
  if (bestDirect) return bestDirect;

  // Tier 2: synonym keyword match (longest synonym wins).
  let bestSyn = null;
  let bestSynLen = 0;
  for (const opt of cfg.typeOptions) {
    const synonyms = LABEL_TYPE_SYNONYMS[opt];
    if (!Array.isArray(synonyms)) continue;
    for (const syn of synonyms) {
      const sLower = syn.toLowerCase();
      if (haystack.includes(sLower) && sLower.length > bestSynLen) {
        bestSyn = opt;
        bestSynLen = sLower.length;
      }
    }
  }
  if (bestSyn) return bestSyn;

  // Final fallback: a "Custom" option if cfg has one.
  if (cfg.typeOptions.some((o) => /custom/i.test(o))) {
    return cfg.typeOptions.find((o) => /custom/i.test(o));
  }
  return null;
}

// Smart-default for the Item Type dropdown on non-Label tabs. Scans the
// element's description/material/type fields for a typeOption keyword and
// picks the most specific match. Without this, every Polybag row defaults
// to typeOptions[0] (e.g. "PVC") regardless of whether the tech pack says
// "PE 60 micron" — forcing the user to fix it manually every time.
function pickTypeFromDescription(elem, cfg) {
  if (!Array.isArray(cfg?.typeOptions) || cfg.typeOptions.length === 0) return null;

  // Combine the most likely material-bearing fields. Order doesn't matter —
  // we're searching the union for a typeOption keyword.
  const haystack = [
    elem?.description,
    elem?.material,
    elem?.value, // BOB packaging-sheet items (Printed Box / Stiffener / Polybag) carry their material spec text in `value`
    elem?.quality,
    elem?.type,
    elem?.trim_type,
    elem?.accessory_type,
    elem?.category,
    elem?.section,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .join(" | ");
  if (!haystack) return null;

  // For each typeOption, all words must appear in the haystack (handles
  // multi-word options like "Brown Cardboard"). Among matches, pick the
  // longest option string for specificity.
  let best = null;
  let bestLen = 0;
  for (const opt of cfg.typeOptions) {
    const optLower = opt.toLowerCase().trim();
    if (!optLower) continue;
    const words = optLower.split(/\s+/);
    const allPresent = words.every((w) => haystack.includes(w));
    if (allPresent && optLower.length > bestLen) {
      best = opt;
      bestLen = optLower.length;
    }
  }
  return best;
}

// Find the UPC/EAN entry matching a given article_code. Returns "" when no
// match exists. Used by the Sticker / Insert Card / Printed Box tabs
// (cfg.showEAN === true) to fill pc_ean_code regardless of whether a
// tech-pack spec element matched the tab category — the EAN can surface
// even when no spec entry exists in the tech pack.
//
// 2026-05-07 fix: previously returned `match.bob_sku || match.our_sku`
// blindly, which surfaced SKU codes (e.g. "GPFRIOMP36") in the EAN column
// when the entry came from the BOB shipping-sheet text parser (which
// stores SKUs in bob_sku, not barcodes — barcodes are only populated
// after vision-OCR via buildUpcUpdate). Now validates the candidate is
// barcode-shaped (8-14 digits) before returning, falling back to "" if
// no candidate looks like a real barcode. Better empty than misleading.
function lookupUpcEan(upc, articleCode) {
  if (!Array.isArray(upc) || upc.length === 0 || !articleCode) return "";
  const code = String(articleCode).trim().toUpperCase();
  const match = upc.find((u) =>
    (u.our_sku && String(u.our_sku).trim().toUpperCase() === code) ||
    (u.bob_sku && String(u.bob_sku).trim().toUpperCase() === code)
  );
  if (!match) return "";
  // Field-name precedence: explicit barcode/ean/upc fields win. bob_sku
  // is the OCR-merge convention (buildUpcUpdate writes the digits there)
  // but in legacy rows it can hold a SKU — so it's the LAST candidate
  // and must still pass the digit-shape check.
  const candidates = [match.barcode, match.ean, match.upc, match.bob_sku];
  for (const c of candidates) {
    if (!c) continue;
    const s = String(c).trim();
    if (/^\d{8,14}$/.test(s)) return s;
  }
  return "";
}

// ── Internal helpers ──────────────────────────────────────────────────────

function isEmptyMaterial(row) {
  return row.material == null || row.material.trim() === "";
}

function shouldFallThrough(rows) {
  return rows.length === 0 || rows.every(isEmptyMaterial);
}

// Pull the per-SKU dimension that corresponds to a packaging tab from an
// articles row (master data). Returns "" when the article has no value for
// that field. Mirrors the per-tab mapping used for tech-pack measurements
// so that articleSizes acts as a 4th-tier size fallback after element /
// measurements / blank.
// When a tech-pack description combines specs for multiple product families
// in one row (e.g. "76mmx23mm (mattress protector) / 64mmX23mm (Pillow Protector)"),
// keep only the segments relevant to THIS SKU's product type. Drops segments
// that explicitly tag a different product family. Untagged segments stay
// (they're descriptive headers like "White ground with black fonts").
//
// Description-text keywords per product family. Used by
// extractSkuRelevantPortion to filter combined-product descriptions like
// "76mmx23mm (mattress protector) / 64mmX23mm (Pillow Protector)" down
// to only the segment(s) relevant to THIS SKU's family.
//
// The product-family identification (regex on article_code) is delegated
// to textileVocabulary.productFamilyOf so we don't carry a parallel copy
// of the patterns here. The keyword arrays below are this resolver's
// only contribution — they're filter-side, not classification-side.
const PRODUCT_TYPE_KEYWORDS = {
  "Pillow Protector":   ["pillow protector", "pillow protect"],
  "Mattress Protector": ["mattress protector", "mattress protect"],
  "Sleeper Encasement": ["sleeper encasement", "sleeper"],
  "Total Encasement":   ["total encasement"],
  "Sheet Set":          ["sheet set", "sheets"],
  "Pillow Case":        ["pillow case", "pillowcase"],
  "Comforter":          ["comforter"],
  "Duvet Cover":        ["duvet cover", "duvet"],
};

// Thin wrapper kept for naming clarity within this module — productFamilyOf
// reads through the central PRODUCT_FAMILY_PATTERNS so any drift in family
// codes (new SKU prefix, renamed family) lands here automatically.
function inferProductType(articleCode) {
  return productFamilyOf(articleCode);
}

export function extractSkuRelevantPortion(description, articleCode) {
  if (!description || !articleCode) return description;
  const productType = inferProductType(articleCode);
  if (!productType) return description;

  const myKWs = PRODUCT_TYPE_KEYWORDS[productType] || [];
  const otherKWs = Object.entries(PRODUCT_TYPE_KEYWORDS)
    .filter(([type]) => type !== productType)
    .flatMap(([_, kws]) => kws);

  // Split the description on " / " (or "/") — common separator in tech packs
  // when one row carries specs for multiple products.
  const parts = description.split(/\s*\/\s*/);
  if (parts.length < 2) return description; // nothing to filter

  // Drop segments that mention a DIFFERENT product type but not OURS.
  const filtered = parts.filter((part) => {
    const lower = part.toLowerCase();
    const mentionsOurs   = myKWs.some((kw) => lower.includes(kw));
    const mentionsOther  = otherKWs.some((kw) => lower.includes(kw));
    if (mentionsOther && !mentionsOurs) return false;
    return true;
  });

  if (filtered.length === parts.length) return description; // no filter applied
  if (filtered.length === 0)             return description; // safety: don't blank everything
  return filtered.join(" / ").trim();
}

function articleSizeForTab(cfg, articleSizes) {
  if (!articleSizes || !cfg) return "";
  // §6 read guard — historical rows in the DB may contain a multi-size
  // blob that escaped before normalizeDim2D/3D learned to refuse them.
  // safeSize() blanks any blob value so the caller's fallback chain
  // (e.g. PackagingPlanning's per-PO cartonSizeMap) takes over instead
  // of rendering the blob into a per-article size cell.
  const safeSize = (v) => {
    const s = v || "";
    return isMultiSizeBlob(s) ? "" : s;
  };
  if (cfg.category === "Polybag")          return safeSize(articleSizes.pvc_bag_dimensions);
  if (cfg.category === "Stiffener")        return safeSize(articleSizes.stiffener_size);
  if (cfg.category === "Carton")           return safeSize(articleSizes.carton_size_cm);
  if (cfg.category === "Insert Card")      return safeSize(articleSizes.insert_dimensions);
  if (cfg.category === "Zipper")           return safeSize(articleSizes.zipper_length_cm);
  return "";
}

// Convert a single consumption_library row to a Packaging Planning row object.
// articleSizes (master-data per-SKU dims) is used as a fallback when the
// consumption_library row has empty size_spec — this is the common case
// where the user filled the master Articles sheet's stiffener_size /
// carton_size_cm columns but the per-component-consumption rows don't
// repeat the same dimensions.
function masterRowToSeedRow(m, cfg, articleSizes = null) {
  const wastage =
    m.wastage_percent != null
      ? m.wastage_percent <= 1
        ? m.wastage_percent * 100
        : m.wastage_percent
      : cfg.defaultWastage;

  // Use consumption_per_unit as the multiplier so rows with e.g. 2 labels
  // per unit seed with x2, and rows with 0 (not required) are excluded by
  // the caller.  Fall back to 1 only when the field is absent (legacy rows).
  const multiplier = m.consumption_per_unit != null ? m.consumption_per_unit : 1;

  const base = {
    type: cfg.typeOptions[0],
    wastage_percent: wastage,
    multiplier,
    pc_ean_code: "",
    carton_ean_code: "",
    existing_id: null,
  };

  const sizeText = m.size_spec || articleSizeForTab(cfg, articleSizes) || "";

  if (cfg.splitDescSize) {
    return { ...base, quality: "", description: m.material || "", size: sizeText };
  }
  return { ...base, quality: m.material || "", description: "", size: sizeText };
}

// Convert a single tech-pack JSONB element to a Packaging Planning row object.
// Coalesces across BOB-format and AI-format field names. measurements (the
// per-SKU dims) and upc (per-size UPC table) are passed in so size and
// pc_ean_code can be filled when the spec element doesn't carry them.
function techPackElementToSeedRow(elem, cfg, ctx = {}) {
  const { measurements = null, upc = null, articleCode = null, articleSizes = null } = ctx;

  const base = {
    type: cfg.typeOptions[0],
    wastage_percent: cfg.defaultWastage,
    multiplier: 1,
    pc_ean_code: "",
    carton_ean_code: "",
    existing_id: null,
  };

  // Description: try several field names because the BOB and AI shapes differ.
  //   AI-extracted shape:  { description, material, size_spec, color, ... }
  //   BOB packaging sheet: { variant, category, label, value }
  //   BOB labelling sheet: { section, type, material, size, color, placement }
  // 2026-05-07 fix: added `elem.value` to the fallback chain so BOB
  // packaging-sheet items (Printed Box / Stiffener / Polybag material
  // rows) surface their content in the Description input. Previously
  // these rows rendered empty because the parser writes content into
  // `value` while the resolver only read `description / material /
  // section`.
  // Then filter combined-product descriptions like
  //   "76mmx23mm (mattress protector) / 64mmX23mm (Pillow Protector)"
  // down to only the segments relevant to THIS SKU's product family.
  const rawDescText =
    elem.description ||
    elem.material ||
    elem.value ||
    elem.section ||
    "";
  const descText = extractSkuRelevantPortion(rawDescText, articleCode);

  // Size: prefer the element's own size_spec; otherwise fall back to per-SKU
  // dimensions stored in extracted_measurements.this_sku, picked by tab.
  // Final fallback: master-data articles row (articleSizes) for the case
  // where the user filled the Articles sheet's stiffener_size/carton_size_cm
  // columns but the tech pack's measurements don't carry them.
  let sizeText = elem.size_spec || elem.dimensions || elem.size || "";
  if (!sizeText && measurements?.this_sku) {
    const sku = measurements.this_sku;
    if (cfg.category === "Polybag")     sizeText = sku.pvc_bag_dimensions || "";
    else if (cfg.category === "Stiffener") sizeText = sku.stiffener_size || "";
    else if (cfg.category === "Carton")    sizeText = sku.carton_size_cm || "";
    else if (cfg.category === "Insert Card") sizeText = sku.insert_dimensions || "";
    else if (cfg.category === "Zipper")    sizeText = sku.zipper_length || "";
  }
  // Reject AI multi-size blobs ("Varies by size: 33X33X32 (Twin XL); ...")
  // — those would seed every article with the same blob.
  if (isMultiSizeBlob(sizeText)) sizeText = "";
  if (!sizeText) sizeText = articleSizeForTab(cfg, articleSizes);

  // Type: for Label tab, derive from section/label_type. For other tabs,
  // scan the description/material text for a typeOption keyword (Polybag
  // → "PE" / "PVC", Stiffener → "Cardboard", Carton → "Brown" / "White",
  // etc.). Falls back to typeOptions[0] only when no signal is found.
  let typeText = base.type;
  if (cfg.category === "Label") {
    typeText = pickLabelType(elem, cfg) || base.type;
  } else {
    typeText = pickTypeFromDescription(elem, cfg) || base.type;
  }

  // pc_ean_code: for tabs with showEAN=true (Sticker, Insert Card), look up
  // the per-size UPC entry by matching on article_code.
  const pcEan = cfg.showEAN ? lookupUpcEan(upc, articleCode) : "";

  // Procurement / floor-supervisor fields. AI extraction pulls these
  // alongside description/material; surface them on the seeded row so
  // the user doesn't have to retype.
  const colorText     = String(elem.color     || "").trim();
  const placementText = String(elem.placement || "").trim();
  const supplierText  = String(elem.supplier  || "").trim();

  if (cfg.splitDescSize) {
    return {
      ...base, type: typeText, quality: "", description: descText, size: sizeText,
      color: colorText, placement: placementText, supplier: supplierText,
      pc_ean_code: pcEan,
    };
  }
  return {
    ...base, type: typeText, quality: descText, description: "", size: sizeText,
    color: colorText, placement: placementText, supplier: supplierText,
    pc_ean_code: pcEan,
  };
}

// Returns true when a tech-pack JSONB element has no usable description.
function isTechPackElementEmpty(elem) {
  if (!elem) return true;
  // Includes `value` for BOB packaging-sheet items (parsePackagingSheet
  // shape: { variant, category, label, value }). Without it, Printed
  // Box / Stiffener / Polybag items from BOB packaging would be
  // filtered out as "empty" even though their material spec lives in
  // `value`. 2026-05-07 production fix.
  const candidates = [elem.description, elem.material, elem.dimensions, elem.size_spec, elem.section, elem.value];
  return !candidates.some((v) => v != null && String(v).trim() !== "");
}

// Dedupe a list of tech-pack JSONB elements using a caller-provided keyFn.
// Elements producing a falsy/empty key (e.g. no description) pass through
// rather than collapsing into a single representative — they may carry
// distinct downstream data (size_spec, dimensions) we don't want to lose.
function dedupeBy(elems, keyFn) {
  const out = [];
  const seen = new Set();
  for (const e of elems) {
    const k = keyFn(e);
    if (!k) { out.push(e); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
// Trims/Accessories: same description text means same physical item, even
// if `trim_type` differs ("Stiffener" + "Stiffener (Cardboard)" both
// describe the same cardboard insert). Includes `value` so BOB
// packaging-sheet items (which only carry their content there) don't
// all dedup to the same empty key and silently collapse.
const trimAccessoryKey = (e) => norm(e.description || e.material || e.value);
// Labels: section/label_type matters because two labels can have identical
// description ("3M non woven material...") but cover different sections
// ("Law tag/Care" vs "Size label"). Keying on description + section keeps
// both in the result.
const labelKey = (e) => {
  const desc = norm(e.description || e.material || e.value);
  const section = norm(e.section || e.label_type || e.type);
  if (!desc && !section) return "";
  return `${desc}||${section}`;
};

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Finds the best tech_packs row for an article from a pre-fetched array.
 * Priority: article_code exact match → po_id match.
 */
export function findTechPackForArticle({ articleCode, poId, techPacks }) {
  if (!Array.isArray(techPacks) || techPacks.length === 0) return null;
  const normalised = (articleCode || "").trim().toUpperCase();

  const byCode = techPacks.find((tp) => (tp.article_code || "").trim().toUpperCase() === normalised);
  if (byCode) return byCode;

  // Brand-prefix-stripped fallback. Buyers often add a 2-char brand prefix
  // (e.g. "GP" for Goofproof) to the same base SKU that exists un-prefixed
  // in master data. Try the base-code lookup before falling through to the
  // PO match — the PO match is broad and would return the WRONG tech-pack
  // when several articles share one PO.
  for (const base of baseSKUVariants(normalised)) {
    const byBase = techPacks.find((tp) => (tp.article_code || "").trim().toUpperCase() === base);
    if (byBase) return byBase;
  }

  // PO-fallback: only safe when there's exactly ONE tech-pack for this PO.
  // Multi-article POs with several tech packs (one per article_code) used
  // to silently inherit the FIRST tech-pack for every article that didn't
  // have its own — every tab seed wrong from article #2 onwards. Now we
  // refuse to guess: if the PO has multiple tech-packs, return null and
  // let the caller fall through to articleSizes / master-data sources.
  if (poId) {
    const matchesForPo = techPacks.filter((tp) => tp.po_id === poId);
    if (matchesForPo.length === 1) return matchesForPo[0];
  }
  return null;
}

/**
 * Yield progressively-shorter base-SKU variants of `code` to try as a
 * fallback when the exact code doesn't match. We strip well-known leading
 * brand prefixes (1-3 chars). This lets `GPFRIOMP46` (Goofproof) match
 * master data stored as `FRIOMP46`. Only emits variants with at least
 * 4 chars left so we don't false-match very short codes.
 */
function baseSKUVariants(code) {
  if (!code || code.length < 6) return [];
  const KNOWN_PREFIXES = ["GP", "JF", "FT", "SLP", "SGS"];
  const out = [];
  for (const p of KNOWN_PREFIXES) {
    if (code.startsWith(p) && code.length - p.length >= 4) {
      out.push(code.slice(p.length));
    }
  }
  return out;
}

/**
 * Resolves the row seeds for one article + tab category combination.
 *
 * Tier-2 (tech pack) reads from FOUR sources on the techPack object:
 *   - extracted_accessory_specs / extracted_trim_specs / extracted_label_specs
 *   - extracted_measurements (per-SKU sizes for Polybag/Stiffener/Carton/etc.)
 *   - extracted_data.upc       (per-size UPC/EAN for Sticker/Insert Card)
 *
 * articleSizes is an optional master-data per-SKU dimensions row (a row from
 * the `articles` table after migration 0005_articles_size_fields). It serves
 * as a fallback for size on Carton / Stiffener / Polybag / Insert Card /
 * Zipper tabs when neither consumption_library nor the tech pack carry the
 * dimension.
 *
 * @param {object} params
 * @param {string} params.articleCode
 * @param {string} params.tabCategory          - cfg.category value
 * @param {object} params.cfg                  - TAB_CONFIG[tab] entry
 * @param {object[]} params.masterSpecs        - consumption_library rows
 * @param {object|null} params.techPack        - tech_packs row (Tier-2)
 * @param {object[]|null} [params.techPackLabelSpecs]
 * @param {object|null} [params.articleSizes]  - articles row carrying
 *                                               carton_size_cm / stiffener_size /
 *                                               pvc_bag_dimensions / insert_dimensions /
 *                                               zipper_length_cm
 * @returns {object[]|null}
 */
export function resolveDescription({
  articleCode,
  tabCategory,
  cfg,
  masterSpecs,
  techPack,
  techPackLabelSpecs = null,
  articleSizes = null,
}) {
  if (!articleCode) return null;
  const normalised = articleCode.trim().toUpperCase();

  // ── Tier 1: consumption_library ──────────────────────────────────────
  // Try the exact item_code first.
  let masterRows = (masterSpecs || []).filter(
    (m) =>
      (m.item_code || "").trim().toUpperCase() === normalised &&
      m.component_type === tabCategory
  );

  // Brand-prefix fallback. If the exact code has nothing, try base
  // variants ("GPFRIOMP46" → "FRIOMP46") so a Goofproof PO finds the
  // un-prefixed master data row.
  if (shouldFallThrough(masterRows)) {
    for (const base of baseSKUVariants(normalised)) {
      const baseRows = (masterSpecs || []).filter(
        (m) => (m.item_code || "").trim().toUpperCase() === base && m.component_type === tabCategory
      );
      if (!shouldFallThrough(baseRows)) {
        masterRows = baseRows;
        break;
      }
    }
  }

  if (!shouldFallThrough(masterRows)) {
    // Exclude rows explicitly marked as not required (consumption_per_unit === 0).
    // Rows where the field is null/undefined keep their default multiplier of 1.
    const required = masterRows.filter(
      (m) => m.consumption_per_unit == null || m.consumption_per_unit > 0
    );
    if (required.length === 0) return null; // nothing required → fall through to tech pack
    return required.map((m) => masterRowToSeedRow(m, cfg, articleSizes));
  }

  // ── Tier 2: tech_packs JSONB ─────────────────────────────────────────
  // techPack may be null (Packaging Path A); we still want to consult
  // articleSizes for a size-only seed row on tabs whose dimension lives
  // on the article. Handled at the bottom.
  if (!techPack) {
    const articleOnlySize = articleSizeForTab(cfg, articleSizes);
    if (articleOnlySize) {
      const base = {
        type: cfg.typeOptions[0],
        wastage_percent: cfg.defaultWastage,
        multiplier: 1,
        pc_ean_code: "",
        carton_ean_code: "",
        existing_id: null,
      };
      return [{ ...base, quality: "", description: "", size: articleOnlySize }];
    }
    return null;
  }

  const accessoryElems = Array.isArray(techPack.extracted_accessory_specs) ? techPack.extracted_accessory_specs : [];
  const trimElems      = Array.isArray(techPack.extracted_trim_specs)      ? techPack.extracted_trim_specs      : [];
  const labelElems     = Array.isArray(techPackLabelSpecs)
    ? techPackLabelSpecs
    : (Array.isArray(techPack.extracted_label_specs) ? techPack.extracted_label_specs : []);

  // Tier-2 context — consulted by techPackElementToSeedRow for size and EAN
  const ctx = {
    measurements: techPack.extracted_measurements || null,
    upc: (techPack.extracted_data && Array.isArray(techPack.extracted_data.upc))
      ? techPack.extracted_data.upc
      : null,
    articleCode,
    articleSizes,
  };

  const accessoryCandidates = accessoryElems.filter(
    (e) => matchesCategory(e.accessory_type, tabCategory) || matchesCategory(e.category, tabCategory)
  );
  const trimCandidates = trimElems.filter(
    (e) => matchesCategory(e.trim_type, tabCategory) || matchesCategory(e.category, tabCategory)
  );
  // Label tab: surface every label spec regardless of label_type (one tab,
  // one bucket). Other tabs: narrow by fuzzy label_type/type/section match.
  const labelCandidates = labelElems.filter((e) => {
    if (String(tabCategory).toLowerCase() === "label") return !isBlacklisted(e.label_type) && !isBlacklisted(e.type);
    return matchesCategory(e.label_type, tabCategory) ||
           matchesCategory(e.type, tabCategory) ||
           matchesCategory(e.section, tabCategory);
  });

  // Dedupe each group with its own key strategy, then merge. Labels need
  // section-aware keys (see labelKey comment); trims/accessories collapse
  // duplicate descriptions across naming variants (Stiffener case).
  let merged = [
    ...dedupeBy(accessoryCandidates, trimAccessoryKey),
    ...dedupeBy(trimCandidates,      trimAccessoryKey),
    ...dedupeBy(labelCandidates,     labelKey),
  ];

  // Sticker / Insert Card consolidation: BOB tech packs often parse the
  // sticker spec into 3 rows ("Direct print on insert", "All barcode...
  // must be stick on PVC bag", "White ground / 76mmx23mm") even though
  // they describe ONE physical sticker. When multiple rows surface for
  // these tabs, prefer rows that carry physical dimensions (e.g. "76mm")
  // over instruction-only rows. Only apply when at least one spec-row
  // exists — otherwise leave the rows alone (better instructions than
  // nothing).
  if ((cfg.category === "Sticker" || cfg.category === "Insert Card") && merged.length > 1) {
    const hasPhysicalDims = (e) => {
      // Include `value` so BOB packaging-sheet items where the dim sits
      // in `value` (e.g. "Color box size" entries) get detected.
      const text = String(e.description || e.material || e.value || "").toLowerCase();
      return /\d+\s*(mm|cm|in|inch|")\b/.test(text)
          || /\d+\s*x\s*\d+/.test(text);  // matches 76mmx23mm, 4x7cm, 3X5
    };
    const specRows = merged.filter(hasPhysicalDims);
    if (specRows.length > 0) merged = specRows;
  }

  if (merged.length > 0) {
    const usable = merged.filter((e) => !isTechPackElementEmpty(e));
    if (usable.length > 0) {
      return usable.map((e) => techPackElementToSeedRow(e, cfg, ctx));
    }
  }

  // ── Tier-2 fallback — measurements-only / articleSizes-only / EAN-only ──
  // Even when no spec element matches the tab, three signals can produce
  // a useful row:
  //   1. extracted_measurements.this_sku (per-SKU dim from BOB tech pack)
  //   2. articleSizes (per-SKU dim from the master-data Articles sheet —
  //      used when no tech pack has been uploaded for the article)
  //   3. UPC/EAN entry for showEAN tabs (Sticker, Insert Card) — emits a
  //      row carrying just the EAN when no other source has data.
  // (3) is critical for the Sticker tab, which has no size source anywhere
  // else and would otherwise return null even when the UPC table has its EAN.
  // Source priority for size: tech-pack measurement > master Articles sheet.
  let fallbackSize = null;
  if (ctx.measurements?.this_sku) {
    const sku = ctx.measurements.this_sku;
    if (cfg.category === "Polybag")          fallbackSize = sku.pvc_bag_dimensions || null;
    else if (cfg.category === "Stiffener")   fallbackSize = sku.stiffener_size      || null;
    else if (cfg.category === "Carton")      fallbackSize = sku.carton_size_cm      || null;
    else if (cfg.category === "Insert Card") fallbackSize = sku.insert_dimensions   || null;
    else if (cfg.category === "Zipper")      fallbackSize = sku.zipper_length        || null;
  }
  // Reject multi-size blobs at this fallback layer too.
  if (isMultiSizeBlob(fallbackSize)) fallbackSize = null;
  if (!fallbackSize) {
    const articleOnly = articleSizeForTab(cfg, articleSizes);
    if (articleOnly) fallbackSize = articleOnly;
  }
  const fallbackEan = cfg.showEAN ? lookupUpcEan(ctx.upc, articleCode) : "";

  if (fallbackSize || fallbackEan) {
    const base = {
      type: cfg.typeOptions[0],
      wastage_percent: cfg.defaultWastage,
      multiplier: 1,
      pc_ean_code: fallbackEan,
      carton_ean_code: "",
      existing_id: null,
    };
    return [{ ...base, quality: "", description: "", size: fallbackSize || "" }];
  }

  return null;
}
