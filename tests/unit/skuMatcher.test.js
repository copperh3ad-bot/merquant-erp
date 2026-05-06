import { describe, it, expect, vi } from "vitest";

// Stub the supabase client so the import chain doesn't throw on missing
// VITE_SUPABASE_* env vars in CI. The tests below only need the pure
// helpers.
vi.mock("@/api/supabaseClient", () => ({
  mfg: { fabricTemplates: { list: vi.fn() } },
  skuQueue: { create: vi.fn() },
}));

import { _internals, matchSKUsToTemplates, applyTemplateToArticle } from "../../src/lib/skuMatcher.js";
import { mfg } from "@/api/supabaseClient";

const { normalizeCode, stripVariantSuffix } = _internals;

// Per docs/architecture.md §4 — SKU matching uses NORMALIZATION ONLY:
//   case + whitespace + dashes + base-SKU variant strip.
// No fuzzy / Levenshtein. The test cases that previously demonstrated
// the structural-override behaviour now demonstrate the same outcome via
// normalization-only: near-but-distinct codes simply don't equate, so
// they fall through to the unknowns list rather than being false-matched.

describe("normalizeCode", () => {
  it("uppercases", () => {
    expect(normalizeCode("gpte78")).toBe("GPTE78");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeCode("  GPTE78  ")).toBe("GPTE78");
  });

  it("strips embedded whitespace, dashes, underscores", () => {
    expect(normalizeCode("GPTE-78")).toBe("GPTE78");
    expect(normalizeCode("GPTE_78")).toBe("GPTE78");
    expect(normalizeCode("GP TE 78")).toBe("GPTE78");
    expect(normalizeCode("GP-TE_78 ABC")).toBe("GPTE78ABC");
  });

  it("returns empty string for null / undefined / blank", () => {
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
    expect(normalizeCode("")).toBe("");
    expect(normalizeCode("   ")).toBe("");
  });

  it("treats already-normalised codes as fixed points (idempotent)", () => {
    expect(normalizeCode("GPTE78")).toBe("GPTE78");
    expect(normalizeCode(normalizeCode("gp te-78"))).toBe("GPTE78");
  });
});

describe("stripVariantSuffix", () => {
  it("strips a trailing dash + 1-4 alphanumeric variant", () => {
    expect(stripVariantSuffix("FRIOMP-RED")).toBe("FRIOMP");
    expect(stripVariantSuffix("GPTE78-L")).toBe("GPTE78");
    expect(stripVariantSuffix("ABC-123")).toBe("ABC");
    expect(stripVariantSuffix("ABC-X1Y2")).toBe("ABC");
  });

  it("returns null when no dash variant is present", () => {
    expect(stripVariantSuffix("GPTE78")).toBeNull();
    expect(stripVariantSuffix("FRIOMP36")).toBeNull();
    expect(stripVariantSuffix("")).toBeNull();
    expect(stripVariantSuffix(null)).toBeNull();
  });

  it("does not strip a long suffix (5+ chars after dash)", () => {
    // "-NAVYBLUE" is 8 chars, far longer than a typical color/size code,
    // so it isn't treated as a variant.
    expect(stripVariantSuffix("FRIOMP-NAVYBLUE")).toBeNull();
  });

  it("strips only the LAST suffix when there are several dashes", () => {
    expect(stripVariantSuffix("BAGW3-W4-RED")).toBe("BAGW3-W4");
  });
});

// ── End-to-end matchSKUsToTemplates ─────────────────────────────────────
//
// The bug-regression cases from 2026-05-04 are reframed: with no
// Levenshtein in play, FRIOMP36 simply isn't equal to GPFRIOMP36 after
// normalising, so it lands in unknowns rather than being false-matched.

const buildTemplate = (code, name = code) => ({
  article_code: code,
  article_name: name,
  components: [],
});

describe("matchSKUsToTemplates", () => {
  it("matches exact codes case-insensitively and stripping dashes", async () => {
    mfg.fabricTemplates.list.mockResolvedValue([buildTemplate("GPTE78")]);
    const { matched, unknowns } = await matchSKUsToTemplates([
      { item_code: "gpte-78", item_description: "" },
    ]);
    expect(matched).toHaveLength(1);
    expect(unknowns).toHaveLength(0);
    expect(matched[0].matchType).toBe("exact");
    expect(matched[0].template.article_code).toBe("GPTE78");
  });

  it("matches by article_name when item_code misses", async () => {
    mfg.fabricTemplates.list.mockResolvedValue([
      buildTemplate("GPTE78", "Standard Pillow Insert"),
    ]);
    const { matched } = await matchSKUsToTemplates([
      { item_code: "X-UNKNOWN", item_description: "Standard Pillow Insert" },
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0].matchType).toBe("exact");
  });

  it("resolves base-SKU when raw code has a colour/size variant", async () => {
    mfg.fabricTemplates.list.mockResolvedValue([buildTemplate("FRIOMP")]);
    const { matched, unknowns } = await matchSKUsToTemplates([
      { item_code: "FRIOMP-RED" },
    ]);
    expect(matched).toHaveLength(1);
    expect(unknowns).toHaveLength(0);
    expect(matched[0].matchType).toBe("base_sku");
  });

  it("does NOT match FRIOMP36 → GPFRIOMP36 (different brand prefix)", async () => {
    // The bug regression case: pre-2026-05-04 Levenshtein matchers gave
    // these ~0.8 similarity and falsely matched. Normalize-only doesn't
    // equate them, so the item lands in unknowns.
    mfg.fabricTemplates.list.mockResolvedValue([buildTemplate("GPFRIOMP36")]);
    const { matched, unknowns } = await matchSKUsToTemplates([
      { item_code: "FRIOMP36" },
    ]);
    expect(matched).toHaveLength(0);
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0].bestGuess).toBeNull();
  });

  it("does NOT match FRIOMP36 → FRIOMP38 (different size)", async () => {
    mfg.fabricTemplates.list.mockResolvedValue([buildTemplate("FRIOMP38")]);
    const { matched, unknowns } = await matchSKUsToTemplates([
      { item_code: "FRIOMP36" },
    ]);
    expect(matched).toHaveLength(0);
    expect(unknowns).toHaveLength(1);
  });

  it("does NOT match GPFRIAMP33 → GPFRIOMP33 (single-char body swap)", async () => {
    // Previously OCR-likely + human-confirm. Now: just unknowns.
    mfg.fabricTemplates.list.mockResolvedValue([buildTemplate("GPFRIOMP33")]);
    const { matched, unknowns } = await matchSKUsToTemplates([
      { item_code: "GPFRIAMP33" },
    ]);
    expect(matched).toHaveLength(0);
    expect(unknowns).toHaveLength(1);
  });

  it("does NOT match FTAMP46 → FTATE46 (multi-position alpha diff)", async () => {
    mfg.fabricTemplates.list.mockResolvedValue([buildTemplate("FTATE46")]);
    const { matched, unknowns } = await matchSKUsToTemplates([
      { item_code: "FTAMP46" },
    ]);
    expect(matched).toHaveLength(0);
    expect(unknowns).toHaveLength(1);
  });

  it("emits unknowns with bestGuess=null (no similarity-based guesses)", async () => {
    mfg.fabricTemplates.list.mockResolvedValue([
      buildTemplate("GPFRIOMP36"),
      buildTemplate("FRIOMP38"),
    ]);
    const { unknowns } = await matchSKUsToTemplates([
      { item_code: "FRIOMP36" },
    ]);
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0].bestGuess).toBeNull();
  });

  it("handles an empty templates list", async () => {
    mfg.fabricTemplates.list.mockResolvedValue([]);
    const { matched, unknowns } = await matchSKUsToTemplates([
      { item_code: "GPTE78" },
    ]);
    expect(matched).toHaveLength(0);
    expect(unknowns).toHaveLength(1);
  });

  it("handles items with empty item_code (description-only fallback)", async () => {
    mfg.fabricTemplates.list.mockResolvedValue([
      buildTemplate("GPTE78", "Standard Pillow Insert"),
    ]);
    const { matched } = await matchSKUsToTemplates([
      { item_code: "", item_description: "Standard Pillow Insert" },
    ]);
    expect(matched).toHaveLength(1);
  });
});

// Regression net for Fix 1 — wastage_percent || 6 → ?? 0. The old
// fallback inflated total_required by 6% on every component where
// wastage was null, undefined, OR explicitly 0.

describe("applyTemplateToArticle", () => {
  const article = { id: "a1", article_code: "PF-MP-Q", order_quantity: 100 };
  const template = {
    components: [
      { component_type: "Platform", consumption_per_unit: 2.0, wastage_percent: 10 },
      { component_type: "Skirt",    consumption_per_unit: 0.5, wastage_percent: 5  },
    ],
  };

  it("applies explicit wastage correctly", () => {
    const result = applyTemplateToArticle(article, template);
    // Platform: 2.0 × 100 × 1.10 = 220
    expect(result.components[0].total_required).toBeCloseTo(220, 3);
    // Skirt: 0.5 × 100 × 1.05 = 52.5
    expect(result.components[1].total_required).toBeCloseTo(52.5, 3);
  });

  it("treats null wastage_percent as 0%, not 6% (bug fix: ?? 0)", () => {
    const noWastage = {
      components: [{ component_type: "Shell", consumption_per_unit: 2.0, wastage_percent: null }],
    };
    const result = applyTemplateToArticle(article, noWastage);
    // Must be exactly 200, not 212 (which the old || 6 bug produced)
    expect(result.components[0].total_required).toBeCloseTo(200, 3);
  });

  it("treats undefined wastage_percent as 0%", () => {
    const noWastage = {
      components: [{ component_type: "Shell", consumption_per_unit: 2.0 }],
    };
    const result = applyTemplateToArticle(article, noWastage);
    expect(result.components[0].total_required).toBeCloseTo(200, 3);
  });

  it("treats explicit 0 wastage as 0% (not 6%)", () => {
    const zeroWastage = {
      components: [{ component_type: "Shell", consumption_per_unit: 2.0, wastage_percent: 0 }],
    };
    const result = applyTemplateToArticle(article, zeroWastage);
    expect(result.components[0].total_required).toBeCloseTo(200, 3);
  });

  it("sums total_fabric_required across all components", () => {
    const result = applyTemplateToArticle(article, template);
    // 220 + 52.5 = 272.5
    expect(result.total_fabric_required).toBeCloseTo(272.5, 3);
  });

  it("preserves article fields", () => {
    const result = applyTemplateToArticle(article, template);
    expect(result.id).toBe("a1");
    expect(result.article_code).toBe("PF-MP-Q");
    expect(result.order_quantity).toBe(100);
  });

  it("handles zero order_quantity — all totals are 0", () => {
    const result = applyTemplateToArticle({ ...article, order_quantity: 0 }, template);
    result.components.forEach(c => expect(c.total_required).toBe(0));
    expect(result.total_fabric_required).toBe(0);
  });

  it("uses customComponents when provided, ignoring template", () => {
    const custom = [{ component_type: "Custom", consumption_per_unit: 3.0, wastage_percent: 0 }];
    const result = applyTemplateToArticle(article, template, custom);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].component_type).toBe("Custom");
    expect(result.components[0].total_required).toBeCloseTo(300, 3);
  });
});
