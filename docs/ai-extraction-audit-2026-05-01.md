# AI Extraction Audit — 2026-05-01

Read-only inventory of every Claude / Anthropic surface in the MerQuant repo, written so the upcoming chatbot work doesn't duplicate it.

## 1. Edge functions that call Anthropic

| Function | File | Purpose | Model(s) | Tool / output |
|---|---|---|---|---|
| `extract-document` | `supabase/functions/extract-document/index.ts:171-509` | Upload XLSX/PDF/JPG/PNG/WEBP up to 10 MB, run BOB fast-path then Haiku→Sonnet fallback chain, persist to `ai_extractions`. Dedup on `file_hash` within 6 h. | Haiku 4.5 → Sonnet 4.6 (chain in `prompts.ts:25`) | Tool-use: `extract_tech_pack` or `extract_master_data` |
| `classify-components` | `supabase/functions/classify-components/index.ts:75-165` | Batch classifier (≤50 items) for accessory/trim/packaging into 11-type taxonomy. Used as fallback after keyword `componentClassifier.js`. | `claude-sonnet-4-6` (`index.ts:11`) | Plain-JSON: `{ classifications: [{id, component_type, confidence, reason}] }` |
| `extract-barcodes` | `supabase/functions/extract-barcodes/index.ts:175-241` | Unzips XLSX, sends embedded `xl/media/*` images to vision in one call, returns `{size, barcode}` pairs (BOB tech packs put UPCs as barcode images). | `claude-sonnet-4-6` (`index.ts:22`) | Plain-JSON: `{ results: [{image_index, size, barcode}] }` |
| `ai-proxy` | `supabase/functions/ai-proxy/index.ts:34-128` | Generic JWT-gated pass-through to `https://api.anthropic.com/v1/messages`. Default model `claude-sonnet-4-5` (`index.ts:83`). Used by `AIAssistant.jsx` and `src/lib/aiProxy.js`. | Caller-chosen | Returns Anthropic response verbatim |

Caching: `extract-document`, `classify-components`, `extract-barcodes` all set `cache_control: { type: "ephemeral" }` on the system block.

## 2. Frontend extraction surfaces

| Component | File | Role |
|---|---|---|
| `TryAIExtractionButton` | `src/components/shared/TryAIExtractionButton.jsx:30-88` | File picker → base64 → `supabase.functions.invoke("extract-document", …)` → navigate to `/AIExtractionReview?id=…`. Used by TechPacks (`TechPacks.jsx:1325`) and MasterDataImport (`MasterDataImport.jsx:766`). |
| `AIExtractionReview` (queue) | `src/pages/AIExtractionReview.jsx:64-234` | Lists `ai_extractions` rows, multi-select, bulk apply via `fn_apply_tech_pack_extraction` / `fn_apply_master_data_extraction`. |
| `AIExtractionReview` (detail) | `src/pages/AIExtractionReview.jsx:262-522` | Per-section tables with checkboxes, conflict pre-check (`p_dry_run=true`), inline reject dialog, `fn_reject_extraction`. |
| `SectionTable` + col defs | `src/pages/AIExtractionReview.jsx:610-767` | Renders any extracted section with validation badges and conflict highlights. |
| Barcode OCR retry | `src/pages/TechPacks.jsx:1119-1480` | Calls `extract-barcodes` directly to enrich an existing tech pack. Merge logic in `src/lib/barcodeOcrMerge.js`. |

Approval/rejection: page calls Supabase RPCs directly (no extra edge function in between).

## 3. Database glue

`ai_extractions` columns (`migrations/up/0002_ai_extractions.sql:11-62`): `id, kind('tech_pack'|'master_data'), prompt_version, model, file_name/mime/size_bytes/hash/storage_path, raw_llm_response (jsonb), extracted_data (jsonb), tokens_input/output, cost_usd, validation_status('pending'|'passed'|'warned'|'failed'|'skipped'), validation_issues (jsonb), review_status('pending_review'|'approved'|'partially_approved'|'rejected'|'superseded'), review_notes, applied_at/by, applied_target_ids (jsonb), rejected_at/by, rejection_reason, error_code/message, created_by, created_at, updated_at, org_id`. RLS: permissive `auth_all`. Storage bucket `ai-extraction-sources` is private.

| RPC | File:Lines | Effect |
|---|---|---|
| `fn_reject_extraction(uuid, text)` | `0003_ai_extraction_rpcs.sql:21-60` | Sets `review_status='rejected'`, stamps `rejected_by/at/rejection_reason`. Idempotent. |
| `fn_apply_tech_pack_extraction(uuid, text[])` | `0003_ai_extraction_rpcs.sql:69-205` | One INSERT into `tech_packs` per matched SKU. Sets `review_status` to `approved` or `partially_approved`. |
| `fn_apply_master_data_extraction(uuid, jsonb, boolean, boolean)` | `0003`+`0004_add_dry_run_to_apply_master_data.sql:12-470` | Conflict-scan then upsert into `articles`, `consumption_library`, `price_list`, `suppliers`, `seasons`, `production_lines`. `p_force=true` overwrites; `p_dry_run=true` returns conflicts only. |

All three RPCs are `SECURITY DEFINER`, granted to `authenticated`.

## 4. Prompt engineering

Prompts live at `supabase/functions/extract-document/prompts.ts`:

| Kind | Prompt version | Tool name | Required output keys |
|---|---|---|---|
| `tech_pack` | `tech_pack.v1` (`prompts.ts:13`) | `extract_tech_pack` (`prompts.ts:89`) | `skus[]` (each requires `item_code`), `_confidence.overall` |
| `master_data` | `master_data.v1` | `extract_master_data` (`prompts.ts:199`) | `_confidence.overall` |

Tech-pack tool (`prompts.ts:89-197`): `header{brand,product_type,product_no,product_name}`, `fabric_specs[]`, `skus[]{item_code, size, color, product_dimensions, insert_dimensions, pvc_bag_dimensions, stiffener_size, zipper_length, units_per_carton, carton_size_cm, is_set}`, `labels[]`, `accessories[]`, `packaging[]`, `zipper{length,type,color}`, `_confidence`, `_notes`.

Master-data tool (`prompts.ts:199-325`): `articles[]`, `fabric_consumption[]`, `accessory_consumption[]`, `carton_master[]`, `price_list[]`, `suppliers[]`, `seasons[]`, `production_lines[]`, `_confidence`, `_notes`. Each section's required keys are minimal (e.g. `articles` requires only `item_code`).

Shared `COMMON_RULES` (`prompts.ts:32-39`) enforces: never invent values, preserve item codes, numbers as numbers, use the tool. Confidence escalation threshold = 0.7 (`extract-document/index.ts:37`).

## 5. Classification & normalisation helpers

| File | Exports | What it does |
|---|---|---|
| `src/lib/componentClassifier.js` | `classifyComponent`, `classifyBatch`, `classifyWithAiFallback` (calls `classify-components` edge fn at line 512), `detectProductTypeFromCode`, `detectPolybagSkuMismatch`, `detectStiffenerSkuMismatch`, `detectAnySkuMismatch`, `CANONICAL_TYPES` | Keyword→11-type taxonomy with AI fallback when keyword confidence < 0.85. SKU-aware mismatch detection by product family. |
| `src/lib/fabricClassifier.js` | `FABRIC_TYPES`, `ACCESSORY_TYPES`, `isFabricComponent` | Fail-closed fabric vs accessory split for the Fabric Working Sheet. |
| `src/lib/headerNormalizer.js` | `normalizeHeaderKey`, plus `GLOBAL_ALIASES` and per-sheet alias overrides | Maps Title Case spreadsheet headers to canonical snake_case keys. |
| `src/lib/dimensionNormalizer.js` | `parseDimension` and canonicaliser | Canonicalises 2-D and 3-D dimension strings (smaller×larger×cm). |
| `src/lib/descriptionResolver.js` | (resolves planning rows from `consumption_library` then tech_pack JSONB) | Tab-category alias matching with non-category blacklist. |
| `src/lib/barcodeOcrMerge.js` | merger for `extract-barcodes` results onto tech_packs | — |
| `src/lib/validators/extractionValidator.js` | `validateExtraction(kind, data)` | Mirrored Deno copy at `supabase/functions/extract-document/extractionValidator.js` runs server-side. |

## 6. Existing chatbot-like UI

| Item | File:Lines | Status |
|---|---|---|
| `AIAssistant.jsx` | `src/pages/AIAssistant.jsx:349-569` | A working chatbot called "AI Programmer". Sends history to `ai-proxy`, model `claude-sonnet-4-5`, expects strict JSON `{type: sql\|react\|answer\|steps, …}`. Auto-runs SELECTs via `supabase.rpc("exec_sql")`, requires confirmation for writes. Role-gated: `AI_DATA_QUERY` to use, `AI_SYSTEM_EDIT` (Owner) for React/DDL. System prompt embeds the full DB schema (`AIAssistant.jsx:13-111`). |
| `src/lib/aiProxy.js` | `aiProxy.js:7-43` | Two helpers — `callClaude({system, messages, model, max_tokens, cacheSystem})` and `askClaude(prompt, system)`. Used by 14 files (POImport, EmailImport, fabric/packaging upload helpers, dashboard season planning, etc.) for one-off Claude calls — each is a domain-specific assistant, not a chat. |
| `QUICK_PROMPTS` in AIAssistant | `AIAssistant.jsx:113-124` | Ten preset queries (BOB summary, fabric usage, yarn requirements, price mismatches, accessory totals, CBM/cartons, payments, trims, generated React, DDL). |

There is no general-purpose "ask Claude about my ERP data" chatbot UI for non-developers — `AIAssistant.jsx` is positioned as a programmer-style SQL/React generator.

## TL;DR for the chatbot prototype

Reuse: `src/lib/aiProxy.js` (`callClaude`), the `ai-proxy` edge fn (already JWT-gated and key-protected), `ai_extractions` schema for any "save extraction" path, and `AIAssistant.jsx` as the visual / state-management template (input bar, message list, role gate, schema-in-system-prompt pattern). The schema dump in `AIAssistant.jsx:13-111` is already the most expensive part.

Avoid duplicating: BOB fast-path / Haiku-Sonnet fallback / file-format detection (all live in `extract-document`). Component / fabric classification (in `componentClassifier.js` + `classify-components`). Apply / reject of staged data (the three RPCs).
