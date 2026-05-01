# Format-Agnostic Extraction — Architecture Plan

**Goal:** MerQuant accepts any tech-pack / master-data / fabric-working / accessory file from any customer, in any layout, and produces standardized internal data linked by SKU. No required input templates.

**Status:** Phase 1 shipped (anomaly detector + auto-fix + v3 prompt). Phase 2-4 designed below; deferred to follow-up sessions.

---

## Principle

The only universal anchor is the SKU code (`item_code` / `article_code`). Every other field — column names, sheet structures, units, language — is customer-specific. The system's job is to translate **arbitrary input shape** to the **standardized internal schema** while preserving SKU identity.

## Why one-shot AI extraction breaks down

A single Claude call asked to "fill these 8 sections from this XLSX" can fail in subtle ways:
- Column-meaning hallucination (today's MFRM bug: fabric description landed in `component_type` because the AI ignored an explicit column header)
- Sheet-purpose confusion (fabric sheet vs accessory sheet vs carton master)
- Silent data loss (rows skipped because they didn't match an inferred shape)
- Cost/latency (huge schema = huge prompt = slow + expensive)

These get worse as customer formats diverge from what the AI was trained on.

## Phase 1 — anomaly detector + strict prompt (SHIPPED 2026-05-01)

| Piece | What it does | Where |
|---|---|---|
| `extractionAnomalyDetector.js` | Pure-JS post-extraction validator. Catches: fabric descriptors leaked into `component_type`; column-swap mistakes (auto-fixes when ALL rows show the swap); missing item_codes; weak fabric_type values. | `src/lib/extractionAnomalyDetector.js` |
| Auto-fix on column swap | When 100% of rows show fabric→component_type with empty fabric_type, swap them in-place + record the fix as an info-level anomaly. Anything less than 100% → flag, don't auto-fix. | Same file |
| Strict prompt v3 | Explicit forbidden list for `component_type` ("never put 'Jersey Knit' here"); explicit allow-list of canonical part names; rule that column headers are authoritative; lowered confidence floor for ambiguous mappings. | `supabase/functions/extract-document/prompts.ts` |
| File Feeder UI | Renders auto-fix notices (blue), anomaly warnings (amber), dedup notices (green), miscategorisation flags (red) on the validation card before apply. | `src/pages/FileFeeder.jsx` |

This catches the obvious cases. It doesn't solve "every customer has their own format" — it just makes the AI's mistakes visible and partially recoverable.

## Phase 2 — Two-step extraction with column-mapping declaration

Replace the single-shot extraction with two AI calls:

**Step 1 — Discover layout:**
```typescript
input:  full XLSX as CSV blocks
output: {
  sheets: [{
    name: "SKU Fabric Consumption",
    purpose: "fabric_consumption",   // matches a target schema section
    column_mapping: {
      "Part":         "component_type",
      "Cut size":     "product_size",
      "Material":     "fabric_type",
      "Width (cm)":   "width_cm",
      "Cut/Unit":     "consumption_per_unit",
      // ...
    },
    confidence_per_column: { ... },
    sample_rows: [first 3 rows after mapping]
  }]
}
```

**Step 2 — Apply mapping deterministically:**
No AI. Just iterate every row, apply the column→field mapping, emit the standardized output. Cheap, fast, reproducible.

**Why two steps:** Step 1 is a small, focused prompt — easier for Claude to get right. Step 2 has zero AI fragility.

## Phase 3 — User confirmation of column mapping

Between Step 1 and Step 2, **show the user** the proposed sheet purpose + column mapping in File Feeder. Editable table:

```
Sheet: "SKU Fabric Consumption"          Type: [fabric_consumption ▾]
─────────────────────────────────────────────────────────────────────
Source column        Target field        Confidence    Override
─────────────────────────────────────────────────────────────────────
Part                 component_type      ████ 0.95     [✓]
Cut size             product_size        ████ 0.93     [✓]
Material             fabric_type         ████ 0.97     [✓]
Description          ???                 ░░░░ 0.30     [Skip ▾]
─────────────────────────────────────────────────────────────────────
                                                       [Apply mapping]
```

User can override any mapping before deterministic extraction runs. This means **the AI never silently miscategorises** — every mapping decision is visible.

## Phase 4 — Per-customer Mapping Profiles

The killer feature. Once the user confirms a mapping for a customer's format:

- Save it to a new `extraction_mapping_profiles` table:
  ```
  id, customer_name, file_pattern_hash, sheet_name, target_purpose,
  column_mapping (JSONB), created_by, last_used_at, hit_count
  ```
- On next upload from the same customer, hash the file's sheet structure (sheet names + column headers).
- If the hash matches a saved profile → skip Step 1 entirely. Apply mapping deterministically. **Zero AI cost.**
- If close-but-not-exact → propose the saved mapping, let user confirm/adjust.
- Profiles get more reliable as the system sees more uploads from that customer.

This is what makes the system scale to N customers without N× per-upload AI cost.

### Profile fingerprinting

`file_pattern_hash` = stable hash of:
- Set of sheet names (sorted)
- For each sheet: set of column headers (sorted)
- (Optionally) sample row patterns (e.g. "first column always alphanumeric with hyphens")

Customers tend to use stable templates internally, so the hash is stable across uploads. When their template changes, the hash differs → fall back to AI discovery.

## Phase 5 — Multi-format intake (later)

Once the profile system exists, accept other input shapes:

- **CSV** — same column-mapping flow, no sheet abstraction
- **PDF** — vision pass to extract a tabular structure; same mapping flow
- **Email body / text paste** — different prompt shape, but same standardized output
- **Per-row JSON** — direct mapping if keys match
- **Free-form description** — Claude tool-use with `add_article` / `add_consumption_row` tools

## Implementation order (when we resume)

1. **Phase 2 (1–2 days)** — refactor `extract-document` master_data path to two-step. New tool schema includes `column_mapping`. Delete the auto-collapse logic in `dedupeMasterData` once Phase 2 lands (the cause it was working around — same component_type for multiple parts — is fixed at the source).

2. **Phase 3 (2–3 days)** — File Feeder UI for confirming mappings. Shows proposed mapping after upload; user adjusts; backend re-extracts deterministically.

3. **Phase 4 (1 week)** — Migration `0010_extraction_mapping_profiles.sql`. RPCs for save / lookup / fingerprint. UI to manage profiles per customer.

4. **Phase 5 (ongoing)** — broaden file types; add tech_pack two-step extraction.

## Compatibility commitments

- The current schema (`articles`, `consumption_library`, `tech_packs`, etc.) does NOT change. Phases 2–4 are extraction-layer improvements only.
- Existing customers can keep using the BOB-format master-data XLSX; the fast-path keeps working.
- Existing `ai_extractions` rows remain valid — Phase 4 just adds an optional `mapping_profile_id` link.

## Cost model

| Phase | Per-upload AI cost | First-upload latency | Repeat-upload latency |
|---|---|---|---|
| Today (1-shot Sonnet) | ~$0.03–0.10 | 15–30 s | 15–30 s |
| Phase 2 (2-shot Haiku→Sonnet fallback) | ~$0.01–0.04 | 8–20 s | 8–20 s |
| Phase 4 with hit | $0 | 8–20 s (first time) | <1 s (deterministic) |

Direct savings + much faster repeated uploads from the same customer.

## Risks

- **Profile drift:** customer changes their template, system silently uses stale mapping. Mitigation: always show mapping summary on validation card; user can reject and re-discover. Also: re-fingerprint and require confirmation if column-set diff > 1.
- **Mapping over-confidence:** AI says 0.95 confidence on a wrong mapping. Mitigation: validator + per-row anomaly detector (already shipped) catches obvious wrongness even with high-confidence mappings.
- **Schema changes:** if MerQuant adds a new target field, all profiles need migration. Mitigation: versioned profiles; auto-trigger re-confirmation on schema bump.

---

This document is the design contract. Open it before resuming work; ship phases in order; don't skip ahead.
