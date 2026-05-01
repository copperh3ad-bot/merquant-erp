# Session Handoff — 2026-05-01

This document is the bridge for a fresh Claude session. Read it first before anything else.

## Who you're working with

- **Waqas Ahmed** — GM Union Fabrics, owns MerQuant. Non-coder; explain in plain English; give direct recommendations not menus. Email: waqas.ahmed358@gmail.com.

## State of the system

- **Branch:** `claude/integration-test` (HEAD: `53ae6a9`)
- **Repo:** github.com/copperh3ad-bot/merquant-erp
- **Tests:** 288/288 passing (`npx vitest run`)
- **Build:** clean (`npm run build`)
- **Two Supabase projects, both live:**
  - `ecjqdyruwqlesfthgphv` — `textile-manager-pro` (Mumbai). The legacy project. Still used by Netlify (env vars not yet swapped). All edge functions deployed; data current.
  - `jcbxmpgjirxqszodotmx` — `MerQuant ERP` (Tokyo). Migrated to today; byte-for-byte parity with source for all 1234 rows + 81 storage files. Schema, RLS, edge functions all in place. Cutover instructions in `docs/migration-cutover-2026-05-01.md` step-by-step (8 manual steps still owed by Waqas: secrets, OAuth redirect, Netlify env vars, signup, role bump, etc.).
- **`.supabase-token`** in repo root (gitignored) — personal access token for Supabase Management API. Used by every script in `scripts/`. Revoke at https://supabase.com/dashboard/account/tokens when no longer needed.

## What just shipped today (chronological)

1. **Migration to new Tokyo Supabase** (`pre-hardening-2026-05-01` → `pre-chatbot-redesign-2026-05-01` tags)
2. **Security hardening** — 3 critical RLS/auth holes closed (`f19cd73`). Migration `0007`.
3. **Fabric Bag dimension fix** + dashboard nag (`acdbffa`)
4. **File Feeder Phase 1** — chat-style tech-pack ingestion at `/FileFeeder` (`420365c`). New top-level nav item "File Feeder" with `Upload` icon next to "AI Assistant".
5. **File Feeder progress UX** (`55be01b`) — phased status bubbles + elapsed-time counter
6. **File Feeder Phase 2** — master-data file support with kind selector (`21e0df2`)
7. **RPC bug fix + dedup** (`6a4deeb`) — migration `0009` fixes `pricing_status_t` cast in `fn_apply_master_data_extraction`. Both projects updated.
8. **Conservative dedup** (`2c5d40a`) — only collapse exact duplicates; flag key-only duplicates instead of silently summing. Master-data prompt v2.
9. **SKU-suffix → product_size inference** (`98ed0de`) — PO import now derives Full/Queen/King/etc. from article codes when master-data lacks size column.
10. **PO 711167-001 manual repair** (`1f01c36`) — parsed user's MFRM XLSX directly (no AI) to populate articles.components with correct per-part data. Scripts left at `scripts/inspect-mfrm-xlsx.mjs` + `scripts/patch-slpcss-from-xlsx.mjs`.
11. **Format-agnostic extraction Phase 1** (`53ae6a9` — most recent) — anomaly detector + auto-fix + strict master_data prompt v3. Architectural plan in `docs/format-agnostic-extraction-plan-2026-05-01.md`.

## The strategic context Waqas just laid out

> "We cannot have standardized formats. When MerQuant deploys as SaaS, every customer has their own tech pack / master data / fabric working / accessory format. The only universal anchor is the SKU. Fix this once and for all."

This drives everything going forward. The 5-phase plan in `docs/format-agnostic-extraction-plan-2026-05-01.md` is the design contract. Phase 1 is shipped. **Phase 2 is the natural next step** — two-step extraction with column-mapping declaration. After that, Phase 4 (per-customer mapping profiles) is the killer feature: zero AI cost on repeated uploads from the same customer.

## Open items (carry these forward)

### Cutover to new Supabase project (Waqas owes)

`docs/migration-cutover-2026-05-01.md` lists 8 manual steps. None are blocked by code; they're all things only Waqas can do (set secrets, update Netlify env vars, sign up fresh, etc.). Still on the OLD project until those happen.

### Security audit findings still open

`docs/security/hardening-audit-2026-05-01.md` has 18 findings. Only the 3 Critical ones are fixed (commit `f19cd73`). Remaining:
- **Finding 5 (HIGH)** — `auth_all USING (true)` on ~30 business tables. Big RLS overhaul, dedicated session.
- Findings 6–18 — smaller pieces, do as time allows.

### File Feeder follow-ups

- **Phase 2 of format-agnostic plan** — refactor `extract-document` master_data path to two-step (discover → confirm → apply). When that lands, the `dedupeMasterData` band-aid can be deleted.
- **Phase 3** — File Feeder UI to confirm column mapping before applying.
- **Phase 4** — `extraction_mapping_profiles` table + RPCs.

### Known data state on OLD project

- PO `711167-001` (PureCare): 6 SLPCSS articles, full per-part components, 24 rows in Fabric Working Sheet should render correctly.
- `consumption_library`: 144 SLPCSS rows with proper per-part `component_type` ("Flat Sheet", "Fitted Sheet", "Pillow Case", "Fabric bag").
- 869afb05 ai_extraction is `rejected`. e20c2290 is `approved`/applied.

## Key files to know

### Source code (recent additions)

- `src/pages/FileFeeder.jsx` — the chatbot upload page (~880 lines)
- `src/lib/extractionAnomalyDetector.js` — Phase 1 anomaly detection + auto-fix
- `src/lib/masterDataDedup.js` — conservative dedup (exact dups only, flag the rest)
- `src/lib/skuSizeInference.js` — SKU code → human size label
- `src/lib/fabricBagDimensionCheck.js` — dashboard nag helper
- `src/components/fabric/FabricEditDialog.jsx` — per-component dimension edit (Layer 0)
- `src/pages/Dashboard.jsx` — fabric-bag nag banner

### Edge functions

- `supabase/functions/extract-document/` — main AI extraction (Haiku→Sonnet fallback)
  - `prompts.ts` — current versions: `tech_pack.v1`, `master_data.v3`
  - `index.ts` — handler with auth gate, dedup, validation
  - `extractionValidator.js` — server-side validator
  - `bobTechPackParser.js`, `bobAdapter.js` — BOB-format fast path
- `supabase/functions/ai-proxy/` — generic Claude pass-through, JWT-gated
- All deployed to both projects.

### Migrations

- `migrations/up/0001_init.sql` → `0009_fix_price_list_pricing_status_cast.sql` — all applied to both projects.

### Architecture / planning docs

- `docs/format-agnostic-extraction-plan-2026-05-01.md` — **THE roadmap. Read first.**
- `docs/migration-cutover-2026-05-01.md` — 8-step manual cutover Waqas owes
- `docs/migration-validation-2026-05-01.md` — byte-perfect validation report
- `docs/security/hardening-audit-2026-05-01.md` — 18 findings, 3 critical closed
- `docs/chatbot-prototype-proposal-2026-05-01.md` — the original File Feeder design (already shipped Phase 1+2)
- `docs/ai-extraction-audit-2026-05-01.md` — what AI extraction code already existed before File Feeder was built

### One-off scripts (leave alone unless re-running)

- `scripts/migrate-schema-to-target.mjs` — schema replay for cross-project migration
- `scripts/migrate-data-to-target.mjs` — JSON-roundtrip data clone
- `scripts/migrate-storage-files.mjs` — bucket file transfer
- `scripts/deploy-edge-functions.mjs` — deploy all 9 edge functions to a project
- `scripts/apply-migrations-via-api.mjs` — apply pre-cleaned migrations
- `scripts/clean-migrations.mjs` — strip psql meta-commands
- `scripts/split-init-sql.mjs` — chunk huge pg_dump
- `scripts/backup-target-db.mjs` — full DB backup with retry + resume
- `scripts/inspect-mfrm-xlsx.mjs` — diagnostic dump of XLSX structure
- `scripts/patch-slpcss-from-xlsx.mjs` — one-off PO repair script

### Dump of new Supabase project (rollback point)

- `docs/backups/2026-05-01/` — 14 JSON files, 1234 rows, byte-checksummed.

## Tags worth knowing

- `pre-hardening-2026-05-01` — before security fixes
- `pre-chatbot-redesign-2026-05-01` — before File Feeder build
- (No tag for individual feature pushes — they're just commits on `claude/integration-test`)

## How to resume in the new chat

Open the new chat and paste this:

> Resuming MerQuant work. Read `docs/SESSION-HANDOFF-2026-05-01.md` first, then `docs/format-agnostic-extraction-plan-2026-05-01.md`. Most recent commit is `53ae6a9` on branch `claude/integration-test`. I want to [X].

Where [X] is one of:

- "test the new anomaly detector by re-uploading the MFRM file in File Feeder"
- "start Phase 2 of the format-agnostic plan"
- "do the cutover steps for the new Tokyo project"
- "tackle Finding 5 from the security audit"
- "continue [some other thread]"

The new Claude will have full context to pick up cleanly.

## Things NOT to do without checking with Waqas first

- Mass schema changes (he said all tables are useful)
- Force push / destructive git operations
- Deploy to production without confirming the project ref
- Run `apply` on any extraction without his sign-off via File Feeder UI
- Skip git hooks on commit (he hasn't asked for `--no-verify`)

---

**Last 5 commits for context:**

```
53ae6a9 feat(extraction): format-agnostic foundation — Phase 1 of 5
1f01c36 fix(po-articles): populate per-part data for PO 711167-001 from real tech pack XLSX
98ed0de feat(po-import): infer product_size from SKU code as last fallback
2c5d40a fix(file-feeder): prevent silent loss of per-part fabric components
6a4deeb fix(file-feeder): auto-dedup master-data + repair price_list cast
```
