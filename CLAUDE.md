# Claude Resume File — MerQuant ERP
<!-- Last updated: 2026-05-12 · Branch: feat/mega-prompt-integration -->

## Project overview
React + Vite SPA backed by Supabase (project `jcbxmpgjirxqszodotmx`).
Never touch the MAS project (`ecjqdyruwqlesfthgphv`) — separate system.
Owner: Waqas Ahmed, GM Union Fabrics.

## Current branch
`feat/mega-prompt-integration`

---

## What was just completed (2026-05-12)

### Code changes (not yet deployed)
| File | What changed |
|------|-------------|
| `src/modules/materials/pages/FabricWorking.jsx` | 15 edits: null fabric_type grouping fix, `dataWarnings` banner, `byTechPackId` map, Layer 1.5 direct tech-pack lookup, Layer 4 base-code fallback in `resolveDims`, wastage display fixes, skipped-codes reporting in `handleRefreshFromTechPacks` |
| `src/lib/featureFlags.js` | Added `ENABLE_MASTER_DATA_GAPS_BANNER` flag |
| `src/modules/orders/pages/Dashboard.jsx` | Added master data gaps banner (red) — queries `consumption_library` for fabric components with null `consumption_per_unit` |

### DB fixes applied (already live in Supabase)
1. **Wastage decimal bug** — `consumption_library` (460 rows) and `articles.components` JSON (14 articles): all `wastage_percent < 1` multiplied ×100. Convention is whole percentages (6, 15, 20), formula is `× (1 + wastage_percent / 100)`.
2. **GPFRIOMP fabric_type** — corrected to `COOLING NYLON` on all po_items across all POs (was wrongly set to `Terry`).
3. **Purecare PO fabric_type** — 33 blank rows filled on D711653-001, D711656-001, D711662-001 using item-code pattern mapping.
4. **PCSJMO-SPK tech_pack_id** — linked to PCSJMO-SK tech pack (`0243eb5d-8d17-48c3-b706-6ea91414da73`). Dimension resolution uses Layer 1.5 direct bypass.
5. **PCSJMO-SHCK tech_pack_id** — linked to PCSJMO-SHC tech pack (`8ab1b69c-d015-44a5-bad4-d4eae6fd80e3`).
6. **GPFRIOPPK Front width** — set to 210cm in `consumption_library` and `articles.components`.

---

## Outstanding items (next session pick up from here)

### P1 — Needs a value from Waqas
- **GPFRIOPPK Front `consumption_per_unit`** is still NULL in `consumption_library` and `articles.components`. Dashboard red banner will show until this is filled. Queen (GPFRIOPPQ) is 0.55m @ 210cm width. Ask Waqas for the King value.
  - SQL to apply once value is known:
    ```sql
    UPDATE consumption_library
    SET consumption_per_unit = <VALUE>
    WHERE item_code = 'GPFRIOPPK' AND component_type = 'Front';

    UPDATE articles
    SET components = (
      SELECT jsonb_agg(
        CASE
          WHEN comp->>'fabric_type' = '140gsm - 100% Nylon mica fiber jersey knitted fabric'
          THEN comp || jsonb_build_object('consumption_per_unit', <VALUE>)
          ELSE comp
        END ORDER BY ordinality
      )
      FROM jsonb_array_elements(components) WITH ORDINALITY AS t(comp, ordinality)
    )
    WHERE article_code = 'GPFRIOPPK';
    ```

### P2 — Needs tech pack uploads
- **GPMP33–GPMP80** (Wick Away Mattress Protectors) — no tech packs uploaded, articles on D711661-001 have blank dimensions and no BOM
- **GPTE33–GPTE80** (Wick Away Encasements) — same, on D711661-001
- **GPSE33–GPSE50** (Sleeper Encasements) — same, on D711703-001
- **MFRM-\*** (Memory Foam sheet sets) — no tech packs, articles are orphaned (po_id = NULL)
- **MBSHMSB3** — orphaned article, no PO
  - After upload: run "Refresh from Tech Packs" on the affected POs in Fabric Working

### P3 — Waqas to upload PO
- ~26 orphaned articles (MFRM, GPMP, GPTE templates with po_id = NULL) — Waqas said he will upload the PO; once done link these articles: `UPDATE articles SET po_id = '<new_po_id>' WHERE article_code ILIKE 'MFRM%' AND po_id IS NULL;`
- PCSJMOPC color variants (6 orphaned) — same pattern, need a PO assigned

### P4 — Low priority / hygiene
- `po_items.gsm` and `po_items.width` columns are always NULL — decide if they should be populated going forward or dropped
- 131/176 consumption_library components have `wastage_percent = 0` — review if any sheet/shell fabric should have non-zero wastage

---

## Key architecture notes

### Dimension resolution in FabricWorking.jsx (`resolveDims`)
Layers in order:
1. Component-level `dimensions` override
2. Article-level `product_dimensions` override
**1.5** `article.tech_pack_id` direct lookup via `byTechPackId` map ← added this session
3. `byItemCode` (exact article_code match)
4. `byCodeSize` (article_code + size match)
**4** Base-code fallback via `getBaseCode()` strips color suffix (CG/MB/WH/NG/BL/GR/RD/BK) ← added this session
5. Family size scan (`resolveByFamilySize`)

### Wastage convention
- Stored as whole percentage integer (6 = 6%, 15 = 15%, 20 = 20%)
- Formula: `net * (1 + wastage_percent / 100)`
- Do NOT store as decimal (0.06) — that was the bug, now fixed

### Fabric Bag (cpu = 0)
Intentional. Self-fabric bag is cut from cutting wastage allowance, not from a separate fabric order. cpu = 0 on the Fabric Bag component is correct and should not be flagged.

### Feature flags
All flags in `src/lib/featureFlags.js`. All default ON. Disable per-session:
```js
localStorage.setItem('mq_flag_<key>', 'off')
```
Current flags: `unapply_extraction`, `bom_blocked_ui`, `data_gaps_banner`, `price_backfill`, `upload_error_log`, `master_data_gaps_banner`

### Supabase tables touched this session
- `consumption_library` — wastage fix, fabric_type fix, GPFRIOPPK width fix
- `articles` — wastage fix in components JSON, PCSJMO-SPK/SHCK tech_pack_id
- `po_items` — fabric_type fill for D711653/656/662 and COOLING NYLON for all GPFRIOMP items
