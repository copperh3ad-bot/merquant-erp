# Migration Queue

These migrations live in `migrations/up/` at repo root (separate from the
Supabase-CLI-managed `supabase/migrations/` set). Apply them in the order
listed below via Supabase Dashboard → SQL Editor or via the Supabase CLI.
Numbering follows the repo convention of 4-digit zero-padded sequential IDs.

| #    | Filename                                       | Purpose                                                   | Manual dashboard step? |
|------|------------------------------------------------|-----------------------------------------------------------|------------------------|
| 0016 | `0016_error_log.sql`                           | Application error log table                               | No                     |
| 0017 | `0017_shop_floor.sql`                          | Shop-floor real-time piece tracking                       | No                     |
| 0018 | `0018_capacity.sql`                            | Capacity-plan AI allocations (extends existing table)     | No                     |
| 0019 | `0019_fabric_inventory.sql`                    | Fabric rolls + per-roll consumption                       | No                     |
| 0020 | `0020_job_work.sql`                            | Subcontractor job-work orders                             | No                     |
| 0021 | `0021_supplier_ai_score.sql`                   | Adds `ai_score` column to `supplier_performance`          | No                     |
| 0022 | `0022_buyer_rls.sql`                           | Buyer-role RLS scoping on POs / shipments / samples       | No                     |
| 0023 | `0023_exec_sql_owner_manager_only.sql`         | Tighten `exec_sql` role gate to {Owner, Manager}          | No                     |
| 0024 | `0024_owner_bootstrap.sql`                     | One-shot `bootstrap_first_owner()` RPC                    | No                     |
| 0025 | `0025_reenable_email_confirmation.sql`         | Re-enable email confirmation (DB triggers + activation)   | YES — Auth → Email → Confirm email = ON |
| 0026 | `0026_ai_proxy_rate_limit.sql`                 | `ai_proxy_calls` table + `check_ai_proxy_rate_limit` RPC  | No                     |
| 0027 | `0027_consumption_library_item_name.sql`       | Add `item_name` col + bump `upsert_key` UNIQUE to 6 cols  | No                     |
| 0028 | `0028_accessory_items_placement.sql`           | Add `placement` text col on `accessory_items` (MAS align) | No                     |

All 13 migrations (0016 → 0028) have been applied to the production DB
(`MerQuant ERP` Supabase project) as of 2026-05-04. They are tagged on
the live `supabase_migrations.schema_migrations` table by the
`mcp__supabase__apply_migration` calls that ran during the
`feat/v2-ai-native-and-hardening` branch work. (During that branch they
were authored under interim names `30_*.sql` … `40_*.sql`; the canonical
4-digit names were locked in at branch-split time.)

## Rollback

To roll back: apply the DOWN block of each migration in reverse order
(0026 → 0025 → … → 0016).

## Notes on coexistence with `supabase/migrations/`

- The timestamp-based migrations under `supabase/migrations/` are the
  primary auto-applied set used by the Supabase CLI. They include the
  earlier hardening work (PRs #34, #37, #38, #41).
- The numbered migrations in this `MIGRATION_QUEUE.md` are **applied
  manually** via the dashboard or `apply_migration` MCP.
- Some target tables (e.g. `capacity_plans`) already exist in the live DB.
  Those migration files use `CREATE TABLE IF NOT EXISTS` and
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS` so they are idempotent and
  do not collide with the existing schema.
