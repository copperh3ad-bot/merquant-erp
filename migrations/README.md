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

## History

- `0001_init.sql` — baseline dump captured 2026-04-26 (72 tables, 77 functions, 87 policies)
