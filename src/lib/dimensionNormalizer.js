/**
 * dimensionNormalizer.js
 *
 * Canonicalises dimension strings so cross-source byte equality holds.
 *
 * Real-world inputs vary in:
 *   - Order:      "27x52.6CM" (W×L)        vs "52.60x27.00CM" (L×W)
 *   - Separator:  "x", "X", "*", "×", " "  any of these
 *   - Spacing:    "27 X 52.6"               vs "27x52.6"
 *   - Decimals:   "27"                       vs "27.00"
 *   - Unit:       "CM", "cm", "Cm", "" (omitted)
 *   - Trailing junk: "27x52.6cm + 4cm flap" — text after the dim block
 *
 * Canonical 2-D form (insert/stiffener/pvc-bag/etc):
 *   smaller × larger × cm   →  e.g. "27.00X52.60CM"
 *   Two decimals, uppercase X, uppercase CM, no spaces.
 *   Sorting smaller→larger means W×L and L×W converge to the same string.
 *
 * Canonical 3-D form (carton):
 *   L × W × H × cm           →  e.g. "60.00X30.00X45.00CM"
 *   Order PRESERVED — for cartons L/W/H are semantically distinct (you
 *   can't sort cartons because shipping/storage cares which face is up).
 *
 * If the input can't be parsed (free-form text, unit-less ambiguity), the
 * normalizer returns the input verbatim — never throws, never returns null.
 */

const NUM = /\d+(?:\.\d+)?/g;
// Unit detection: match cm/mm/inch/in/"/' anywhere, but require the next
// character to NOT be a letter so "mm" beats "m" and "Smith" doesn't match.
// No leading word-boundary because real inputs have no boundary between
// digit and letter (e.g. "52.6CM" — there is no \b between 6 and C).
const UNIT_RE = /(cm|mm|inch|in|"|')(?![a-z])/i;

/**
 * Per docs/architecture.md §6 — detect a "multi-size blob" string. AI
 * extractions occasionally fold per-size dimension data into a single
 * cell, e.g.:
 *
 *   "Varies by size: 33X33X32 (Twin XL); 40X40X32 (Full)"
 *
 * Such strings must NOT be written into per-article dimension columns
 * (carton_size_cm, stiffener_size, pvc_bag_dimensions, insert_dimensions,
 * zipper_length_cm) — those columns are scalar per-article and a blob
 * would break every downstream consumer.
 *
 * Detection heuristic — true if any of these hold:
 *   1. Contains the literal phrase "varies by size" (case-insensitive)
 *   2. Contains a semicolon AND at least two parenthesised size labels
 *   3. Contains at least two distinct dimension groups separated by `;`
 *      or `,` where each group has its own dim numbers
 *
 * Tight on purpose — false positives (legit dim wrongly flagged) would
 * null out real data. False negatives (blob slips through) are
 * acceptable; the read-side guard in descriptionResolver catches them.
 */
export function isMultiSizeBlob(input) {
  if (input == null) return false;
  const s = String(input).trim();
  if (!s) return false;

  // Rule 1 — explicit phrase
  if (/varies\s+by\s+size/i.test(s)) return true;

  // Rule 2 — multiple parenthesised size labels paired with a separator
  const parenMatches = s.match(/\([^)]+\)/g) || [];
  if (parenMatches.length >= 2 && /[;,]/.test(s)) return true;

  // Rule 3 — multiple dim groups separated by `;`. Each segment must
  // independently look like a dimension (>= 2 numbers).
  const segments = s.split(/\s*;\s*/).filter(Boolean);
  if (segments.length >= 2) {
    let dimGroups = 0;
    for (const seg of segments) {
      const nums = seg.match(NUM);
      if (nums && nums.length >= 2) dimGroups++;
      if (dimGroups >= 2) return true;
    }
  }
  return false;
}

/**
 * Parse a dimension string into { numbers: number[], unit: string|null }.
 * Returns null if no numbers are found.
 */
export function parseDimension(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  const matches = s.match(NUM);
  if (!matches || matches.length === 0) return null;

  const numbers = matches.map((m) => parseFloat(m));

  // Detect unit. Default to "cm" if input contains digits + a separator
  // pattern (most likely a dimension), null otherwise.
  let unit = null;
  const unitMatch = s.match(UNIT_RE);
  if (unitMatch) {
    const u = unitMatch[1].toLowerCase();
    if (u === '"' || u === "in" || u === "inch") unit = "in";
    else if (u === "'") unit = "ft";
    else unit = u;
  }
  return { numbers, unit };
}

/**
 * Format a parsed dimension back to a canonical string.
 *
 * @param {object}  parsed       result of parseDimension()
 * @param {object}  options
 * @param {boolean} [options.sort=true]  sort numbers ascending (off for cartons)
 * @param {string}  [options.defaultUnit="CM"] unit to use when none detected
 */
export function formatDimension(parsed, { sort = true, defaultUnit = "CM" } = {}) {
  if (!parsed || !Array.isArray(parsed.numbers) || parsed.numbers.length === 0) return "";
  let nums = parsed.numbers.slice();
  if (sort) nums.sort((a, b) => a - b);
  const unit = (parsed.unit || defaultUnit).toUpperCase();
  return nums.map((n) => n.toFixed(2)).join("X") + unit;
}

/**
 * Convenience wrapper. Returns the canonical 2-D form (sorted small→large).
 * Falls back to the original input if parsing fails.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeDim2D(input) {
  if (input == null || String(input).trim() === "") return input == null ? null : "";
  // §6 write guard — refuse to canonicalise a multi-size blob into a
  // scalar per-article column. Returning null lets the caller's
  // onlyIfBlank/fillIfBlank wrappers leave the existing column alone
  // rather than overwriting a good value with a blob.
  if (isMultiSizeBlob(input)) return null;
  const parsed = parseDimension(input);
  if (!parsed || parsed.numbers.length < 2) return String(input).trim();
  // For 2D values that mistakenly contain 3 numbers, sort them all.
  return formatDimension(parsed, { sort: true });
}

/**
 * Convenience wrapper for cartons. Preserves number order (L/W/H semantics).
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeDim3D(input) {
  if (input == null || String(input).trim() === "") return input == null ? null : "";
  // §6 write guard — same rule as normalizeDim2D. Carton-size columns
  // are especially vulnerable because tech-pack rows often list per-size
  // carton dimensions in a single cell.
  if (isMultiSizeBlob(input)) return null;
  const parsed = parseDimension(input);
  if (!parsed || parsed.numbers.length < 1) return String(input).trim();
  return formatDimension(parsed, { sort: false });
}

/**
 * Compare two dimension strings semantically. Returns true when both parse
 * to the same SET of numbers regardless of order. Useful for cross-source
 * audits where one side has W×L and the other has L×W.
 */
export function dimensionsEqual(a, b) {
  const pa = parseDimension(a);
  const pb = parseDimension(b);
  if (!pa || !pb) return String(a ?? "").trim() === String(b ?? "").trim();
  if (pa.numbers.length !== pb.numbers.length) return false;
  const aS = pa.numbers.slice().sort((x, y) => x - y);
  const bS = pb.numbers.slice().sort((x, y) => x - y);
  // Compare with a tiny epsilon to avoid floating-point noise (e.g. 27.000001).
  return aS.every((n, i) => Math.abs(n - bS[i]) < 0.001);
}
