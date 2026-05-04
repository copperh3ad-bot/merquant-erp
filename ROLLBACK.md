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
applies. The new `migrations/30-40` files in this pass are **manual-apply
only** — they live alongside the timestamp set rather than replacing it.

---

## Pass summary

To be filled in at the end of the pass.

- [ ] Phase 1 (S1-S8) — system shortcomings
- [ ] Phase 2 (F1-F8) — AI-native feature parity
- [ ] Phase 3 (C1-C4, H2, AI-RL, M2-M4, L3, D2, Q3) — hardening
- [ ] Final build + tests + lint pass
