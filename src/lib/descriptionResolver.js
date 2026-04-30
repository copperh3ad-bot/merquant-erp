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

// ── Category alias map ────────────────────────────────────────────────────
// Each tab's `cfg.category` (left key) maps to a list of substrings that,
// when found in a tech-pack element's category-flavoured field
// (trim_type / accessory_type / label_type / category / type / section),
// count as a match. Comparison is case-insensitive.
const CATEGORY_ALIASES = {
  "Label":       ["label", "law tag", "care label", "size label", "brand label", "hang tag", "wash label"],
  "Insert Card": ["insert card", "insert", "color paper insert", "art card", "bleach card"],
  "Polybag":     ["polybag", "poly bag", "pvc bag", "pvc", "pe bag", "opp bag", "ldpe bag", "bag material"],
  "Stiffener":   ["stiffener", "cardboard", "card stiffener", "stiffener size"],
  "Carton":      ["carton", "carton box", "outer carton", "shipping carton", "carton size"],
  "Sticker":     ["sticker", "barcode sticker", "size sticker", "upc sticker", "barcode label", "qr code"],
  "Zipper":      ["zipper", "zip", "zipper end piecing"],
  "Trim":        ["trim", "binding", "piping", "elastic", "drawcord", "ribbon", "velcro"],
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

function matchesCategory(elemCat, tab) {
  if (!elemCat) return false;
  if (isBlacklisted(elemCat)) return false;
  const e = String(elemCat).toLowerCase().trim();
  const t = String(tab).toLowerCase().trim();
  // Exact / substring match (legacy + AI fuzzy)
  if (e === t || e.includes(t) || t.includes(e)) return true;
  // Alias map match
  const aliases = CATEGORY_ALIASES[tab];
  if (Array.isArray(aliases) && aliases.some((a) => e.includes(a))) return true;
  return false;
}

// Map a free-form label_type/section value to one of cfg.typeOptions so the
// row's "Type" dropdown defaults to the right entry instead of always
// showing the first option (typically "Brand Label").
function pickLabelType(elem, cfg) {
  const candidates = [elem?.section, elem?.label_type, elem?.type]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  if (candidates.length === 0 || !Array.isArray(cfg?.typeOptions)) return null;

  // Try each typeOption against each candidate. "Care label" / "Care Label"
  // matches "Law tag/Care label". Take the longest match for specificity.
  let best = null;
  let bestLen = 0;
  for (const opt of cfg.typeOptions) {
    const oLower = opt.toLowerCase();
    for (const c of candidates) {
      if (c.includes(oLower) || oLower.includes(c)) {
        if (oLower.length > bestLen) {
          best = opt;
          bestLen = oLower.length;
        }
      }
    }
  }
  // Fallback: if cfg has "Custom Label" / "Custom" option, use it
  if (!best && cfg.typeOptions.some((o) => /custom/i.test(o))) {
    best = cfg.typeOptions.find((o) => /custom/i.test(o));
  }
  return best;
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
function articleSizeForTab(cfg, articleSizes) {
  if (!articleSizes || !cfg) return "";
  if (cfg.category === "Polybag")          return articleSizes.pvc_bag_dimensions || "";
  if (cfg.category === "Stiffener")        return articleSizes.stiffener_size     || "";
  if (cfg.category === "Carton")           return articleSizes.carton_size_cm     || "";
  if (cfg.category === "Insert Card")      return articleSizes.insert_dimensions  || "";
  if (cfg.category === "Zipper")           return articleSizes.zipper_length_cm   || "";
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

  const base = {
    type: cfg.typeOptions[0],
    wastage_percent: wastage,
    multiplier: 1,
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
  const descText =
    elem.description ||
    elem.material ||
    elem.section ||
    "";

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
  // the per-size UPC entry by matching on item_code or size.
  let pcEan = "";
  if (cfg.showEAN && Array.isArray(upc) && upc.length > 0) {
    const match = upc.find((u) =>
      (u.our_sku && articleCode && String(u.our_sku).trim().toUpperCase() === String(articleCode).trim().toUpperCase()) ||
      (u.bob_sku && articleCode && String(u.bob_sku).trim().toUpperCase() === String(articleCode).trim().toUpperCase())
    );
    if (match) pcEan = match.bob_sku || match.our_sku || "";
  }

  if (cfg.splitDescSize) {
    return { ...base, type: typeText, quality: "", description: descText, size: sizeText, pc_ean_code: pcEan };
  }
  return { ...base, type: typeText, quality: descText, description: "", size: sizeText, pc_ean_code: pcEan };
}

// Returns true when a tech-pack JSONB element has no usable description.
function isTechPackElementEmpty(elem) {
  if (!elem) return true;
  const candidates = [elem.description, elem.material, elem.dimensions, elem.size_spec, elem.section];
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
// describe the same cardboard insert).
const trimAccessoryKey = (e) => norm(e.description || e.material);
// Labels: section/label_type matters because two labels can have identical
// description ("3M non woven material...") but cover different sections
// ("Law tag/Care" vs "Size label"). Keying on description + section keeps
// both in the result.
const labelKey = (e) => {
  const desc = norm(e.description || e.material);
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

  if (poId) {
    const byPo = techPacks.find((tp) => tp.po_id === poId);
    if (byPo) return byPo;
  }
  return null;
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
  const masterRows = (masterSpecs || []).filter(
    (m) =>
      (m.item_code || "").trim().toUpperCase() === normalised &&
      m.component_type === tabCategory
  );

  if (!shouldFallThrough(masterRows)) {
    return masterRows.map((m) => masterRowToSeedRow(m, cfg, articleSizes));
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
  const merged = [
    ...dedupeBy(accessoryCandidates, trimAccessoryKey),
    ...dedupeBy(trimCandidates,      trimAccessoryKey),
    ...dedupeBy(labelCandidates,     labelKey),
  ];

  if (merged.length > 0) {
    const usable = merged.filter((e) => !isTechPackElementEmpty(e));
    if (usable.length > 0) {
      return usable.map((e) => techPackElementToSeedRow(e, cfg, ctx));
    }
  }

  // ── Tier-2 fallback — measurements-only ──────────────────────────────
  // Even when no spec element matches the tab, certain tabs have data in
  // extracted_measurements.this_sku that's worth surfacing on its own
  // (e.g. Carton tab when the trim_specs JSONB has nothing labeled "Carton").
  // articleSizes is checked second so master-data dimensions also surface
  // when the tech pack has no measurements at all.
  let fallbackSize = null;
  if (ctx.measurements?.this_sku) {
    const sku = ctx.measurements.this_sku;
    if (cfg.category === "Polybag")          fallbackSize = sku.pvc_bag_dimensions || null;
    else if (cfg.category === "Stiffener")   fallbackSize = sku.stiffener_size      || null;
    else if (cfg.category === "Carton")      fallbackSize = sku.carton_size_cm      || null;
    else if (cfg.category === "Insert Card") fallbackSize = sku.insert_dimensions   || null;
    else if (cfg.category === "Zipper")      fallbackSize = sku.zipper_length        || null;
  }
  if (!fallbackSize) {
    const articleOnly = articleSizeForTab(cfg, articleSizes);
    if (articleOnly) fallbackSize = articleOnly;
  }

  if (fallbackSize) {
    const base = {
      type: cfg.typeOptions[0],
      wastage_percent: cfg.defaultWastage,
      multiplier: 1,
      pc_ean_code: "",
      carton_ean_code: "",
      existing_id: null,
    };
    return [{ ...base, quality: "", description: "", size: fallbackSize }];
  }

  return null;
}
