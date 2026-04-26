# S12 — Tech-Pack Description Fallback for Planning Pages

## 1. Problem

`PackagingPlanning.jsx`, `TrimsPlanning.jsx`, and `AccessoryPlanning.jsx` seed planning rows
from `consumption_library` when no saved `accessory_items` exist for a PO article.  If a
`consumption_library` row exists but its `material` field is null or empty, the user sees a
blank description field and must type it in manually — even though the information exists in
the linked tech pack.

## 2. Goal

When `consumption_library` has no usable description for an article + category combination,
fall back to the extracted tech-pack data for that article.  Users should see pre-filled rows
without re-typing.  Existing rows with real `consumption_library` content must be unaffected.

## 3. Scope — this session (S12)

**In scope:**
- `src/lib/descriptionResolver.js` — new shared helper, full implementation
- `src/pages/PackagingPlanning.jsx` — wire helper, remove inline `seedFromMasterData`
- `tests/unit/descriptionResolver.test.js` — unit tests for the helper

**Out of scope (later sessions):**
- `TrimsPlanning.jsx` and `AccessoryPlanning.jsx` wiring (same helper, different chain length)
- UFMAS back-port
- UI or styling changes

## 4. Schema — no changes required

Path A selected: Packaging falls back to `consumption_library` only (chain length 1).
Trims and Accessory will use `consumption_library → tech_packs` (chain length 2) in later
sessions.  No migration needed.

### Relevant tables

**`consumption_library`** — master accessory specs, keyed by `item_code` + `component_type`.
Fields used: `material` (the "empty" sentinel), `size_spec`, `wastage_percent`.
Query filter: `kind = 'accessory'`.

**`tech_packs`** — one row per uploaded/extracted tech pack.
Linked to articles by: `tech_packs.article_code = articles.article_code` (both sides are
`UPPER(TRIM(...))` via `fn_normalize_item_code` trigger).  Secondary link:
`tech_packs.po_id = articles.po_id` (used only when article-code match fails).
Filter required: `extraction_status = 'extracted'`.

Fields used per category:
| Page | JSONB column | Key element fields |
|---|---|---|
| Packaging | *(none — Path A)* | — |
| Trims | `extracted_trim_specs` | `trim_type`, `description`, `size_spec`, `color` |
| Accessory | `extracted_accessory_specs` | `accessory_type`, `description`, `size_spec`, `color` |
| Accessory (labels) | `extracted_label_specs` | `label_type`, `description`, `size_spec`, `color` |

Note: `extracted_label_specs` is merged with `extracted_accessory_specs` for the `Label`
category in Accessory Planning (future session).  The `resolveDescription` API accepts an
optional `techPackLabelSpecs` param for this purpose.

## 5. "Empty" rule

```
isEmptyMaterial(row)  :=  row.material == null || row.material.trim() === ''
fallThrough(rows)     :=  rows.length === 0 || rows.every(isEmptyMaterial)
```

Only `material` is checked.  A row with empty `material` but non-empty `size_spec` still
triggers fall-through — `size_spec` without a description is not actionable.

When at least one `consumption_library` row has non-empty `material`, all matching rows for
that article+category are used (including any with empty `material`).  This preserves
deliberate "blank slot" rows a merchandiser may have created.

## 6. Article → tech pack resolution

Priority matches `explode_po_bom()` in `0001_init.sql`:
1. `tech_packs.article_code = articleCode` AND `extraction_status = 'extracted'`
2. `tech_packs.po_id = poId`              AND `extraction_status = 'extracted'`

`findTechPackForArticle({ articleCode, poId, techPacks })` implements this from a
pre-fetched array (no extra DB round-trip).

## 7. API surface — `src/lib/descriptionResolver.js`

```js
resolveDescription({ articleCode, tabCategory, cfg, masterSpecs, techPack, techPackLabelSpecs? })
// → object[]   — Packaging Planning row objects to seed
// → null        — caller renders defaultRow(cfg)

findTechPackForArticle({ articleCode, poId, techPacks })
// → object | null
```

Fallback chain is implicit in what the caller passes:
- Packaging:        techPack = null   → chain length 1 (consumption_library only)
- Trims/Accessory:  techPack = <row>  → chain length 2

## 8. PackagingPlanning.jsx changes

1. Add `useQuery` for `techPacks` (columns: `id, article_code, po_id,
   extracted_accessory_specs, extracted_trim_specs, extracted_label_specs`; filter:
   `extraction_status = 'extracted'`; limit 500).
2. Remove inline `seedFromMasterData` function (lines ~364–420).
3. Replace call site (line ~432) with:
   ```js
   const seeded = resolveDescription({
     articleCode: art.article_code,
     tabCategory: cfg.category,
     cfg,
     masterSpecs: masterAccessorySpecs,
     techPack: null,   // Path A: Packaging does not use tech-pack fallback
   });
   init[tab][art.id] = seeded ?? [defaultRow(cfg)];
   ```
4. Add `techPacks.length` to the `useEffect` dependency key (future-proofs the key even
   though techPack is passed as null for Packaging; removes need to touch the key again when
   Trims/Accessory are wired).

No other behavioral changes.  Save/load paths are untouched.

## 9. Unit tests — `tests/unit/descriptionResolver.test.js`

| # | Description | Expected |
|---|---|---|
| 1 | masterSpecs has non-empty `material` | returns master row; tech pack not consulted |
| 2 | masterSpecs row exists, `material` is `''` | falls through to tech pack |
| 3 | masterSpecs is empty array | falls through to tech pack |
| 4 | Both tiers empty/null | returns null |
| 5 | `techPack` is null (Path A / no extracted pack) | returns null without throwing |
| 6 | masterSpecs has mixed empty/non-empty `material` rows | uses all master rows (no fall-through) |
| 7 | `findTechPackForArticle` — article-code match beats po-id match | returns article-code match |
| 8 | `findTechPackForArticle` — no article-code match, po-id match exists | returns po-id match |
| 9 | `findTechPackForArticle` — no match at all | returns null |

## 10. Commit

```
feat(packaging): add descriptionResolver helper and wire tech-pack fallback to PackagingPlanning
```

Patch ships as `merquant-s12-techpack-description-fallback.zip`.

## 11. Definition of done

- [ ] `tests/unit/descriptionResolver.test.js` — all 9 cases pass (`npm run test`)
- [ ] Packaging Planning page loads without errors on a PO with no `consumption_library` data
- [ ] Packaging Planning page loads without errors on a PO with populated `consumption_library`
- [ ] No visible change to rows for articles that already had non-empty `material` in master data
- [ ] `git diff` reviewed and approved before commit
