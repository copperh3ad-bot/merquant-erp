import { describe, it, expect, vi } from "vitest";

// Stub the supabase client so the import chain doesn't throw on
// missing VITE_SUPABASE_* env vars in CI. The tests below only use
// `_internals` (pure functions); `mfg` and `skuQueue` are imported by
// skuMatcher.js but never reached on these code paths.
vi.mock("@/api/supabaseClient", () => ({
  mfg: { fabricTemplates: { list: vi.fn() } },
  skuQueue: { create: vi.fn() },
}));

import { _internals } from "../../src/lib/skuMatcher.js";

const {
  splitSku,
  isPrefixExtension,
  isLikelyOcr,
  numericSuffixesDiffer,
  matchShape,
} = _internals;

// 2026-05-04 — locks down the matcher rules from the bug found in the
// FRIOMP/GPFRIOMP and GPFRIAMP/GPFRIOMP cases. Two structural rejects
// fire BEFORE Levenshtein:
//   - prefix-extension (extra alpha letters at the start of the longer
//     code → different brand/family)
//   - numeric-suffix mismatch (different size → different SKU)
// One positive shape rule:
//   - same length + identical numeric suffix + alpha-prefix Hamming
//     distance exactly 1 → flagged as ocr_likely for human confirm.

describe("splitSku", () => {
  it("splits trailing numeric suffix from alpha prefix", () => {
    expect(splitSku("GPFRIOMP33")).toEqual(["GPFRIOMP", "33"]);
    expect(splitSku("FRIOMP36")).toEqual(["FRIOMP", "36"]);
    expect(splitSku("GPFRIAMP78")).toEqual(["GPFRIAMP", "78"]);
  });

  it("returns empty numeric suffix for codes ending in alpha", () => {
    expect(splitSku("ABC")).toEqual(["ABC", ""]);
  });

  it("uppercases and trims", () => {
    expect(splitSku("  gpfriomp33  ")).toEqual(["GPFRIOMP", "33"]);
  });

  it("handles null/undefined safely", () => {
    expect(splitSku(null)).toEqual(["", ""]);
    expect(splitSku(undefined)).toEqual(["", ""]);
  });
});

describe("isPrefixExtension", () => {
  it("rejects when the longer code has an alpha brand prefix", () => {
    // FRIOMP36 vs GPFRIOMP36 — "GP" is a brand prefix → different family
    expect(isPrefixExtension("FRIOMP36", "GPFRIOMP36")).toBe(true);
    expect(isPrefixExtension("GPFRIOMP36", "FRIOMP36")).toBe(true); // symmetric
  });

  it("does not flag identical or non-suffix relationships", () => {
    expect(isPrefixExtension("GPFRIOMP33", "GPFRIOMP33")).toBe(false);
    expect(isPrefixExtension("GPFRIOMP33", "GPFRIAMP33")).toBe(false); // same length
    expect(isPrefixExtension("FRIOMP36", "FRIOMP38")).toBe(false); // not suffix relation
  });

  it("does not treat numeric prefix as brand qualifier", () => {
    // 100ABC vs ABC — the leading digits could be a year or version
    expect(isPrefixExtension("ABC", "100ABC")).toBe(false);
  });
});

describe("isLikelyOcr", () => {
  it("flags single-character body swap with identical numeric suffix", () => {
    // GPFRIAMP33 vs GPFRIOMP33 — A↔O at one position, suffix 33 matches
    expect(isLikelyOcr("GPFRIAMP33", "GPFRIOMP33")).toBe(true);
    expect(isLikelyOcr("GPFRIAMP78", "GPFRIOMP78")).toBe(true);
    expect(isLikelyOcr("GPFRIAMP50", "GPFRIOMP50")).toBe(true);
  });

  it("rejects when numeric suffixes differ", () => {
    expect(isLikelyOcr("GPFRIAMP33", "GPFRIOMP38")).toBe(false);
  });

  it("rejects when alpha prefix Hamming distance > 1", () => {
    // FTAMP46 vs FTATE46 — alpha prefixes differ in 2 positions
    expect(isLikelyOcr("FTAMP46", "FTATE46")).toBe(false);
  });

  it("rejects when lengths differ", () => {
    expect(isLikelyOcr("FRIOMP36", "GPFRIOMP36")).toBe(false);
  });

  it("rejects when no numeric suffix", () => {
    expect(isLikelyOcr("ABCDE", "ABCDF")).toBe(false);
  });
});

describe("numericSuffixesDiffer", () => {
  it("detects size differences", () => {
    expect(numericSuffixesDiffer("FRIOMP36", "FRIOMP38")).toBe(true);
    expect(numericSuffixesDiffer("FRIOMP36", "FRIOMP79")).toBe(true);
  });

  it("returns false when suffixes match or are absent", () => {
    expect(numericSuffixesDiffer("FRIOMP36", "FRIOMP36")).toBe(false);
    expect(numericSuffixesDiffer("ABC", "DEF")).toBe(false);
  });
});

describe("matchShape — top-level decision", () => {
  it("returns exact for identical codes (case-insensitive)", () => {
    expect(matchShape("GPFRIOMP33", "GPFRIOMP33").type).toBe("exact");
    expect(matchShape("gpfriomp33", "GPFRIOMP33").type).toBe("exact");
  });

  it("rejects prefix-extensions even when Levenshtein is high", () => {
    // FRIOMP36 vs GPFRIOMP36 — Levenshtein similarity ≈ 0.8 but we reject
    const result = matchShape("FRIOMP36", "GPFRIOMP36");
    expect(result.type).toBe("reject");
    expect(result.reason).toBe("prefix-extension");
  });

  it("rejects numeric-suffix mismatches even when alpha matches", () => {
    // FRIOMP36 vs FRIOMP38 — alpha prefix identical, only suffix differs
    const result = matchShape("FRIOMP36", "FRIOMP38");
    expect(result.type).toBe("reject");
    expect(result.reason).toBe("numeric-suffix-mismatch");
  });

  it("flags single-char body swap as ocr_likely", () => {
    const result = matchShape("GPFRIAMP33", "GPFRIOMP33");
    expect(result.type).toBe("ocr_likely");
    expect(result.reason).toBe("single-char-swap");
  });

  it("does not match across different product families (FTAMP vs FTATE)", () => {
    const result = matchShape("FTAMP46", "FTATE46");
    expect(result.type).toBe("reject");
  });

  it("returns reject with empty input", () => {
    expect(matchShape("", "ABC").type).toBe("reject");
    expect(matchShape("ABC", "").type).toBe("reject");
    expect(matchShape(null, undefined).type).toBe("reject");
  });
});
