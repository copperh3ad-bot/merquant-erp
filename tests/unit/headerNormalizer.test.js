import { describe, it, expect } from "vitest";
import { normalizeHeaderKey, normalizeRowKeys } from "../../src/lib/headerNormalizer.js";

describe("normalizeHeaderKey", () => {
  it("lowercases and converts spaces to underscores", () => {
    expect(normalizeHeaderKey("Article Code")).toBe("article_code");
    expect(normalizeHeaderKey("Item Code")).toBe("item_code");
    expect(normalizeHeaderKey("Tech Pack Code")).toBe("tech_pack_code");
  });

  it("strips parentheses and units", () => {
    expect(normalizeHeaderKey("Width (cm)")).toBe("width_cm");
    expect(normalizeHeaderKey("Carton L (cm)")).toBe("carton_l_cm");
    expect(normalizeHeaderKey("Price (USD)")).toBe("price_usd");
  });

  it("converts slashes and special chars", () => {
    expect(normalizeHeaderKey("Pieces/Carton")).toBe("pieces_carton");
    expect(normalizeHeaderKey("CBM/Carton")).toBe("cbm_carton");
    expect(normalizeHeaderKey("Wastage %")).toBe("wastage");
  });

  it("collapses repeated separators and trims edges", () => {
    expect(normalizeHeaderKey("  Item  Code  ")).toBe("item_code");
    expect(normalizeHeaderKey("___leading___trailing___")).toBe("leading_trailing");
    expect(normalizeHeaderKey("Carton  /  Length")).toBe("carton_length");
  });

  it("preserves already-canonical snake_case keys unchanged", () => {
    expect(normalizeHeaderKey("item_code")).toBe("item_code");
    expect(normalizeHeaderKey("carton_size_cm")).toBe("carton_size_cm");
    expect(normalizeHeaderKey("wastage_percent")).toBe("wastage_percent");
  });

  it("handles all-caps", () => {
    expect(normalizeHeaderKey("GSM")).toBe("gsm");
    expect(normalizeHeaderKey("USD")).toBe("usd");
  });

  it("handles null / empty / non-string input gracefully", () => {
    expect(normalizeHeaderKey(null)).toBe("");
    expect(normalizeHeaderKey(undefined)).toBe("");
    expect(normalizeHeaderKey("")).toBe("");
    expect(normalizeHeaderKey(42)).toBe("42");
  });
});

describe("normalizeRowKeys — Articles sheet", () => {
  const SHEET = "1. Articles (SKUs)";

  it("maps v4-template Title Case headers to importer's expected keys", () => {
    const row = {
      "Article Code":   "SLPCSS-Q-GY",
      "Article Name":   "Sleep Cool Sheet Set - Queen - Gray",
      "Customer":       "MFRM",
      "Program Code":   "SLPCSS",
      "Article Type":   "Sheet Set",
      "Pieces/Carton":  4,
      "Carton L (cm)":  40,
      "Carton W (cm)":  40,
      "Carton H (cm)":  32,
    };
    const out = normalizeRowKeys(row, SHEET);
    expect(out.item_code).toBe("SLPCSS-Q-GY");          // Article Code → article_code → item_code (global alias)
    expect(out.brand).toBe("MFRM");                      // Customer → brand (per-sheet)
    expect(out.tech_pack_code).toBe("SLPCSS");           // Program Code → tech_pack_code (per-sheet)
    expect(out.product_category).toBe("Sheet Set");      // Article Type → product_category (per-sheet)
    expect(out.units_per_carton).toBe(4);                // Pieces/Carton → units_per_carton (per-sheet)
    expect(out.carton_length_cm).toBe(40);               // Carton L (cm) → carton_l_cm → carton_length_cm
    expect(out.carton_width_cm).toBe(40);
    expect(out.carton_height_cm).toBe(32);
  });

  it("preserves already-canonical headers unchanged", () => {
    const row = {
      item_code:        "SLPCSS-Q-GY",
      tech_pack_code:   "SLPCSS",
      carton_size_cm:   "40*40*32",
    };
    const out = normalizeRowKeys(row, SHEET);
    expect(out).toEqual(row);
  });
});

describe("normalizeRowKeys — Fabric sheet", () => {
  const SHEET = "2. SKU Fabric Consumption";

  it("maps v4 fabric headers", () => {
    const row = {
      "Tech Pack Code":   "SLPCSS",
      "Item Code":        "SLPCSS-Q-GY",
      "Size":             "Queen",
      "Fabric Type":      "Modal Jersey Knit",
      "Construction":     "Jersey Knit",
      "GSM":              170,
      "Width (cm)":       112,
      "Color":            "Dove Gray",
      "Treatment":        "Finishing X",
      "Consumption/Unit": 2.4,
      "Wastage %":        0.20,
    };
    const out = normalizeRowKeys(row, SHEET);
    expect(out.item_code).toBe("SLPCSS-Q-GY");
    expect(out.tech_pack_code).toBe("SLPCSS");
    expect(out.fabric_type).toBe("Modal Jersey Knit");
    expect(out.gsm).toBe(170);
    expect(out.width_cm).toBe(112);
    expect(out.finish).toBe("Finishing X");              // Treatment → finish (per-sheet)
    expect(out.consumption_per_unit).toBe(2.4);          // Consumption/Unit → cons → consumption_per_unit (global)
    expect(out.wastage_percent).toBe(0.20);              // Wastage % → wastage → wastage_percent (global)
  });
});

describe("normalizeRowKeys — Accessory sheet", () => {
  const SHEET = "3. SKU Accessory Consumption";

  it("maps Component Type → category (importer's expected key)", () => {
    const row = {
      "Item Code":        "GPSE50",
      "Size":             "Queen",
      "Component Type":   "Polybag",
      "Material":         "12S Transparent PVC Bag",
      "Size Spec":        "28x28x9.5cm",
      "Placement":        "Outer",
      "Consumption/Unit": 1,
      "Unit":             "pcs",
      "Wastage %":        0.05,
    };
    const out = normalizeRowKeys(row, SHEET);
    expect(out.item_code).toBe("GPSE50");
    expect(out.category).toBe("Polybag");                // Component Type → category (per-sheet)
    expect(out.material).toBe("12S Transparent PVC Bag");
    expect(out.size_spec).toBe("28x28x9.5cm");
    expect(out.consumption_per_unit).toBe(1);
    expect(out.wastage_percent).toBe(0.05);
  });

  it("still works when the user already typed `category` (the importer's name)", () => {
    const row = { "Item Code": "X1", "category": "Polybag", "Material": "PVC bag" };
    const out = normalizeRowKeys(row, SHEET);
    expect(out.category).toBe("Polybag");
  });
});

describe("normalizeRowKeys — Carton Master sheet", () => {
  const SHEET = "4. Carton Master";

  it("maps Carton L/W/H + Pieces/Carton + CBM/Carton", () => {
    const row = {
      "Item Code":               "SLPCSS-Q",
      "Pieces/Carton":           4,
      "Carton L (cm)":           40,
      "Carton W (cm)":           40,
      "Carton H (cm)":           32,
      "CBM/Carton (stored)":     0.0512,
    };
    const out = normalizeRowKeys(row, SHEET);
    expect(out.item_code).toBe("SLPCSS-Q");
    expect(out.units_per_carton).toBe(4);
    expect(out.carton_length_cm).toBe(40);
    expect(out.carton_width_cm).toBe(40);
    expect(out.carton_height_cm).toBe(32);
    // "CBM/Carton (stored)" normalizes to "cbm_carton_stored" — no alias for
    // the suffixed form, so it's left as-is. Importer's transform reads
    // r.cbm_per_carton; user can rename. Plain "CBM/Carton" works.
    expect(out.cbm_carton_stored).toBe(0.0512);
  });

  it("plain `CBM/Carton` (no suffix) maps to cbm_per_carton", () => {
    const row = { "Item Code": "X", "CBM/Carton": 0.05 };
    const out = normalizeRowKeys(row, SHEET);
    expect(out.cbm_per_carton).toBe(0.05);
  });
});

describe("normalizeRowKeys — Price List sheet", () => {
  const SHEET = "5. Price List";

  it("maps v4 price headers", () => {
    const row = {
      "Item Code":      "SLPCSS-Q-GY",
      "Description":    "Queen - Gray",
      "Price (USD)":    21.03,
      "Currency":       "USD",
      "Pieces/Carton":  4,
      "Active":         "Yes",
      "Effective From": "2025-08-12",
    };
    const out = normalizeRowKeys(row, SHEET);
    expect(out.item_code).toBe("SLPCSS-Q-GY");
    expect(out.item_description).toBe("Queen - Gray");
    expect(out.price_usd).toBe(21.03);
    expect(out.currency).toBe("USD");
    expect(out.pieces_per_carton).toBe(4);               // Pieces/Carton → pieces_per_carton on Price List (matches transform)
    expect(out.is_active).toBe("Yes");
    expect(out.effective_from).toBe("2025-08-12");
  });
});

describe("normalizeRowKeys — first-seen-wins on collisions", () => {
  it("first non-empty value wins when two columns alias to the same canonical", () => {
    const row = {
      "Article Code":  "SLPCSS-Q-GY",  // → item_code
      "Item Code":     "SHOULD-NOT-WIN",
    };
    const out = normalizeRowKeys(row, "1. Articles (SKUs)");
    expect(out.item_code).toBe("SLPCSS-Q-GY");
  });

  it("an empty-string column does NOT block a later non-empty column", () => {
    const row = {
      "Article Code":  "",
      "Item Code":     "WINS",
    };
    const out = normalizeRowKeys(row, "1. Articles (SKUs)");
    expect(out.item_code).toBe("WINS");
  });
});
