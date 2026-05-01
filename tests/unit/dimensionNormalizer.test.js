import { describe, it, expect } from "vitest";
import {
  parseDimension,
  formatDimension,
  normalizeDim2D,
  normalizeDim3D,
  dimensionsEqual,
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
