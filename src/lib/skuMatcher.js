import { mfg, skuQueue } from "@/api/supabaseClient";

// ── Fuzzy match: Levenshtein distance normalised 0–1 ─────────────────────
function similarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: la + 1 }, (_, i) => Array.from({ length: lb + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return 1 - dp[la][lb] / Math.max(la, lb);
}

// ── Code-shape rules (override Levenshtein) ──────────────────────────────
//
// 2026-05-04 — bug found in fuzzy matching: Levenshtein alone matched
// `FRIOMP36` to `GPFRIOMP36` (different product family — master adds a
// "GP" brand prefix) and `FRIOMP36` to `FRIOMP38` (different size —
// numeric suffix differs). Two structural rules now run BEFORE the
// Levenshtein fallback:
//
//   1. Prefix-extension reject — if one code ends with the other and
//      the longer prefix is alpha-only, they are different SKUs (the
//      prefix is a brand qualifier like "GP", "QC", etc).
//   2. Numeric-suffix mismatch reject — split each code into
//      [alphaPrefix, numericSuffix]. If both have a numeric suffix and
//      the suffixes differ, reject. Sizes differ → different SKUs.
//
// One positive-shape rule for OCR detection:
//
//   3. OCR-likely — same length, same numeric suffix, alpha-prefix
//      Hamming distance exactly 1. Catches `GPFRIAMP33` ↔ `GPFRIOMP33`
//      where A↔O is an OCR misread inside the body. Matches under this
//      rule still go through human confirm via the SKU review queue
//      (matchType "ocr_likely").

const ALPHA_NUM_SPLIT = /^(.+?)(\d+)$/;

function splitSku(sku) {
  const s = String(sku || "").toUpperCase().trim();
  const m = s.match(ALPHA_NUM_SPLIT);
  return m ? [m[1], m[2]] : [s, ""];
}

function isPrefixExtension(a, b) {
  // True if the longer string ends with the shorter and the extra
  // leading characters on the longer are alpha-only (brand prefix
  // pattern). Numeric prefixes are NOT treated as brand qualifiers
  // (could be a year, version, etc.).
  if (a === b || !a || !b) return false;
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  if (!longer.endsWith(shorter)) return false;
  const extra = longer.slice(0, longer.length - shorter.length);
  return /^[A-Z]+$/.test(extra);
}

function isLikelyOcr(a, b) {
  // Same length, identical numeric suffix, alpha prefix differs by
  // exactly one substitution (Hamming distance 1).
  if (a === b || !a || !b || a.length !== b.length) return false;
  const [aAlpha, aNum] = splitSku(a);
  const [bAlpha, bNum] = splitSku(b);
  if (!aNum || aNum !== bNum) return false;
  if (aAlpha.length !== bAlpha.length) return false;
  let diffs = 0;
  for (let i = 0; i < aAlpha.length; i++) {
    if (aAlpha[i] !== bAlpha[i]) {
      diffs++;
      if (diffs > 1) return false;
    }
  }
  return diffs === 1;
}

function numericSuffixesDiffer(a, b) {
  const [, aNum] = splitSku(a);
  const [, bNum] = splitSku(b);
  return !!aNum && !!bNum && aNum !== bNum;
}

// Decide how a candidate template code relates to an item code.
// Returns one of: 'exact' | 'ocr_likely' | 'fuzzy' | 'reject' (with score).
// Exposed for tests via _internals.
function matchShape(itemCode, templateCode) {
  const a = String(itemCode || "").toUpperCase().trim();
  const b = String(templateCode || "").toUpperCase().trim();
  if (!a || !b) return { type: "reject", score: 0 };
  if (a === b) return { type: "exact", score: 1 };

  // Hard rejects, regardless of Levenshtein
  if (isPrefixExtension(a, b)) return { type: "reject", score: 0, reason: "prefix-extension" };
  if (numericSuffixesDiffer(a, b)) return { type: "reject", score: 0, reason: "numeric-suffix-mismatch" };

  // Positive OCR signal
  if (isLikelyOcr(a, b)) return { type: "ocr_likely", score: 0.9, reason: "single-char-swap" };

  // Fall through to Levenshtein
  const s = similarity(a, b);
  if (s >= 0.8) return { type: "fuzzy", score: s };
  return { type: "reject", score: s };
}

export const _internals = {
  similarity,
  splitSku,
  isPrefixExtension,
  isLikelyOcr,
  numericSuffixesDiffer,
  matchShape,
};

// ── Main: match a list of PO items against fabric templates ──────────────
// Returns { matched: [], unknowns: [] }
// matched  → items with template found (exact or fuzzy ≥ 0.8)
// unknowns → items with no template match → need human review
//            (ocr_likely + low-confidence fuzzy lands here with bestGuess
//             for the SKU Review Queue confirm dialog)
export async function matchSKUsToTemplates(items) {
  const templates = await mfg.fabricTemplates.list();
  const matched = [];
  const unknowns = [];

  for (const item of items) {
    const code = (item.item_code || "").trim().toUpperCase();
    const desc = (item.item_description || "").trim().toUpperCase();

    // 1. Exact match by article_code
    const exact = templates.find(t => t.article_code?.trim().toUpperCase() === code);
    if (exact) {
      matched.push({ item, template: exact, matchType: "exact", score: 1 });
      continue;
    }

    // 2. Exact match by article_name against description
    const nameExact = templates.find(t => t.article_name?.trim().toUpperCase() === desc);
    if (nameExact) {
      matched.push({ item, template: nameExact, matchType: "exact", score: 1 });
      continue;
    }

    // 3. Per-template shape evaluation — pick the best non-rejected match.
    //    matchShape() applies the prefix-extension + numeric-suffix-mismatch
    //    rejects BEFORE falling back to Levenshtein, so a high-score
    //    Levenshtein match against a wrong-family code is correctly
    //    suppressed.
    let best = { type: "reject", score: 0 };
    let bestTemplate = null;
    for (const t of templates) {
      const tCode = (t.article_code || "").trim().toUpperCase();
      const codeShape = code ? matchShape(code, tCode) : { type: "reject", score: 0 };
      const nameScore = desc ? similarity(desc, t.article_name || "") : 0;
      // Prefer code-shape matches; fall back to name similarity only if
      // the name score is meaningfully higher.
      const candidate = nameScore > codeShape.score + 0.05
        ? { type: nameScore >= 0.8 ? "fuzzy" : "reject", score: nameScore }
        : codeShape;
      if (candidate.score > best.score) {
        best = candidate;
        bestTemplate = t;
      }
    }

    // ocr_likely → human confirms via SKU Review Queue (not auto-matched).
    if (best.type === "ocr_likely" && bestTemplate) {
      unknowns.push({
        item,
        bestGuess: { template: bestTemplate, score: best.score, reason: "ocr_likely" },
      });
      continue;
    }
    if (best.type === "fuzzy" && best.score >= 0.8 && bestTemplate) {
      matched.push({ item, template: bestTemplate, matchType: "fuzzy", score: best.score });
      continue;
    }

    // 4. No match — needs human review (with bestGuess if borderline)
    unknowns.push({
      item,
      bestGuess: best.score >= 0.5 && bestTemplate ? { template: bestTemplate, score: best.score } : null,
    });
  }

  return { matched, unknowns };
}

// ── Enqueue unknown SKUs for human review ────────────────────────────────
export async function enqueueUnknownSKUs({ poId, poNumber, items, poItemIds = {} }) {
  if (!items.length) return 0;

  const rows = items.map(({ item, bestGuess }) => ({
    po_id: poId,
    po_number: poNumber,
    po_item_id: poItemIds[item.item_code] || null,
    item_code: item.item_code || "",
    item_description: item.item_description || "",
    order_quantity: Number(item.quantity) || 0,
    status: "pending",
    match_type: bestGuess ? "ai_suggested" : "new",
    matched_template_code: bestGuess?.template?.article_code || null,
    suggested_components: bestGuess?.template?.components || [],
    notes: bestGuess
      ? `Best guess: "${bestGuess.template.article_name}" (${Math.round(bestGuess.score * 100)}% match)`
      : "No similar SKU found in templates",
  }));

  await skuQueue.create(rows);
  return rows.length;
}

// ── Apply a template to create/update an article record ──────────────────
export function applyTemplateToArticle(article, template, customComponents = null) {
  const comps = (customComponents || template?.components || []).map(c => {
    const net = (c.consumption_per_unit || 0) * (article.order_quantity || 0);
    return { ...c, total_required: +(net * (1 + (c.wastage_percent || 6) / 100)).toFixed(4) };
  });
  const total_fabric_required = +comps.reduce((s, c) => s + (c.total_required || 0), 0).toFixed(4);
  return { ...article, components: comps, total_fabric_required };
}

