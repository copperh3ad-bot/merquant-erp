import { describe, it, expect } from "vitest";
import {
  classifyComponent,
  classifyBatch,
  CANONICAL_TYPES,
} from "../../src/lib/componentClassifier.js";

// ── Real-world fixtures from the live consumption_library data ────────────

const FIXTURES = [
  // The two-polybag case that triggered this work
  {
    name: "main packaging polybag",
    item: {
      raw_category: "Polybag",
      material: "Bag material — 12S (Thickness)- Transparent PVC Bag with 7S(Thickness) White PVC White Binding all around seam and 3# Nylon Coil White Zipper(No Hanger Loop on top)",
      size_spec: "",
    },
    expected: "Polybag",
  },
  {
    name: "small accessory bag for hang tag",
    item: {
      raw_category: "Polybag",
      material: "Bag material — Size – 3.5cm H X 11.5cm W, 0.35cm (Thickness) - PVC Transparent Polybag with PP Transparent Plastic Hanger on Top, Bag opening at the bottom with automatic adhesive tape.",
      size_spec: "3.5cm H X 11.5cm W",
    },
    expected: "Accessory Bag",
  },

  // Stiffener
  {
    name: "U-shape cardboard stiffener",
    item: {
      raw_category: "Stiffener",
      material: 'Cardboard material(Stiffener) — Packaging inside need to put a "U"  1 ply thickness in White Cardboard to maintain the shape',
    },
    expected: "Stiffener",
  },
  {
    name: "white square card stiffener",
    item: {
      raw_category: "Stiffener",
      material: "Cardboard material(Stiffener) — White square card",
    },
    expected: "Stiffener",
  },

  // Labels
  {
    name: "law tag care label",
    item: {
      raw_category: "Label",
      material: "Non woven label with coating — 3M non woven material with white ground / black color font",
      size_spec: "4.0cmX3.0cm",
      placement: "Position of law tag label for MP & PP – 3 apart from opening (Inside)",
    },
    expected: "Label",
  },

  // Insert Card
  {
    name: "u-shape insert paper card",
    item: {
      raw_category: "Insert Card",
      material: 'Color paper insert material — Printed Insert quality - INSERT ("U" Shape) - Insert Material: 250g-300g White Card Paper with Coating both side',
    },
    expected: "Insert Card",
  },

  // Stickers
  {
    name: "barcode sticker on PVC bag",
    item: {
      raw_category: "Sticker",
      material: "All barcode (SKU) sticker must be stick on the PVC Bag",
    },
    expected: "Sticker",
  },

  // Hang Tag
  {
    name: "swing tag with brand logo",
    item: {
      raw_category: "Trim",
      material: "Swing tag with brand logo, printed on 300gsm card",
    },
    expected: "Hang Tag",
  },

  // Carton
  {
    name: "brown 5-ply carton",
    item: {
      raw_category: "Carton",
      material: "Brown 5-ply B-flute corrugated outer carton",
    },
    expected: "Carton",
  },

  // Zipper
  {
    name: "nylon coil zipper",
    item: {
      raw_category: "Zipper",
      material: "#3 Auto lock coil nylon zipper in white color",
    },
    expected: "Zipper",
  },

  // Trim
  {
    name: "elastic binding",
    item: {
      raw_category: "Trim",
      material: "0.6cm white elastic binding",
    },
    expected: "Trim",
  },

  // Should NOT classify a labeled "Polybag" as Hang Tag just because the
  // word "tag" appears nowhere — it should match Polybag rule.
  {
    name: "plain main polybag without hanger words",
    item: {
      raw_category: "Polybag",
      material: "Transparent PE Bag, 60 micron, sealed top",
      size_spec: "60x40cm",
    },
    expected: "Polybag",
  },
];

describe("classifyComponent", () => {
  for (const fx of FIXTURES) {
    it(`classifies "${fx.name}" → ${fx.expected}`, () => {
      const result = classifyComponent(fx.item);
      expect(result.component_type).toBe(fx.expected);
      expect(result.confidence).toBeGreaterThan(0);
    });
  }

  it("returns null type with reason 'no_input' for empty input", () => {
    expect(classifyComponent({}).component_type).toBeNull();
    expect(classifyComponent({}).reason).toBe("no_input");
  });

  it("falls back to raw_category when no rule matches but category is canonical", () => {
    const result = classifyComponent({ raw_category: "Other", material: "uncategorized item" });
    expect(result.component_type).toBe("Other");
    expect(result.reason).toBe("raw_category_match");
  });

  it("returns confidence 0 when neither keyword nor raw_category matches anything", () => {
    const result = classifyComponent({ raw_category: "Unknown Category", material: "mystery item" });
    expect(result.component_type).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reason).toBe("no_rule_matched");
  });

  it("disambiguates 'Polybag' raw category — small bag with hanger → Accessory Bag", () => {
    const result = classifyComponent({
      raw_category: "Polybag",
      material: "Small PVC bag with PP plastic hanger and adhesive tape opening",
      size_spec: "3.5x11.5cm",
    });
    expect(result.component_type).toBe("Accessory Bag");
  });

  it("disambiguates 'Polybag' raw category — large bag without hanger → Polybag", () => {
    const result = classifyComponent({
      raw_category: "Polybag",
      material: "PE 60 micron transparent polybag with sealed top",
      size_spec: "60x40cm",
    });
    expect(result.component_type).toBe("Polybag");
  });
});

describe("classifyBatch", () => {
  it("returns one classification per input item, aligned by index", () => {
    const items = FIXTURES.map((fx) => fx.item);
    const results = classifyBatch(items);
    expect(results).toHaveLength(items.length);
    results.forEach((r, i) => {
      expect(r.index).toBe(i);
      expect(r.component_type).toBe(FIXTURES[i].expected);
    });
  });

  it("handles empty / non-array input gracefully", () => {
    expect(classifyBatch([])).toEqual([]);
    expect(classifyBatch(null)).toEqual([]);
    expect(classifyBatch(undefined)).toEqual([]);
  });
});

describe("CANONICAL_TYPES", () => {
  it("includes the new Accessory Bag and Hang Tag categories", () => {
    expect(CANONICAL_TYPES).toContain("Accessory Bag");
    expect(CANONICAL_TYPES).toContain("Hang Tag");
  });
});
