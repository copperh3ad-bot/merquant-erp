import { describe, it, expect } from "vitest";
import {
  getTechPackSize,
  matchOcrResultsToTechPacks,
  buildUpcUpdate,
  computeBarcodeUpdates,
  sizesMatch,
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

// ── Real-world fuzzy size matching (BOB FT2 Cool-S Frio regression) ──────
// Production data showed 7 / 12 SKUs failed to match because the OCR-printed
// size labels differed from the SKU's stored size string in subtle ways:
//   - "SPLIT  CAL KING"     (double space in SKU side)
//   - "CAL KING" / "CK"     (abbreviation in OCR side)
//   - "KING PILLOW PROTECTOR" — OCR may print only "KING"
// These tests pin the lenient matching rules added to barcodeOcrMerge.js.

describe("sizesMatch (lenient rules for BOB OCR labels)", () => {
  it("collapses double-space whitespace artefacts ('SPLIT  CAL KING' === 'SPLIT CAL KING')", () => {
    expect(sizesMatch("SPLIT  CAL KING", "SPLIT CAL KING")).toBe(true);
  });

  it("normalises punctuation: 'CAL-KING' / 'CAL_KING' / 'CAL/KING' all match 'CAL KING'", () => {
    expect(sizesMatch("CAL-KING", "CAL KING")).toBe(true);
    expect(sizesMatch("CAL_KING", "CAL KING")).toBe(true);
    expect(sizesMatch("CAL/KING", "CAL KING")).toBe(true);
  });

  it("matches abbreviations: 'CK' ↔ 'CAL KING'", () => {
    expect(sizesMatch("CAL KING", "CK")).toBe(true);
    expect(sizesMatch("CK",       "CAL KING")).toBe(true);
  });

  it("matches abbreviations: 'SHQ' ↔ 'SPLIT HEAD QUEEN'", () => {
    expect(sizesMatch("SPLIT HEAD QUEEN", "SHQ")).toBe(true);
    expect(sizesMatch("SHQ", "SPLIT HEAD QUEEN")).toBe(true);
  });

  it("matches abbreviations: 'SHK' ↔ 'SPLIT HEAD KING'", () => {
    expect(sizesMatch("SPLIT HEAD KING", "SHK")).toBe(true);
  });

  it("matches abbreviations: 'TXL' ↔ 'TWIN XL'", () => {
    expect(sizesMatch("TWIN XL", "TXL")).toBe(true);
  });

  it("matches abbreviations: 'FXL' ↔ 'FULL XL'", () => {
    expect(sizesMatch("FULL XL", "FXL")).toBe(true);
  });

  it("matches partial OCR labels: 'KING' against 'KING PILLOW PROTECTOR'", () => {
    expect(sizesMatch("KING PILLOW PROTECTOR", "KING")).toBe(true);
  });

  it("matches partial OCR labels: 'QUEEN PP' against 'QUEEN PILLOW PROTECTOR'", () => {
    expect(sizesMatch("QUEEN PILLOW PROTECTOR", "QUEEN PP")).toBe(true);
  });

  it("does NOT match unrelated sizes", () => {
    expect(sizesMatch("KING", "QUEEN")).toBe(false);
    expect(sizesMatch("TWIN", "FULL XL")).toBe(false);
    expect(sizesMatch("CAL KING", "SPLIT HEAD KING")).toBe(false);
  });

  it("does NOT match a single short word like 'K' or 'Q' (avoid spurious noise hits)", () => {
    expect(sizesMatch("K", "KING")).toBe(false);
    expect(sizesMatch("Q", "QUEEN")).toBe(false);
  });

  it("returns false when either side is empty", () => {
    expect(sizesMatch("", "QUEEN")).toBe(false);
    expect(sizesMatch("QUEEN", "")).toBe(false);
    expect(sizesMatch(null, "QUEEN")).toBe(false);
  });
});

describe("matchOcrResultsToTechPacks — real-world FT2 Cool-S Frio cases", () => {
  // Replicates the 12-SKU mattress protector upload where 7 rows previously
  // missed: the failing sizes had double spaces, abbreviations, or partial
  // OCR labels. With sizesMatch, all 12 should now pair up.
  const frioOcr = [
    { size: "TWIN",         barcode: "10001731001" },
    { size: "TXL",          barcode: "10001731002" }, // OCR returned abbreviation
    { size: "FULL",         barcode: "10001731003" },
    { size: "QUEEN",        barcode: "10001731004" },
    { size: "KING",         barcode: "10001731005" },
    { size: "CK",           barcode: "10001731006" }, // CAL KING
    { size: "FXL",          barcode: "10001731007" }, // FULL XL
    { size: "SHQ",          barcode: "10001731008" }, // SPLIT HEAD QUEEN
    { size: "SHK",          barcode: "10001731009" }, // SPLIT HEAD KING
    { size: "SCK",          barcode: "10001731010" }, // SPLIT CAL KING
    { size: "KING",         barcode: "10001731011" }, // OCR for KING PILLOW PROTECTOR
    { size: "QUEEN PP",     barcode: "10001731012" }, // QUEEN PILLOW PROTECTOR
  ];
  const frioTechPacks = [
    { id: "tp-1",  article_code: "GPFRIOMP33", extracted_data: { this_sku: { size: "TWIN" } } },
    { id: "tp-2",  article_code: "GPFRIOMP38", extracted_data: { this_sku: { size: "TWIN XL" } } },
    { id: "tp-3",  article_code: "GPFRIOMP46", extracted_data: { this_sku: { size: "FULL" } } },
    { id: "tp-4",  article_code: "GPFRIOMP50", extracted_data: { this_sku: { size: "QUEEN" } } },
    { id: "tp-5",  article_code: "GPFRIOMP78", extracted_data: { this_sku: { size: "KING" } } },
    { id: "tp-6",  article_code: "GPFRIOMP72", extracted_data: { this_sku: { size: "CAL KING" } } },
    { id: "tp-7",  article_code: "GPFRIOMP80", extracted_data: { this_sku: { size: "FULL XL" } } },
    { id: "tp-8",  article_code: "GPFRIOMP52", extracted_data: { this_sku: { size: "SPLIT HEAD QUEEN" } } },
    { id: "tp-9",  article_code: "GPFRIOMP79", extracted_data: { this_sku: { size: "SPLIT HEAD KING" } } },
    { id: "tp-10", article_code: "GPFRIOMP36", extracted_data: { this_sku: { size: "SPLIT  CAL KING" } } }, // double space
    { id: "tp-11", article_code: "GPFRIOPPK",  extracted_data: { this_sku: { size: "KING PILLOW PROTECTOR" } } },
    { id: "tp-12", article_code: "GPFRIOPPQ",  extracted_data: { this_sku: { size: "QUEEN PILLOW PROTECTOR" } } },
  ];

  it("matches all 12 SKUs with the lenient rules", () => {
    const pairs = matchOcrResultsToTechPacks(frioOcr, frioTechPacks);
    // 1:1 assignment: every SKU pairs to a unique OCR result.
    const matchedIds = pairs.map((p) => p.tp.id);
    for (let i = 1; i <= 12; i++) expect(matchedIds).toContain(`tp-${i}`);
    expect(pairs.length).toBe(12);
    // No barcode is assigned to more than one SKU.
    const barcodes = pairs.map((p) => p.match.barcode);
    expect(new Set(barcodes).size).toBe(barcodes.length);
  });
});

// ── v3 improvements: 1:1 assignment + word-set + CALIFORNIA KING alias ──
// Production data showed Vision returns the FULL printed label
// ("CALIFORNIA KING", "QUEEN SPLIT HEAD") rather than the abbreviated
// SKU-side form ("CAL KING", "SPLIT HEAD QUEEN"). Also, with multiple
// SKUs sharing a common word ("KING", "CAL KING", "KING PILLOW PROTECTOR"),
// per-tp greedy matching let one OCR result get assigned to multiple SKUs.
// 1:1 assignment + score priority fix both.

describe("sizesMatch — v3 additions", () => {
  it("matches 'CAL KING' ↔ 'CALIFORNIA KING' (Vision-side full name)", () => {
    expect(sizesMatch("CAL KING", "CALIFORNIA KING")).toBe(true);
    expect(sizesMatch("CALIFORNIA KING", "CAL KING")).toBe(true);
  });

  it("matches 'SPLIT CAL KING' ↔ 'SPLIT CALIFORNIA KING'", () => {
    expect(sizesMatch("SPLIT CAL KING", "SPLIT CALIFORNIA KING")).toBe(true);
  });

  it("matches word-set permutations: 'SPLIT HEAD QUEEN' ↔ 'QUEEN SPLIT HEAD'", () => {
    expect(sizesMatch("SPLIT HEAD QUEEN", "QUEEN SPLIT HEAD")).toBe(true);
    expect(sizesMatch("QUEEN SPLIT HEAD", "SPLIT HEAD QUEEN")).toBe(true);
  });

  it("matches word-set permutations: 'SPLIT HEAD KING' ↔ 'KING SPLIT HEAD'", () => {
    expect(sizesMatch("SPLIT HEAD KING", "KING SPLIT HEAD")).toBe(true);
  });
});

describe("matchOcrResultsToTechPacks — 1:1 assignment", () => {
  // Real production scenario: Vision returned 11 entries for 12 SKUs in the
  // FT2 Cool-S Frio upload. The bed-size sub-products (KING, CAL KING,
  // SPLIT HEAD KING, KING PILLOW PROTECTOR) all contain "KING" — and per-tp
  // greedy matching previously assigned the same barcode to all 4. v3's
  // 1:1 assignment with score priority fixes this.
  it("assigns each OCR result to AT MOST one tech pack (no duplicate barcodes)", () => {
    const ocr = [
      { size: "TWIN",                  barcode: "001" },
      { size: "QUEEN",                 barcode: "002" },
      { size: "KING",                  barcode: "003" },
      { size: "CALIFORNIA KING",       barcode: "004" }, // → CAL KING SKU via alias
      { size: "QUEEN SPLIT HEAD",      barcode: "005" }, // → SPLIT HEAD QUEEN via word-set
      { size: "KING SPLIT HEAD",       barcode: "006" }, // → SPLIT HEAD KING via word-set
      { size: "QUEEN",                 barcode: "007" }, // 2nd QUEEN → QUEEN PP via containment
      { size: "KING",                  barcode: "008" }, // 2nd KING → KING PP via containment
    ];
    const tps = [
      { id: "t1", article_code: "A1", extracted_data: { this_sku: { size: "TWIN" } } },
      { id: "t2", article_code: "A2", extracted_data: { this_sku: { size: "QUEEN" } } },
      { id: "t3", article_code: "A3", extracted_data: { this_sku: { size: "KING" } } },
      { id: "t4", article_code: "A4", extracted_data: { this_sku: { size: "CAL KING" } } },
      { id: "t5", article_code: "A5", extracted_data: { this_sku: { size: "SPLIT HEAD QUEEN" } } },
      { id: "t6", article_code: "A6", extracted_data: { this_sku: { size: "SPLIT HEAD KING" } } },
      { id: "t7", article_code: "A7", extracted_data: { this_sku: { size: "QUEEN PILLOW PROTECTOR" } } },
      { id: "t8", article_code: "A8", extracted_data: { this_sku: { size: "KING PILLOW PROTECTOR" } } },
    ];
    const pairs = matchOcrResultsToTechPacks(ocr, tps);
    // Every barcode should be assigned to exactly one SKU (no duplicates).
    const barcodes = pairs.map((p) => p.match.barcode);
    expect(new Set(barcodes).size).toBe(barcodes.length); // all unique
    expect(pairs.length).toBe(8); // all 8 SKUs got matched
  });

  it("a generic OCR label does NOT shadow a specific OCR label for the specific SKU", () => {
    // Two OCR results: "QUEEN" (generic) and "SLEEPER QUEEN" (specific).
    // The Sleeper Queen SKU should get the specific entry, not the generic.
    const ocr = [
      { size: "QUEEN",          barcode: "GEN-Q" },
      { size: "SLEEPER QUEEN",  barcode: "SLEEP-Q" },
    ];
    const tps = [
      { id: "tq",  extracted_data: { this_sku: { size: "QUEEN" } } },
      { id: "tsq", extracted_data: { this_sku: { size: "SLEEPER QUEEN" } } },
    ];
    const pairs = matchOcrResultsToTechPacks(ocr, tps);
    const queenBarcode   = pairs.find((p) => p.tp.id === "tq")?.match.barcode;
    const sleeperBarcode = pairs.find((p) => p.tp.id === "tsq")?.match.barcode;
    expect(queenBarcode).toBe("GEN-Q");
    expect(sleeperBarcode).toBe("SLEEP-Q");
  });

  it("real-world FT2 Cool-S Frio: Vision-shape OCR (with full names + word-order swaps + duplicate KINGs) pairs 11/12 cleanly", () => {
    // Mirrors the exact OCR output observed in production.
    const ocr = [
      { size: "TWIN",                  barcode: "10001731001" },
      { size: "TWIN XL",               barcode: "10001731002" },
      { size: "FULL",                  barcode: "10001731003" },
      { size: "QUEEN",                 barcode: "10001731004" },
      { size: "KING",                  barcode: "10001731005" },
      { size: "CALIFORNIA KING",       barcode: "10001731006" },
      { size: "SPLIT CALIFORNIA KING", barcode: "10001731007" },
      { size: "QUEEN SPLIT HEAD",      barcode: "10001731008" },
      { size: "KING SPLIT HEAD",       barcode: "10001731009" },
      { size: "QUEEN",                 barcode: "10001731010" },
      { size: "KING",                  barcode: "10001731011" },
    ];
    const tps = [
      { id: "1",  extracted_data: { this_sku: { size: "TWIN" } } },
      { id: "2",  extracted_data: { this_sku: { size: "TWIN XL" } } },
      { id: "3",  extracted_data: { this_sku: { size: "FULL" } } },
      { id: "4",  extracted_data: { this_sku: { size: "FULL XL" } } }, // genuinely missing from OCR
      { id: "5",  extracted_data: { this_sku: { size: "QUEEN" } } },
      { id: "6",  extracted_data: { this_sku: { size: "KING" } } },
      { id: "7",  extracted_data: { this_sku: { size: "CAL KING" } } },
      { id: "8",  extracted_data: { this_sku: { size: "SPLIT  CAL KING" } } }, // double space
      { id: "9",  extracted_data: { this_sku: { size: "SPLIT HEAD QUEEN" } } },
      { id: "10", extracted_data: { this_sku: { size: "SPLIT HEAD KING" } } },
      { id: "11", extracted_data: { this_sku: { size: "QUEEN PILLOW PROTECTOR" } } },
      { id: "12", extracted_data: { this_sku: { size: "KING PILLOW PROTECTOR" } } },
    ];
    const pairs = matchOcrResultsToTechPacks(ocr, tps);
    expect(pairs.length).toBe(11);
    // FULL XL should NOT match anything (Vision missed that image).
    const matchedIds = pairs.map((p) => p.tp.id);
    expect(matchedIds).not.toContain("4");
    // Every barcode is unique.
    const barcodes = pairs.map((p) => p.match.barcode);
    expect(new Set(barcodes).size).toBe(barcodes.length);
    // Spot-check the harder pairings.
    const get = (id) => pairs.find((p) => p.tp.id === id)?.match.barcode;
    expect(get("7")).toBe("10001731006");  // CAL KING ↔ CALIFORNIA KING
    expect(get("8")).toBe("10001731007");  // SPLIT  CAL KING ↔ SPLIT CALIFORNIA KING
    expect(get("9")).toBe("10001731008");  // SPLIT HEAD QUEEN ↔ QUEEN SPLIT HEAD
    expect(get("10")).toBe("10001731009"); // SPLIT HEAD KING ↔ KING SPLIT HEAD
    expect(get("11")).toBe("10001731010"); // QUEEN PP gets 2nd QUEEN
    expect(get("12")).toBe("10001731011"); // KING PP gets 2nd KING
  });
});
