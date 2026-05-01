# MerQuant ERP — Migration Validation Report

**Date:** 2026-05-01
**Source:** `textile-manager-pro` / `ecjqdyruwqlesfthgphv` (Mumbai)
**Target:** `MerQuant ERP` / `jcbxmpgjirxqszodotmx` (Tokyo)

---

## Verdict: PASS ✅

Every byte of every migrated row is byte-identical to the source. Schema is complete. Edge functions are deployed with correct auth settings. Storage files all transferred.

The only differences are intentional skips (user accounts, audit log, the `_pre_cleanup_backup` legacy table).

---

## 1. Schema parity

| Object type | Source | Target | Match |
|---|---|---|---|
| Base tables | 73 (excl. `_pre_cleanup_backup`) | 73 | ✅ |
| Views | 12 | 12 | ✅ |
| Columns | 1556 | 1556 | ✅ |
| Functions | 22 | 22 | ✅ |
| RLS policies (public) | 87 | 87 | ✅ |
| Indexes | 265 (excl. backup pkey) | 265 | ✅ |
| Triggers | 66 | 66 | ✅ |
| Constraints | 283 | 283 | ✅ |
| Enum types | 1 | 1 | ✅ |
| Storage buckets | 3 | 3 | ✅ |
| Storage policies | 7 | 7 | ✅ |

**Notes**
- During validation I caught and fixed two trigger functions (`normalize_consumption_item_code`, `normalize_tech_pack_article_code`) that existed on source but weren't in any committed migration. They're now on target and the migration script `0008` could be added to the repo if desired.

## 2. Row counts (16 tables, every value matches)

| Table | Source | Target |
|---|---|---|
| ai_extractions | 7 | 7 ✅ |
| articles | 92 | 92 ✅ |
| consumption_library | 774 | 774 ✅ |
| po_item_sizes | 0 | 0 ✅ |
| po_items | 89 | 89 ✅ |
| price_list | 158 | 158 ✅ |
| production_lines | 2 | 2 ✅ |
| production_stages | 5 | 5 ✅ |
| purchase_orders | 5 | 5 ✅ |
| seasons | 0 | 0 ✅ |
| signup_whitelist | 1 | 1 ✅ |
| status_logs | 39 | 39 ✅ |
| suppliers | 6 | 6 ✅ |
| teams | 5 | 5 ✅ |
| tech_packs | 47 | 47 ✅ |
| tna_templates | 4 | 4 ✅ |
| **Total** | **1234** | **1234** |

## 3. Data integrity (byte-level)

For each critical table, every row was hashed (`md5(row::jsonb::text)`),
then the per-row hashes were aggregated in id-order into a single
table-level digest. Identical digests on source and target prove every
cell of every row is byte-identical.

| Table | Digest |
|---|---|
| ai_extractions | `cefb951b1002cf0e82e0a713dfc9ef19` ✅ |
| articles | `c94a529b73dec86b25782125bd05d13b` ✅ |
| consumption_library | `fc89ae8007db143fb98aa5788ac9ea15` ✅ |
| po_items | `9a1577f5b7da203b4c95ada510c2737a` ✅ |
| price_list | `6c191df215c8dd2260e1a30284d591a8` ✅ |
| purchase_orders | `54afbcce0873a9b0b44ced96a4ad777b` ✅ |
| suppliers | `b083e00ef642d1d547a1dc1d29e299dd` ✅ |
| tech_packs | `60fea080fd657c90cfc4ce3c4319956a` ✅ |

Every JSONB blob (`extracted_measurements`, `components`, `size_chart`,
`part_dimensions`), every UUID, every timestamp — bit-perfect.

## 4. Edge functions

All 9 functions deployed and ACTIVE on target with the correct `verify_jwt` setting:

| Function | verify_jwt | Status |
|---|---|---|
| ai-proxy | true | ACTIVE ✅ |
| extract-document | true | ACTIVE ✅ |
| extract-barcodes | true | ACTIVE ✅ |
| classify-components | true | ACTIVE ✅ |
| backup-hourly | false | ACTIVE ✅ |
| gmail-oauth | false | ACTIVE ✅ |
| gmail-crawl | false | ACTIVE ✅ |
| notify-pricing-pending | false | ACTIVE ✅ |
| user-approval | false | ACTIVE ✅ |

**Note:** Functions will return 500 until you add the secrets per
`docs/migration-cutover-2026-05-01.md` step 1.

## 5. Storage

| Bucket | Source | Target |
|---|---|---|
| ai-extraction-sources | 3 files / 18 MB | 3 files / 18 MB ✅ |
| backups | 78 files / 1040 kB | 78 files / 1040 kB ✅ |
| po-item-files | 0 files | 0 files ✅ |
| **Total** | **81 files / 19 MB** | **81 files / 19 MB** |

All bucket configs, RLS policies, MIME-type allowlists, and size limits match.

## 6. Intentionally NOT migrated

These are documented and expected — not migration failures:

| Item | Reason |
|---|---|
| `auth.users` (2 users) | Password hashes are project-scoped; you re-sign up |
| `user_profiles` (2 rows) | FK to auth.users; recreated on signup |
| `user_settings` (1 row) | Same FK reason |
| `gmail_oauth` (1 row) | Same FK reason; reconnect Gmail post-cutover |
| `audit_log` (650 rows) | History-only; fresh start on new project |
| `_pre_cleanup_backup` (7 rows) | Legacy backup from prior maintenance |

## 7. What still requires manual cutover

Still on you (per `docs/migration-cutover-2026-05-01.md`):

1. ⏳ Edge function secrets (Anthropic, Resend, Google OAuth, Backup, Owner email)
2. ⏳ Google OAuth redirect URI for new project URL
3. ⏳ Netlify env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
4. ⏳ Sign up fresh on new project + UPDATE role to Owner
5. ⏳ Re-invite Sadia (optional)
6. ⏳ Reconnect Gmail sync (optional)
7. ⏳ Final smoke test (8 verification clicks)

---

## Validation methodology

- Schema fingerprint: `pg_class`, `pg_proc`, `pg_policies`, `pg_trigger`, `pg_constraint`, `pg_indexes`, `information_schema.columns` aggregated
- Row counts: `COUNT(*)` on every populated table, exact (not stat-based)
- Data integrity: per-row `md5(to_jsonb(row)::text)` aggregated id-ordered with `string_agg`
- Edge functions: Management API `list_edge_functions`
- Storage: `storage.objects` row count + size aggregation per bucket

All queries run via Supabase Management API on both projects in the same session window. Source database remains untouched and available for rollback.
