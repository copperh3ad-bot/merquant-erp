import { describe, it, expect } from "vitest";
import {
  resolveDescription,
  findTechPackForArticle,
} from "../../src/lib/descriptionResolver.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

// Minimal TAB_CONFIG entries covering both row shapes
const CFG_QUALITY = {
  category: "Label",
  typeOptions: ["Brand Label", "Care Label"],
  qualityLabel: "Quality / Description",
  qualityPlaceholder: "e.g. Woven, Satin, 3x5cm",
  defaultWastage: 5,
};

const CFG_SPLIT = {
  category: "Polybag",
  typeOptions: ["PVC", "PP", "PE"],
  splitDescSize: true,
  descLabel: "Description",
  descPlaceholder: "e.g. 50 micron, printed",
  sizeLabel: "Size",
  sizePlaceholder: "e.g. 40x60cm",
  defaultWastage: 3,
};

const ARTICLE_CODE = "MP-QUEEN-WHT";
const PO_ID = "po-uuid-001";

// A consumption_library row with real material
const masterFull = {
  item_code: ARTICLE_CODE,
  component_type: "Label",
  material: "Woven brand label, navy on white",
  size_spec: "3x5cm",
  wastage_percent: 0.05,
};

// A consumption_library row with empty material
const masterEmpty = {
  item_code: ARTICLE_CODE,
  component_type: "Label",
  material: "",
  size_spec: "3x5cm",
  wastage_percent: 0.05,
};

// A tech_packs row with accessory and label specs
const techPackRow = {
  id: "tp-uuid-001",
  article_code: ARTICLE_CODE,
  po_id: PO_ID,
  extracted_accessory_specs: [
    {
      accessory_type: "Label",
      description: "Woven brand label from tech pack",
      size_spec: "3x5cm",
      color: "navy",
    },
  ],
  extracted_trim_specs: [],
  extracted_label_specs: [],
};

// A tech_packs row matched only by po_id (no article_code match)
const techPackByPoOnly = {
  id: "tp-uuid-002",
  article_code: "DIFFERENT-CODE",
  po_id: PO_ID,
  extracted_accessory_specs: [
    {
      accessory_type: "Label",
      description: "Label from PO-level tech pack",
      size_spec: "2x4cm",
      color: "white",
    },
  ],
  extracted_trim_specs: [],
  extracted_label_specs: [],
};

// ── resolveDescription ────────────────────────────────────────────────────

describe("resolveDescription", () => {
  it("1. returns master row when masterSpecs has non-empty material; tech pack not consulted", () => {
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [masterFull],
      techPack: techPackRow,
    });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    // quality maps from material
    expect(result[0].quality).toBe("Woven brand label, navy on white");
    // size maps from size_spec
    expect(result[0].size).toBe("3x5cm");
    // wastage normalised: 0.05 → 5
    expect(result[0].wastage_percent).toBe(5);
  });

  it("2. falls through to tech pack when masterSpecs row exists but material is empty", () => {
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [masterEmpty],
      techPack: techPackRow,
    });

    expect(result).not.toBeNull();
    expect(result[0].quality).toBe("Woven brand label from tech pack");
  });

  it("3. falls through to tech pack when masterSpecs is empty array", () => {
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [],
      techPack: techPackRow,
    });

    expect(result).not.toBeNull();
    expect(result[0].quality).toBe("Woven brand label from tech pack");
  });

  it("4. returns null when both tiers are empty", () => {
    const emptyTechPack = {
      ...techPackRow,
      extracted_accessory_specs: [],
    };

    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [],
      techPack: emptyTechPack,
    });

    expect(result).toBeNull();
  });

  it("5. returns null without throwing when techPack is null (Path A — Packaging)", () => {
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [],
      techPack: null,
    });

    expect(result).toBeNull();
  });

  it("6. uses all master rows when mix of empty and non-empty material (no fall-through)", () => {
    const masterWithContent = { ...masterEmpty, material: "Care label, printed" };

    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [masterEmpty, masterWithContent],
      techPack: techPackRow,
    });

    expect(result).not.toBeNull();
    // Both master rows returned, not just the non-empty one
    expect(result).toHaveLength(2);
    // First row maps empty material to empty quality (preserved as blank slot)
    expect(result[0].quality).toBe("");
    expect(result[1].quality).toBe("Care label, printed");
  });

  it("maps splitDescSize tabs: description from material, size from size_spec", () => {
    const polybagMaster = {
      item_code: ARTICLE_CODE,
      component_type: "Polybag",
      material: "PP 50 micron, printed",
      size_spec: "40x60cm",
      wastage_percent: 3,
    };

    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Polybag",
      cfg: CFG_SPLIT,
      masterSpecs: [polybagMaster],
      techPack: null,
    });

    expect(result).not.toBeNull();
    expect(result[0].description).toBe("PP 50 micron, printed");
    expect(result[0].size).toBe("40x60cm");
    expect(result[0].quality).toBe("");
  });

  it("is case-insensitive on articleCode matching", () => {
    const result = resolveDescription({
      articleCode: "mp-queen-wht",  // lower-case
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [masterFull],    // stored upper-case
      techPack: null,
    });

    expect(result).not.toBeNull();
    expect(result[0].quality).toBe("Woven brand label, navy on white");
  });
});

// ── findTechPackForArticle ────────────────────────────────────────────────

describe("findTechPackForArticle", () => {
  it("7. returns article-code match when both article-code and po-id matches exist", () => {
    const result = findTechPackForArticle({
      articleCode: ARTICLE_CODE,
      poId: PO_ID,
      techPacks: [techPackByPoOnly, techPackRow],  // po-only listed first
    });

    expect(result).not.toBeNull();
    expect(result.id).toBe("tp-uuid-001");  // article-code match wins
  });

  it("8. returns po-id match when no article-code match exists", () => {
    const result = findTechPackForArticle({
      articleCode: "NONEXISTENT-CODE",
      poId: PO_ID,
      techPacks: [techPackByPoOnly],
    });

    expect(result).not.toBeNull();
    expect(result.id).toBe("tp-uuid-002");
  });

  it("9. returns null when no match exists", () => {
    const result = findTechPackForArticle({
      articleCode: "NONEXISTENT-CODE",
      poId: "different-po-uuid",
      techPacks: [techPackRow, techPackByPoOnly],
    });

    expect(result).toBeNull();
  });

  it("returns null for empty techPacks array", () => {
    const result = findTechPackForArticle({
      articleCode: ARTICLE_CODE,
      poId: PO_ID,
      techPacks: [],
    });

    expect(result).toBeNull();
  });

  it("is case-insensitive on articleCode matching", () => {
    const result = findTechPackForArticle({
      articleCode: "mp-queen-wht",
      poId: "different-po-uuid",
      techPacks: [techPackRow],  // stored as MP-QUEEN-WHT
    });

    expect(result).not.toBeNull();
    expect(result.id).toBe("tp-uuid-001");
  });
});

// ── AI-extracted shape coverage (regression guard) ────────────────────────
// AI extraction produces JSONB elements with descriptive free-form values
// in accessory_type / label_type, not the canonical tab category strings the
// BOB path used. Strict equality returned 0 candidates and the seeded rows
// came back with empty descriptions ("quantities are there but not the right
// description"). The resolver now does case-insensitive substring matching
// and also surfaces ALL labels on the Label tab regardless of label_type.

const techPackAiShape = {
  id: "tp-ai-001",
  article_code: ARTICLE_CODE,
  po_id: PO_ID,
  extracted_accessory_specs: [
    // AI emits descriptive accessory_type values, not exact tab names
    { accessory_type: "Polybag printed",      description: "50 micron PE bag",   size_spec: "40x60cm" },
    { accessory_type: "Stitching Density",    description: "11 stitches per inch" },
    { accessory_type: "Carton Outer Sleeve",  description: "5-ply B-flute brown" },
  ],
  extracted_trim_specs: [
    // AI's "packaging" array sometimes lands here with `category`, not `trim_type`
    { category: "Polybag", description: "PE 60 micron printed" },
  ],
  extracted_label_specs: [
    // AI label items use label_type for narrative, plus dimensions/section
    { label_type: "Print satin woven label", description: "Polyester silk satin print woven folded label", dimensions: "3.8x10cm" },
    { label_type: "Care label",              description: "100% cotton, machine wash cold",                dimensions: "2x6cm" },
  ],
};

describe("resolveDescription — AI-extracted shape", () => {
  it("Polybag tab: surfaces accessory whose accessory_type contains 'Polybag'", () => {
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Polybag",
      cfg: CFG_SPLIT,
      masterSpecs: [],
      techPack: techPackAiShape,
    });
    expect(result).not.toBeNull();
    // Should find at least the accessory_specs match AND the trim_specs match
    expect(result.length).toBeGreaterThanOrEqual(1);
    const descs = result.map((r) => r.description);
    expect(descs.some((d) => /50 micron/i.test(d) || /60 micron/i.test(d))).toBe(true);
  });

  it("Stitching/Density-only specs DON'T match unrelated tabs", () => {
    // "Stitching Density" should not appear under Trim or Polybag
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Trim",
      cfg: { ...CFG_QUALITY, category: "Trim" },
      masterSpecs: [],
      techPack: techPackAiShape,
    });
    if (result) {
      const descs = result.map((r) => r.quality);
      expect(descs.every((d) => !/stitches per inch/i.test(d))).toBe(true);
    }
  });

  it("Label tab: surfaces all label specs regardless of label_type", () => {
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [],
      techPack: techPackAiShape,
      techPackLabelSpecs: techPackAiShape.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThanOrEqual(2);
    const qualities = result.map((r) => r.quality);
    expect(qualities.some((q) => /silk satin/i.test(q))).toBe(true);
    expect(qualities.some((q) => /machine wash/i.test(q))).toBe(true);
  });

  it("Carton tab: matches accessory_type 'Carton Outer Sleeve' via substring", () => {
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Carton",
      cfg: { ...CFG_SPLIT, category: "Carton" },
      masterSpecs: [],
      techPack: techPackAiShape,
    });
    expect(result).not.toBeNull();
    expect(result[0].description).toMatch(/5-ply/i);
  });

  it("falls back to dimensions when description is empty (BOB labels often used dimensions)", () => {
    const tp = {
      ...techPackAiShape,
      extracted_label_specs: [
        { label_type: "Custom Label", dimensions: "5x5cm woven", section: "Hem" },
      ],
    };
    const result = resolveDescription({
      articleCode: ARTICLE_CODE,
      tabCategory: "Label",
      cfg: CFG_QUALITY,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    // dimensions is exposed via size, section is exposed via quality
    expect(result).not.toBeNull();
    expect(result[0].size).toMatch(/5x5cm/);
  });
});
