# MEGA_PROMPT Run — Final Summary

**Started:** 2026-05-08 (single session, ERP project `jcbxmpgjirxqszodotmx`)
**Status:** ✅ Complete — all 20 phases shipped
**Commits:** 16 (commit range `811f2e6..HEAD`)
**Diff:** 95 files changed, 33,291 insertions, 15 deletions
**Build:** ✅ green (last build 7.6s, 3115 modules)

This document is the canonical summary of what shipped, where it lives,
and what to know about it for future work or rollback. The detailed
phase-by-phase tracker is in `tasks/mega-todo.md`. Adaptation rationale
(why the original MAS plan diverged for ERP) is in
`tasks/mega-exploration.md` Appendix A.

## What was built

Five major feature areas integrated into MerQuant ERP, sharing a common
agentic substrate:

| # | Feature | Phases |
|---|---|---|
| 1 | Agent memory layer (write/read/consolidate) | 1, 3, 7, 16 |
| 2 | Agentic AI Assistant v2 with read+write tool gating | 4, 7 |
| 3 | Email-to-PO + IMAP + Email crawler agent | 5, 7, 3 |
| 4 | TNA Risk agent | 6, 7 |
| 5 | BOM/fabric calculator + auto-routed fabric orders | 8, 9, 10–15 |
| ⚪ | Realtime event triggers + orchestrator + cron | 2, 3, 16 |

## Database — 14 migrations applied

All applied to live DB (`jcbxmpgjirxqszodotmx`). See `MIGRATION_QUEUE.md`
for details.

| # | Filename | What |
|---|---|---|
| 0029 | `email_po_drafts.sql` | Staging table for AI-extracted PO drafts |
| 0030 | `email_crawler_agent.sql` | gmail_tokens + agent_run_log + email_crawl_log ALTERs |
| 0031 | `imap_credentials.sql` | imap_credentials + Vault encryption RPCs |
| 0032 | `tna_risk_agent.sql` | tna_risk_thresholds + tna_risk_drafts + risk cols on tna_milestones |
| 0033 | `agent_memory_layer.sql` | agent_memories + memory_retrieval_log + 2 retrieval RPCs |
| 0034 | `realtime_event_triggers.sql` | agent_events + 6 row-level triggers + fire_agent_event() |
| 0035 | `agent_action_policy.sql` | agent_action_policy (16-row seed) + agent_action_queue + execute_agent_action RPC |
| 0036 | `full_agentic_schedules.sql` | 6 pg_cron jobs (memory-consolidation, tna-risk daily, email-crawler 15min, expire-actions, cleanup-events, cleanup-pg-net) |
| 0037 | `bom_consumption_schema.sql` | size_masters (24 US bedding seeds) + article_components + bom_results + bom_set_totals + tech_pack_construction_specs + wastage_memory |
| 0038 | `thread_consumption_schema.sql` | stitch_library (16 ISO 4915 seeds) + article_seams + thread_bom_results + thread_bom_totals |
| 0039 | `po_fabric_requirements.sql` | po_fabric_requirements + RPC `calculate_po_fabric_requirements` (ERP rewrite — fans out per po_items.size_breakdown jsonb) |
| 0040 | `fabric_order_generation.sql` | facility_capabilities + fabric_order_drafts + 9 ALTERs to fabric_orders + match_facility_for_material RPC + 3 facility seeds |

## Edge functions — 12 deployed

12 new functions live on `jcbxmpgjirxqszodotmx`, all `verify_jwt = true`,
all version 1+ ACTIVE.

| Function | Purpose | Invoked by |
|---|---|---|
| memory-writer | Claude tool-use → agent_memories insert | orchestrator, ai-assistant, e2e tests |
| ai-assistant-v2 | Multi-tool agentic loop with policy-gated writes | UI (when `VITE_USE_AI_V2=true`) |
| email-po-agent | Paste-email → PO draft Claude extraction | EmailPOAgent.jsx, email-crawler-agent |
| imap-test-connection | ImapFlow-based credential validator | UI form |
| imap-credentials-save | Vault-encrypted IMAP password save | UI form |
| tna-risk-agent | Daily TNA risk classifier + buyer email drafter | pg_cron daily, UI manual |
| bom-calculator | Tech-pack parse + fabric+thread formula engine | UI BOMCalculator |
| po-fabric-calculator | Wraps `calculate_po_fabric_requirements` RPC | UI POFabricRequirements panel |
| fabric-order-generator | Capacity-first inhouse routing → fabric_order_drafts | UI FabricOrderDrafts panel |
| agent-orchestrator | Event router (DB triggers → agents) | mig 0034 triggers via pg_net |
| memory-consolidation-agent | Weekly memory-pattern distillation | pg_cron Sunday 20:00 UTC |
| email-crawler-agent | Gmail+IMAP polling → classify → email-po-agent | pg_cron every 15 min |

## Pages + components

**4 new pages** (registered in `src/pages.config.js` + sidebar):
- `AgentMemory` — memory browser + EventStreamPanel tab (Phase 16)
- `AgentActions` — action approval queue
- `EmailPOAgent` — paste-email PO extraction
- `TNARiskAgent` — TNA risk review queue
- `BOMCalculator` — fabric + thread BOM editor (Materials group)

**Embedded components** (wired into existing pages):
- `POFabricRequirements` → 5th tab in `PODetail.jsx`
- `FabricOrderDrafts` → "Generated Drafts" tab in `FabricOrders.jsx`
- `EventStreamPanel` → "Live Events" tab in `AgentMemory.jsx`
- `SeamEditor` (`SeamEditorTab` + `ThreadBOMResultsPanel`) → 3rd tab in `BOMCalculator.jsx`

**Standalone components** (drop-in usage):
- `EmailCrawlerAgentPanel` → ready for embedding in EmailCrawler or EmailPOAgent
- `ImapCredentialsForm` → ready for embedding alongside Gmail flow

## Pg_cron schedules

```
cron.job  schedule        purpose
─────────────────────────────────────────────────────────────────
1         every 15 min    email-crawler-agent
2         daily 02:00 UTC tna-risk-agent
3         Sun 20:00 UTC   memory-consolidation-agent
4         hourly          expire-agent-actions
5         daily 03:00 UTC cleanup-agent-events (30-day retention)
6         daily 04:00 UTC cleanup-pg-net-responses (7-day retention)
```

## Critical Supabase-platform adaptations

These are not in the original MAS spec — they are ERP-specific because
Supabase blocks operations that work on a self-hosted Postgres.

1. **`ALTER DATABASE ... SET app.service_role_key` is blocked** by Supabase
   on the `postgres` role.
   *Solution:* Store the service-role JWT in Vault as `service_role_key`.
   Both mig 0034 (`fire_agent_event`) and mig 0036 (cron jobs) read it via
   `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')`.

2. **Project ref needs to be hardcoded** (no GUC). All edge function URLs
   in mig 0034 + 0036 hardcode `jcbxmpgjirxqszodotmx`.

3. **Fire-and-forget across edge functions doesn't survive Deno isolate
   teardown.** When the orchestrator returned, in-flight outbound `fetch()`
   calls were killed mid-Anthropic-API-call. *Solution:* `await` all
   inter-function calls in the orchestrator (commit `97c0c9a`).
   Latency goes from ~2s to ~8s but the work actually completes.

4. **`agent_memories.entity_type` CHECK constraint** allows only
   `('buyer','supplier','article','agent','po')`. The orchestrator's
   trigger-derived entity_types (`'purchase_order'`, `'tna_milestone'`,
   etc.) failed the constraint. *Solution:* added `ENTITY_TYPE_MAP` in
   the orchestrator that translates trigger types → allowed memory types.

## ERP column-name patches (vs. MAS source)

These were applied throughout mig 0034, the orchestrator, and the BOM
edge functions. Documented in `tasks/mega-exploration.md` Appendix A.

| MAS column | ERP column | Tables |
|---|---|---|
| `tna_milestones.milestone_name` | `name` | mig 0034, orchestrator |
| `tna_milestones.calendar_id` | `tna_id` | mig 0034, mig 0035, orchestrator |
| `tna_milestones.due_date` | `target_date` | mig 0034, mig 0035, orchestrator, tna-risk-agent |
| `tna_milestones.completed_date` | `actual_date` | mig 0034, tna-risk-agent |
| `qc_inspections.result` | `verdict` | mig 0034 |
| `qc_inspections.defect_count` / `defect_types` | `critical_defects + major_defects + minor_defects` | mig 0034 |
| `articles.category` | `product_category` | bom-calculator |
| `articles.description` | `article_name` | bom-calculator |
| `articles.sku` | `article_code` | bom-calculator, mig 0039 |
| `po_items.article_id` | `master_article_id` | mig 0039 |
| `po_items.sku` / `style_number` | `style_sku` / `item_code` | mig 0039 |
| `po_items.size_code` (single) | `size_breakdown` (jsonb, fanned via `jsonb_each_text`) | mig 0039 |
| `po_items.description` | `item_description` | mig 0039 |
| `tna_calendars.season_name` / `active` / `created_by` / `completed_at` | (none — fields don't exist) | orchestrator |
| `tna_templates` (rows per milestone) | `tna_templates.milestones` (jsonb array) | orchestrator |
| `notifications.link` / `read` | `link_page + link_params` / `is_read` | orchestrator, memory-consolidation-agent |
| `buyer_contacts.company` / `name` | `customer_name` / `full_name` | tna-risk-agent |
| `purchase_orders.season_id` | (none — removed) | tna-risk-agent |
| `tna_calendars.active` filter | (none — removed; all rows considered active) | tna-risk-agent |
| `suppliers.type` | `category` (no `type` col) | fabric-order-generator |

## Verified end-to-end (Phase 17)

```
fire_agent_event('po.created', payload)
  └─ DB trigger writes agent_events row
  └─ pg_net.http_post → agent-orchestrator (verify_jwt + Vault auth)
        └─ marks event status=processing
        └─ routes to writeMemoryEvent action
        └─ awaits memory-writer fetch
              └─ memory-writer extracts memory via Claude tool-use
              └─ inserts agent_memories row (entity_type mapped)
        └─ marks event status=done
8466ms total latency, 0 errors, 1 memory written.
```

## Known limitations / follow-ups

These are deliberate cuts or future-work tickets — not bugs.

1. **mig 0039 size_breakdown fanout** uses simple per-key iteration. Per
   Appendix A.7, multi-size POs distribute fabric proportionally to each
   size's quantity, but the BOM lookup keys by `size_code`. If your BOM
   templates only define one set of dimensions per article (typical),
   this works fine. If they're size-specific (e.g. fitted-sheet skirt
   depth varies per size), make sure `bom_set_totals` has rows for each
   size you'll see in `size_breakdown` keys.

2. **Orchestrator's `runTargetedTnaRisk` action** passes
   `{ calendar_id }` to tna-risk-agent. The agent currently ignores that
   parameter and scans all calendars — fine for now but a future
   optimisation would let it run targeted (mig 0034 sends the
   risk-escalated milestone's calendar id).

3. **`bom-calculator-thread-patch.ts`** lives in
   `supabase/functions/bom-calculator/thread-patch.ts` rather than in
   `_shared/`. This is intentional — it's bom-calculator-specific glue.
   The pure formula engines DO live in `_shared/` and are used by both
   bom-calculator (via thread-patch) and ai-assistant-v2 (when it calls
   bom calculations as a tool, not yet wired up but possible).

4. **BOM/thread self-tests** (`tasks/run-bom-tests.ts`, 10/10 passing)
   are not wired into CI. Run manually with
   `node --experimental-strip-types tasks/run-bom-tests.ts` after
   modifying either formula engine. Consider adding to a pre-push hook.

5. **`.claude/`** worktrees directory is untracked but not gitignored.
   Created by Claude during this run; safe to delete or leave.

## Cleanup done

- ✅ Test events deleted from `agent_events`
- ✅ Test memories deleted from `agent_memories`
- ✅ Build verified green
- ✅ All migrations recorded in `MIGRATION_QUEUE.md`
- ✅ All edge functions ACTIVE on live (verified via `supabase functions list`)

## Cleanup deferred (your call)

- `_claude-code-ready/` — the original MAS source files (716 KB,
  36 entries). Now redundant since everything was integrated and patched.
  Safe to archive into a tarball or delete:
  ```bash
  tar czf _claude-code-ready.tar.gz _claude-code-ready/ && rm -rf _claude-code-ready/
  ```
  Keeping it for now in case you want to diff against the originals.

- `.env.old-project-backup` — predates this run. Not touched.

## Files of interest

| Path | What it is |
|---|---|
| `tasks/mega-todo.md` | Phase tracker with [x]/[ ] markers |
| `tasks/mega-exploration.md` | Adaptation analysis + Appendix A column maps |
| `tasks/MEGA_PROMPT_SUMMARY.md` | This file |
| `tasks/NETLIFY_ENV.md` | Production env-var checklist |
| `tasks/run-bom-tests.ts` | 10-test self-test runner for the formula engines |
| `MIGRATION_QUEUE.md` | All 14 new migrations + apply status |
| `migrations/up/0029-0040*.sql` | All 12 ERP-adapted migration files |
| `supabase/functions/_shared/{bom,thread}-formula-engine.ts` | Pure deterministic formula engines |
| `supabase/config.toml` | verify_jwt settings for all 12 new edge fns |

---

🎯 **The MEGA_PROMPT integration is complete.** ERP now has a real-time
agentic substrate, BOM/fabric automation, agent memory with weekly
consolidation, and a TNA risk agent — all gated by role-based auth and
human-approval queues for destructive actions.
