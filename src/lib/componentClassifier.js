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

  // ── Insert Card (printed card placed inside packaging)
  {
    type: "Insert Card",
    confidence: 0.93,
    test: (h) => /\b(insert card|insert paper|art card|color paper insert|bleach card|info card|booklet|leaflet)\b/.test(h)
              || (/\binsert\b/.test(h) && /\b(paper|card)\b/.test(h)),
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

// Pillow Protector matches BEFORE Mattress Protector because some Pillow
// codes (GPFRIOPPK, GPFRIOPPQ) also satisfy the MP regex via the "MPP"
// substring. Order matters.
const PRODUCT_TYPE_PATTERNS = [
  // Pillow Protector — codes ending in PPK/PPQ or containing PP\d
  { type: "Pillow Protector",   test: (c) => /PP[KQ]\d*$/.test(c) || /PP\d/.test(c) },
  // Mattress Protector — codes containing MP\d (GPMP46, GPFRIOMP33)
  { type: "Mattress Protector", test: (c) => /MP\d/.test(c) },
  // Sleeper Encasement — codes containing SE\d (GPSE50)
  { type: "Sleeper Encasement", test: (c) => /SE\d/.test(c) },
  // Total Encasement — codes containing TE\d (GPTE50)
  { type: "Total Encasement",   test: (c) => /TE\d/.test(c) },
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

// Per-product-type "this should NOT appear in a Polybag description" lists.
// Each keyword here is a STRONG signal the row was mis-paired in the source.
// Detection is one-way (we flag obvious problems, not subtle judgement calls).
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
  if (!material) return null;

  const productType = detectProductTypeFromCode(articleCode);
  if (!productType) return null;

  const rule = POLYBAG_MISMATCH_RULES[productType];
  if (!rule) return null;

  const m = String(material).toLowerCase();
  for (const kw of rule.bad_keywords) {
    if (m.includes(kw)) {
      return {
        article_code: articleCode,
        product_type: productType,
        offending_keyword: kw,
        message: `${articleCode} is a ${productType} but its Polybag description mentions "${kw}" — typical of a different product type. The row may be mis-paired in the master-data source.`,
      };
    }
  }
  return null;
}
