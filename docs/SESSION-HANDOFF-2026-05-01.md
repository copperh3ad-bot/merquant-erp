# Session Handoff — 2026-05-01

This document is the bridge for a fresh Claude session. Read it first before anything else.

## Who you're working with

- **Waqas Ahmed** — GM Union Fabrics, owns MerQuant. Non-coder; explain in plain English; give direct recommendations not menus. Email: waqas.ahmed358@gmail.com.

## State of the system

- **Trunk + three branches in flight (this is important — work has NOT been consolidated):**
  - `claude/integration-test` (HEAD: `1725290`) — trunk for finished work. Has NOT moved since this doc was first written. None of today's three later branches have been merged back.
  - `claude/crazy-antonelli-0f58a4` (HEAD: `35db047`) — Phase 2 of the format-agnostic extraction plan + the dedup-by-kind hotfix. Sits on top of `1725290`.
  - `claude/infallible-heyrovsky-22bd51` (HEAD: `8c2a16e`) — five hardening-audit fixes (Findings 6, 7, 12, 16, 18). Sits on top of `1725290`. Independent of the Phase 2 branch.
  - `claude/stupefied-solomon-d1531c` (HEAD: `36e1b90`) — Findings 13 and 14 (xlsx CDN + 0.18.5 upgrade). Sits on top of `infallible-heyrovsky` (i.e. all 5 prior security fixes plus the xlsx work).
  - **Tomorrow-Claude:** none of these four branches has the full state. To resume any thread, check out the matching branch — don't assume work is on `integration-test`.
- **Repo:** github.com/copperh3ad-bot/merquant-erp
- **Tests:** 288/288 passing on each branch (`npx vitest run`)
- **Build:** clean on each branch (`npm run build`)
- **Two Supabase projects, both live:**
  - `ecjqdyruwqlesfthgphv` — `textile-manager-pro` (Mumbai). The legacy project. Still used by Netlify (env vars not yet swapped). All edge functions deployed; data current. **Note:** edge functions still run xlsx@0.18.5 — the repo has been bumped to 0.20.3 but no deploy has happened. Deploy is gated on the user.
  - `jcbxmpgjirxqszodotmx` — `MerQuant ERP` (Tokyo). Migrated to today; byte-for-byte parity with source for all 1234 rows + 81 storage files. Schema, RLS, edge functions all in place. Cutover instructions in `docs/migration-cutover-2026-05-01.md` step-by-step (8 manual steps still owed by Waqas: secrets, OAuth redirect, Netlify env vars, signup, role bump, etc.). Same xlsx note applies — deployed functions still 0.18.5 until next push.
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
11. **Format-agnostic extraction Phase 1** (`53ae6a9`) — anomaly detector + auto-fix + strict master_data prompt v3. Architectural plan in `docs/format-agnostic-extraction-plan-2026-05-01.md`.
12. **Session handoff doc** (`1725290` — last commit on `claude/integration-test`).
13. **Format-agnostic Phase 2 — design + wiring** (`0b0c329`, `d65344e`, `5c21b56` on `claude/crazy-antonelli-0f58a4`). Two-step master_data extraction: layout-discovery prompt + tool schema, deterministicApply module with unit tests, and the wire-up in `extract-document` with a fall-back to legacy single-step on any failure. Phase 2 ships behind a feature gate; legacy path is the default until smoke-tested in production.
14. **Dedup-by-kind hotfix** (`35db047` on `claude/crazy-antonelli-0f58a4`) — extraction dedup now keys on `(file_hash, kind)` instead of `file_hash` alone, so re-categorizing a file that was already extracted as a different `kind` triggers a fresh AI run instead of returning the stale extraction. Surfaced when re-uploading a master-data file that had previously been mistaken for a tech_pack.
15. **Mumbai cleanup of misapplied tech_pack extraction** — runtime database action on the Mumbai project (`ecjqdyruwqlesfthgphv`); not a code commit. A tech_pack extraction had been applied that should not have been; rows were rolled back via the Supabase dashboard / a one-off SQL. No migration was added; if it recurs, dedup-by-kind plus the master_data v3 prompt should prevent it.
16. **Hardening-audit Findings 6, 7, 12, 16, 18** (`d1be33b`, `b397dd2`, `83ab157`, `72fc03d`, `8c2a16e` on `claude/infallible-heyrovsky-22bd51`):
    - `d1be33b` — `classify-components` and `extract-barcodes` edge functions now call `supabase.auth.getUser(token)` in-handler instead of trusting any non-empty Authorization header.
    - `b397dd2` — `notify-pricing-pending` requires authenticated caller.
    - `83ab157` — `backup-hourly` fails closed (HTTP 503) when `BACKUP_SECRET` is empty/unset, instead of allowing all callers.
    - `72fc03d` — browser-side file uploads capped at 10 MB at every entry point (mirrors the existing edge-function cap; closes the self-DoS / parser-CVE surface).
    - `8c2a16e` — added `public/_headers` with X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security, Permissions-Policy. CSP deferred until Finding 13 was resolved (now done — see #17).
17. **Hardening-audit Findings 13 and 14 — xlsx CDN + 0.18.5 upgrade** (`d13a94e`, `c9f6414`, `36e1b90` on `claude/stupefied-solomon-d1531c`):
    - `d13a94e` — installed xlsx@0.20.3 from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (npm registry no longer hosts xlsx). Lockfile records sha512 integrity.
    - `c9f6414` — replaced 9 dynamic `<script src="cdn.jsdelivr.net/npm/xlsx@0.18.5/...">` injection sites in the front-end with `await import("xlsx")`. Vite bundles xlsx into a 493 KB code-split chunk (160 KB gzipped) that lazy-loads only on first upload; same UX as the previous CDN-on-first-use behavior, but now same-origin and version-locked. Closes both the SRI gap (Finding 13) and the front-end CVE exposure (Finding 14: GHSA-4r6h-8v6p-xvw6 prototype pollution + GHSA-5pgg-2g60-rcc5 ReDoS).
    - `36e1b90` — bumped `extract-document/index.ts` and the in-tree mirror `extract-document/bobTechPackParser.js` to `https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs`. **Deployed edge functions still run 0.18.5 until next deploy.** Repo is consistent.

## The strategic context Waqas just laid out

> "We cannot have standardized formats. When MerQuant deploys as SaaS, every customer has their own tech pack / master data / fabric working / accessory format. The only universal anchor is the SKU. Fix this once and for all."

This drives everything going forward. The 5-phase plan in `docs/format-agnostic-extraction-plan-2026-05-01.md` is the design contract. Phase 1 is shipped. **Phase 2 is the natural next step** — two-step extraction with column-mapping declaration. After that, Phase 4 (per-customer mapping profiles) is the killer feature: zero AI cost on repeated uploads from the same customer.

## Open items (carry these forward)

### Cutover to new Supabase project (Waqas owes)

`docs/migration-cutover-2026-05-01.md` lists 8 manual steps. None are blocked by code; they're all things only Waqas can do (set secrets, update Netlify env vars, sign up fresh, etc.). Still on the OLD project until those happen.

### Security audit findings still open

`docs/security/hardening-audit-2026-05-01.md` has 18 findings.

**Closed:**
- Findings 1, 2, 4 (Critical, RLS) — closed in `f19cd73` on `claude/integration-test`.
- Findings 6, 7, 12, 16, 18 — closed in commits `d1be33b` … `8c2a16e` on `claude/infallible-heyrovsky-22bd51` (5 commits, see #16 in the chronological log above).
- Findings 13, 14 — closed in `d13a94e`, `c9f6414`, `36e1b90` on `claude/stupefied-solomon-d1531c` (3 commits, see #17 above). **Edge functions still need to be redeployed** for the 0.20.3 bump to take effect in production.

**Remaining:**
- **Finding 3 (Critical) — `ai-proxy` edge function has no JWT verification.** Untouched. Cost-exhaustion exposure on Anthropic billing. Highest-priority remaining item.
- **Finding 5 (HIGH)** — `auth_all USING (true)` on ~30 business tables. Big RLS overhaul, dedicated session.
- **Finding 8 (HIGH)** — `user-approval` `notify_owner` action accepts unauthenticated input.
- **Finding 9 (HIGH)** — `exec_sql` RPC bypasses RLS and uses regex-based input validation.
- **Finding 10 (HIGH)** — gmail OAuth refresh tokens stored in plaintext.
- **Finding 11 (Medium)** — front-end role checks not backed by server-side enforcement (subsumed by #5).
- **Finding 15 (Medium)** — storage bucket `ai-extraction-sources` has no per-user scoping.
- **Finding 17 (Low)** — wide CORS on every edge function. Now feasible to tighten because front-end is bundled (no jsdelivr origin needed).

### File Feeder follow-ups

- **Phase 2 of format-agnostic plan** — *in flight on `claude/crazy-antonelli-0f58a4`.* The two-step master_data path (discover → confirm → apply) is wired, with a fallback to legacy on any error. Smoke-test with real customer files before flipping the default. When proven, the `dedupeMasterData` band-aid can be deleted.
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
- (No tag for individual feature pushes — they're just commits on the four parallel branches above.)

## How to resume in the new chat

Open the new chat and paste this:

> Resuming MerQuant work. Read `docs/SESSION-HANDOFF-2026-05-01.md` first — note that there are FOUR branches in flight, not one. Then read `docs/format-agnostic-extraction-plan-2026-05-01.md`. I want to [X].

Where [X] is one of (each names the branch you'd start on):

- "merge `claude/infallible-heyrovsky-22bd51` (5 security fixes) and `claude/stupefied-solomon-d1531c` (xlsx upgrade) into `claude/integration-test`, then deploy edge functions" — consolidates today's security work onto trunk and pushes the xlsx 0.20.3 bump live
- "merge `claude/crazy-antonelli-0f58a4` Phase 2 work into `claude/integration-test` after smoke-testing with a real customer master-data file"
- "tackle Finding 3 (ai-proxy unauth) — the highest-priority security item still open" — should branch off whatever consolidated trunk looks like at that point
- "tackle Finding 5 from the security audit (RLS overhaul)" — dedicated session
- "do the cutover steps for the new Tokyo project" (Waqas-driven, mostly manual)
- "continue [some other thread]"

When in doubt, run `git branch -a` and pick the branch matching the thread you want to continue. Don't assume `claude/integration-test` has the latest of anything — it doesn't.

## Things NOT to do without checking with Waqas first

- Mass schema changes (he said all tables are useful)
- Force push / destructive git operations
- Deploy to production without confirming the project ref
- Run `apply` on any extraction without his sign-off via File Feeder UI
- Skip git hooks on commit (he hasn't asked for `--no-verify`)

---

**Tip of each branch as of this update:**

```
claude/integration-test          1725290  docs: session handoff note for resuming in a fresh chat
claude/crazy-antonelli-0f58a4    35db047  fix(extraction): scope dedup by kind so re-categorizing a file triggers a fresh extraction
claude/infallible-heyrovsky-22bd51  8c2a16e  security: 16 — add Netlify _headers with baseline security headers
claude/stupefied-solomon-d1531c  36e1b90  security: 13/14 — bump edge-function xlsx to 0.20.3 (cdn.sheetjs.com)
```

**Stupefied-solomon's full commit chain on top of integration-test:**

```
36e1b90 security: 13/14 — bump edge-function xlsx to 0.20.3 (cdn.sheetjs.com)
c9f6414 security: 13/14 — bundle xlsx in front-end (drop jsdelivr CDN injection)
d13a94e security: 13/14 — install xlsx@0.20.3 from sheetjs.com tarball
8c2a16e security: 16 — add Netlify _headers with baseline security headers
72fc03d security: 12 — cap browser-side file uploads at 10 MB
83ab157 security: 18 — fail closed in backup-hourly when BACKUP_SECRET is unset
b397dd2 security: 6 — require auth on notify-pricing-pending
d1be33b security: 7 — verify JWT in-handler for classify-components and extract-barcodes
1725290 docs: session handoff note for resuming in a fresh chat
```

(So `stupefied-solomon` is the cleanest single branch to look at if you want all of today's security work in one place. It does NOT include the Phase 2 extraction work — that's only on `claude/crazy-antonelli-0f58a4`.)
