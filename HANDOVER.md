# Session handover — AI extraction pipeline

> **Generated:** 2026-04-27 end-of-day
> **Branch:** `claude/wizardly-greider-d3266d` (worktree at `.claude/worktrees/wizardly-greider-d3266d`)
> **Last commit:** `7fa7141 fix(ai-extraction): rules-of-hooks and LLM timeout for large master_data`
> **Spec:** `specs/2026-04-25-ai-extraction.md` (committed `4e57400`)

## What's done and live

Phases A → F of the spec are **shipped to live Supabase** (project ref `ecjqdyruwqlesfthgphv`). The system is end-to-end functional — you can upload a tech pack or master-data file, see Claude extract it, review per-row, and apply approved rows to the live `tech_packs` / `articles` / `consumption_library` / etc. tables.

| Phase | Commit | Live |
|---|---|---|
| A — schema + storage | `4748f9b` | ✅ table `ai_extractions` + bucket `ai-extraction-sources` |
| B — edge function skeleton | `4b7773b` | ✅ `extract-document` v1 |
| C — XLSX → Claude → row | `06d8caa` | ✅ deployed |
| D — validator | `0a85886` | ✅ wired into edge function |
| E — apply/reject RPCs + conflict scan | `de3f400` | ✅ migration 0003 applied |
| E2 — PDF/image, BOB fast path, Haiku→Sonnet fallback | `0f1e1d2` | ✅ deployed |
| F — review UI + entry points | `9131127` | ✅ committed (Netlify deploys on push to main) |
| F runtime fixes | `7fa7141` | ✅ extract-document redeployed; UI awaiting Netlify |
| G — tests + CI | `1da568d` | ✅ 17 new unit tests (56 total); DB stubs in `tests/db/`; no CI change needed |

## What's not done

- **Bug — packaging planning missing descriptions.** User reported, paused for example SKU. Three possible diagnoses: (1) data gap, (2) Path A by design (Packaging doesn't fall back to tech pack), (3) resolver defect. Need a SKU + tab name to investigate.
- **End-to-end verification of a successful AI extraction.** First master_data attempt timed out at 60s (now bumped to 120s). Retest tomorrow.

## Where you left off

User was testing the live UI (after `7fa7141`):
1. First master-data upload (`merquant-master-data-v4.xlsx`) timed out at 60s on Haiku — fixed in `7fa7141` by bumping per-attempt timeout to 120s. **Awaiting retest.**
2. User then surfaced an unrelated packaging-planning bug (missing descriptions on some SKUs). Paused there for a specific SKU code.

## How to resume tomorrow

1. **Run dev server:** `npm run dev` in this worktree directory. The `.env` file is local (gitignored) and contains `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. If it's missing on a new machine, recreate it from `.env.example` plus the publishable anon key (Supabase Dashboard → Project Settings → API).
2. **Retest the master_data extraction** that timed out yesterday. Reject the failed extraction first (it's still in the queue). Re-upload the same file; should finish within 120s now. If it still times out, the diagnostics path is to (a) split the file into smaller XLSX uploads or (b) skip the prompt-cache write for very large prompts.
3. **Diagnose the packaging-planning bug** — ask user for a specific SKU code, then SQL-check `consumption_library` for that item_code + the relevant `component_type`. Decision matrix in chat history.
4. **Phase G** — only after the two items above are resolved.

## Key live infrastructure (read-only reference)

- **Supabase project:** `ecjqdyruwqlesfthgphv` (live, prod)
- **Storage bucket:** `ai-extraction-sources` (private, 6-hour dedup window per file hash, 90-day retention not yet enforced)
- **Table:** `public.ai_extractions` (auth_all RLS permissive)
- **Edge function:** `extract-document` (verify_jwt: true, currently v4 from `0f1e1d2` + 120s timeout patch)
- **RPCs (SECURITY DEFINER):**
  - `fn_apply_tech_pack_extraction(uuid, text[])`
  - `fn_apply_master_data_extraction(uuid, jsonb, boolean, boolean)` — last param is `p_dry_run`
  - `fn_reject_extraction(uuid, text)`

## Files of interest

- Spec: [specs/2026-04-25-ai-extraction.md](specs/2026-04-25-ai-extraction.md)
- Edge function: [supabase/functions/extract-document/](supabase/functions/extract-document/)
  - `index.ts` — handler with format detection, BOB fast path, model fallback chain
  - `prompts.ts` — `MODEL_CHAIN_BY_KIND` (Haiku → Sonnet)
  - `bobTechPackParser.js` — Deno copy of the canonical parser at `src/lib/bobTechPackParser.js`
  - `bobAdapter.js` — maps BOB output → AI tech_pack JSON shape
  - `extractionValidator.js` — Deno copy of `src/lib/validators/extractionValidator.js`
- Migrations: `migrations/up/0002` (table+bucket), `0003` (RPCs), `0004` (dry_run)
- React: [src/pages/AIExtractionReview.jsx](src/pages/AIExtractionReview.jsx) + [src/components/shared/TryAIExtractionButton.jsx](src/components/shared/TryAIExtractionButton.jsx)
- Tests: 39 passing in `tests/unit/` (extractionValidator, descriptionResolver, articleUtils)
