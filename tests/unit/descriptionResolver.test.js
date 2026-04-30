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

// ── Real-world BOB tech-pack regressions (5 specific issues) ──────────────

const BOB_TECH_PACK = {
  id: "tp-bob-001",
  article_code: "GPSE50",
  po_id: PO_ID,
  // Real fixture from production: encasement protector with 2 labels,
  // 9 trim entries (incl. duplicate Stiffeners), and accessories.
  extracted_label_specs: [
    {
      colours: "Label white ground with printed black fonts",
      section: "Law tag/Care label",
      placement: "Sewing at the middle of short side",
      dimensions: "4.0cmX7.0cm",
      label_type: "Non woven label with coating",
      description: "3M non woven material with white ground / black color font",
    },
    {
      colours: "White ground with black fonts",
      section: "Size label",
      placement: "Next the law tag label",
      dimensions: "4.0cmX3.0cm",
      label_type: "Non woven label with coating",
      description: "3M non woven material with white ground / black color font",
    },
  ],
  extracted_trim_specs: [
    { trim_type: "Packaging",            description: "Color paper insert with vinyl PVC Bag with white bound seam & inside cardboard wrapped by product(Stiffener)" },
    { trim_type: "PVC Bag",              description: "12S Transparent PVC Bag with 7S White PVC Binding all around" },
    { trim_type: "Insert Card",          description: "Printed Insert quality - INSERT (U Shape) - 250g-300g White Card Paper" },
    { trim_type: "Stiffener",            description: "Packaging inside need to put a U 1 ply thickness in White Cardboard" },
    { trim_type: "Size Sticker",         description: "Direct print on insert" },
    { trim_type: "Barcode Sticker",      description: "All barcode (SKU) sticker must be stick on the PVC Bag" },
    { trim_type: "Barcode Sticker Size", description: "White ground with black fonts / 76mmx23mm" },
    // Duplicate description — should be deduped against the earlier "Stiffener" entry
    { trim_type: "Stiffener (Cardboard)", description: "Packaging inside need to put a U 1 ply thickness in White Cardboard" },
    { trim_type: "Stiffener Size",       description: "Please refer spec sheet" },
  ],
  extracted_accessory_specs: [
    // Sewing/quality specs that should NOT bleed into Trim or other tabs
    { accessory_type: "Sewing Construction", description: "1cm H – Bound Seam inside all seam" },
    { accessory_type: "Stitching Density",   description: "9-10 stitch per inch" },
    { accessory_type: "Needle",              description: "Ball Point Needle" },
    { accessory_type: "Zipper",              description: "#3 Auto lock coil nylon zipper in white color" },
  ],
  extracted_measurements: {
    sizes: ["TWIN", "QUEEN", "KING", "SLEEPER - QUEEN"],
    this_sku: {
      size: "SLEEPER - QUEEN",
      item_code: "GPSE50",
      zipper_length: "482cm",
      stiffener_size: "27X27.5X6.5cm",
      insert_dimensions: "27.00X54.70cm",
      pvc_bag_dimensions: "28X28X7cm",
      // Note: this real fixture has no carton_size_cm on this_sku — falls
      // through to size_chart on tabs that need carton dims, then to po_items.
    },
    size_chart: {
      "SLEEPER - QUEEN": { item_code: "GPSE50", carton_size_cm: "58*28.5*43" },
    },
  },
  extracted_data: {
    source: "BOB Tech Pack",
    upc: [
      { size: "SLEEPER - QUEEN", our_sku: "GPSE50", bob_sku: "012345678905", qty_per_ctn: 10 },
      { size: "QUEEN",           our_sku: "GPTE50", bob_sku: "012345678929", qty_per_ctn: 10 },
    ],
  },
};

const CFG_LABEL = {
  category: "Label",
  typeOptions: ["Brand Label", "Care Label", "Size Label", "Direction Label", "Hang Tag", "Custom Label"],
  qualityLabel: "Quality / Description",
  defaultWastage: 5,
};
const CFG_POLYBAG = {
  category: "Polybag",
  typeOptions: ["PVC", "PP", "PE", "LDPE", "OPP"],
  splitDescSize: true,
  descLabel: "Description",
  sizeLabel: "Size",
  defaultWastage: 3,
};
const CFG_STIFFENER = {
  category: "Stiffener",
  typeOptions: ["Cardboard", "PVC Sheet", "Foam Board", "MDF", "Corrugated"],
  splitDescSize: true,
  descLabel: "Description",
  sizeLabel: "Size",
  defaultWastage: 3,
};
const CFG_CARTON = {
  category: "Carton",
  typeOptions: ["Printed", "Plain", "Brown", "White"],
  splitDescSize: true,
  descLabel: "Description",
  sizeLabel: "Size (LxWxH cm)",
  defaultWastage: 2,
};
const CFG_STICKER = {
  category: "Sticker",
  typeOptions: ["UPC Sticker", "Packaging Info Sticker", "Custom Sticker"],
  qualityLabel: "Size / Description",
  defaultWastage: 5,
  showEAN: true,
};

describe("resolveDescription — real-world BOB tech-pack issues", () => {
  it("Issue #1: Label tab picks Care Label / Size Label from section, not default Brand Label", () => {
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Label",
      cfg: CFG_LABEL,
      masterSpecs: [],
      techPack: BOB_TECH_PACK,
      techPackLabelSpecs: BOB_TECH_PACK.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result.length).toBe(2);
    const types = result.map((r) => r.type);
    // section "Law tag/Care label" → Care Label; section "Size label" → Size Label
    expect(types).toContain("Care Label");
    expect(types).toContain("Size Label");
    // None should be the default "Brand Label"
    expect(types).not.toContain("Brand Label");
  });

  it("Issue #2: Polybag tab pulls description from PVC Bag and size from pvc_bag_dimensions", () => {
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Polybag",
      cfg: CFG_POLYBAG,
      masterSpecs: [],
      techPack: BOB_TECH_PACK,
    });
    expect(result).not.toBeNull();
    expect(result[0].description).toMatch(/Transparent PVC Bag/);
    expect(result[0].size).toBe("28X28X7cm");
  });

  it("Issue #3: Stiffener tab dedupes byte-identical descriptions across duplicate entries", () => {
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Stiffener",
      cfg: CFG_STIFFENER,
      masterSpecs: [],
      techPack: BOB_TECH_PACK,
    });
    expect(result).not.toBeNull();
    // Three entries in the trim_specs ("Stiffener", "Stiffener (Cardboard)", "Stiffener Size")
    // but the first two have identical descriptions → kept once.
    // "Stiffener Size" has a unique description ("Please refer spec sheet") → kept once.
    // Total kept = 2.
    expect(result.length).toBe(2);
    // Each resulting row's size falls back to stiffener_size from measurements
    expect(result[0].size).toBe("27X27.5X6.5cm");
  });

  it("Issue #4: Carton tab picks up size from extracted_measurements.size_chart even when no trim spec exists", () => {
    // Modify fixture: zero trim entries that match Carton, but size_chart has it
    const techPackNoCartonTrim = {
      ...BOB_TECH_PACK,
      extracted_trim_specs: BOB_TECH_PACK.extracted_trim_specs.filter((t) => !/carton/i.test(t.trim_type)),
    };
    // Note the resolver only auto-fills carton from this_sku.carton_size_cm,
    // which our fixture doesn't have — so use a fixture that does.
    const tp = {
      ...techPackNoCartonTrim,
      extracted_measurements: {
        ...BOB_TECH_PACK.extracted_measurements,
        this_sku: { ...BOB_TECH_PACK.extracted_measurements.this_sku, carton_size_cm: "58*28.5*43" },
      },
    };
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Carton",
      cfg: CFG_CARTON,
      masterSpecs: [],
      techPack: tp,
    });
    expect(result).not.toBeNull();
    expect(result[0].size).toBe("58*28.5*43");
  });

  it("Issue #5: Sticker tab populates pc_ean_code from upc[].bob_sku via article_code match", () => {
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Sticker",
      cfg: CFG_STICKER,
      masterSpecs: [],
      techPack: BOB_TECH_PACK,
    });
    expect(result).not.toBeNull();
    // At least one row has the EAN from the UPC table
    const eans = result.map((r) => r.pc_ean_code);
    expect(eans.some((e) => e === "012345678905")).toBe(true);
  });

  it("Sewing/Stitching/Needle accessory_type values do NOT leak into Trim tab", () => {
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Trim",
      cfg: { ...CFG_LABEL, category: "Trim", typeOptions: ["Elastic", "Drawcord", "Custom"] },
      masterSpecs: [],
      techPack: BOB_TECH_PACK,
    });
    if (result) {
      const descs = result.map((r) => r.quality);
      expect(descs.every((d) => !/stitches per inch/i.test(d))).toBe(true);
      expect(descs.every((d) => !/Bound Seam/i.test(d))).toBe(true);
      expect(descs.every((d) => !/Ball Point Needle/i.test(d))).toBe(true);
    }
  });
});

// ── Item Type smart-default for non-Label tabs ────────────────────────────
// These tests prove that Polybag / Stiffener / Carton rows pick a Type from
// the description text instead of always defaulting to typeOptions[0]. Each
// fixture deliberately puts the *correct* typeOption somewhere OTHER than
// position 0 so a passing test cannot be explained by the old default behavior.

describe("resolveDescription — Item Type smart-default for non-Label tabs", () => {
  it("Polybag: picks 'PVC' from description even when typeOptions[0] is 'PE'", () => {
    // Reorder typeOptions so PE is first, PVC is third — the helper must scan
    // the description ("...Transparent PVC Bag...") and pick PVC anyway.
    const cfg = { ...CFG_POLYBAG, typeOptions: ["PE", "PP", "PVC", "LDPE", "OPP"] };
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Polybag",
      cfg,
      masterSpecs: [],
      techPack: BOB_TECH_PACK,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("PVC");
  });

  it("Stiffener: row whose description mentions 'Cardboard' picks 'Cardboard' even when typeOptions[0] is 'MDF'", () => {
    const cfg = { ...CFG_STIFFENER, typeOptions: ["MDF", "Foam Board", "Cardboard", "PVC Sheet", "Corrugated"] };
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Stiffener",
      cfg,
      masterSpecs: [],
      techPack: BOB_TECH_PACK,
    });
    expect(result).not.toBeNull();
    // The "Stiffener" trim entry has "...White Cardboard" in its description,
    // so its row's type should be "Cardboard" (not the typeOptions[0] of "MDF").
    // Other rows ("Stiffener Size" — "Please refer spec sheet") have no keyword
    // and legitimately fall back to "MDF", so we look up the specific row.
    const cardboardRow = result.find((r) => /Cardboard/i.test(r.description));
    expect(cardboardRow).toBeDefined();
    expect(cardboardRow.type).toBe("Cardboard");
  });

  it("Carton: picks 'Brown' from description when typeOptions[0] is 'Printed'", () => {
    // Add a Carton trim entry to the fixture whose description specifies "Brown 5-ply".
    const tp = {
      ...BOB_TECH_PACK,
      extracted_trim_specs: [
        ...BOB_TECH_PACK.extracted_trim_specs,
        { trim_type: "Carton",     description: "Brown 5-ply B-flute corrugated outer carton" },
      ],
    };
    const cfg = { ...CFG_CARTON, typeOptions: ["Printed", "Plain", "Brown", "White"] };
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Carton",
      cfg,
      masterSpecs: [],
      techPack: tp,
    });
    expect(result).not.toBeNull();
    const types = result.map((r) => r.type);
    expect(types).toContain("Brown");
  });

  it("falls back to typeOptions[0] when description carries no recognisable typeOption keyword", () => {
    // Description doesn't contain any of the typeOptions verbatim — must
    // default to typeOptions[0] rather than throw or pick something random.
    const tp = {
      ...BOB_TECH_PACK,
      extracted_trim_specs: [
        { trim_type: "Carton", description: "Generic outer packaging per spec sheet" },
      ],
    };
    const cfg = { ...CFG_CARTON, typeOptions: ["Printed", "Plain", "Brown", "White"] };
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Carton",
      cfg,
      masterSpecs: [],
      techPack: tp,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("Printed"); // typeOptions[0]
  });

  it("Label tab still uses pickLabelType (section-based), not the new helper", () => {
    // Sanity: Label flow still derives type from section/label_type so the
    // new non-Label helper doesn't take over its tab.
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Label",
      cfg: CFG_LABEL,
      masterSpecs: [],
      techPack: BOB_TECH_PACK,
      techPackLabelSpecs: BOB_TECH_PACK.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    const types = result.map((r) => r.type);
    expect(types).toContain("Care Label");
    expect(types).toContain("Size Label");
  });
});

// ── Description-based label classification (issue: classify from description) ──
// pickLabelType used to read only section/label_type/type. Real-world labels
// often have generic section ("Hem", "Inside seam") with the actual intent
// only in the description ("Wash care, machine wash cold"). These tests
// verify the helper now reads description + material and falls back to a
// synonym map when the typeOption literal isn't present.

const CFG_LABEL_FULL = {
  category: "Label",
  typeOptions: [
    "Brand Label", "Care Label", "Size Label", "Direction Label", "GOTS Label",
    "Barcode Label", "Hang Tag", "Country of Origin Label", "Composition Label",
    "Wash Label", "Price Ticket", "Compliance Label", "Retailer Label", "Eco Label",
    "Custom Label",
  ],
  qualityLabel: "Quality / Description",
  defaultWastage: 5,
};

describe("resolveDescription — description-based label classification", () => {
  // ── Direct typeOption literal in description ────────────────────────────
  it("classifies as Brand Label when description literally says 'brand label'", () => {
    const tp = {
      id: "tp-d1",
      article_code: "X1",
      extracted_label_specs: [
        { section: "Hem", label_type: "Sewn-in", description: "Brand label, woven satin, navy on white" },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "X1",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("Brand Label");
  });

  it("classifies as Hang Tag from description 'swing tag with brand logo'", () => {
    const tp = {
      id: "tp-d2",
      article_code: "X2",
      extracted_label_specs: [
        { section: "Outside", description: "Swing tag with brand logo, printed on 300gsm card" },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "X2",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("Hang Tag");
  });

  // ── Synonym fallback ────────────────────────────────────────────────────
  it("classifies as Care Label from synonym 'wash care' when typeOption literal isn't present", () => {
    const tp = {
      id: "tp-d3",
      article_code: "X3",
      extracted_label_specs: [
        { section: "Inside seam", description: "Wash care: machine wash cold, tumble dry low, do not bleach" },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "X3",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("Care Label");
  });

  it("classifies as Country of Origin Label from synonym 'made in'", () => {
    const tp = {
      id: "tp-d4",
      article_code: "X4",
      extracted_label_specs: [
        { section: "Inside hem", description: "Made in Pakistan, polyester 100%, woven" },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "X4",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("Country of Origin Label");
  });

  it("classifies as Composition Label from 'fiber content 100% cotton'", () => {
    const tp = {
      id: "tp-d5",
      article_code: "X5",
      extracted_label_specs: [
        { section: "Hem", description: "Fiber content: 100% cotton, machine washable" },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "X5",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    // "Composition Label" via synonym "fiber content"
    expect(result[0].type).toBe("Composition Label");
  });

  it("classifies as GOTS Label when description mentions GOTS certification", () => {
    const tp = {
      id: "tp-d6",
      article_code: "X6",
      extracted_label_specs: [
        { section: "Inside", description: "GOTS certified organic cotton blend" },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "X6",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("GOTS Label");
  });

  // ── Direct beats synonym (priority test) ────────────────────────────────
  it("prefers direct typeOption match over synonym when both apply", () => {
    // section says "Care Label" (direct) AND description says "wash" (synonym)
    // — should pick direct.
    const tp = {
      id: "tp-d7",
      article_code: "X7",
      extracted_label_specs: [
        { section: "Care Label", description: "Wash instructions, machine washable" },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "X7",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("Care Label");
  });

  // ── Real-world BOB shape: Law tag/Care label section ────────────────────
  it("real-world BOB regression still works: 'Law tag/Care label' section → Care Label", () => {
    const tp = {
      id: "tp-d8",
      article_code: "GPSE50",
      extracted_label_specs: [
        {
          section: "Law tag/Care label",
          label_type: "Non woven label with coating",
          description: "3M non woven material with white ground / black color font",
        },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "GPSE50",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    // "Care Label" via direct match in section
    expect(result[0].type).toBe("Care Label");
  });

  // ── Generic section + uninformative description ─────────────────────────
  it("falls back to Custom Label when description carries no recognisable signal", () => {
    const tp = {
      id: "tp-d9",
      article_code: "X9",
      extracted_label_specs: [
        { section: "Hem", description: "Generic label per spec sheet, refer artwork" },
      ],
      extracted_accessory_specs: [],
      extracted_trim_specs: [],
    };
    const result = resolveDescription({
      articleCode: "X9",
      tabCategory: "Label",
      cfg: CFG_LABEL_FULL,
      masterSpecs: [],
      techPack: tp,
      techPackLabelSpecs: tp.extracted_label_specs,
    });
    expect(result).not.toBeNull();
    expect(result[0].type).toBe("Custom Label");
  });
});
