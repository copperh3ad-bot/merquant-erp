// src/lib/classifyTerm.js
//
// Hybrid classifier: vocabulary first (deterministic, free), AI second
// (adaptive, costs ~$0.001 per call), client cache to amortise.
//
// Why this exists: regex / static alias tables can't cover the long tail
// of customer terminology. "PCSJMO" is a sheet set family but its code
// doesn't contain "CSS" or "SLP" or any other marker our regex looks for.
// "Heavy weight matt protector" is a mattress protector but doesn't match
// /MP\d/. The AI fallback classifies these by *meaning*, not pattern.
//
// Performance contract:
//   - canonical hit  → instant, $0
//   - cache hit      → instant, $0
//   - AI call        → 0.5-2s, ~$0.0005 (Haiku, prompt-cached system text)
//
// The cache lives in localStorage. Per-category. Cap at MAX_CACHE_ENTRIES
// per category (LRU-ish: when full, drop oldest 25%).

import { canonical, allCanonicals, CATEGORIES } from "./textileVocabulary";
import { callClaude } from "./aiProxy";

const CACHE_KEY_PREFIX = "mq_classify_term_";
const MAX_CACHE_ENTRIES = 500;

// Confidence threshold below which we treat the AI's answer as unknown.
const MIN_AI_CONFIDENCE = 0.55;

// In-flight de-duplication so concurrent calls for the same input don't
// each fire their own AI request.
const inflight = new Map();

// ── Cache helpers ───────────────────────────────────────────────────────────

function cacheKey(category) {
  return CACHE_KEY_PREFIX + category;
}

function readCache(category) {
  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(cacheKey(category)) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(category, cache) {
  try {
    // LRU-trim if over cap. Drop oldest 25 % by `at` timestamp.
    const entries = Object.entries(cache);
    if (entries.length > MAX_CACHE_ENTRIES) {
      entries.sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
      const drop = Math.floor(entries.length * 0.25);
      const trimmed = entries.slice(drop);
      cache = Object.fromEntries(trimmed);
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(cacheKey(category), JSON.stringify(cache));
    }
  } catch {
    // ignore (private mode, quota, etc.)
  }
}

const norm = (s) => (s == null ? "" : String(s).toLowerCase().trim().replace(/\s+/g, " "));

// ── Main API ────────────────────────────────────────────────────────────────

/**
 * Classify `input` as one of the canonical names in `category`.
 *
 * @param {string} category   one of CATEGORIES, e.g. "part", "size", "accessory"
 * @param {string} input      the customer's raw term
 * @param {object} [options]
 * @param {string} [options.context]  extra context to help the AI ("SKU code", "size column", etc.)
 * @param {boolean} [options.useAI=true]  set to false to disable AI fallback
 * @param {string} [options.model="claude-haiku-4-5"]
 * @returns {Promise<{ canonical: string|null, source: "vocab"|"cache"|"ai"|"none", confidence: number }>}
 */
export async function classifyTerm(category, input, options = {}) {
  const { context, useAI = true, model = "claude-haiku-4-5" } = options;

  if (!CATEGORIES.includes(category)) {
    console.warn(`[classifyTerm] unknown category: ${category}`);
    return { canonical: null, source: "none", confidence: 0 };
  }
  const term = norm(input);
  if (!term) return { canonical: null, source: "none", confidence: 0 };

  // 1. Vocabulary fast path
  const direct = canonical(category, input);
  if (direct) return { canonical: direct, source: "vocab", confidence: 1 };

  // 2. Cache
  const cache = readCache(category);
  const cached = cache[term];
  if (cached) {
    return {
      canonical: cached.canonical,
      source: "cache",
      confidence: cached.confidence ?? 0.7,
    };
  }

  if (!useAI) return { canonical: null, source: "none", confidence: 0 };

  // 3. AI — coalesce concurrent calls for the same term
  const dedupKey = `${category}::${term}`;
  if (inflight.has(dedupKey)) return inflight.get(dedupKey);

  const promise = (async () => {
    try {
      const allowed = allCanonicals(category);
      const ai = await classifyViaAI({ category, input, allowed, context, model });

      const accepted = ai.canonical && allowed.includes(ai.canonical) && ai.confidence >= MIN_AI_CONFIDENCE
        ? ai.canonical
        : null;

      // Persist to cache (always, so we don't keep re-asking even for unknowns)
      const fresh = readCache(category);
      fresh[term] = {
        canonical: accepted,
        confidence: ai.confidence,
        at: Date.now(),
      };
      writeCache(category, fresh);

      return {
        canonical: accepted,
        source: "ai",
        confidence: ai.confidence,
      };
    } catch (err) {
      console.warn(`[classifyTerm] AI call failed for ${category}/${input}:`, err);
      return { canonical: null, source: "none", confidence: 0 };
    } finally {
      inflight.delete(dedupKey);
    }
  })();

  inflight.set(dedupKey, promise);
  return promise;
}

// ── AI call ────────────────────────────────────────────────────────────────

async function classifyViaAI({ category, input, allowed, context, model }) {
  const system = SYSTEM_PROMPT_BY_CATEGORY[category] || GENERIC_SYSTEM_PROMPT;
  const userMessage = [
    `Input term: "${input}"`,
    context ? `Context: ${context}` : null,
    `Possible canonical values: ${JSON.stringify(allowed)}`,
    `Respond with strict JSON: {"canonical":"<one of the allowed values, or null>","confidence":<0..1>,"reason":"<brief>"}.`,
    `If the input doesn't match any canonical value, return {"canonical":null,"confidence":0.0,"reason":"…"}.`,
  ].filter(Boolean).join("\n");

  const data = await callClaude({
    model,
    system,
    messages: [{ role: "user", content: userMessage }],
    max_tokens: 200,
    cacheSystem: true,
  });

  const text = data?.content?.[0]?.text || "";
  const obj = parseJsonLoose(text);
  return {
    canonical: typeof obj?.canonical === "string" ? obj.canonical : null,
    confidence: clampNum(obj?.confidence, 0, 1),
    reason: typeof obj?.reason === "string" ? obj.reason : null,
  };
}

function parseJsonLoose(text) {
  if (!text) return null;
  // Strip code-fence wrappers
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Last resort: find the first { ... } block
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function clampNum(n, min, max) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(min, Math.min(max, x));
}

// ── Per-category system prompts ─────────────────────────────────────────────
//
// Concise prompts kept inline for now. Each should explain the category's
// semantics clearly enough that the AI can map customer-specific terms to
// our canonical set.

const GENERIC_SYSTEM_PROMPT = `
You are a textile-domain classifier. Map an input term to one of the
provided canonical values, or return null if no match exists. Reason
about meaning, not surface text — customer files use unpredictable
spellings, abbreviations, and language. Be conservative: prefer null
over a wrong match. Respond in strict JSON only.
`.trim();

const SYSTEM_PROMPT_BY_CATEGORY = {
  part: `${GENERIC_SYSTEM_PROMPT}

Category: garment PART (a physical piece of a finished article).
Examples of canonical names you may be asked about:
  Flat Sheet, Fitted Sheet, Pillow Case, Sham, Fabric Bag, Top Fabric,
  Bottom, Skirt, Front, Back, Binding, Piping, Filling, Platform,
  Sleeper Flap, Lamination.

NEVER return a fabric description (e.g. "Jersey Knit", "Modal",
"170 GSM") as a part name — those are fabric_type values, not parts.
If the input is a fabric description, return canonical=null.`,

  fabric_type: `${GENERIC_SYSTEM_PROMPT}

Category: FABRIC TYPE (construction/weave family). Examples: Jersey
Knit, Sateen, Percale, Twill, Plain Weave, Flannel, Microfiber. Do
NOT return a fibre composition (Cotton, Polyester) — that's a
different category.`,

  fibre: `${GENERIC_SYSTEM_PROMPT}

Category: FIBRE COMPOSITION. Examples: Cotton, Modal, Polyester,
Spandex, Lyocell. Strip any percentage prefix.`,

  accessory: `${GENERIC_SYSTEM_PROMPT}

Category: ACCESSORY CATEGORY (the role of an accessory item in the
finished article). Examples: Care Label, Hang Tag, Polybag, Stiffener,
Insert Card, Sticker, Zipper, Thread, Elastic.`,

  size: `${GENERIC_SYSTEM_PROMPT}

Category: SIZE (US bedding size convention). Examples: Twin, Twin XL,
Full, Queen, King, Cal King, Split King, Split Head Queen.`,

  direction: `${GENERIC_SYSTEM_PROMPT}

Category: cutting direction code. Examples: WXL (width × length),
LXW, LXL, WXW, Bias.`,

  treatment: `${GENERIC_SYSTEM_PROMPT}

Category: fabric TREATMENT/finish. Examples: Antimicrobial, Stain
Repellent, Waterproof, Cooling, Flame Retardant.`,

  colour: `${GENERIC_SYSTEM_PROMPT}

Category: COLOUR. Examples: White, Black, Grey, Navy, Ivory, Beige.`,
};

/**
 * Convenience: classify a SKU/product code as a product family.
 * Tries vocabulary's productFamilyOf regex first, then AI as fallback.
 *
 * @param {string} sku
 * @param {object} [options]
 * @param {string} [options.productName]  optional product name for AI context
 * @returns {Promise<{ canonical: string|null, source: string, confidence: number }>}
 */
export async function classifyProductFamily(sku, options = {}) {
  // Imported lazily to avoid circular dependency concerns
  const { productFamilyOf, PRODUCT_FAMILIES } = await import("./textileVocabulary");
  const { productName } = options;

  const direct = productFamilyOf(sku);
  if (direct) return { canonical: direct, source: "vocab", confidence: 1 };

  // Cache + AI fallback. We cache under a synthetic "product_family" key
  // (not in CATEGORIES) so it lives alongside the others.
  const cache = readCache("product_family");
  const term = norm(sku);
  if (cache[term]) {
    return { canonical: cache[term].canonical, source: "cache", confidence: cache[term].confidence };
  }

  try {
    const allowed = PRODUCT_FAMILIES;
    const system = `${GENERIC_SYSTEM_PROMPT}

Category: PRODUCT FAMILY. Map a textile SKU code (and optionally its
product name) to one of: ${allowed.join(", ")}.

SKU codes are concatenated abbreviations. Examples:
  GPMP38 → Mattress Protector (MP infix, 38" mattress depth)
  GPSE50 → Sleeper Encasement (SE infix)
  GPTE50 → Total Encasement (TE infix)
  PCSJMO-Q-WH → Sheet Set (PureCare Sheet Jersey Modal — sheet set family)
  SLPCSS-K-GY → Sheet Set (Sleep Cool Stretch — sheet set family)
  GPPPK → Pillow Protector (PP infix)

Use both letter cues and the product name when available.`;

    const userMsg = [
      `SKU code: "${sku}"`,
      productName ? `Product name: "${productName}"` : null,
      `Possible canonical values: ${JSON.stringify(allowed)}`,
      `Respond with strict JSON: {"canonical":"<one of the values, or null>","confidence":<0..1>,"reason":"<brief>"}.`,
    ].filter(Boolean).join("\n");

    const data = await callClaude({
      model: options.model || "claude-haiku-4-5",
      system,
      messages: [{ role: "user", content: userMsg }],
      max_tokens: 150,
      cacheSystem: true,
    });

    const text = data?.content?.[0]?.text || "";
    const obj = parseJsonLoose(text);
    const accepted = obj?.canonical && allowed.includes(obj.canonical) && (obj.confidence ?? 0) >= MIN_AI_CONFIDENCE
      ? obj.canonical
      : null;

    const fresh = readCache("product_family");
    fresh[term] = {
      canonical: accepted,
      confidence: clampNum(obj?.confidence, 0, 1),
      at: Date.now(),
    };
    writeCache("product_family", fresh);

    return {
      canonical: accepted,
      source: "ai",
      confidence: clampNum(obj?.confidence, 0, 1),
    };
  } catch (err) {
    console.warn(`[classifyProductFamily] AI call failed for ${sku}:`, err);
    return { canonical: null, source: "none", confidence: 0 };
  }
}

// Test helpers
export const _internals = {
  cacheKey,
  readCache,
  writeCache,
  parseJsonLoose,
  norm,
};
