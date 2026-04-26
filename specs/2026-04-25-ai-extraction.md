# Spec: Unified AI-driven extraction pipeline for tech packs and master data

> **Spec ID:** 2026-04-25-ai-extraction
> **Status:** Draft
> **Owner:** Waqas
> **Related:** `CLAUDE_CODE_AI_EXTRACTION_PROMPT.md` (implementation playbook, not in repo); `src/lib/bobTechPackParser.js` (replaced by this); `src/pages/MasterDataImport.jsx` (parallel AI path added alongside); `src/lib/validators/masterDataValidator.js` (extended); existing `supabase/functions/ai-proxy` (model conventions reused)

---

## 1. Problem statement

Onboarding new buyers is blocked because tech-pack extraction and master-data import are tied to one buyer's XLSX schema. `bobTechPackParser.js` parses BOB's specific four-sheet layout via `parseBobTechPack`, called from `src/pages/TechPacks.jsx:793`. `MasterDataImport.jsx` requires a buyer-formatted "BOB master data" XLSX. Any other buyer's tech pack or master data file — different sheet names, PDF, photo, freeform — cannot be ingested without writing a new parser. After this spec ships there is one server-side AI extraction path, parameterised by `kind`, that accepts XLSX (v1) and produces a normalised JSON payload landing in a new `ai_extractions` audit table. A mandatory review UI gates every DB write; nothing flows automatically. The existing BOB XLSX parser and the existing browser-side AI call at `TechPacks.jsx:981` stay in place — cutover is a separate post-ship task.

## 2. Non-goals

- **org_id rollout.** `org_id` on `ai_extractions` is added as nullable now and ignored by RLS; multi-tenant enforcement ships in its own spec.
- **PDF, image, or text input.** v1 accepts XLSX only. Other modalities deferred to v2.
- **Auto-write for "high confidence" rows.** Every applied row requires explicit user approval, even if validation comes back clean.
- **Cutover of the existing browser-side AI call** at `src/pages/TechPacks.jsx:981`. Build the new edge-function path alongside; switch in a separate session.
- **Removal of `bobTechPackParser.js`.** Stays as the fast path for buyers whose XLSX matches the BOB schema; deprecation is a separate decision once the AI path proves out.
- **Per-buyer prompt fragments.** Single prompt per `kind` for v1. Hooks left in `prompts.ts`; per-buyer composition deferred.
- **`master_articles_history` snapshots on apply.** Out of scope; revisit when audit-trail requirements firm up.
- **Replay tooling.** Raw LLM responses are stored on `ai_extractions` so future replay is possible; UI/CLI to drive it is deferred.
- **Integration tests.** No Supabase test project exists; integration coverage is acknowledged as a gap (see §8).

## 3. Schema diff

Two migrations. Each ships with a matching down migration.

```sql
-- migrations/up/0002_ai_extractions.sql

create extension if not exists "pgcrypto";

create table public.ai_extractions (
  id              uuid        primary key default gen_random_uuid(),
  kind            text        not null check (kind in ('tech_pack', 'master_data')),
  prompt_version  text        not null,                 -- e.g. 'tech_pack.v1'
  model           text        not null,                 -- e.g. 'claude-sonnet-4-5'
  -- source file
  file_name       text        not null,
  file_mime       text        not null,
  file_size_bytes integer     not null check (file_size_bytes > 0),
  file_hash       text        not null,                 -- sha256 hex of raw bytes
  storage_path    text        not null,                 -- ai-extraction-sources/<id>/<file_name>
  -- llm round trip
  raw_llm_response jsonb,                               -- full Anthropic response, null if request failed pre-LLM
  extracted_data   jsonb,                               -- normalised payload, shape per kind (see §5)
  tokens_input     integer,
  tokens_output    integer,
  cost_usd         numeric(10,4),
  -- validation
  validation_status text not null default 'pending'
    check (validation_status in ('pending','passed','warned','failed','skipped')),
  validation_issues jsonb not null default '[]'::jsonb, -- array of {severity, code, path, message, suggestion}
  -- review
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review','approved','partially_approved','rejected','superseded')),
  review_notes  text,
  -- apply
  applied_at         timestamptz,
  applied_by         uuid,
  applied_target_ids jsonb,        -- {tech_packs:[uuid,...]} or {articles:[item_code,...], fabric_consumption:[...]}
  -- rejection
  rejected_at      timestamptz,
  rejected_by      uuid,
  rejection_reason text,
  -- failure (extraction itself errored)
  error_code    text,
  error_message text,
  -- audit
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- multi-tenant placeholder; nullable until org_id rollout ships
  org_id     uuid
);

comment on column public.ai_extractions.org_id is
  'Nullable placeholder until org_id rollout ships; RLS does not enforce on this column yet.';

create index ai_extractions_kind_idx           on public.ai_extractions (kind);
create index ai_extractions_review_status_idx  on public.ai_extractions (review_status);
create index ai_extractions_created_at_idx     on public.ai_extractions (created_at desc);
create index ai_extractions_file_hash_idx      on public.ai_extractions (file_hash);
create index ai_extractions_created_by_idx     on public.ai_extractions (created_by);

-- updated_at trigger (mirrors existing convention in 0001_init.sql)
create trigger ai_extractions_set_updated_at
  before update on public.ai_extractions
  for each row execute function public.fn_set_updated_at();

-- storage bucket: private, 90-day lifecycle
insert into storage.buckets (id, name, public)
  values ('ai-extraction-sources', 'ai-extraction-sources', false)
  on conflict (id) do nothing;

-- 90-day retention enforced by scheduled job (see §10); not by storage policy
```

```sql
-- migrations/down/0002_ai_extractions.sql
drop trigger if exists ai_extractions_set_updated_at on public.ai_extractions;
drop table if exists public.ai_extractions;
delete from storage.buckets where id = 'ai-extraction-sources';
```

```sql
-- migrations/up/0003_ai_extraction_rpcs.sql
-- See §5 for full function bodies.
create or replace function public.fn_apply_tech_pack_extraction(
  p_extraction_id uuid,
  p_sku_codes     text[]
) returns jsonb language plpgsql security definer set search_path = public as $$ ... $$;

create or replace function public.fn_apply_master_data_extraction(
  p_extraction_id uuid,
  p_row_filter    jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$ ... $$;

create or replace function public.fn_reject_extraction(
  p_extraction_id uuid,
  p_reason        text
) returns jsonb language plpgsql security definer set search_path = public as $$ ... $$;

grant execute on function public.fn_apply_tech_pack_extraction(uuid, text[])  to authenticated;
grant execute on function public.fn_apply_master_data_extraction(uuid, jsonb) to authenticated;
grant execute on function public.fn_reject_extraction(uuid, text)             to authenticated;
```

```sql
-- migrations/down/0003_ai_extraction_rpcs.sql
drop function if exists public.fn_apply_tech_pack_extraction(uuid, text[]);
drop function if exists public.fn_apply_master_data_extraction(uuid, jsonb);
drop function if exists public.fn_reject_extraction(uuid, text);
```

## 4. RLS diff

Permissive `auth_all` matching the codebase default. `org_id` is recorded but not enforced — the column exists for the future org_id rollout to gate on without a follow-up migration.

```sql
alter table public.ai_extractions enable row level security;

create policy ai_extractions_select on public.ai_extractions
  for select to authenticated using (true);

create policy ai_extractions_insert on public.ai_extractions
  for insert to authenticated with check (true);

create policy ai_extractions_update on public.ai_extractions
  for update to authenticated using (true) with check (true);

create policy ai_extractions_delete on public.ai_extractions
  for delete to authenticated using (true);
```

Storage RLS (bucket `ai-extraction-sources`):

```sql
create policy ai_extraction_sources_select on storage.objects
  for select to authenticated
  using (bucket_id = 'ai-extraction-sources');

create policy ai_extraction_sources_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ai-extraction-sources');

create policy ai_extraction_sources_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'ai-extraction-sources');
```

No update policy on storage objects — sources are write-once.

## 5. RPC contract

### 5.1 Edge function: `extract-document`

`POST /functions/v1/extract-document`. CORS allow-list mirrors `ai-proxy`. Calls Anthropic via raw `fetch` (no SDK in Deno; consistent with `ai-proxy/index.ts`). Reads `ANTHROPIC_API_KEY` via `Deno.env.get`.

Steps inside the function:
1. Verify caller has a valid `Authorization: Bearer <jwt>` header (Supabase verifies via `--no-verify-jwt` is **not** set when deployed).
2. Parse body. Reject with `EXTRACTION_KIND_INVALID` if `kind` not in `('tech_pack','master_data')`.
3. Reject with `EXTRACTION_FILE_TOO_LARGE` if `file_size_bytes > 10 * 1024 * 1024` (10 MB).
4. Decode base64, compute `sha256` hex hash.
5. Lookup `ai_extractions` where `file_hash = <hash> AND review_status not in ('rejected','superseded')`. If found within 6 h, return `EXTRACTION_DUPLICATE` with the existing `extraction_id`.
6. Upload bytes to `ai-extraction-sources/<new-uuid>/<file_name>`.
7. Insert `ai_extractions` row with `validation_status='pending'`, `review_status='pending_review'`.
8. Parse XLSX with SheetJS. If parse throws, set `error_code='EXTRACTION_PARSE_FAILED'`, return failure (row stays for review).
9. Build prompt per `kind` (constants in `supabase/functions/extract-document/prompts.ts`). System prompt is static per `kind+version` and benefits from prompt-cache control headers; user prompt carries the parsed XLSX text.
10. Call Anthropic `messages` endpoint with `tool_use` for structured output. Tool schema is the JSON shape in §5.4 / §5.5.
11. On non-2xx or no `tool_use` block, set `error_code='EXTRACTION_LLM_ERROR'` (or `EXTRACTION_LLM_INVALID_JSON`), return failure.
12. Persist `raw_llm_response`, `extracted_data`, `tokens_input/output`, `cost_usd`.
13. Run server-side validator (§6). Set `validation_status` and `validation_issues`.
14. Return success envelope.

**Request body:**
```json
{
  "kind": "tech_pack",
  "file_name": "BUYER_X_techpack_apr.xlsx",
  "file_mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "file_size_bytes": 84321,
  "file_base64": "UEsDBBQA..."
}
```

**Response (success):**
```json
{
  "ok": true,
  "extraction_id": "uuid",
  "validation_status": "passed",
  "summary": { "rows_extracted": 12, "errors": 0, "warnings": 1 }
}
```

**Response (error):**
```json
{
  "ok": false,
  "code": "EXTRACTION_FILE_TOO_LARGE",
  "user_message": "This file is larger than 10 MB. Please save a smaller version and try again.",
  "dev_detail": "received 12482931 bytes; limit 10485760"
}
```

### 5.2 RPC: `fn_apply_tech_pack_extraction`

```sql
fn_apply_tech_pack_extraction(p_extraction_id uuid, p_sku_codes text[])
  returns jsonb
  security definer
```

Idempotent. If `applied_at` is set, returns the existing `applied_target_ids` and `code='APPLY_ALREADY_APPLIED'` (200, not an error). Otherwise:
- Loads `extracted_data` from `ai_extractions` where `kind='tech_pack'`, `review_status in ('pending_review','partially_approved')`, `validation_status in ('passed','warned')`.
- For each SKU in `extracted_data.skus` whose `item_code` is in `p_sku_codes`, inserts one `tech_packs` row mirroring the field mapping currently in `TechPacks.jsx:841-929` (fabric specs filtered by `componentApplies`, etc.).
- Updates `applied_at`, `applied_by = auth.uid()`, `applied_target_ids = {"tech_packs":[...]}`.
- Sets `review_status = 'approved'` if all SKUs were applied, else `'partially_approved'`.

Input:
```json
{ "p_extraction_id": "uuid", "p_sku_codes": ["PCSJMO-T-WH","PCSJMO-T-BL"] }
```
Output (success):
```json
{ "ok": true, "applied_target_ids": { "tech_packs": ["uuid","uuid"] }, "review_status": "approved" }
```
Output (error):
```json
{ "ok": false, "code": "APPLY_NOT_REVIEWABLE", "user_message": "This extraction can no longer be applied.", "dev_detail": "review_status=rejected" }
```

### 5.3 RPC: `fn_apply_master_data_extraction`

```sql
fn_apply_master_data_extraction(p_extraction_id uuid, p_row_filter jsonb)
  returns jsonb
  security definer
```

Same idempotency rules. `p_row_filter` shape:
```json
{
  "articles":             ["PCSJMO-T-WH", "PCSJMO-T-BL"],
  "fabric_consumption":   [{"item_code":"PCSJMO-T-WH","component_type":"shell","color":"white"}],
  "accessory_consumption":[{"item_code":"PCSJMO-T-WH","category":"label","material":"satin"}],
  "carton_master":        ["PCSJMO-T-WH"],
  "price_list":           ["PCSJMO-T-WH"],
  "suppliers":            ["Sample Supplier Ltd"]
}
```
Each section is optional; omitting a section means "do not apply rows from that sheet". Each entry is matched against the corresponding row in `extracted_data` by upsert key (matching the keys used by `MasterDataImport.jsx` — see `masterDataValidator.js:34-57`).

Per-sheet upsert behaviour (`insert ... on conflict do update`) mirrors the existing importer. `applied_target_ids` is keyed by sheet name.

Input/Output envelopes follow the same `{ok, code, user_message, dev_detail}` shape as §5.2.

### 5.4 Extracted data shape — `kind='tech_pack'`

```json
{
  "header": {
    "brand": "string|null",
    "product_type": "string|null",
    "product_no": "string|null",
    "product_name": "string|null"
  },
  "fabric_specs": [
    { "component_type":"shell", "fabric_type":"poly", "gsm":110, "color":"white", "construction":"woven", "finish":"laminated" }
  ],
  "skus": [
    {
      "item_code":"PCSJMO-T-WH",
      "size":"Twin",
      "color":"white",
      "product_dimensions":"39x75",
      "insert_dimensions":null,
      "pvc_bag_dimensions":null,
      "stiffener_size":null,
      "zipper_length":null,
      "units_per_carton":12,
      "carton_size_cm":"60x40x35",
      "is_set":false
    }
  ],
  "labels":      [{ "section":"main", "type":"woven", "material":"...", "size":"...", "color":"...", "placement":"..." }],
  "accessories": [{ "accessory_type":"...", "description":"...", "material":"...", "placement":"...", "source_label":"..." }],
  "packaging":   [{ "variant":"...", "category":"...", "label":"...", "value":"..." }],
  "zipper":      { "length":"...", "type":"...", "color":"..." },
  "_confidence": { "overall": 0.0, "per_section": { "header":0.0, "skus":0.0 } },
  "_notes":      "string"
}
```

### 5.5 Extracted data shape — `kind='master_data'`

Mirrors the eight-sheet structure of `MasterDataImport.jsx`. Each section is an array of row objects with the same column names as the existing importer expects:

```json
{
  "articles":               [{ "item_code":"...", "brand":"...", "product_type":"...", "size":"..." }],
  "fabric_consumption":     [{ "item_code":"...", "component_type":"...", "color":"...", "fabric_type":"...", "gsm":110, "width_cm":150, "consumption_per_unit":1.2, "wastage_percent":0.06 }],
  "accessory_consumption":  [{ "item_code":"...", "category":"...", "item_name":"...", "material":"...", "size_spec":"...", "placement":"...", "consumption_per_unit":1 }],
  "carton_master":          [{ "item_code":"...", "units_per_carton":12, "carton_length_cm":60, "carton_width_cm":40, "carton_height_cm":35 }],
  "price_list":             [{ "item_code":"...", "price_usd":4.20, "effective_from":"YYYY-MM-DD" }],
  "suppliers":              [{ "name":"...", "contact_email":"...", "contact_phone":"..." }],
  "seasons":                [{ "name":"...", "start_date":"YYYY-MM-DD", "end_date":"YYYY-MM-DD" }],
  "production_lines":       [{ "name":"...", "line_type":"...", "daily_capacity":1200 }],
  "_confidence": { ... },
  "_notes": "string"
}
```

## 6. Validation rules

Server-side, runs inside `extract-document` after the LLM returns and before persisting `validation_status`. Implemented in `src/lib/validators/extractionValidator.js` (importable from both Deno edge function and Vitest unit tests; pure JS, no React).

Reuses `findDuplicates`, `requireField`, `requireNumericRange`, and `isNoteOnlyRow` from `masterDataValidator.js`. Output shape matches: `{severity:"error"|"warn"|"info", code, path, message, suggestion}` (with `path` replacing `sheet`+`row` — e.g. `"skus[2].item_code"` for tech-pack, `"articles[5].item_code"` for master-data).

Severity → `validation_status` mapping:
- Any `error` → `failed`. Apply RPCs reject (`APPLY_VALIDATION_FAILED`).
- No `error`, ≥1 `warn` → `warned`. Apply RPCs allow.
- No `error`, no `warn` → `passed`. Apply RPCs allow.
- LLM call did not run (parse failed / quota / timeout) → `skipped`. Row stays for human review; no apply path.

### 6.1 `kind='tech_pack'` rules

- `header.product_no`: warn if missing (extraction usable but harder to deduplicate).
- `skus`: error if empty array.
- For each SKU: `item_code` required (error); `size` required (error); `units_per_carton` numeric range 1–500 (warn if outside).
- `fabric_specs[].gsm`: numeric range 20–500 (warn).
- `fabric_specs[].width_cm`: numeric range 50–400 (warn).
- Duplicate `skus[].item_code`: error.
- `_confidence.overall < 0.4`: warn ("low LLM confidence — review carefully").

### 6.2 `kind='master_data'` rules

For each present section, reuse the corresponding `validateXxx` from `masterDataValidator.js`, with the section-name remap:
- `articles`              → `validateArticles`
- `fabric_consumption`    → `validateFabricConsumption`
- `accessory_consumption` → `validateAccessoryConsumption`
- `carton_master`         → `validateCartonMaster`
- `price_list`            → `validatePriceList`
- `suppliers`             → `validateSuppliers`

`validateCrossSheet` runs over the assembled section map. `seasons` and `production_lines` get `requireField` checks for their required columns (no per-sheet validator exists today; one is added in `extractionValidator.js`).

The validator is invoked via a thin adapter that converts the AI shape to `{ "1. Articles (SKUs)": rows, ... }` so existing functions are reused as-is.

## 7. User-facing error strings

| Code | user_message | dev_detail |
|---|---|---|
| `EXTRACTION_NO_FILE` | No file was uploaded. Please choose a file and try again. | request body had no file_base64 |
| `EXTRACTION_FILE_TOO_LARGE` | This file is larger than 10 MB. Please save a smaller version and try again. | size > 10485760 bytes |
| `EXTRACTION_KIND_INVALID` | Unknown extraction type — please pick "Tech pack" or "Master data". | kind not in ('tech_pack','master_data') |
| `EXTRACTION_DUPLICATE` | This file was already uploaded recently. Open the existing extraction to review it. | hash match within 6h; existing extraction_id returned |
| `EXTRACTION_PARSE_FAILED` | We couldn't read this XLSX file. It may be corrupt or password-protected. | sheetjs threw: \<message\> |
| `EXTRACTION_LLM_TIMEOUT` | The AI took too long to respond. Please try again in a minute. | fetch aborted at 60s |
| `EXTRACTION_LLM_ERROR` | The AI service returned an error. Please try again, or contact support if it keeps happening. | Anthropic returned status \<n\>: \<body\> |
| `EXTRACTION_LLM_INVALID_JSON` | The AI couldn't produce a structured result for this file. Please review the raw output or try a clearer source. | tool_use block missing or invalid |
| `EXTRACTION_VALIDATION_FAILED` | The extracted data has problems that block import. Open the review screen to see the details. | validation_status=failed; N errors |
| `APPLY_NOT_REVIEWABLE` | This extraction can no longer be applied. | review_status in ('rejected','superseded') |
| `APPLY_ALREADY_APPLIED` | These rows are already imported. | applied_at is not null |
| `APPLY_VALIDATION_FAILED` | This extraction has blocking errors and can't be imported. Fix the source file or reject this extraction. | validation_status=failed |
| `APPLY_NO_ROWS_SELECTED` | No rows were selected — please tick at least one row to import. | p_sku_codes/p_row_filter empty |
| `APPLY_TARGET_CONFLICT` | One of the rows clashes with existing data. See details on the row. | unique-violation on \<table\>.\<keys\> |

## 8. Test cases

### Unit tests (`tests/unit/extractionValidator.test.js`)

1. tech-pack with empty `skus[]` → one `error` with code matching missing-required pattern; `validation_status` would map to `failed`.
2. tech-pack SKU with no `item_code` → `error` at `path="skus[N].item_code"`.
3. tech-pack with two SKUs sharing `item_code` → duplicate error.
4. tech-pack `_confidence.overall = 0.2` → one `warn`, no `error`.
5. tech-pack `fabric_specs[].gsm = 800` → `warn` (out of range).
6. master_data with no sections present → `passed` (no rows means nothing to validate).
7. master_data with `articles[]` row missing `item_code` → `error`.
8. master_data with duplicate `articles.item_code` → `error`.
9. master_data with `fabric_consumption[]` row referencing item_code not in `articles[]` → `warn` (orphan).
10. master_data with `accessory_consumption.consumption_per_unit = 200` → `warn`.
11. Adapter: AI shape → `validateMasterData` keys round-trip with the same issue counts as the equivalent direct call.

### Unit tests (`tests/unit/extractionPrompts.test.js`)

12. `buildPrompt('tech_pack', 'v1', xlsxText)` returns a string containing the expected schema instruction; snapshot test detects accidental drift.
13. `buildPrompt('master_data', 'v1', xlsxText)` same as above.
14. Unknown `kind` throws.

### DB tests (`tests/db/ai_extractions.sql`)

15. `insert into ai_extractions (... minimal fields ...)` succeeds and `created_at`, `id`, `validation_status='pending'`, `review_status='pending_review'` are defaulted.
16. `update ... set ...` bumps `updated_at`.
17. `insert ... values (... kind='other' ...)` rejected by check constraint.
18. `fn_apply_tech_pack_extraction` on an extraction with `validation_status='failed'` returns `{ok:false, code:'APPLY_VALIDATION_FAILED'}`.
19. `fn_apply_tech_pack_extraction` on an already-applied extraction returns `{ok:true, code:'APPLY_ALREADY_APPLIED', applied_target_ids:<previous>}` and does not insert a second copy.
20. `fn_apply_tech_pack_extraction` happy path: inserts N tech_packs rows where N = count(p_sku_codes), sets `applied_at`, sets `review_status='approved'` when N matches all SKUs.
21. `fn_apply_master_data_extraction` happy path: upserts rows into the right tables; `applied_target_ids` records keys per table.
22. `fn_reject_extraction` sets `review_status='rejected'`, `rejection_reason`, `rejected_by=auth.uid()`.
23. RLS smoke: `select` and `insert` succeed for any authenticated user; anon role denied.

### Integration tests

**Acknowledged gap.** No Supabase test project is provisioned, so end-to-end runs of the edge function against a real Anthropic key are not part of this spec. When a test project is created, integration coverage in `tests/integration/ai-extraction.test.ts` should add: edge function happy path for both kinds; duplicate-hash detection; oversize file rejection; review UI flow approve-row / approve-all / reject. Until then, manual smoke testing on the live project (with a clearly-marked test user) is the gate.

## 9. Acceptance criteria

1. `migrations/up/0002_ai_extractions.sql` and `migrations/up/0003_ai_extraction_rpcs.sql` apply cleanly against current schema; matching down migrations roll back without orphan objects.
2. `ai_extractions` table exists with the columns, constraints, and indexes in §3; `org_id` is nullable.
3. RLS is enabled on `ai_extractions` and on `storage.objects` for `bucket_id='ai-extraction-sources'` per §4; anon role denied on both.
4. Storage bucket `ai-extraction-sources` exists, is private, and accepts uploads from the edge function.
5. Edge function `extract-document` is deployed, validates `kind`, enforces the 10 MB size cap, computes file hash, dedupes within 6 h, persists raw + parsed responses, and returns the success/error envelopes in §5.1.
6. `ANTHROPIC_API_KEY` is read via `Deno.env.get` and never appears in committed code.
7. Server-side validator `src/lib/validators/extractionValidator.js` reuses `masterDataValidator.js` helpers and produces the severity → `validation_status` mapping in §6.
8. RPCs `fn_apply_tech_pack_extraction`, `fn_apply_master_data_extraction`, `fn_reject_extraction` enforce idempotency, refuse to apply on `validation_status='failed'`, and record `applied_by`, `applied_target_ids`, `applied_at`.
9. Review UI page `src/pages/AIExtractionReview.jsx` lists extractions, shows per-row validation status, requires explicit selection before any apply, exposes an "Approve all" gated by zero blocking errors, and a "Reject" path that calls `fn_reject_extraction`.
10. "Try AI extraction" entry points are wired into `src/pages/TechPacks.jsx` and `src/pages/MasterDataImport.jsx` without altering the existing BOB/deterministic paths.
11. Existing browser-side AI call at `src/pages/TechPacks.jsx:981` is unchanged (verified by `git diff --stat` for that file showing only additions related to the new entry point, not edits to the existing handler).
12. Every row written to `ai_extractions` has a non-null `prompt_version`.
13. All unit tests in §8 pass under `npm run test:unit -- --run`.
14. All DB tests in §8 pass against a freshly-migrated database.
15. `npm run build` passes; no new lint warnings.
16. No emojis in any file added or modified by this spec.
17. Commit history follows `feat(ai-extraction): <description>` per phase A→G of the implementation playbook.

## 10. Rollback plan

Per-piece, in reverse order of the phasing.

- **Frontend (Phase F+G).** Revert the commits adding `AIExtractionReview.jsx` and the "Try AI extraction" buttons in `TechPacks.jsx` and `MasterDataImport.jsx`. The existing extraction paths are untouched, so users return to the pre-spec behaviour with no data loss.
- **RPCs (Phase E).** Apply `migrations/down/0003_ai_extraction_rpcs.sql`. No data is destroyed; rows in `ai_extractions` remain but cannot be applied until the RPCs are restored.
- **Edge function (Phase B+C).** Undeploy `extract-document` from Supabase. New extractions can no longer be created; existing rows in `ai_extractions` remain readable for audit.
- **Validator (Phase D).** Delete `src/lib/validators/extractionValidator.js`. `masterDataValidator.js` is unchanged so the existing importer is unaffected.
- **Schema (Phase A).** Apply `migrations/down/0002_ai_extractions.sql`. This drops the `ai_extractions` table — back up its contents first if any production extractions have been recorded. Storage objects under `ai-extraction-sources` are deleted with the bucket; export them first if retention matters.
- **90-day retention.** A scheduled job (out of scope for this spec; tracked in §11) is responsible for deleting storage objects and setting `review_status='superseded'` on the matching `ai_extractions` rows after 90 days. Until that job ships, no automatic deletion runs.

## 11. Future work (out of scope)

Triggers in parentheses indicate when to revisit.

- **PDF / image / freeform text input** (when a buyer ships their first non-XLSX tech pack). Likely needs a different extraction path inside `extract-document` — a `kind+modality` matrix, or a separate Anthropic vision call for images.
- **Per-buyer prompt fragments** (when a second buyer's XLSX behaves materially differently from the first). Compose `system_prompt = base + per_buyer_overrides[buyer_id]`; bumps `prompt_version` to e.g. `tech_pack.v2-buyerX`.
- **Cutover of the existing browser-side AI call** at `src/pages/TechPacks.jsx:981` (after the new path proves out for at least one full PO cycle). Replace with a call to `extract-document`; remove the inline Anthropic call.
- **Auto-write for high-confidence rows** (when validators have run on ≥100 production extractions and the false-positive rate is known). Requires a confidence threshold per `kind` and a flag on `ai_extractions` recording the auto-applied path.
- **PO PDF extraction** (separate spec; uses the same edge function with `kind='po_document'` once that schema is designed).
- **Replay tooling** (when a prompt change needs to be rolled forward against historical extractions). CLI or admin page that reads `raw_llm_response`-bearing rows, re-runs the validator, and shows diffs.
- **`master_articles_history` snapshots on apply** (when audit-trail requirements firm up). Captures the pre-apply state of each upserted row for one-click revert.
- **`org_id` rollout** (separate spec; blocks this column being non-null and adds tenant gating to RLS).
- **90-day retention scheduler** (before the bucket grows past a few GB). Cron edge function that lists `ai-extraction-sources`, deletes objects older than 90 days, and updates the matching `ai_extractions.review_status` to `'superseded'`.
- **Per-row apply for tech packs across SKUs from multiple extractions** (when buyers ship one SKU per file). Needs cross-extraction dedup on `tech_packs.article_code`.
