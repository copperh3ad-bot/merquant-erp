# Mumbai cross-app touch — incident record (2026-05-05)

> **Owner of this document:** MerQuant ERP repo (this one).
> **Audience:** MAS sister repo team (Mumbai project owner).
> **Status:** Recovery complete on the MerQuant side. **Mumbai is hands-off from MerQuant going forward.**

## TL;DR

On 2026-05-02 a session running off **stale local `main`** of this MerQuant ERP repo applied one migration and redeployed eight edge functions to **Mumbai (`ecjqdyruwqlesfthgphv`)** in addition to Tokyo. Mumbai is owned by the MAS sister repo and should not have been touched.

After read-only inspection on 2026-05-05, **the net effect on Mumbai's database state is zero** — all policies on the five tables referenced by the migration are currently in the correct, role-aware shape that the MerQuant tier-2 RLS migrations also produce. The eight edge functions on Mumbai are still running our (MerQuant ERP) code and are at MerQuant's deployment timestamps; **MAS team should redeploy MAS's own versions**.

We did not write to Mumbai during this recovery. We only read.

---

## 1. What was done to Mumbai (chronological)

### 1a. Migration applied — `migrations/up/0010_security_hardening_finding_4.sql`

This migration drops and recreates one permissive policy on each of five tables, scoping them `TO authenticated` instead of `PUBLIC`. The migration is part of MerQuant ERP's hardening work and was authored to close audit Finding #4. It was applied during the session prior to this recovery; precise timestamp not preserved by Supabase migration history (the session note says 2026-05-02).

The five tables: `bom_explosion_log`, `job_card_steps`, `sample_invoices`, `user_settings`, `whatsapp_crawl`.

The migration's effect: drops policies named `bom_log_all`, `jcs_all`, `sample_invoices_all`, `us_all`, `wa_all` (if present) and recreates them as `FOR ALL TO authenticated USING (true) WITH CHECK (true)`.

**Current state on Mumbai (verified 2026-05-05 via read-only `pg_policies` query): none of these `_all` policies exist. They have been superseded by per-command, role-aware policies (see section 2 below) that match exactly what MerQuant ERP now has on Tokyo. Either (a) the 0010 migration's `_all` policies were dropped by a subsequent tier-2 migration, or (b) Mumbai was already in the post-tier-2 state when 0010 ran (in which case 0010's DROP IF EXISTS was a no-op and its CREATE was overwritten before we observed). Either way, no regression is observable now.**

### 1b. Edge functions redeployed (eight)

The MerQuant deploy script `scripts/deploy-edge-functions.mjs` walks `supabase/functions/` and uploads every directory found. When run against Mumbai's project ref, it overwrote eight functions with code from the stale local `main` branch:

| function | Mumbai version (post-deploy) | Mumbai `updated_at` (last touched) |
|---|---|---|
| `ai-proxy` | 47 | 2026-05-02T13:25:00Z |
| `backup-hourly` | 24 | 2026-05-02T13:25:02Z |
| `classify-components` | 17 | 2026-05-02T13:25:05Z |
| `extract-barcodes` | 17 | 2026-05-02T13:25:07Z |
| `gmail-crawl` | 29 | 2026-05-02T13:25:11Z |
| `gmail-oauth` | 27 | 2026-05-02T13:25:12Z |
| `notify-pricing-pending` | 22 | 2026-05-02T13:25:13Z |
| `user-approval` | 34 | 2026-05-02T13:25:15Z |

A ninth function, `extract-document`, has version 28 with `updated_at` 2026-05-04T11:01:45Z — i.e. it was touched again **after** our deploy, most likely by the MAS team. It's possible the MAS team has already noticed and started recovering.

Versions are Mumbai's project-specific deployment counters; the `_at` timestamps are the relevant signal.

### 1c. Mumbai was not touched again on 2026-05-05

The recovery session did not deploy, migrate, RPC, or write anything else to Mumbai. Read-only `pg_policies`, `information_schema.columns`, `pg_class`, and `pg_tables` queries via the Supabase Management API were the only Mumbai operations.

---

## 2. Current Mumbai state (verified read-only on 2026-05-05)

### 2a. Five tables — schema unchanged

All five tables exist on Mumbai with column shapes that exactly match Tokyo. Most relevant scoping columns:

- `user_settings` has a `user_id UUID` column.
- `sample_invoices` has `customer_name TEXT`, `created_by TEXT`, `po_id UUID`, `rfq_id UUID` — no `team_id`, `org_id`, or scoping UUID.
- `bom_explosion_log`, `job_card_steps`, `whatsapp_crawl` — no scoping column.

RLS is enabled on all five (`relrowsecurity = true`).

### 2b. Policies on the five tables (verbatim from `pg_policies`)

```
─── bom_explosion_log ──────────────────────────────────────────────
bom_explosion_log_select: TO authenticated
  USING  has_role('Owner','Manager')
bom_explosion_log_insert: TO authenticated
  WITH CHECK has_role('Owner','Manager','Merchandiser')
bom_explosion_log_delete: TO authenticated
  USING  has_role('Owner')

─── job_card_steps ──────────────────────────────────────────────────
job_card_steps_select: TO authenticated  USING true
job_card_steps_insert: TO authenticated  WITH CHECK has_role('Owner','Manager','Merchandiser')
job_card_steps_update: TO authenticated  USING has_role('Owner','Manager','Merchandiser')
                                          WITH CHECK has_role('Owner','Manager','Merchandiser')
job_card_steps_delete: TO authenticated  USING has_role('Owner')

─── sample_invoices ─────────────────────────────────────────────────
sample_invoices_select: TO authenticated  USING has_role('Owner','Manager')
sample_invoices_insert: TO authenticated  WITH CHECK has_role('Owner','Manager')
sample_invoices_update: TO authenticated  USING has_role('Owner','Manager')
                                          WITH CHECK has_role('Owner','Manager')
sample_invoices_delete: TO authenticated  USING has_role('Owner')

─── user_settings ───────────────────────────────────────────────────
user_settings_select: TO authenticated  USING (user_id = auth.uid() OR has_role('Owner'))
user_settings_insert: TO authenticated  WITH CHECK (user_id = auth.uid())
user_settings_update: TO authenticated  USING (user_id = auth.uid() OR has_role('Owner'))
                                        WITH CHECK (user_id = auth.uid() OR has_role('Owner'))
user_settings_delete: TO authenticated  USING (user_id = auth.uid() OR has_role('Owner'))

─── whatsapp_crawl ──────────────────────────────────────────────────
whatsapp_crawl_select: TO authenticated  USING has_role('Owner','Manager')
whatsapp_crawl_insert: TO authenticated  WITH CHECK has_role('Owner','Manager')
whatsapp_crawl_update: TO authenticated  USING has_role('Owner','Manager')
                                         WITH CHECK has_role('Owner','Manager')
whatsapp_crawl_delete: TO authenticated  USING has_role('Owner')
```

These are MerQuant ERP's tier-2 role-aware policies. They depend on a `public.has_role(text...)` SECURITY DEFINER helper and on rows in a `public.user_profiles` table with a `role` column. Both helper and table also exist on Mumbai.

**No `bom_log_all`, `jcs_all`, `sample_invoices_all`, `us_all`, or `wa_all` policy exists on Mumbai.** The only output from the 2026-05-02 migration that we can observe is its idempotent `DROP POLICY IF EXISTS` lines; the `CREATE POLICY` lines have been superseded.

### 2c. Edge function code provenance

The eight Mumbai functions touched by us are still running MerQuant ERP code from this repo's local `main` as of 2026-05-02. We have not redeployed them with corrected (origin/main) versions because Mumbai is the MAS team's responsibility.

If the MAS team's edge functions have different request shapes, environment variable expectations, or business logic from MerQuant ERP's, then **the eight functions listed in section 1b are running incorrect code right now** (since 2026-05-02, except `extract-document` which appears to have been re-touched on 2026-05-04).

---

## 3. Net effect

| Surface | Concern | Verified state |
|---|---|---|
| Five Finding-4 tables — schema | Did the migration alter columns? | No. Migration is policy-only. Schemas unchanged. |
| Five Finding-4 tables — policies | Did the migration leave permissive `_all` policies? | No. All five tables have proper per-command role-aware policies. **Zero observable regression.** |
| Eight edge functions | Are they running MAS-team code or MerQuant code? | Likely MerQuant code, since 2026-05-02. **Likely behavioural regression for any MAS-specific request paths.** |
| `extract-document` (ninth fn) | Same? | Possibly already recovered — `updated_at` 2026-05-04 is later than our deploy. |
| Migration history table (`supabase_migrations.schema_migrations` or equivalent) | Does our `0010` show up? | Not verified — we did not query Mumbai's migrations table. MAS team can check. |

---

## 4. What MAS team should do

1. **Confirm the eight functions in section 1b are the right code.** Compare the Mumbai-deployed source (via `supabase functions download <name>` or the Management API `/functions/<slug>/body` endpoint) against the MAS repo's expected source for each. If they match MerQuant ERP source, redeploy from the MAS repo.
2. **Look at `extract-document` separately.** Its 2026-05-04 timestamp suggests someone on the MAS side already noticed and re-deployed. If so, no action needed there. If not, redeploy.
3. **Verify the five Finding-4 tables don't conflict with MAS schema.** If the MAS app uses `bom_explosion_log`, `job_card_steps`, `sample_invoices`, `user_settings`, or `whatsapp_crawl` for purposes other than what MerQuant ERP does, the role-aware policies installed there (`Owner`/`Manager`/`Merchandiser` checks) may not match MAS's permission model. **The policies as listed in section 2b lock down writes to these specific role names — if the MAS app's `user_profiles.role` values are different (e.g. roles named after MAS modules), users will get 401s on writes.** Drop/replace the policies as needed.
4. **Check whether our 0010 migration left a row in the migration history table.** If it did, decide whether to keep that record (to track the foreign migration) or remove it.

---

## 5. Why this happened (one paragraph)

The MerQuant ERP deploy script (`scripts/deploy-edge-functions.mjs`) takes a project ref as an argument and walks the local `supabase/functions/` tree. It does not check whether the target project belongs to MerQuant ERP. The session that ran it on 2026-05-02 was working off stale local `main` (the cutover commit `28f9100` that swapped the default Supabase ref from Mumbai to Tokyo had landed, but the deploy command was still given Mumbai's ref). MerQuant ERP has since added a banner-style guard idea to its session notes; whether to encode that as a hard check in the deploy script (e.g. "refuse unless target ref is in an allowlist file") is open.

---

## 6. Contact

If MAS team has questions, contact the MerQuant ERP repo maintainer (Waqas / `waqas.ahmed358@gmail.com`).

The full recovery trail for the MerQuant side is in:
- `cleanup/post-recovery-2026-05-05` (this branch) — verify-rls probe + Viewer role removal
- `feat/master-data-two-step-extraction` — Phase 2 master-data extraction work salvaged from a stale branch
- `feat/v2-ai-native-and-hardening` — the larger v2 feature set (29 commits, all post-origin/main, untouched today)
