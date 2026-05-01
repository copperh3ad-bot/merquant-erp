// src/lib/fabricBagDimensionCheck.js
//
// Detects articles that have a "Fabric Bag" fabric component but no resolved
// dimension. Used by:
//   - The Dashboard banner that nags the user to fill in missing fabric-bag
//     sizes (tech-pack files almost never include the polybag size — see
//     2026-05-01 conversation with Waqas).
//
// Why a separate module:
//   The Fabric Working Sheet's resolveDims is tightly coupled to a useQuery
//   index (per page state). The dashboard needs a simpler, dependency-free
//   version that asks one question per article: "is the fabric-bag dimension
//   knowable?". A blank means the user needs to enter it manually.
//
// Resolution order mirrors FabricWorking.jsx::resolveDims for the part where
// the fabric-bag dimension can possibly come from:
//   Layer 0: component.dimensions on the Fabric Bag component itself.
//   Layer 1: article.product_dimensions (whole-SKU manual override).
//   Layer 2: tech pack part_dimensions[Fabric Bag] for this article_code.
//
// We do NOT count Layer 2b/3b (whole-SKU dimension fall-through) because
// those would otherwise return the flat-sheet dimension — that was the
// original bug we fixed.

export function articleHasFabricBag(article) {
  if (!article?.components || !Array.isArray(article.components)) return false;
  return article.components.some(
    (c) => (c?.component_type || "").toLowerCase().trim() === "fabric bag",
  );
}

/**
 * Returns the Fabric Bag component object on this article, or null.
 */
export function getFabricBagComponent(article) {
  if (!article?.components || !Array.isArray(article.components)) return null;
  return (
    article.components.find(
      (c) => (c?.component_type || "").toLowerCase().trim() === "fabric bag",
    ) || null
  );
}

/**
 * @param {object}   article            articles row, including components[].
 * @param {object}   [techPackPartDims] optional map { "fabric bag": "..." }
 *                                      pulled from tech_packs for this article.
 *                                      Pass null/undefined when no tech-pack
 *                                      data is available.
 * @returns {string} resolved dimension string, or "" if unknown.
 */
export function resolveFabricBagDimension(article, techPackPartDims) {
  const comp = getFabricBagComponent(article);
  if (!comp) return "";

  // Layer 0: component-level override.
  if (comp.dimensions) return String(comp.dimensions);

  // Layer 1: article-level override.
  if (article?.product_dimensions) return String(article.product_dimensions);

  // Layer 2: tech-pack per-part dimension.
  if (techPackPartDims && typeof techPackPartDims === "object") {
    for (const [k, v] of Object.entries(techPackPartDims)) {
      if (!v) continue;
      if ((k || "").toLowerCase().trim() === "fabric bag") return String(v);
    }
  }

  return "";
}

/**
 * Filters a list of articles to those that need a manual fabric-bag dimension.
 *
 * @param {Array<object>} articles
 * @param {Map<string, object>} [techPackPartDimsByArticle] article_code -> partDims
 * @returns {Array<object>} subset of articles missing the dimension.
 */
export function findArticlesMissingFabricBagDimension(articles, techPackPartDimsByArticle) {
  if (!Array.isArray(articles)) return [];
  return articles.filter((a) => {
    if (!articleHasFabricBag(a)) return false;
    const partDims = techPackPartDimsByArticle?.get?.(a.article_code) || null;
    return !resolveFabricBagDimension(a, partDims);
  });
}
