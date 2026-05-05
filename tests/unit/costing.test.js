// tests/unit/costing.test.js
//
// Phase-3 hardening (Q3). Locks the costing / BOM math in place so a
// future refactor (or an accidental copy-paste) can't silently shift a
// margin number that ships to a customer-facing PDF.

import { describe, expect, it } from "vitest";
import {
  calcCosting,
  toYarnKg,
  fabricTotalRequired,
  trimQtyPerPiece,
  trimQtyPerMeter,
  trimQtyPercentage,
  packagingQty,
  cbmFromDimensions,
  cbmFromPriceList,
} from "../../src/lib/costing.js";

describe("calcCosting", () => {
  it("sums all six cost buckets and applies overhead + freight + commission", () => {
    const r = calcCosting({
      fabric_cost: 10,
      trim_cost: 2,
      accessory_cost: 3,
      embellishment_cost: 1,
      cm_cost: 4,
      washing_cost: 2,         // subtotal = 22
      overhead_pct: 10,        // overhead = 2.2
      freight_cost: 5,
      buyer_price: 50,
      agent_commission_pct: 5, // commission = 2.5
    });
    expect(r.total_cogs).toBe(31.7);   // 22 + 2.2 + 5 + 2.5
    expect(r.gross_margin).toBe(18.3); // 50 - 31.7
    expect(r.gross_margin_pct).toBe(36.6);
  });

  it("returns zeros for an empty / blank costing row", () => {
    const r = calcCosting({});
    expect(r).toEqual({ total_cogs: 0, gross_margin: 0, gross_margin_pct: 0 });
  });

  it("treats string inputs the same as numeric (form fields are strings)", () => {
    const r = calcCosting({
      fabric_cost: "10",
      trim_cost: "5",
      buyer_price: "20",
    });
    expect(r.total_cogs).toBe(15);
    expect(r.gross_margin).toBe(5);
    expect(r.gross_margin_pct).toBe(25);
  });

  it("handles a loss (negative margin) without exploding", () => {
    const r = calcCosting({
      fabric_cost: 100,
      cm_cost: 50,
      buyer_price: 80,
    });
    expect(r.total_cogs).toBe(150);
    expect(r.gross_margin).toBe(-70);
    expect(r.gross_margin_pct).toBe(-87.5);
  });

  it("returns 0% margin when buyer_price is 0 (no division-by-zero)", () => {
    const r = calcCosting({ fabric_cost: 5, buyer_price: 0 });
    expect(r.gross_margin_pct).toBe(0);
    expect(r.total_cogs).toBe(5);
    expect(r.gross_margin).toBe(-5);
  });

  it("rounds total_cogs to 4 decimals (matches DB column scale)", () => {
    const r = calcCosting({
      fabric_cost: 1.111111,
      trim_cost: 2.222222,
      buyer_price: 10,
    });
    // sum = 3.333333 → fixed-4 = 3.3333; DB stores 4dp, so callers
    // should not see trailing 33333… in the response.
    expect(Number.isInteger(r.total_cogs * 10000)).toBe(true);
  });

  it("commission scales with buyer_price, not subtotal (real BlueKaktus convention)", () => {
    // 5% of buyer_price=200 = 10, not 5% of subtotal=100 = 5
    const r = calcCosting({
      fabric_cost: 100,
      buyer_price: 200,
      agent_commission_pct: 5,
    });
    expect(r.total_cogs).toBe(110); // 100 + 0 + 0 + 10
  });
});

describe("toYarnKg", () => {
  it("applies the canonical formula (meters × GSM × width_cm / 39.37 / 1000)", () => {
    // 1000 × 200 × 150 / 39.37 / 1000 = 762.0015… → toFixed(2) → 762.00
    expect(toYarnKg(1000, 200, 150)).toBeCloseTo(762.0, 1);
  });

  it("returns 0 for any falsy input — empty form rendering safe", () => {
    expect(toYarnKg(0, 200, 150)).toBe(0);
    expect(toYarnKg(1000, 0, 150)).toBe(0);
    expect(toYarnKg(1000, 200, 0)).toBe(0);
    expect(toYarnKg(null, 200, 150)).toBe(0);
    expect(toYarnKg(undefined, 200, 150)).toBe(0);
  });

  it("rounds to 2 decimals", () => {
    const v = toYarnKg(123, 187, 145);
    expect(v.toString()).toMatch(/^\d+\.\d{1,2}$/);
  });
});

describe("fabricTotalRequired", () => {
  it("multiplies consumption × qty × wastage uplift", () => {
    // 1.2 m/pc × 1000 pcs × 1.05 (5% wastage) = 1260
    expect(fabricTotalRequired(1.2, 1000, 5)).toBe(1260);
  });

  it("zero wastage just gives consumption × qty", () => {
    expect(fabricTotalRequired(2, 500, 0)).toBe(1000);
  });

  it("returns 0 if qty or consumption is missing", () => {
    expect(fabricTotalRequired(0, 1000, 5)).toBe(0);
    expect(fabricTotalRequired(1.5, 0, 5)).toBe(0);
  });
});

describe("trimQty helpers", () => {
  it("trimQtyPerPiece ceil-rounds to whole units (you can't order half a button)", () => {
    expect(trimQtyPerPiece(100, 1, 0)).toBe(100);
    expect(trimQtyPerPiece(100, 1, 5)).toBe(105);
    expect(trimQtyPerPiece(100, 1.05, 0)).toBe(105);
    // 100 × 0.5 × 1.07 = 53.5 → ceil → 54
    expect(trimQtyPerPiece(100, 0.5, 7)).toBe(54);
  });

  it("trimQtyPerMeter scales with fabric meters not piece count", () => {
    // 500m of zip tape × 0.05 m/m × 1.10 = 27.5 → 28
    expect(trimQtyPerMeter(500, 0.05, 10)).toBe(28);
  });

  it("trimQtyPercentage of order qty", () => {
    // 1000 × 5% × 1.05 = 52.5 → 53
    expect(trimQtyPercentage(1000, 5, 5)).toBe(53);
  });

  it("0/0 inputs return 0 not NaN", () => {
    expect(trimQtyPerPiece(0, 0, 0)).toBe(0);
    expect(trimQtyPerMeter(0, 0, 0)).toBe(0);
    expect(trimQtyPercentage(0, 0, 0)).toBe(0);
  });
});

describe("packagingQty", () => {
  it("default multiplier is 1 when omitted", () => {
    expect(packagingQty(100, undefined, 0)).toBe(100);
  });

  it("multiplier × wastage × ceil", () => {
    // 100 × 2 × 1.07 = 214
    expect(packagingQty(100, 2, 7)).toBe(214);
  });
});

describe("cbm helpers", () => {
  it("cbmFromDimensions converts cm³ to m³ × cartons", () => {
    // 60×40×30 cm = 72000 cm³ = 0.072 m³ × 10 cartons = 0.72 m³
    expect(cbmFromDimensions(60, 40, 30, 10)).toBeCloseTo(0.72, 6);
  });

  it("cbmFromPriceList uses ceil(qty/ppc) × cbm_per_carton", () => {
    // qty=250, ppc=24 → ceil(250/24)=11 cartons × 0.05 = 0.55
    expect(cbmFromPriceList(250, 24, 0.05)).toBeCloseTo(0.55, 6);
  });

  it("cbmFromPriceList returns 0 if pcs_per_carton is 0 (avoids ÷0)", () => {
    expect(cbmFromPriceList(250, 0, 0.05)).toBe(0);
  });

  it("dimension cbm with 0 cartons is 0", () => {
    expect(cbmFromDimensions(60, 40, 30, 0)).toBe(0);
  });
});
