import { describe, it, expect } from "vitest";
import { _internals } from "../../src/lib/descriptionResolver.js";

const { matchesCategory, CATEGORY_ALIASES, CATEGORY_EXCLUSIONS } = _internals;

// Per docs/architecture.md §5 — locks in the alias-routing rules and
// the overlap-suppression rules. Run together so a future tweak to
// either CATEGORY_ALIASES or CATEGORY_EXCLUSIONS can't silently
// regress the spec-mandated routing.

describe("§5 — CATEGORY_ALIASES (Trim)", () => {
  // Spec list: thread, sewing thread, stopper, cord lock, cord stopper,
  // elastic, cord, metal stopper.
  it.each([
    "thread",
    "sewing thread",
    "stopper",
    "cord lock",
    "cord stopper",
    "elastic",
    "cord",
    "metal stopper",
  ])("'%s' classifies as Trim", (alias) => {
    expect(matchesCategory(alias, "Trim")).toBe(true);
  });

  it("a generic 'Trim Detail' element still routes to Trim via substring", () => {
    expect(matchesCategory("Trim Detail", "Trim")).toBe(true);
  });

  it("the spec list does not match Trim for unrelated elements", () => {
    expect(matchesCategory("polybag", "Trim")).toBe(false);
    expect(matchesCategory("carton box", "Trim")).toBe(false);
  });
});

describe("§5 — CATEGORY_EXCLUSIONS (overlap suppression)", () => {
  it("Label excludes 'sticker' even though aliases would otherwise match", () => {
    // "barcode sticker" contains "barcode label" alias-substring? — actually
    // it contains "sticker" → must be excluded from Label.
    expect(matchesCategory("Barcode Sticker", "Label")).toBe(false);
    // And it should still match Sticker.
    expect(matchesCategory("Barcode Sticker", "Sticker")).toBe(true);
  });

  it("Label excludes 'barcode' element types", () => {
    expect(matchesCategory("Barcode Label", "Label")).toBe(false);
    expect(matchesCategory("Barcode Label", "Sticker")).toBe(true);
  });

  it("Label excludes 'qr code' elements", () => {
    expect(matchesCategory("QR Code Label", "Label")).toBe(false);
    expect(matchesCategory("QR Code Label", "Sticker")).toBe(true);
  });

  it("Stiffener excludes 'carton' elements", () => {
    // A "Carton Stiffener" is the carton box itself, not the stiffener
    // insert that goes inside packaging.
    expect(matchesCategory("Carton Stiffener", "Stiffener")).toBe(false);
    expect(matchesCategory("Carton Stiffener", "Carton")).toBe(true);
  });

  it("benign labels still route to Label after exclusions", () => {
    expect(matchesCategory("Care Label", "Label")).toBe(true);
    expect(matchesCategory("Brand Label", "Label")).toBe(true);
    expect(matchesCategory("Size Label", "Label")).toBe(true);
    expect(matchesCategory("Hang Tag", "Label")).toBe(true);
  });

  it("benign stiffeners still route to Stiffener after exclusions", () => {
    expect(matchesCategory("Cardboard Stiffener", "Stiffener")).toBe(true);
    expect(matchesCategory("Card Stiffener", "Stiffener")).toBe(true);
  });
});

describe("§5 — exclusion rules wired only on the listed tabs", () => {
  it("only Label and Stiffener have exclusions configured", () => {
    expect(Object.keys(CATEGORY_EXCLUSIONS).sort()).toEqual(["Label", "Stiffener"]);
  });

  it("Trim has no exclusions, so 'thread' classifies even when other categories match", () => {
    expect(matchesCategory("thread", "Trim")).toBe(true);
  });
});
