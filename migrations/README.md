# Migrations

Schema migrations for MerQuant ERP, applied via Supabase SQL editor or `psql`.

## Conventions

- One numbered file per migration: `NNNN_<slug>.sql`
- `up/` contains forward migrations
- `down/` contains reversal migrations (when feasible)
- Numbering is monotonic, no skipping

## Applying

```bash
psql "<session-pooler-uri>" -f migrations/up/NNNN_<slug>.sql
```

Or paste contents into Supabase Dashboard → SQL Editor → Run.

## Dual-folder layout

There are TWO migration folders in this repo:

| Folder | Purpose |
|---|---|
| `migrations/up/` (this folder) | Canonical, hand-numbered files (`0001_init.sql`, `0013_harden_exec_sql.sql`, …). Applied via `psql` or the per-migration applier scripts in `scripts/apply-NNNN.mjs`. This is what humans read and edit. |
| `supabase/migrations/` | Mirror used by the **Supabase GitHub integration**. Filenames follow the Supabase CLI's `YYYYMMDDHHMMSS_slug.sql` convention. The integration compares this folder against `supabase_migrations.schema_migrations` on the live DB; missing files break the Supabase Preview check. |

When you ship a new migration:
1. Add the numbered file to `migrations/up/` and apply it via the
   applier script (the standard path used by every commit so far).
2. **If the migration is also tracked in `supabase_migrations.schema_migrations`**
   (most aren't — only ones applied via `supabase db push` are), mirror
   the SQL into `supabase/migrations/` with a matching `YYYYMMDDHHMMSS_*` filename.
3. The migrations applied via the Management API
   (`scripts/apply-NNNN.mjs`) do NOT register in `schema_migrations`,
   so they don't usually need a `supabase/migrations/` mirror — only
   the older CLI-applied ones do.

## History

- `0001_init.sql` — baseline dump captured 2026-04-26 (72 tables, 77 functions, 87 policies)
- `0007_security_hardening_critical.sql` — closed 3 RLS holes from the 2026-05-01 audit
- `0010_backfill_auth_user_created_trigger.sql` — captures an auth-schema trigger that `pg_dump --schema=public` misses
- `0011_restore_supabase_default_grants.sql` — recreates anon/authenticated grants nuked by `DROP SCHEMA public CASCADE`
- `0012_explode_po_bom_field_fallbacks.sql` — `CREATE OR REPLACE explode_po_bom` with field-name fallback helpers
- `0013_harden_exec_sql.sql` — Finding 9 closure: drops SECURITY DEFINER, adds role gate, rejects multi-statement injection
- `0014_storage_per_user_scoping.sql` — Finding 15 closure: ai-extraction-sources bucket scoped to `owner = auth.uid()`
- `0015_encrypt_gmail_refresh_token.sql` — Finding 10 closure: pgcrypto encryption for Gmail OAuth tokens
