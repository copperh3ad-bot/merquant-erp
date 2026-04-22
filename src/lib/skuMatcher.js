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

// ── Main: match a list of PO items against fabric templates ──────────────
// Returns { matched: [], unknowns: [] }
// matched  → items with template found (exact or fuzzy ≥ 0.8)
// unknowns → items with no template match → need human review
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

    // 3. Fuzzy match — best score above threshold
    let bestScore = 0;
    let bestTemplate = null;
    for (const t of templates) {
      const codeScore = code ? similarity(code, t.article_code || "") : 0;
      const nameScore = desc ? similarity(desc, t.article_name || "") : 0;
      const s = Math.max(codeScore, nameScore);
      if (s > bestScore) { bestScore = s; bestTemplate = t; }
    }

    if (bestScore >= 0.8 && bestTemplate) {
      matched.push({ item, template: bestTemplate, matchType: "fuzzy", score: bestScore });
      continue;
    }

    // 4. No match — needs human review
    unknowns.push({
      item,
      bestGuess: bestScore >= 0.5 ? { template: bestTemplate, score: bestScore } : null,
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

