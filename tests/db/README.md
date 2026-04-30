# DB tests — manual / pgTAP-ready stubs

These SQL files cover spec §8 tests 15–23 for the AI extraction pipeline.

**Why they don't run in CI:** the spec's hard constraint says no test Supabase
project is provisioned yet. Running these against the live project would
create test rows in production tables.

## How to use them today (manual smoke test)

1. Pick one of the `.sql` files.
2. Open **Supabase Dashboard → SQL Editor** for project `ecjqdyruwqlesfthgphv`.
3. Paste the file contents and run it section by section. Each `RAISE NOTICE`
   reports an expected vs. actual outcome; failures show the divergence.
4. The cleanup block at the bottom of each file removes the test rows it
   created. **Always run the cleanup block** before closing the editor.

## How to use them later (CI integration)

When a test Supabase project is provisioned (or Supabase branching is wired
into CI), each file can be wrapped in `BEGIN;` / `ROLLBACK;` and run by
pgTAP or a plain `psql -v ON_ERROR_STOP=1 -f`. The assertion style here
(`RAISE EXCEPTION ... WHEN ...`) maps cleanly to pgTAP `ok()` calls.

## Files

| File | Spec §8 test # | Covers |
|---|---|---|
| `ai_extractions_table.sql` | 15–17 | table defaults, updated_at trigger, kind check constraint |
| `apply_tech_pack.sql`     | 18–20 | validation gate, idempotency, happy path |
| `apply_master_data.sql`   | 21    | upsert returns target ids per section |
| `reject_extraction.sql`   | 22    | review_status=rejected, rejected_by=auth.uid() |
| `rls_smoke.sql`           | 23    | authenticated select+insert; anon denied |

## Limitations

- Manual runs cannot exercise `auth.uid()` cleanly (the SQL editor runs as
  service role). Files that depend on `auth.uid()` are flagged in their
  headers and validated against the assumption that the dashboard impersonates
  a known user.
- Edge function calls (extract-document) are not testable from SQL — those
  are covered by the unit tests + manual UI smoke test.
