// src/lib/skuMatcher.js
//
// Per docs/architecture.md §4: SKU matching uses NORMALIZATION ONLY.
//   • case-insensitive (uppercase)
//   • whitespace stripped
//   • dashes / underscores stripped
//   • base-SKU variant strip — a trailing "-XYZ" (1-4 alphanumerics after
//     the last dash) is treated as a colour / size / finish variant and
//     stripped on a retry pass
//
// No fuzzy / Levenshtein — earlier matchers had a similarity-threshold
// fallback that incorrectly equated FRIOMP36 ↔ GPFRIOMP36 (different
// brand prefix) and similar near-but-distinct codes. Anything that
// doesn't match deterministically goes to the SKU review queue rather
// than being auto-resolved on a similarity guess.
//
// Public API:
//   matchSKUsToTemplates(items)       — returns { matched, unknowns }
//   enqueueUnknownSKUs(opts)          — writes to sku_review_queue
//   applyTemplateToArticle(...)       — copy template components onto an article
//
// _internals exposes normalizeCode + stripVariantSuffix for tests.

import { mfg, skuQueue } from "@/api/supabaseClient";

// ── Normalisation primitives ─────────────────────────────────────────────

/**
 * Canonical form for a SKU code:
 *   trim → uppercase → strip [whitespace | dash | underscore]
 *
 * Example: "  gpte-78  " → "GPTE78"
 */
export function normalizeCode(c) {
  return String(c || "").trim().toUpperCase().replace(/[\s\-_]+/g, "");
}

/**
 * Strip a trailing colour / size / finish variant suffix from the RAW
 * (un-normalised) code. The suffix is "-XYZ" where XYZ is 1-4
 * alphanumerics. Returns null if no such suffix is present.
 *
 *   "FRIOMP-RED"  → "FRIOMP"
 *   "GPTE78-L"    → "GPTE78"
 *   "GPTE78"      → null   (no dash, nothing to strip)
 */
export function stripVariantSuffix(code) {
  const s = String(code || "");
  const m = /^(.+)-([A-Z0-9]{1,4})$/i.exec(s);
  return m ? m[1] : null;
}

export const _internals = { normalizeCode, stripVariantSuffix };

// ── Main: match a list of PO items against fabric templates ──────────────
// Returns { matched: [], unknowns: [] }
//   matched  → items matched to a template (exact or base-SKU resolved)
//   unknowns → items with no deterministic match → human review via the
//              SKU review queue. No similarity guess.
export async function matchSKUsToTemplates(items) {
  const templates = await mfg.fabricTemplates.list();

  // Index templates by normalised article_code. canonicalFor preserves the
  // original casing/format so downstream code uses the master record's
  // exact code value.
  const tmplByNorm = new Map();      // norm code -> template
  const canonicalForNorm = new Map(); // norm code -> original article_code
  for (const t of templates) {
    const n = normalizeCode(t.article_code);
    if (!tmplByNorm.has(n)) {
      tmplByNorm.set(n, t);
      canonicalForNorm.set(n, t.article_code);
    }
  }

  // Index by article_name (uppercased+trimmed only) for description fallback.
  const tmplByName = new Map();
  for (const t of templates) {
    const n = String(t.article_name || "").trim().toUpperCase();
    if (n && !tmplByName.has(n)) tmplByName.set(n, t);
  }

  const matched = [];
  const unknowns = [];

  for (const item of items) {
    const rawCode = String(item.item_code || "").trim();
    const codeNorm = normalizeCode(rawCode);
    const descNorm = String(item.item_description || "").trim().toUpperCase();

    // 1. Direct normalised match on article_code.
    if (codeNorm && tmplByNorm.has(codeNorm)) {
      matched.push({
        item,
        template: tmplByNorm.get(codeNorm),
        matchType: "exact",
        score: 1,
      });
      continue;
    }

    // 2. Description match on article_name (case-insensitive, trimmed).
    if (descNorm && tmplByName.has(descNorm)) {
      matched.push({
        item,
        template: tmplByName.get(descNorm),
        matchType: "exact",
        score: 1,
      });
      continue;
    }

    // 3. Base-SKU variant strip: peel off a trailing "-XYZ" colour/size
    //    suffix on the RAW code, normalise the stripped form, and retry.
    const baseRaw = stripVariantSuffix(rawCode);
    const baseNorm = baseRaw ? normalizeCode(baseRaw) : null;
    if (baseNorm && tmplByNorm.has(baseNorm)) {
      matched.push({
        item,
        template: tmplByNorm.get(baseNorm),
        matchType: "base_sku",
        score: 1,
      });
      continue;
    }

    // 4. No deterministic match — to the review queue. No similarity guess.
    unknowns.push({ item, bestGuess: null });
  }

  return { matched, unknowns };
}

// ── Enqueue unknown SKUs for human review ────────────────────────────────
export async function enqueueUnknownSKUs({ poId, poNumber, items, poItemIds = {} }) {
  if (!items.length) return 0;

  const rows = items.map(({ item }) => ({
    po_id: poId,
    po_number: poNumber,
    po_item_id: poItemIds[item.item_code] || null,
    item_code: item.item_code || "",
    item_description: item.item_description || "",
    order_quantity: Number(item.quantity) || 0,
    status: "pending",
    match_type: "new",
    matched_template_code: null,
    suggested_components: [],
    notes: "No deterministic match in templates — needs manual mapping.",
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
