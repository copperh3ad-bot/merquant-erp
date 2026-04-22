/**
 * Shared helpers for article fabric components.
 *
 * Used by both FabricWorking and Articles pages so that edit behavior,
 * color/base-code parsing, and recalculation logic stay in lockstep.
 */

// Known short-code → human label mapping for article_code color suffixes
const COLOR_CODE_MAP = {
  CG: "Cloud Gray",
  MB: "Misty Blue",
  WH: "White",
  NG: "Navy Gray",
  BL: "Blue",
  GR: "Gray",
  RD: "Red",
  BK: "Black",
};

/**
 * Derive a display-friendly color label for an article.
 * Preference order: explicit color field → suffix on article_code → fallback to article_name.
 */
export function getColorLabel(art) {
  if (!art) return "—";
  if (art.color) return art.color;
  const m = art.article_code?.match(/-([A-Z]{2,3})$/);
  if (m) return COLOR_CODE_MAP[m[1]] || m[1];
  return art.article_name || "—";
}

/**
 * Extract the base article code (color suffix stripped) so that
 * colorway siblings of the same style group together.
 *
 * Example: "GP-KIMONO-WHT-M-CG" → "GP-KIMONO-WHT-M"
 */
export function getBaseCode(art) {
  if (!art) return "";
  const code = art.article_code?.replace(/-[A-Z]{2,3}$/, "") || "";
  if (code) return code;
  // Fallback: strip common color words from article_name
  return (art.article_name || "")
    .replace(/\b(Cloud Gray|Misty Blue|White|Navy|Black|Red|Green|Blue|Gray|Grey)\b/gi, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Recalculate `total_required` for each fabric component given a target quantity.
 * Formula: consumption_per_unit × qty × (1 + wastage_percent/100)
 * Rounds to 4 decimal places to match FabricWorking output.
 */
export function recalcComponents(components, qty) {
  return (components || []).map((c) => {
    const cpu = parseFloat(c.consumption_per_unit) || 0;
    const net = cpu * (qty || 0);
    const wastage = parseFloat(c.wastage_percent) || 0;
    return {
      ...c,
      total_required: +(net * (1 + wastage / 100)).toFixed(4),
    };
  });
}

/**
 * Sum up total fabric required across all components. Used to keep
 * `total_fabric_required` on the article row in sync with the jsonb array.
 */
export function sumTotalFabric(components) {
  return +(components || [])
    .reduce((s, c) => s + (c.total_required || 0), 0)
    .toFixed(4);
}
