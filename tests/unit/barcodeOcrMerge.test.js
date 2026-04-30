import { describe, it, expect } from "vitest";
import {
  getTechPackSize,
  matchOcrResultsToTechPacks,
  buildUpcUpdate,
  computeBarcodeUpdates,
} from "../../src/lib/barcodeOcrMerge.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const ocrResults = [
  { image_index: 0, image_path: "xl/media/image1.png", size: "QUEEN", barcode: "012345678929" },
  { image_index: 1, image_path: "xl/media/image2.png", size: "TWIN",  barcode: "012345678936" },
  { image_index: 2, image_path: "xl/media/image3.png", size: "KING",  barcode: "012345678943" },
  { image_index: 3, image_path: "xl/media/image4.png", size: "SLEEPER - QUEEN", barcode: "012345678905" },
];

const techPacksBob = [
  {
    id: "tp-1",
    article_code: "GPSE50",
    file_url: "storage://ai-extraction-sources/tech-packs/abc/sheet.xlsx",
    extracted_data: { source: "BOB Tech Pack", this_sku: { size: "QUEEN" } },
  },
  {
    id: "tp-2",
    article_code: "GPSE51",
    file_url: "storage://ai-extraction-sources/tech-packs/abc/sheet.xlsx",
    extracted_data: { source: "BOB Tech Pack", this_sku: { size: "TWIN" } },
  },
  {
    id: "tp-3",
    article_code: "GPSE52",
    file_url: "storage://ai-extraction-sources/tech-packs/abc/sheet.xlsx",
    extracted_data: { source: "BOB Tech Pack", this_sku: { size: "FULL" } }, // no OCR match
  },
];

// AI-shape row uses extracted_data.size instead of nested this_sku
const techPackAi = {
  id: "tp-ai-1",
  article_code: "MP-QUEEN-WHT",
  file_url: "storage://ai-extraction-sources/tech-packs/xyz/file.xlsx",
  extracted_data: { size: "QUEEN" },
};

// ── getTechPackSize ──────────────────────────────────────────────────────

describe("getTechPackSize", () => {
  it("reads size from BOB shape (extracted_data.this_sku.size)", () => {
    expect(getTechPackSize(techPacksBob[0])).toBe("QUEEN");
  });

  it("reads size from AI shape (extracted_data.size)", () => {
    expect(getTechPackSize(techPackAi)).toBe("QUEEN");
  });

  it("uppercases and trims the size for stable matching", () => {
    const tp = { extracted_data: { this_sku: { size: "  queen  " } } };
    expect(getTechPackSize(tp)).toBe("QUEEN");
  });

  it("returns empty string when extracted_data is missing", () => {
    expect(getTechPackSize({})).toBe("");
    expect(getTechPackSize(null)).toBe("");
    expect(getTechPackSize(undefined)).toBe("");
  });
});

// ── matchOcrResultsToTechPacks ───────────────────────────────────────────

describe("matchOcrResultsToTechPacks", () => {
  it("pairs each tech-pack row with the OCR result whose size matches", () => {
    const pairs = matchOcrResultsToTechPacks(ocrResults, techPacksBob);
    // Two of three rows should match (QUEEN, TWIN). FULL has no OCR result.
    expect(pairs).toHaveLength(2);
    const ids = pairs.map((p) => p.tp.id);
    expect(ids).toContain("tp-1");
    expect(ids).toContain("tp-2");
    expect(ids).not.toContain("tp-3");
  });

  it("matches case-insensitively and tolerates whitespace", () => {
    const ocr = [{ size: "  queen  ", barcode: "999" }];
    const tps = [{ id: "x", extracted_data: { this_sku: { size: "QUEEN" } } }];
    const pairs = matchOcrResultsToTechPacks(ocr, tps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].match.barcode).toBe("999");
  });

  it("returns [] when ocrResults is empty or not an array", () => {
    expect(matchOcrResultsToTechPacks([], techPacksBob)).toEqual([]);
    expect(matchOcrResultsToTechPacks(null, techPacksBob)).toEqual([]);
    expect(matchOcrResultsToTechPacks(undefined, techPacksBob)).toEqual([]);
  });

  it("returns [] when techPacks is empty or not an array", () => {
    expect(matchOcrResultsToTechPacks(ocrResults, [])).toEqual([]);
    expect(matchOcrResultsToTechPacks(ocrResults, null)).toEqual([]);
  });

  it("skips OCR results that lack size or barcode", () => {
    const partial = [
      { size: "QUEEN" },                          // no barcode
      { barcode: "012345678929" },                // no size
      { size: "TWIN", barcode: "012345678936" },  // valid
    ];
    const pairs = matchOcrResultsToTechPacks(partial, techPacksBob);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].tp.id).toBe("tp-2");
  });

  it("matches multi-word sizes like 'SLEEPER - QUEEN' (real BOB fixture case)", () => {
    const tps = [{
      id: "sq-1",
      article_code: "GPSE99",
      extracted_data: { this_sku: { size: "Sleeper - Queen" } }
    }];
    const pairs = matchOcrResultsToTechPacks(ocrResults, tps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].match.barcode).toBe("012345678905");
  });
});

// ── buildUpcUpdate ───────────────────────────────────────────────────────

describe("buildUpcUpdate", () => {
  it("preserves existing extracted_data fields and adds upc array", () => {
    const tp = {
      article_code: "GPSE50",
      extracted_data: { source: "BOB Tech Pack", program: "G37", this_sku: { size: "QUEEN" } },
    };
    const match = { size: "QUEEN", barcode: "012345678929" };
    const out = buildUpcUpdate(tp, match);
    expect(out.source).toBe("BOB Tech Pack");
    expect(out.program).toBe("G37");
    expect(out.this_sku.size).toBe("QUEEN");
    expect(out.upc).toEqual([
      { size: "QUEEN", our_sku: "GPSE50", bob_sku: "012345678929" },
    ]);
  });

  it("overwrites a pre-existing upc array (re-extract scenario)", () => {
    const tp = {
      article_code: "GPSE50",
      extracted_data: { upc: [{ size: "QUEEN", our_sku: "GPSE50", bob_sku: "OLD-999" }] },
    };
    const match = { size: "QUEEN", barcode: "NEW-123" };
    const out = buildUpcUpdate(tp, match);
    expect(out.upc).toHaveLength(1);
    expect(out.upc[0].bob_sku).toBe("NEW-123");
  });

  it("handles tech packs with no prior extracted_data", () => {
    const tp = { article_code: "X" };
    const match = { size: "QUEEN", barcode: "012345678929" };
    const out = buildUpcUpdate(tp, match);
    expect(out.upc[0].our_sku).toBe("X");
  });
});

// ── computeBarcodeUpdates ────────────────────────────────────────────────

describe("computeBarcodeUpdates", () => {
  it("returns [{id, extracted_data}] for matched rows only", () => {
    const updates = computeBarcodeUpdates(ocrResults, techPacksBob);
    expect(updates).toHaveLength(2);
    const ids = updates.map((u) => u.id);
    expect(ids).toContain("tp-1");
    expect(ids).toContain("tp-2");
    // tp-3 (FULL) has no matching OCR result and is dropped
    expect(ids).not.toContain("tp-3");
  });

  it("each update payload preserves prior extracted_data", () => {
    const updates = computeBarcodeUpdates(ocrResults, techPacksBob);
    const u1 = updates.find((u) => u.id === "tp-1");
    expect(u1.extracted_data.source).toBe("BOB Tech Pack");
    expect(u1.extracted_data.upc[0].bob_sku).toBe("012345678929");
  });

  it("returns [] when nothing matches (no silent failures, no DB writes)", () => {
    const noMatchOcr = [{ size: "ZZZ-NONESUCH", barcode: "1" }];
    const updates = computeBarcodeUpdates(noMatchOcr, techPacksBob);
    expect(updates).toEqual([]);
  });
});
