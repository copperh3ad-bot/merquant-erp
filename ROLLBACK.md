# Rollback Point

**Created:** 2026-05-04
**Commit:** `ae6360745df55ad38d07dc966c5d3a0a3fd71f58`

This file marks the pre-state for the MerQuant v2 — AI-native feature parity
+ hardening pass. Use the instructions below to revert in part or in full.

---

## To roll back the entire v2 pass

```sh
git revert --no-commit $(cat .rollback-point)..HEAD
git commit -m "revert: full rollback to pre-v2 state"
```

## To roll back a single phase

Find the phase boundary commit in `git log` by its message prefix
(`feat(phase-1)`, `feat(phase-2)`, `feat(phase-3)`) and revert from that
commit forward.

## DB rollback

Every numbered migration in [`MIGRATION_QUEUE.md`](MIGRATION_QUEUE.md) ships
with both an UP and a DOWN block. To roll back the database:

1. Identify the highest migration that was applied (check
   `supabase_migrations.schema_migrations` or the queue file).
2. Apply DOWN blocks in reverse order via the Supabase Dashboard SQL editor
   or the Supabase CLI.

The repo also keeps the original `supabase/migrations/` timestamp-based
files. Those are the "main line" migrations that the Supabase CLI auto-
applies. The new `migrations/up/0016-0026` files in this pass are
**manual-apply only** — they live alongside the timestamp set rather
than replacing it.

---

## Pass summary (final, 2026-05-04)

- [x] Phase 1 (S1-S8) — system shortcomings: domain-module re-export
      shells; React Query + optimistic updates on PO approval; Realtime
      subscriptions on PODetail / Dashboard; null-safety + structured
      logger + `error_log` table; postgres → devDeps. (S7 xlsx → exceljs
      deferred — CVE risk already mitigated via pinning + SRI per the
      original audit Finding 14.)
- [x] Phase 2 (F1-F8) — AI-native feature parity:
      F1 ShopFloor, F2 CapacityPlanning AI allocate, F3 FabricInventory
      with shade grouping + shortage alerts, F4 JobWork with AI cost
      estimate + jspdf gate-pass, F5 BuyerPortal with cost-blind chat
      and RLS-scoped reads, F6 PWA + AIVoiceEntry (5-page responsive
      overrides deferred — pages already use Tailwind responsive
      classes), F7 SupplierPerformance ai_score, F8 NLM schema
      context update.
- [x] Phase 3 — hardening:
      C1 (scrub manifest), C2 (ai-proxy verify_jwt + admin client),
      C3 (exec_sql Owner/Manager-only, mig 0023),
      C4 (`bootstrap_first_owner`, mig 0024),
      H2 (netlify CSP + security headers),
      M2 (email confirmation re-enabled, mig 0025),
      AI-RL (ai-proxy per-user rate limit, mig 0026),
      M3 (full CI workflow), L3 (Dependabot), M4 (xlsx purge),
      D2 (pre-commit secret scan), Q3 (costing/BOM lib + 23 tests).
- [x] Final build + tests + lint pass: 465/465 tests, build clean.

If something needs to be undone, the per-commit messages on the
`feat/v2-ai-native-and-hardening` branch document each change in
isolation — `git log --oneline` then `git revert <sha>` is the
fine-grained path.
