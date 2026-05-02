import { describe, it, expect } from "vitest";
import { inferYarnType, inferYarnCount, deriveYarnFields } from "@/lib/yarnInference";

describe("inferYarnType", () => {
  it("extracts a single percentage composition", () => {
    expect(inferYarnType("100% Polyester terry knitted fabric")).toBe("100% Polyester");
    expect(inferYarnType("70gsm - 100% Polyester interlock knitted fabric")).toBe("100% Polyester");
    expect(inferYarnType("140gsm - 100% Nylon mica fiber jersey knitted fabric")).toBe("100% Nylon");
  });

  it("extracts multi-fibre blends with all percentages", () => {
    const out = inferYarnType("85% Modal 10% Polyester 5% Spandex");
    expect(out).toContain("85% Modal");
    expect(out).toContain("10% Polyester");
    expect(out).toContain("5% Spandex");
  });

  it("recognises fibre aliases (Tencel → Lyocell, Lycra → Spandex, Viscose → Rayon)", () => {
    expect(inferYarnType("100% Tencel jersey")).toBe("100% Lyocell");
    expect(inferYarnType("95% Cotton 5% Lycra")).toContain("Spandex");
    expect(inferYarnType("100% Viscose")).toBe("100% Rayon");
  });

  it("falls back to fibre name without percentage when no % present", () => {
    expect(inferYarnType("Egyptian Cotton sateen 300TC")).toBe("Egyptian Cotton");
    expect(inferYarnType("Modal jersey")).toBe("Modal");
  });

  it("ignores percentages on non-fibre words (no false positive)", () => {
    expect(inferYarnType("100% TPU coating, 110gsm fabric")).toBeNull();
    expect(inferYarnType("0.02mm TPU coating only")).toBeNull();
  });

  it("returns null for empty/garbage input", () => {
    expect(inferYarnType("")).toBeNull();
    expect(inferYarnType(null)).toBeNull();
    expect(inferYarnType(undefined)).toBeNull();
    expect(inferYarnType("   ")).toBeNull();
    expect(inferYarnType("just some random words")).toBeNull();
  });
});

describe("inferYarnCount", () => {
  it("extracts cotton count notation X/Y", () => {
    expect(inferYarnCount("30/1 single jersey")).toBe("30/1");
    expect(inferYarnCount("40/2 doubled cotton")).toBe("40/2");
    expect(inferYarnCount("Single Jersey 24/1")).toBe("24/1");
  });

  it("extracts English count Xs", () => {
    expect(inferYarnCount("Cotton 40s")).toBe("40s");
    expect(inferYarnCount("80s combed")).toBe("80s");
  });

  it("extracts denier notation", () => {
    expect(inferYarnCount("80D filament")).toBe("80D");
    expect(inferYarnCount("150D/48F textured polyester")).toBe("150D/48F");
    expect(inferYarnCount("20D spandex")).toBe("20D");
  });

  it("extracts Ne / Nm explicit notation", () => {
    expect(inferYarnCount("Ne 30 cotton")).toBe("Ne30");
    expect(inferYarnCount("Nm 60 wool")).toBe("Nm60");
  });

  it("returns null when no count notation present", () => {
    expect(inferYarnCount("100% Polyester knitted fabric")).toBeNull();
    expect(inferYarnCount("Some material")).toBeNull();
    expect(inferYarnCount("")).toBeNull();
    expect(inferYarnCount(null)).toBeNull();
  });

  it("does not confuse GSM, width, or other numbers with yarn count", () => {
    expect(inferYarnCount("110 GSM cotton")).toBeNull();
    expect(inferYarnCount("210 cm width fabric")).toBeNull();
    expect(inferYarnCount("3000 meters")).toBeNull();
  });
});

describe("deriveYarnFields — multi-source", () => {
  it("uses the first source that yields a yarn_type", () => {
    const out = deriveYarnFields(null, "100% Cotton 30/1");
    expect(out.yarn_type).toBe("100% Cotton");
    expect(out.yarn_count).toBe("30/1");
  });

  it("merges across sources — yarn_type from one, yarn_count from another", () => {
    const out = deriveYarnFields(
      "100% Cotton",                  // has yarn_type, no count
      "30/1 single jersey",           // has yarn_count, no type
    );
    expect(out.yarn_type).toBe("100% Cotton");
    expect(out.yarn_count).toBe("30/1");
  });

  it("returns nulls when all sources are empty/non-textile", () => {
    const out = deriveYarnFields("", null, "no fibre info");
    expect(out.yarn_type).toBeNull();
    expect(out.yarn_count).toBeNull();
  });

  it("real-world: GPMP72 Front fabric description", () => {
    // Sample data pulled from articles.components on the live DB
    const out = deriveYarnFields(
      null,
      "110gsm - 100% Polyester terry knitted fabric with 0.02mm TPU coating",
      null,
    );
    expect(out.yarn_type).toBe("100% Polyester");
    // No yarn count in this description → null is correct
    expect(out.yarn_count).toBeNull();
  });
});
