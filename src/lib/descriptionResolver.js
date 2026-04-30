/**
 * descriptionResolver.js
 *
 * Resolves Packaging / Trims / Accessory Planning row seeds for one article
 * and tab category from a two-tier fallback chain:
 *
 *   Tier 1 — consumption_library (master data)
 *   Tier 2 — tech_packs JSONB columns (Trims / Accessory only; Packaging passes null)
 *
 * The caller chooses the chain length by passing techPack: null (Packaging, Path A)
 * or a real tech_packs row (Trims / Accessory, future sessions).
 *
 * Neither function performs any DB I/O.  All data is passed in from existing
 * useQuery results so the resolver stays pure and testable.
 */

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Returns true when a consumption_library row has no usable description.
 * Only `material` is checked; a row with empty material but non-empty
 * size_spec still triggers fall-through because size alone is not actionable.
 */
function isEmptyMaterial(row) {
  return row.material == null || row.material.trim() === "";
}

/**
 * Returns true when the entire set of master-data rows for an article+category
 * combination should be treated as absent (fall through to the next tier).
 */
function shouldFallThrough(rows) {
  return rows.length === 0 || rows.every(isEmptyMaterial);
}

/**
 * Converts a single consumption_library row to a Packaging Planning row object.
 * Handles both split-desc-size tabs (Polybag / Stiffener / Carton) and
 * quality tabs (Labels / Sticker / Zipper / Trim / Insert Card).
 *
 * wastage_percent in consumption_library may be stored as a decimal (0.05) or
 * a whole number (5).  We normalise to a whole number here.
 */
function masterRowToSeedRow(m, cfg) {
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

  if (cfg.splitDescSize) {
    return {
      ...base,
      quality: "",
      description: m.material || "",
      size: m.size_spec || "",
    };
  }

  return {
    ...base,
    quality: m.material || "",
    description: "",
    size: m.size_spec || "",
  };
}

/**
 * Converts a single element from extracted_trim_specs / extracted_accessory_specs
 * / extracted_label_specs to a Packaging Planning row object.
 *
 * `description` from the tech pack maps to the same field as `material` from
 * master data.  Wastage defaults to cfg.defaultWastage because tech packs do
 * not carry a wastage value for accessory/trim items.
 */
function techPackElementToSeedRow(elem, cfg) {
  const base = {
    type: cfg.typeOptions[0],
    wastage_percent: cfg.defaultWastage,
    multiplier: 1,
    pc_ean_code: "",
    carton_ean_code: "",
    existing_id: null,
  };

  // Coalesce across the BOB-format and AI-format field names so we get a
  // populated description regardless of which extraction path produced
  // the JSONB element.
  const descText =
    elem.description ||
    elem.material ||
    elem.section ||
    "";
  const sizeText =
    elem.size_spec ||
    elem.dimensions ||
    elem.size ||
    "";

  if (cfg.splitDescSize) {
    return { ...base, quality: "", description: descText, size: sizeText };
  }

  return { ...base, quality: descText, description: "", size: sizeText };
}

/**
 * Returns true when a tech-pack JSONB element has no usable description.
 * Checks several plausible field names because the BOB path and AI path use
 * slightly different naming conventions for the human-readable description.
 */
function isTechPackElementEmpty(elem) {
  if (!elem) return true;
  const candidates = [
    elem.description,
    elem.material,
    elem.dimensions,
    elem.size_spec,
    elem.section,
  ];
  return !candidates.some((v) => v != null && String(v).trim() !== "");
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Finds the best tech_packs row for an article from a pre-fetched array.
 *
 * Priority matches explode_po_bom() in 0001_init.sql:
 *   1. article_code match (fn_normalize_item_code ensures both sides are UPPER-TRIM)
 *   2. po_id match (catches packs uploaded against a PO before code was known)
 *
 * Both sides of the article_code comparison are upper-trimmed defensively
 * even though the DB trigger should have normalised them already.
 *
 * @param {object}   params
 * @param {string}   params.articleCode  - Article code to look up
 * @param {string}   params.poId         - PO uuid (fallback match)
 * @param {object[]} params.techPacks     - Pre-fetched tech_packs rows
 *                                         (extraction_status = 'extracted' already filtered)
 * @returns {object|null}
 */
export function findTechPackForArticle({ articleCode, poId, techPacks }) {
  if (!Array.isArray(techPacks) || techPacks.length === 0) return null;

  const normalised = (articleCode || "").trim().toUpperCase();

  // Tier-1: exact article_code match
  const byCode = techPacks.find(
    (tp) => (tp.article_code || "").trim().toUpperCase() === normalised
  );
  if (byCode) return byCode;

  // Tier-2: po_id match
  if (poId) {
    const byPo = techPacks.find((tp) => tp.po_id === poId);
    if (byPo) return byPo;
  }

  return null;
}

/**
 * Resolves the row seeds for one article + tab category combination.
 *
 * Fallback chain:
 *   1. consumption_library (masterSpecs)  — always consulted
 *   2. tech_packs JSONB array             — consulted only when techPack is non-null
 *                                           (Packaging passes null → chain length 1)
 *
 * Returns null when no tier yields usable rows; caller renders defaultRow(cfg).
 *
 * @param {object}      params
 * @param {string}      params.articleCode          - Article code (raw; normalised internally)
 * @param {string}      params.tabCategory          - TAB_CONFIG[tab].category value
 * @param {object}      params.cfg                  - TAB_CONFIG[tab] object
 * @param {object[]}    params.masterSpecs           - Full masterAccessorySpecs query result
 * @param {object|null} params.techPack              - Single tech_packs row or null
 * @param {object[]|null} [params.techPackLabelSpecs] - Caller may pass
 *                                                      techPack.extracted_label_specs here
 *                                                      when tabCategory === "Label" so that
 *                                                      label specs are merged with accessory
 *                                                      specs (Accessory Planning, future).
 *                                                      Unused in Packaging (techPack = null).
 * @returns {object[]|null}
 */
export function resolveDescription({
  articleCode,
  tabCategory,
  cfg,
  masterSpecs,
  techPack,
  techPackLabelSpecs = null,
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
    // At least one row has non-empty material — use all of them as-is
    return masterRows.map((m) => masterRowToSeedRow(m, cfg));
  }

  // ── Tier 2: tech_packs JSONB ─────────────────────────────────────────
  // Packaging always passes techPack = null, so this block is unreachable
  // for Packaging Planning (Path A).
  if (!techPack) return null;

  // Select the right JSONB array for this tab category.
  // For the "Label" category in Accessory Planning (future), the caller may
  // pass techPackLabelSpecs to merge extracted_label_specs alongside
  // extracted_accessory_specs.  For all other categories we use
  // extracted_accessory_specs (Accessory) or extracted_trim_specs (Trims).
  // The caller — not this function — decides which column to pass in.
  const accessoryElems = Array.isArray(techPack.extracted_accessory_specs)
    ? techPack.extracted_accessory_specs
    : [];
  const trimElems = Array.isArray(techPack.extracted_trim_specs)
    ? techPack.extracted_trim_specs
    : [];
  const labelElems = Array.isArray(techPackLabelSpecs) ? techPackLabelSpecs : [];

  // Determine candidate elements for this category. Matching is fuzzy
  // (case-insensitive substring + alias) because the JSONB columns can be
  // populated from two different paths with different field-naming conventions:
  //
  //   BOB-extracted (TechPacks.jsx legacy fast path)
  //     trim_specs    → elem.trim_type      = exact tab category ("Trim", "Polybag", ...)
  //     accessory_specs → elem.accessory_type = exact tab category
  //     label_specs   → elem.label_type      = exact tab category
  //
  //   AI-extracted (extract-document edge function)
  //     trim_specs    = AI's "packaging" array → elem.category = free-form ("Polybag printed")
  //     accessory_specs → elem.accessory_type = free-form ("Stitching Density")
  //     label_specs   → elem.label_type        = free-form ("Print satin woven label")
  //
  // Strict equality on the AI shape returned 0 candidates (the symptom
  // "quantities are there but not the right description"). Substring + alias
  // matching surfaces the right rows on each tab regardless of which path
  // produced the tech pack data.
  const matchesCategory = (elemCat, tab) => {
    if (!elemCat) return false;
    const e = String(elemCat).toLowerCase();
    const t = String(tab).toLowerCase();
    return e === t || e.includes(t) || t.includes(e);
  };
  const accessoryCandidates = accessoryElems.filter(
    (e) => matchesCategory(e.accessory_type, tabCategory) || matchesCategory(e.category, tabCategory)
  );
  const trimCandidates = trimElems.filter(
    (e) => matchesCategory(e.trim_type, tabCategory) || matchesCategory(e.category, tabCategory)
  );
  // Labels: when the tab is "Label", surface every label element regardless of
  // its specific label_type (e.g. "Print satin woven label", "Care label").
  // For other tabs, only include if the label_type fuzzy-matches.
  const labelCandidates = labelElems.filter((e) => {
    if (String(tabCategory).toLowerCase() === "label") return true;
    return matchesCategory(e.label_type, tabCategory) || matchesCategory(e.type, tabCategory);
  });

  // Merge: accessory + trim candidates cover most cases; labels merged when caller
  // supplies techPackLabelSpecs.
  const candidates = [
    ...accessoryCandidates,
    ...trimCandidates,
    ...labelCandidates,
  ];

  if (candidates.length === 0) return null;

  const usable = candidates.filter((e) => !isTechPackElementEmpty(e));
  if (usable.length === 0) return null;

  return usable.map((e) => techPackElementToSeedRow(e, cfg));
}
