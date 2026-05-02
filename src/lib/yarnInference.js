// src/lib/yarnInference.js
//
// Derive yarn_type and yarn_count from a free-form fabric description.
// Used by YarnPlanning.handleAutoGenerate() so the auto-from-FWS flow
// populates these columns instead of leaving them blank.
//
// Source data is `articles.components[i].fabric_type` (e.g.
// "110gsm - 100% Polyester terry knitted fabric with 0.02mm TPU coating")
// plus optionally a fuller `material` field. Tech packs and master-data
// sheets describe the yarn composition + count inline rather than as
// separate columns, so we have to parse it out.
//
// 2026-05-02 — added to fix "Yarn Type and Yarn Count are always
// missing" on the YarnPlanning page after Auto from FWS.
//
// Test cases live in tests/unit/yarnInference.test.js.

import { _internals as VOCAB } from "@/lib/textileVocabulary";

// Build a once-per-module regex that catches every fibre alias.
// Sorted longest-first so multi-word aliases ("Egyptian Cotton",
// "Pima Cotton") win over their single-word substring ("Cotton").
const FIBRE_REGEX = (() => {
  const idx = VOCAB.REVERSE_INDEX.fibre;
  if (!idx || idx.size === 0) return null;
  const aliases = Array.from(idx.keys()).sort((a, b) => b.length - a.length);
  const escaped = aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "ig");
})();

/**
 * Pull yarn composition out of a fabric description.
 *
 * Examples:
 *   "100% Polyester terry knitted fabric"      → "100% Polyester"
 *   "85% Modal / 10% Polyester / 5% Spandex"   → "85% Modal / 10% Polyester / 5% Spandex"
 *   "Egyptian Cotton sateen"                    → "Egyptian Cotton"
 *   "60% Cotton 40% Bamboo viscose"            → "60% Cotton / 40% Bamboo"
 *   ""                                          → null
 *
 * Strategy:
 *   1. Find every "<NN>% <fibre>" run in the input. Use those verbatim
 *      because customers care about the exact percentages.
 *   2. If no percentages but fibre names appear, return the canonicalised
 *      list joined.
 *   3. Otherwise null (caller can fall back to the raw fabric_type).
 *
 * @param {string} input  raw fabric_type or material description
 * @returns {string|null}
 */
export function inferYarnType(input) {
  if (!input || typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  // Strategy 1: percentages with fibre names. The percent number must
  // come BEFORE the fibre and within ~25 chars (avoids matching a GSM
  // value far away from any fibre word).
  const PCT_FIBRE = /(\d{1,3})\s*%\s+([A-Za-z][A-Za-z\s\-/]{0,24}?)(?=\s|,|\/|&|;|\d|$)/g;
  const pctParts = [];
  let m;
  while ((m = PCT_FIBRE.exec(text)) !== null) {
    const pct = m[1];
    const word = m[2].trim().toLowerCase();
    // Resolve the fibre word against the vocabulary. If it doesn't match
    // any fibre, skip — we don't want to grab "100% TPU coating" as a
    // yarn composition.
    let canonical = null;
    for (const token of word.split(/\s+/)) {
      const c = VOCAB.REVERSE_INDEX.fibre?.get(token.toLowerCase());
      if (c) { canonical = c; break; }
    }
    // Also try the multi-word form (e.g. "egyptian cotton")
    if (!canonical) {
      const multi = VOCAB.REVERSE_INDEX.fibre?.get(word);
      if (multi) canonical = multi;
    }
    if (canonical) pctParts.push(`${pct}% ${canonical}`);
  }
  if (pctParts.length > 0) return pctParts.join(" / ");

  // Strategy 2: fibre name(s) without percentages. Take the first match.
  if (FIBRE_REGEX) {
    FIBRE_REGEX.lastIndex = 0;
    const matches = new Set();
    while ((m = FIBRE_REGEX.exec(text)) !== null) {
      const c = VOCAB.REVERSE_INDEX.fibre?.get(m[1].toLowerCase());
      if (c) matches.add(c);
      if (matches.size >= 4) break; // sanity cap
    }
    if (matches.size > 0) return [...matches].join(" / ");
  }

  return null;
}

/**
 * Pull yarn count out of a fabric description.
 *
 * Common formats:
 *   "30/1"          single-yarn count        → "30/1"
 *   "30/2"          two-ply                  → "30/2"
 *   "40s"           Ne (English count)       → "40s"
 *   "Ne 30"         explicit Ne notation     → "Ne 30"
 *   "Nm 60"         metric count             → "Nm 60"
 *   "80D"           denier (filament yarns)  → "80D"
 *   "150D/48F"      denier / filaments       → "150D/48F"
 *   "20D"           spandex denier           → "20D"
 *
 * @param {string} input  raw fabric_type or material description
 * @returns {string|null}
 */
export function inferYarnCount(input) {
  if (!input || typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  // Order matters: more specific first. Each pattern returns the captured
  // text verbatim so the output looks the same as a buyer would write.
  const PATTERNS = [
    // 150D/48F filament yarn
    /\b(\d{2,4}D\s*\/\s*\d{1,3}F)\b/i,
    // 80D / 20D / 150D denier
    /\b(\d{2,4}D)\b/,
    // 30/1, 40/2, 20/3 cotton count
    /\b(\d{1,3}\s*\/\s*\d{1,2})\b/,
    // 40s, 30s English count
    /\b(\d{1,3}s)\b/,
    // Ne 30 / Ne30
    /\b(Ne\s*\d{1,3})\b/i,
    // Nm 60 / Nm60 metric count
    /\b(Nm\s*\d{1,3})\b/i,
  ];
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m) return m[1].replace(/\s+/g, "");
  }
  return null;
}

/**
 * Convenience wrapper: derive both fields from one or more description
 * sources. Each source is tried in order; first non-null wins per field.
 *
 * @param {...(string|null|undefined)} sources
 * @returns {{ yarn_type: string|null, yarn_count: string|null }}
 */
export function deriveYarnFields(...sources) {
  let yarn_type = null;
  let yarn_count = null;
  for (const src of sources) {
    if (!yarn_type)  yarn_type  = inferYarnType(src);
    if (!yarn_count) yarn_count = inferYarnCount(src);
    if (yarn_type && yarn_count) break;
  }
  return { yarn_type, yarn_count };
}
