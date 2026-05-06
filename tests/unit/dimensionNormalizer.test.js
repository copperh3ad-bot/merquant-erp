import { describe, it, expect } from "vitest";
import {
  parseDimension,
  formatDimension,
  normalizeDim2D,
  normalizeDim3D,
  dimensionsEqual,
  isMultiSizeBlob,
} from "../../src/lib/dimensionNormalizer.js";

describe("parseDimension", () => {
  it("extracts numbers from common 2-D forms", () => {
    expect(parseDimension("27x52.6CM").numbers).toEqual([27, 52.6]);
    expect(parseDimension("52.60x27.00CM").numbers).toEqual([52.6, 27]);
    expect(parseDimension("27 X 52.6 cm").numbers).toEqual([27, 52.6]);
    expect(parseDimension("27*52.6").numbers).toEqual([27, 52.6]);
    expect(parseDimension("27×52.6cm").numbers).toEqual([27, 52.6]);
  });

  it("extracts numbers from 3-D carton forms", () => {
    expect(parseDimension("60*30*45").numbers).toEqual([60, 30, 45]);
    expect(parseDimension("58.0X28.5X43.0CM").numbers).toEqual([58, 28.5, 43]);
  });

  it("detects the unit when present", () => {
    expect(parseDimension("27x52.6CM").unit).toBe("cm");
    expect(parseDimension("27x52.6 mm").unit).toBe("mm");
    expect(parseDimension('59x73x5"').unit).toBe("in");
  });

  it("returns null when no numbers can be found", () => {
    expect(parseDimension("")).toBeNull();
    expect(parseDimension(null)).toBeNull();
    expect(parseDimension("Refer spec sheet")).toBeNull();
  });
});

describe("normalizeDim2D — 2-D canonical form (smaller × larger × CM)", () => {
  it("converges W×L and L×W to the same string", () => {
    expect(normalizeDim2D("27x52.6CM")).toBe("27.00X52.60CM");
    expect(normalizeDim2D("52.60x27.00CM")).toBe("27.00X52.60CM");
  });

  it("normalizes separators", () => {
    expect(normalizeDim2D("27*52.6")).toBe("27.00X52.60CM");
    expect(normalizeDim2D("27×52.6 cm")).toBe("27.00X52.60CM");
    expect(normalizeDim2D("27 x 52.6")).toBe("27.00X52.60CM");
  });

  it("preserves a non-default unit when explicit", () => {
    expect(normalizeDim2D("27x52.6mm")).toBe("27.00X52.60MM");
    expect(normalizeDim2D('59x73"')).toBe('59.00X73.00IN');
  });

  it("rounds/expands to 2 decimal places", () => {
    expect(normalizeDim2D("27x52")).toBe("27.00X52.00CM");
    expect(normalizeDim2D("27x52.5555")).toBe("27.00X52.56CM");
  });

  it("falls back to original when not a parseable dimension", () => {
    expect(normalizeDim2D("Refer spec sheet")).toBe("Refer spec sheet");
    expect(normalizeDim2D("")).toBe("");
    expect(normalizeDim2D(null)).toBeNull();
  });
});

describe("normalizeDim3D — preserves order (cartons)", () => {
  it("does NOT sort carton dimensions", () => {
    expect(normalizeDim3D("60*30*45")).toBe("60.00X30.00X45.00CM");
    expect(normalizeDim3D("58.0X28.5X43.0CM")).toBe("58.00X28.50X43.00CM");
  });

  it("treats 1-number values gracefully (e.g. zipper length)", () => {
    expect(normalizeDim3D("482cm")).toBe("482.00CM");
  });
});

describe("dimensionsEqual — semantic equality (used in audits)", () => {
  it("treats 27x52.6 and 52.60x27.00 as equal", () => {
    expect(dimensionsEqual("27x52.6CM", "52.60x27.00CM")).toBe(true);
  });

  it("ignores case + separator differences", () => {
    expect(dimensionsEqual("27 X 52.6 cm", "52.60*27.00CM")).toBe(true);
  });

  it("treats 3-D carton dims as equal regardless of order", () => {
    expect(dimensionsEqual("60*30*45", "45*30*60")).toBe(true);
  });

  it("returns false for genuinely different sets", () => {
    expect(dimensionsEqual("27x52.6", "27x55.6")).toBe(false);
    expect(dimensionsEqual("60*30*45", "60*30*44")).toBe(false);
  });

  it("falls back to string compare when neither parses", () => {
    expect(dimensionsEqual("ref spec", "ref spec")).toBe(true);
    expect(dimensionsEqual("ref spec", "see chart")).toBe(false);
  });

  it("handles null / empty gracefully", () => {
    expect(dimensionsEqual(null, null)).toBe(true);
    expect(dimensionsEqual("", "")).toBe(true);
    expect(dimensionsEqual("27x52.6", null)).toBe(false);
  });
});

// Per docs/architecture.md §6 — isMultiSizeBlob detects strings that
// fold per-size dimension data into one cell. Such values must NOT be
// written into per-article scalar dimension columns.

describe("isMultiSizeBlob — detection", () => {
  it("flags an explicit 'Varies by size:' prefix", () => {
    expect(isMultiSizeBlob("Varies by size: 33X33X32 (Twin XL); 40X40X32 (Full)")).toBe(true);
    expect(isMultiSizeBlob("varies by size: 27x52cm")).toBe(true);
    expect(isMultiSizeBlob("VARIES BY SIZE 33x33")).toBe(true);
  });

  it("flags multiple parenthesised size labels with a separator", () => {
    expect(isMultiSizeBlob("33X33X32 (Twin XL); 40X40X32 (Full)")).toBe(true);
    expect(isMultiSizeBlob("33X33X32 (Twin), 40X40X32 (Full)")).toBe(true);
  });

  it("flags multiple semicolon-separated dim groups", () => {
    expect(isMultiSizeBlob("33X33X32; 40X40X32")).toBe(true);
    expect(isMultiSizeBlob("33x33; 40x40; 50x50")).toBe(true);
  });

  it("does NOT flag plain single dimensions", () => {
    expect(isMultiSizeBlob("27x52.6CM")).toBe(false);
    expect(isMultiSizeBlob("60x40x30")).toBe(false);
    expect(isMultiSizeBlob("27.00X52.60CM")).toBe(false);
    expect(isMultiSizeBlob("33X33X32")).toBe(false);
  });

  it("does NOT flag a single dim with one parenthesised note", () => {
    // Single label shouldn't be confused with multi-size
    expect(isMultiSizeBlob("27x52cm (Twin XL)")).toBe(false);
  });

  it("handles empty / null / whitespace safely", () => {
    expect(isMultiSizeBlob("")).toBe(false);
    expect(isMultiSizeBlob(null)).toBe(false);
    expect(isMultiSizeBlob(undefined)).toBe(false);
    expect(isMultiSizeBlob("   ")).toBe(false);
  });
});

describe("normalize* — refuse to canonicalise multi-size blobs", () => {
  it("normalizeDim2D returns null for a blob (write guard)", () => {
    expect(normalizeDim2D("Varies by size: 27x52 (S); 30x55 (M)")).toBeNull();
    expect(normalizeDim2D("27X52 (S); 30X55 (M)")).toBeNull();
  });

  it("normalizeDim3D returns null for a blob (carton write guard)", () => {
    expect(normalizeDim3D("33X33X32 (Twin XL); 40X40X32 (Full)")).toBeNull();
    expect(normalizeDim3D("Varies by size: 60x40x30; 70x45x35")).toBeNull();
  });

  it("normal single-dim inputs are unaffected by the blob guard", () => {
    expect(normalizeDim2D("27x52cm")).toBe("27.00X52.00CM");
    expect(normalizeDim3D("60x40x30cm")).toBe("60.00X40.00X30.00CM");
  });
});
