/**
 * componentClassifier.js
 *
 * Maps a free-form accessory/trim/packaging item to a canonical Packaging
 * Planning component_type. Two-stage:
 *
 *   1. Keyword classifier (this file) — handles ~95% of cases for free,
 *      deterministically. Uses item_name, material, size, and the raw
 *      source category.
 *   2. Claude classifier (classify-components edge function) — invoked by
 *      the caller for items the keyword classifier marks as ambiguous,
 *      i.e. confidence < 0.7 or component_type === null.
 *
 * The taxonomy mirrors PackagingPlanning.jsx tab categories plus a few
 * extras the spreadsheet category column conflates ("Accessory Bag" vs
 * "Polybag", "Hang Tag" vs "Label").
 */

export const CANONICAL_TYPES = [
  "Label",
  "Insert Card",
  "Polybag",         // MAIN product packaging bag
  "Accessory Bag",   // SMALL bag for hang tags / accessories
  "Stiffener",
  "Carton",
  "Sticker",
  "Zipper",
  "Trim",
  "Hang Tag",
  "Other",
];

// Keyword rules. Each rule fires against the joined haystack of
// item_name + material + size_spec + raw_category (lowercased).
// Ordering matters: more specific rules first (Accessory Bag before Polybag,
// Hang Tag before Label). Each rule returns a confidence 0–1.
const RULES = [
  // ── Accessory Bag (must come BEFORE Polybag — same word "polybag" appears)
  {
    type: "Accessory Bag",
    confidence: 0.95,
    test: (h, sizeNumbers) => {
      const isBag = /\b(polybag|poly bag|pvc bag|opp bag|plastic bag|pe bag|hang ?tag bag)\b/.test(h);
      if (!isBag) return false;
      // Negation veto: phrases like "no hanger", "without hanger" mean the
      // bag is explicitly NOT an accessory bag — it's the main polybag.
      if (/\b(no hanger|without hanger|no hang.?tag|no loop|no plastic hanger)\b/.test(h)) return false;
      // Positive signals it's an accessory bag:
      const hasHanger      = /\b(plastic hanger|hang ?tag|adhesive tape|self.?adhesive|seal.?strip|hanger loop on top|hanger on top)\b/.test(h);
      const hasSmallDim    = sizeNumbers.length >= 2 && sizeNumbers.every((n) => n < 20);
      return hasHanger || hasSmallDim;
    },
  },

  // ── Hang Tag (paper card with brand/info, hung by a string — NOT a bag)
  {
    type: "Hang Tag",
    confidence: 0.9,
    test: (h) => /\b(hang ?tag|swing ?tag|swing ?ticket|brand tag|paper tag)\b/.test(h)
              && !/\b(label|sticker|sewn|woven)\b/.test(h),
  },

  // ── Label (woven / sewn / printed labels)
  {
    type: "Label",
    confidence: 0.92,
    test: (h) => /\b(care label|brand label|size label|main label|woven label|printed label|law tag|composition label|country of origin|made in)\b/.test(h)
              || /\bnon ?woven label\b/.test(h)
              || (/\blabel\b/.test(h) && !/\b(barcode|qr|sticker)\b/.test(h)),
  },

  // ── Sticker (barcode / UPC / adhesive printed)
  {
    type: "Sticker",
    confidence: 0.92,
    test: (h) => /\b(sticker|barcode|upc|qr code|ean|adhesive label|carton mark)\b/.test(h),
  },

  // ── Insert Card (printed card placed inside packaging).
  // Also catches "Direct print on insert" — a description that refers to
  // SIZE info being printed directly on the insert card (no separate
  // sticker), which the BOB parser sometimes mis-categorizes as Sticker.
  {
    type: "Insert Card",
    confidence: 0.93,
    test: (h) => /\b(insert card|insert paper|art card|color paper insert|bleach card|info card|booklet|leaflet)\b/.test(h)
              || (/\binsert\b/.test(h) && /\b(paper|card)\b/.test(h))
              || /\bdirect print on insert\b/.test(h),
  },

  // ── Stiffener (cardboard insert that maintains shape)
  {
    type: "Stiffener",
    confidence: 0.92,
    test: (h) => /\b(stiffener|cardboard.*(?:wrap|insert|stiffen)|card stiffener|u shape|u.?shape)\b/.test(h)
              || (/\bcardboard\b/.test(h) && /\b(stiffen|wrap|maintain|shape)\b/.test(h)),
  },

  // ── Carton (outer master/shipping carton)
  {
    type: "Carton",
    confidence: 0.92,
    test: (h) => /\b(master carton|outer carton|shipping carton|export carton|carton box)\b/.test(h)
              || (/\bcarton\b/.test(h) && /\b(\d+ ?ply|b.?flute|c.?flute|corrugated|brown|kraft)\b/.test(h)),
  },

  // ── Polybag (the MAIN product packaging bag — must come AFTER Accessory Bag
  //    but BEFORE Zipper, since polybag descriptions often mention "with zipper".
  //    The bag's primary identity is being a bag, not a zipper.)
  {
    type: "Polybag",
    confidence: 0.85,
    test: (h) => {
      const isBag = /\b(polybag|poly bag|pvc bag|opp bag|plastic bag|pe bag|ldpe bag|bag material)\b/.test(h);
      if (!isBag) return false;
      // If it has any signal it's accessory-sized, the Accessory Bag rule
      // should have caught it first; reaching here means it's a main bag.
      return true;
    },
  },

  // ── Zipper (standalone zipper item — must come AFTER Polybag so that
  //    "bag with zipper" descriptions are classified as Polybag, not Zipper)
  {
    type: "Zipper",
    confidence: 0.92,
    test: (h) => {
      // Veto when the item is clearly a bag with a zipper feature
      if (/\b(bag|polybag|pvc bag|opp bag|pe bag)\b/.test(h)) return false;
      return /\b(zipper|zip slider|coil zipper|nylon zipper|sbs zipper|metal zipper|ykk)\b/.test(h);
    },
  },

  // ── Trim (binding, piping, elastic, drawcord, ribbon, velcro, etc.)
  {
    type: "Trim",
    confidence: 0.9,
    test: (h) => /\b(binding|piping|elastic|drawcord|cord lock|ribbon|velcro|hook ?and ?loop|button|rivet)\b/.test(h),
  },
];

const NUM = /\d+(?:\.\d+)?/g;

function extractSizeNumbers(item) {
  const fields = [item.size_spec, item.material, item.dimensions, item.size].filter(Boolean);
  for (const f of fields) {
    const matches = String(f).match(NUM);
    if (matches && matches.length >= 1) return matches.map(parseFloat);
  }
  return [];
}

/**
 * Classify a single item. Returns { component_type, confidence, reason }.
 * confidence is 0 when no rule matched (caller should send to AI fallback).
 */
export function classifyComponent(item) {
  if (!item || (!item.item_name && !item.material && !item.raw_category && !item.size_spec)) {
    return { component_type: null, confidence: 0, reason: "no_input" };
  }

  const haystack = [
    item.raw_category, item.item_name, item.material,
    item.description, item.size_spec, item.placement,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .join(" | ");

  const sizeNumbers = extractSizeNumbers(item);

  for (const rule of RULES) {
    if (rule.test(haystack, sizeNumbers)) {
      return { component_type: rule.type, confidence: rule.confidence, reason: `keyword:${rule.type}` };
    }
  }

  // Fallback: trust the source category if it matches a canonical type case-insensitively.
  if (item.raw_category) {
    const raw = String(item.raw_category).trim().toLowerCase();
    const match = CANONICAL_TYPES.find((t) => t.toLowerCase() === raw);
    if (match) return { component_type: match, confidence: 0.6, reason: "raw_category_match" };
  }

  return { component_type: null, confidence: 0, reason: "no_rule_matched" };
}

/**
 * Classify a batch. Returns an array aligned with the input array.
 */
export function classifyBatch(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => ({
    index: i,
    ...classifyComponent(item),
  }));
}

// ── SKU-aware data-quality detection ────────────────────────────────────
//
// Different product types use different polybags. When the user's master
// data sheet pastes the wrong polybag description against a SKU (e.g. the
// large mattress-encasement zipper bag against a pillow protector SKU,
// because both products share a tech pack), the row imports cleanly but
// surfaces wrong info on Packaging Planning.
//
// detectProductTypeFromCode() infers the product family from the article
// code so we can validate the polybag/insert/etc. description against
// the SKU's actual product type.

// More-specific patterns FIRST so they win over broader patterns.
// Bedding-protector codes (PP/MP/SE/TE) checked before Sheet Sets etc.
// because some shared substrings exist (e.g. CSS contains "SS").
const PRODUCT_TYPE_PATTERNS = [
  // Pillow Protector — codes ending in PPK/PPQ or containing PP\d
  { type: "Pillow Protector",   test: (c) => /PP[KQ]\d*$/.test(c) || /PP\d/.test(c) },
  // Mattress Protector — codes containing MP\d (GPMP46, GPFRIOMP33)
  { type: "Mattress Protector", test: (c) => /MP\d/.test(c) },
  // Sleeper Encasement — codes containing SE\d (GPSE50)
  { type: "Sleeper Encasement", test: (c) => /SE\d/.test(c) },
  // Total Encasement — codes containing TE\d (GPTE50)
  { type: "Total Encasement",   test: (c) => /TE\d/.test(c) },

  // ── Newly added (Apr 2026): broader bedding categories ──
  // Sheet Set — SLPCSS (Sleep Cool Stretch Sheet Set), JFCSS (Jersey
  // Frio Cool Sheet Set), or *SS-* / *-SS in the code.
  { type: "Sheet Set",          test: (c) => /(?:CSS|JFCSS|^SLP|SHTSET|SHEET)/.test(c) || /(?:^|[^A-Z])SS[-_]/.test(c) },
  // Pillow Case — PC followed by digit, or explicit PILLOWCASE keyword
  { type: "Pillow Case",        test: (c) => /PC\d|PILLOWCASE|PILLCASE|PCASE/.test(c) },
  // Comforter
  { type: "Comforter",          test: (c) => /COMF|CMFTR|COMFORTER/.test(c) },
  // Duvet Cover — DC followed by digit, or explicit DUVET keyword
  { type: "Duvet Cover",        test: (c) => /DC\d|DUVET|DUV\d/.test(c) },
  // Mattress Topper — TOP*, TPR
  { type: "Mattress Topper",    test: (c) => /TOPPER|TPR\d|MATTOP|MTOP/.test(c) },
  // Bed Skirt — BSK*, SKRT*, BEDSKIRT
  { type: "Bed Skirt",          test: (c) => /BEDSKIRT|BSK\d|SKRT\d|BSKT/.test(c) },
  // Throw / Blanket — THRW*, BLNK*
  { type: "Throw",              test: (c) => /THROW|THRW|BLANKET|BLNKT/.test(c) },
];

/**
 * Infer the product family from a SKU/article code. Returns null when no
 * known pattern matches (the system falls back to neutral classification).
 */
export function detectProductTypeFromCode(articleCode) {
  if (!articleCode) return null;
  const code = String(articleCode).toUpperCase();
  for (const p of PRODUCT_TYPE_PATTERNS) {
    if (p.test(code)) return p.type;
  }
  return null;
}

// Per-product-type rules for detecting mis-paired component rows.
// Two parallel maps:
//   POLYBAG_MISMATCH_RULES   — Polybag-specific mis-pair signals
//   STIFFENER_MISMATCH_RULES — Stiffener-specific mis-pair signals
// Generic SKU↔component mismatch is detected via detectComponentSkuMismatch,
// which dispatches to the right rule set based on componentType.

const STIFFENER_MISMATCH_RULES = {
  // Mattress Protectors / Sleeper / Total Encasements use a U-shape
  // cardboard insert that wraps the product to maintain shape. They DON'T
  // use the small white square card (that's for pillow protectors).
  "Mattress Protector": {
    bad_keywords: ["white square card"],
    expected_keywords: ["u shape", "u-shape", "1 ply thickness", "maintain the shape"],
  },
  "Sleeper Encasement": {
    bad_keywords: ["white square card"],
    expected_keywords: ["u shape", "u-shape", "1 ply thickness"],
  },
  "Total Encasement": {
    bad_keywords: ["white square card"],
    expected_keywords: ["u shape", "u-shape", "1 ply thickness"],
  },
  // Pillow Protectors use a small white square cardboard piece. They
  // DON'T use the U-shape cardboard (that's for mattress products).
  "Pillow Protector": {
    bad_keywords: ['"u" 1 ply', "u-1 ply", "u 1 ply thickness", "1 ply thickness", "maintain the shape"],
    expected_keywords: ["white square card"],
  },
  // ── Empty rule entries for newly-recognised product families ──
  // Detection works (dispatcher fires), but no specific mis-pair rules
  // until real evidence appears in production data. The keyword
  // classifier still handles these via its generic Stiffener rule, and
  // the AI fallback (classify-components edge function) covers cases
  // that don't fit either path.
  "Sheet Set":         { bad_keywords: [], expected_keywords: [] },
  "Pillow Case":       { bad_keywords: [], expected_keywords: [] },
  "Comforter":         { bad_keywords: [], expected_keywords: [] },
  "Duvet Cover":       { bad_keywords: [], expected_keywords: [] },
  "Mattress Topper":   { bad_keywords: [], expected_keywords: [] },
  "Bed Skirt":         { bad_keywords: [], expected_keywords: [] },
  "Throw":             { bad_keywords: [], expected_keywords: [] },
};

// Same per-product structure for Polybag mis-pairs. Newly-added families
// have empty rule sets — they don't have known shared-tech-pack issues yet.
const POLYBAG_MISMATCH_RULES = {
  "Pillow Protector": {
    // Pillow protectors use a small clear bag with plastic hanger + adhesive
    // seal. They DON'T use coil zippers, "12S thickness" vinyl, or bound seams
    // (those are mattress-encasement features).
    bad_keywords: [
      "nylon coil zipper", "coil zipper",
      "no hanger loop on top",
      "12s transparent",
      "bound seam",
      "white pvc binding all around",
    ],
    expected_keywords: ["plastic hanger", "adhesive tape", "hanger on top"],
  },
  "Mattress Protector": {
    // Mattress protectors use a larger PVC bag, often with a bound seam and
    // sometimes a zipper. The small 3.5cm × 11.5cm hanger bag is for the
    // hang tag, NOT for the protector itself.
    bad_keywords: [
      "3.5cm h x 11.5cm w",
      "bag opening at the bottom with automatic adhesive",
    ],
    expected_keywords: ["pvc bag", "bound seam"],
  },
  "Sleeper Encasement": {
    bad_keywords: ["3.5cm h x 11.5cm w", "automatic adhesive"],
    expected_keywords: ["pvc bag", "zipper"],
  },
  "Total Encasement": {
    bad_keywords: ["3.5cm h x 11.5cm w", "automatic adhesive"],
    expected_keywords: ["pvc bag", "zipper"],
  },
  // ── Empty rule entries for newly-recognised product families ──
  "Sheet Set":         { bad_keywords: [], expected_keywords: [] },
  "Pillow Case":       { bad_keywords: [], expected_keywords: [] },
  "Comforter":         { bad_keywords: [], expected_keywords: [] },
  "Duvet Cover":       { bad_keywords: [], expected_keywords: [] },
  "Mattress Topper":   { bad_keywords: [], expected_keywords: [] },
  "Bed Skirt":         { bad_keywords: [], expected_keywords: [] },
  "Throw":             { bad_keywords: [], expected_keywords: [] },
};

/**
 * Detect a polybag description that doesn't match the SKU's product type.
 * Returns null when everything looks consistent OR when we can't confidently
 * classify (no rule for this product type, no signal in the description, etc.).
 *
 * @param {object} args
 * @param {string} args.articleCode    SKU code
 * @param {string} args.componentType  must be "Polybag" — other types short-circuit
 * @param {string} args.material       the polybag description text
 * @returns {object|null}              { product_type, offending_keyword, message } or null
 */
export function detectPolybagSkuMismatch({ articleCode, componentType, material }) {
  if (componentType !== "Polybag") return null;
  return _detectMismatchByRules(POLYBAG_MISMATCH_RULES, "Polybag", { articleCode, material });
}

/**
 * Same shape as detectPolybagSkuMismatch but for Stiffener rows.
 * Mattress / Sleeper / Total Encasements use a U-shape cardboard insert.
 * Pillow Protectors use a small white square card. When the user's master
 * data sheet copies a stiffener row from one SKU type onto another (a real
 * issue we cleaned up — every Mattress Protector had BOTH stiffener rows
 * because both came from the shared tech pack), this detects it.
 */
export function detectStiffenerSkuMismatch({ articleCode, componentType, material }) {
  if (componentType !== "Stiffener") return null;
  return _detectMismatchByRules(STIFFENER_MISMATCH_RULES, "Stiffener", { articleCode, material });
}

/**
 * Generic dispatcher — run all known mismatch detectors against a row.
 * Use this from MasterDataImport.jsx postProcess to flag any
 * SKU↔component mis-pairings during ingest, regardless of which
 * component type the row is.
 *
 * @returns {object|null}  same shape as the per-component detectors
 */
export function detectAnySkuMismatch({ articleCode, componentType, material }) {
  return (
    detectPolybagSkuMismatch({ articleCode, componentType, material }) ||
    detectStiffenerSkuMismatch({ articleCode, componentType, material })
  );
}

// Shared internal — walks a rules map for the SKU's product type and
// returns the first bad-keyword hit. Returns null when nothing fires.
function _detectMismatchByRules(rulesMap, componentLabel, { articleCode, material }) {
  if (!material) return null;
  const productType = detectProductTypeFromCode(articleCode);
  if (!productType) return null;
  const rule = rulesMap[productType];
  if (!rule) return null;

  const m = String(material).toLowerCase();
  for (const kw of rule.bad_keywords) {
    if (m.includes(kw)) {
      return {
        article_code: articleCode,
        product_type: productType,
        component_label: componentLabel,
        offending_keyword: kw,
        message: `${articleCode} is a ${productType} but its ${componentLabel} description mentions "${kw}" — typical of a different product type. The row may be mis-paired in the master-data source.`,
      };
    }
  }
  return null;
}

// ── AI fallback wrapper ──────────────────────────────────────────────────
//
// Run the keyword classifier on every input item. For items that come back
// with confidence < 0.85 (or null component_type), batch them up and ask
// Claude via the classify-components edge function. AI handles product
// families the keyword rules don't know about and ambiguous descriptions.
//
// Cost: ~$0.005 per batch of 30 items. Fully non-blocking — if the edge
// function fails or times out, the keyword result is kept.
//
// @param {Array<object>} items                     same shape as classifyComponent input
// @param {object}        opts
// @param {Function}      opts.invokeFn             async (name, args) => { data, error }
//                                                  Pass supabase.functions.invoke from the caller.
// @param {number}        [opts.confidenceFloor=0.85]
// @param {number}        [opts.batchLimit=50]      max items per AI call
// @returns {Promise<Array<object>>}                array of classifications aligned with input
export async function classifyWithAiFallback(items, opts = {}) {
  const { invokeFn, confidenceFloor = 0.85, batchLimit = 50 } = opts;
  if (!Array.isArray(items)) return [];

  // 1. Keyword pass on every item.
  const local = items.map((item, i) => ({
    index: i,
    item,
    ...classifyComponent(item),
  }));

  // 2. Identify ambiguous rows.
  const ambiguous = local.filter(
    (r) => !r.component_type || (r.confidence || 0) < confidenceFloor
  );

  if (ambiguous.length === 0 || typeof invokeFn !== "function") {
    return local.map(({ index, component_type, confidence, reason }) => ({
      index, component_type, confidence, reason,
    }));
  }

  // 3. Batch the ambiguous rows and call the edge function.
  const ambiguousById = new Map();
  for (let i = 0; i < ambiguous.length; i += batchLimit) {
    const slice = ambiguous.slice(i, i + batchLimit).map((r) => ({
      id: String(r.index),
      raw_category: r.item.raw_category || "",
      item_name:    r.item.item_name || "",
      material:     r.item.material || "",
      description:  r.item.description || "",
      size_spec:    r.item.size_spec || "",
      placement:    r.item.placement || "",
    }));
    try {
      const { data, error } = await invokeFn("classify-components", { body: { items: slice } });
      if (error || !data?.ok || !Array.isArray(data.classifications)) continue;
      for (const c of data.classifications) {
        if (c && c.id != null && c.component_type) {
          ambiguousById.set(String(c.id), c);
        }
      }
    } catch (_e) {
      // Silently skip — keep the keyword classifier's result for these rows.
    }
  }

  // 4. Merge AI results back, keyed by index.
  return local.map(({ index, component_type, confidence, reason }) => {
    const ai = ambiguousById.get(String(index));
    if (ai && ai.component_type && (ai.confidence ?? 0.85) >= confidenceFloor) {
      return {
        index,
        component_type: ai.component_type,
        confidence: ai.confidence ?? 0.85,
        reason: `ai:${ai.reason || "claude"}`,
      };
    }
    return { index, component_type, confidence, reason };
  });
}
