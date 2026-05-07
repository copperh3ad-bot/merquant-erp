import { describe, it, expect } from "vitest";
import { _internals } from "../../src/lib/descriptionResolver.js";

const { matchesCategory, CATEGORY_ALIASES, CATEGORY_EXCLUSIONS } = _internals;

// Per docs/architecture.md §5 — locks in the alias-routing rules and
// the overlap-suppression rules. Run together so a future tweak to
// either CATEGORY_ALIASES or CATEGORY_EXCLUSIONS can't silently
// regress the spec-mandated routing.

describe("§5 — CATEGORY_ALIASES (Trim)", () => {
  // MAS-aligned alias list (13 items): legacy 7 + hardware/thread 6.
  // The architecture spec text mentioned bare "cord" and "metal stopper"
  // but MAS's actual implementation doesn't include those — MAS treats
  // them as too broad / unused. These tests assert the MAS reality.
  it.each([
    // Legacy (kept from before the §5 spec rewrite, restored from MAS)
    "trim",
    "binding",
    "piping",
    "elastic",
    "drawcord",
    "ribbon",
    "velcro",
    // Hardware / thread additions per MAS
    "thread",
    "sewing thread",
    "stopper",
    "cord lock",
    "cord stopper",
    "drawstring stopper",
    "drawcord stopper",
  ])("'%s' classifies as Trim", (alias) => {
    expect(matchesCategory(alias, "Trim")).toBe(true);
  });

  it("a generic 'Trim Detail' element still routes to Trim via substring", () => {
    expect(matchesCategory("Trim Detail", "Trim")).toBe(true);
  });

  it("the alias list does not match Trim for unrelated elements", () => {
    expect(matchesCategory("polybag", "Trim")).toBe(false);
    expect(matchesCategory("carton box", "Trim")).toBe(false);
  });

  it("bare 'cord' is NOT a Trim alias on its own (per MAS)", () => {
    // The spec text mentioned bare "cord" but MAS treats it as too
    // broad and omits it. "drawcord", "cord lock", "cord stopper"
    // catch the legitimate cases.
    expect(matchesCategory("cord", "Trim")).toBe(false);
  });

  it("'metal stopper' classifies via the 'stopper' substring alias", () => {
    // The spec text lists "metal stopper" as a separate alias but
    // MAS doesn't need it — the bare "stopper" alias already catches
    // "metal stopper" via substring match.
    expect(matchesCategory("metal stopper", "Trim")).toBe(true);
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
