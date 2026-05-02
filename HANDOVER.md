# Session handover — AI extraction pipeline

> **Generated:** 2026-04-27 (second session, end-of-day)
> **Branch:** `claude/wizardly-greider-d3266d` (worktree at `.claude\worktrees\wizardly-greider-d3266d`)
> **Tip commit:** `30148ab fix(ai-extraction): bump per-attempt timeout to 240s for large master_data`
> **Branch on GitHub:** https://github.com/copperh3ad-bot/merquant-erp/tree/claude/wizardly-greider-d3266d
> **Spec:** `specs/2026-04-25-ai-extraction.md` (committed `4e57400`)

## Status: all seven phases shipped

Phases A → G are done — code committed and pushed to GitHub, edge function and migrations applied to live Supabase project `ecjqdyruwqlesfthgphv`.

| Phase | Commit | Live |
|---|---|---|
| A — schema + storage | `4748f9b` | ✅ table `ai_extractions` + bucket `ai-extraction-sources` |
| B — edge function skeleton | `4b7773b` | ✅ deployed |
| C — XLSX → Claude → row | `06d8caa` | ✅ deployed |
| D — validator + wiring | `0a85886` | ✅ deployed |
| E — apply/reject RPCs + conflict scan | `de3f400` | ✅ migration 0003 applied |
| E2 — PDF/image, BOB fast path, Haiku→Sonnet fallback | `0f1e1d2` | ✅ deployed |
| F — review UI + entry points | `9131127` | ✅ committed (Netlify deploys on PR merge) |
| F runtime fixes (hooks rule, 120s timeout) | `7fa7141` | ✅ deployed |
| G — tests + CI | `1da568d` (+ `d21886a` doc) | ✅ 56 unit tests pass; DB stubs in `tests/db/` |
| Truncation handling + 32K output cap | `314a4e4` | ✅ deployed |
| Per-attempt timeout 240s | `30148ab` | ✅ deployed |

Branch is **14 commits ahead of `main`**, all on GitHub. Local + remote in sync.

## End-to-end verification: WORKING

Multiple successful runs confirmed in the live `ai_extractions` table:

- `15abbf11` (V4 file, applied yesterday): passed → approved → live tables
- `6f1874a0` (V4 file, applied today 06:23): warned → approved → live tables
  - **⚠ This one's `extracted_data` was actually truncated** (`stop_reason: max_tokens`) under the old 16K cap. Some master_data sections (probably tail of `accessory_consumption` plus all of `carton_master`/`price_list`/`suppliers`/`seasons`/`production_lines`) silently never made it into the persisted JSON. Then the validator only saw what was there and let it through. **The user's live tables have partial data from this application** (commit `314a4e4` added the truncation detector so this can't recur, but the existing damage isn't auto-fixable).

## Open decisions for next session

The user closed the session before answering these — they're at the top of the queue when work resumes.

### Decision 1 — handle the truncated V4 application
The earlier V4 application was incomplete. Options:
- **Accept it.** Going-forward workflow is to upload one new program at a time (small files, no truncation). Existing programs stay incomplete unless someone reports a missing item.
- **Re-upload V4 once.** With the 32K output cap + 240s timeout it'll complete cleanly. The apply RPC UPSERTS by upsert key, so existing rows update and missing rows get added — no data loss.
- **SQL-diff first.** Compare what's in `articles` / `consumption_library` / `price_list` / etc. against the original XLSX to see exactly what's missing, then decide.

### Decision 2 — retry the large filled XLSX in the queue
File: `merquant-master-data-2026-04-27-filled.xlsx`. Hit the 120s timeout, was rejected. With the 240s patch it might now complete (or might still be too big for one shot). Options:
- **Retry once.** End-to-end test of the 240s patch against a real large file.
- **Skip.** The new "small uploads going forward" workflow makes large files moot.

### Decision 3 — packaging planning bug (carryover from earlier session)
User reported missing descriptions on some SKUs in Packaging Planning page. Three diagnoses possible:
- Data gap (no `consumption_library` row for that item_code + category)
- Path A by design (Packaging doesn't fall back to tech pack — see `specs/s12-techpack-description-fallback.md`)
- Resolver defect

Need a specific SKU code + which tab from the user before we can investigate. Decision matrix is in chat history.

## Workflow note (user decision recorded today)

Going forward, master data uploads will contain **only new programs** (not the full master). This keeps file sizes well within the 32K output cap and 240s timeout — no truncation expected on regular workflow. The safety nets (truncation detector, timeout, conflict scan) become rarely-used fallbacks, not the operating regime.

## How to resume in a new session

Paste this into the new chat to bring it up to speed quickly:

> Resuming the MerQuant AI extraction pipeline work in `D:\merquant-erp` on branch `claude/wizardly-greider-d3266d`. Read `HANDOVER.md` at the repo root before doing anything. All seven phases (A–G) shipped and live. Three decisions are open: handle the truncated V4 application; retry the failed-then-rejected large filled XLSX or skip it; diagnose the packaging-planning missing-descriptions bug. Going-forward workflow is small per-program uploads.

Then:
1. **Run dev server:** `npm run dev` in this worktree. `.env` is local (gitignored). Recreate from `.env.example` + Supabase Dashboard → Project Settings → API → publishable key if missing.
2. **Pick a decision from the open list** above and act on it.

## Key live infrastructure (read-only reference)

- **Supabase project:** `ecjqdyruwqlesfthgphv` (live, prod). Live URL: https://merquanterp.netlify.app
- **Storage bucket:** `ai-extraction-sources` (private, 6-hour dedup window per file hash, 90-day retention not yet enforced)
- **Table:** `public.ai_extractions` (auth_all RLS permissive)
- **Edge function:** `extract-document` (verify_jwt: true, current version reflects `30148ab` — 240s timeout, 32K output cap, truncation detector, BOB fast path, Haiku→Sonnet fallback)
- **RPCs (SECURITY DEFINER):**
  - `fn_apply_tech_pack_extraction(uuid, text[])`
  - `fn_apply_master_data_extraction(uuid, jsonb, p_force boolean, p_dry_run boolean)`
  - `fn_reject_extraction(uuid, text)`

## Files of interest

- Spec: [specs/2026-04-25-ai-extraction.md](specs/2026-04-25-ai-extraction.md)
- Edge function dir: [supabase/functions/extract-document/](supabase/functions/extract-document/)
  - `index.ts` — handler (format detection, BOB fast path, model fallback chain, truncation detection)
  - `prompts.ts` — `MODEL_CHAIN_BY_KIND` (Haiku → Sonnet), versioned per-kind prompts
  - `bobTechPackParser.js` — Deno copy of canonical browser parser at `src/lib/bobTechPackParser.js`
  - `bobAdapter.js` — maps BOB output → AI tech_pack JSON shape
  - `extractionValidator.js` — Deno copy of canonical at `src/lib/validators/extractionValidator.js`
- Migrations: `migrations/up/0002` (table+bucket), `0003` (RPCs), `0004` (dry_run)
- React: [src/pages/AIExtractionReview.jsx](src/pages/AIExtractionReview.jsx) + [src/components/shared/TryAIExtractionButton.jsx](src/components/shared/TryAIExtractionButton.jsx)
- Tests: **56 passing** in `tests/unit/` (validator + adapter + prompts snapshots + existing). DB test stubs in [tests/db/](tests/db/).

## Local backups in D:\

- `D:\merquant-erp-backup-2026-04-27.zip` — created mid-session yesterday (~0.89 MB, source + config). Slightly out of date now (missing today's commits). Refresh below if needed.
