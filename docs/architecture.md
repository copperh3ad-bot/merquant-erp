# MerQuant ERP — System Architecture

**Last verified:** 2026-05-06

This is the canonical reference for how MerQuant ERP is supposed to behave.
Code that contradicts this document is the bug, not the spec. When in doubt,
update the code to match this document; if a change to the document is
required, raise it deliberately and update both in the same commit.

---

## 1. Authentication & Access Control

- **Roles:** `Owner`, `Manager`, `Merchandiser`. Owner-only actions: delete
  extractions, approve users, manage assignments.
- **Per-customer RBAC:** every user is mapped to one or more customers via
  `user_customer_assignments`. `user_can_see_customer(text)` is the RLS gate;
  tables with a `customer` column enforce it.
- **Whitelist:** only emails in `signup_whitelist` can register.

## 2. AI Extraction Pipeline

**Flow:** upload → `extract-document` edge function → Claude (Haiku, falls
back to Sonnet) → JSON → validate → store in `ai_extractions` → review →
apply RPC writes to canonical tables.

**Auto-split (master-data XLSX > 60k chars).** Client-side XLSX is parsed and
each sheet uploaded as a separate sibling extraction sharing one `batch_id`
(UUID). Avoids Supabase's 150s wall-clock cap.

**Validation severities.**
- `passed` — no issues.
- `warned` — warnings only, can apply.
- `failed` — has errors, RPC refuses.

**Duplicate handling.**
- **Exact-content duplicates** (same data across all fields):
  `DUPLICATE_KEY_EXACT` at WARN — auto-collapsed by dedup.
- **Key-only duplicates** (same composite key, different consumption /
  wastage): `DUPLICATE_KEY` at ERROR — likely AI miscategorisation; needs
  human fix.

**Dedup (`masterDataDedup.js`).**
- Fabric key: `(item_code, component_type, color)`.
- Accessory key: `(item_code, category, material, item_name)` — five cols
  since migration 0024.
- Exact dups silently collapse to one row. Key-only dups keep first row +
  flag for user review (never auto-sum — caused data loss in May 2026).

## 3. Apply RPCs

### `fn_apply_master_data_extraction`

Refuses if:
- extraction not found,
- `kind ≠ master_data`,
- already applied,
- `review_status` not in `(pending_review, partially_approved)`,
- `validation_status = 'failed'`,
- `p_row_filter` empty.

**Conflict pre-check:** rows clashing with existing keys returned in
`conflicts`. Apply blocks unless `p_force=true`.

**Writes to:**
- `articles`,
- `consumption_library` (kind in `fabric` / `accessory`),
- `price_list` (carton + price merged on `item_code`),
- `suppliers`,
- `seasons`,
- `production_lines`.

**Persists** `placement`, `supplier`, `item_name` on accessory rows.

### `fn_apply_tech_pack_extraction`

Writes `extracted_data` shards to `tech_packs.extracted_*` columns:
- `header` → `extracted_header`
- `skus` → `extracted_skus`
- `fabric_specs` → `extracted_fabric_specs`
- `trims` → `extracted_trim_specs` (was wrongly mapped to packaging until
  migration 0021)
- `accessories ∪ packaging` → `extracted_accessory_specs` (merged)
- `zipper` → `extracted_construction`

## 4. PO Pipeline

- **PO import — SKU matching:** uses **normalisation only** (case +
  whitespace + dashes + base-SKU variant strip). **No fuzzy / Levenshtein** —
  caused false matches like `FRIOMP36 ↔ GPFRIOMP36`.
- **Explosion:** `explode_po_bom` reads `tech_packs.extracted_*_specs` to
  populate `trim_items`, `accessory_items`, `fabric_orders` for each PO line.
- **Cascading delete:** deleting a PO cascades through `po_items`,
  `po_item_sizes`, `accessory_items`, `trim_items`, `fabric_orders`,
  `accessory_purchase_orders`, `bom_explosion_log`, `batch_items`,
  `po_batches`, `po_change_log`.

## 5. Category Resolution (`descriptionResolver.js`)

**Aliases match loosely** via `matchesCategory`:

- **Trim:** thread, sewing thread, stopper, cord lock, cord stopper, elastic,
  cord, metal stopper.
- **Label:** brand label, care label, size label, wash label, hang tag.
- **Insert Card / Polybag / Carton / Sticker / Stiffener / Barcode / etc.**

**Exclusions (`CATEGORY_EXCLUSIONS`):**
- Label excludes sticker, barcode, qr code.
- Stiffener excludes carton.

## 6. Dimension Handling

- `isMultiSizeBlob()` detects strings like
  `"Varies by size: 33X33X32 (Twin XL); 40X40X32 (Full)"` and refuses to
  write into per-article columns.
- **Carton-size lookup:** `cartonSizeMap` keyed by `article_code`, formatted
  (decimal-stripped). Existing rows showing a blob get rewritten:
  `description ← item_description`, `size ← cartonSizeMap[article_code]`.

## 7. Packaging Planning Rules

- **Empty rows:** `rowHasContent()` requires non-default content. Empty rows
  with `existing_id` get a `DELETE` op.
- **Tabs filter** by `matchesCategory` (loose).
- **Sewing Thread banner** on Trim tab aggregates threads from `tech_packs`.
- **Summary key:** `(category, item_description, size_spec, color, placement,
  supplier, garment_size)` — per-garment-size breakdown for size-specific
  items (e.g. size labels).
- **Fabric Bag:** *pending* — to be omitted from accessories when present as
  a fabric component.

## 8. DB Uniqueness Constraints

- `consumption_library.upsert_key` UNIQUE: `(item_code, kind, component_type,
  color, material, item_name)` — six cols since migration 0024.
- `articles.article_code`, `price_list.item_code`, `suppliers.name`,
  `seasons.name`, `production_lines.name` — single-column UNIQUE.

## 9. Operational Defaults

- All money in **USD**.
- Suppliers default to `status='Active'`.
- Production lines default to `line_type='stitching'`.
- Price list rows: `pricing_status` flips to `active` when `price_usd` is
  non-null, else `pending`.
- Carton CBM auto-computed from `L × W × H / 1,000,000` (cm → m³).

## 10. Safety / Recovery

- Daily backups (set during commercial deployment prep).
- `rejected_at`, `rejection_reason` preserved on extractions instead of
  hard-deleting.
- Owner-only delete on AI extraction queue.
- Migrations are idempotent (`IF NOT EXISTS` everywhere).
