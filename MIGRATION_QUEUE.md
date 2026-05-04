# Migration Queue

These migrations live in `migrations/` at repo root (separate from the
Supabase-CLI-managed `supabase/migrations/` set). Apply them in the order
listed below via Supabase Dashboard → SQL Editor or via the Supabase CLI.
Every entry has both an UP and a DOWN block for full rollback.

| #   | Filename                                  | Purpose                                                   | Manual dashboard step? |
|-----|-------------------------------------------|-----------------------------------------------------------|------------------------|
| 30  | `30_error_log.sql`                        | Application error log table                               | No                     |
| 31  | `31_shop_floor.sql`                       | Shop-floor real-time piece tracking                       | No                     |
| 32  | `32_capacity.sql`                         | Capacity-plan AI allocations (extends existing table)     | No                     |
| 33  | `33_fabric_inventory.sql`                 | Fabric rolls + per-roll consumption                       | No                     |
| 34  | `34_job_work.sql`                         | Subcontractor job-work orders                             | No                     |
| 35  | `35_supplier_ai_score.sql`                | Adds `ai_score` column to `supplier_performance`          | No                     |
| 36  | `36_harden_exec_sql.sql`                  | Lock down `exec_sql` to authenticated only                | No                     |
| 37  | `37_owner_bootstrap.sql`                  | First-owner bootstrap function                            | No                     |
| 38  | `38_reenable_email_confirmation.sql`      | Re-enable email confirmation in Supabase Auth             | YES — Auth → Email → Confirm email = ON |
| 39  | `39_ai_rate_limit.sql`                    | `ai_proxy_calls` rate-limit log                           | No                     |
| 40  | `40_buyer_rls.sql`                        | Buyer-role RLS scoping on POs + shipments                 | No                     |

## Rollback

To roll back: apply the DOWN block of each migration in reverse order
(40 → 39 → ... → 30).

## Notes on coexistence with `supabase/migrations/`

- The timestamp-based migrations under `supabase/migrations/` are the
  primary auto-applied set used by the Supabase CLI. They include the
  earlier hardening work (PRs #34, #37, #38, #41).
- The numbered migrations in this `MIGRATION_QUEUE.md` are **applied
  manually** via the dashboard or `apply_migration` MCP. They were
  pre-assigned numbers 30-40 before being authored.
- Some target tables (e.g. `capacity_plans`) already exist in the live DB.
  Those migration files use `CREATE TABLE IF NOT EXISTS` and
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS` so they are idempotent and
  do not collide with the existing schema.
