# MEGA_PROMPT Adaptation — Exploration Report

**Repo:** `D:\merquant-erp`
**Generated:** 2026-05-08
**Status:** ⏸️ AWAITING SIGN-OFF before any phase executes

The MEGA_PROMPT was authored for the **MAS** project. This document
catalogues every concrete adaptation needed to safely run it against
**ERP** instead, plus blockers that must be resolved manually.

---

## 1 · Project ref — corrected

| | |
|---|---|
| MEGA_PROMPT value | `ecjqdyruwqlesfthgphv` (MAS / textile-manager-pro) |
| **ERP correct value** | `jcbxmpgjirxqszodotmx` (from `.env` `VITE_SUPABASE_URL`) |
| Replace in | Phase 2 (`fire_agent_event` ALTER), Phase 18 final SQL, any HTTP base-URL in edge fns / migrations |

---

## 2 · Migration numbering — corrected

Last migration in `migrations/up/` is `0028_accessory_items_placement.sql`. The MEGA_PROMPT wants to add 12 new migrations under the integers 30-39 + 41-42. Re-numbered to ERP's 4-digit padded scheme:

| MEGA_PROMPT name | ERP target name |
|---|---|
| `30_email_po_drafts.sql` | `0029_email_po_drafts.sql` |
| `31_email_crawler_agent.sql` | `0030_email_crawler_agent.sql` |
| `32_imap_credentials.sql` | `0031_imap_credentials.sql` |
| `33_tna_risk_agent.sql` | `0032_tna_risk_agent.sql` |
| `34_agent_memory_layer.sql` | `0033_agent_memory_layer.sql` |
| `35_realtime_event_triggers.sql` | `0034_realtime_event_triggers.sql` |
| `36_agent_action_policy.sql` | `0035_agent_action_policy.sql` |
| `37_full_agentic_schedules.sql` | `0036_full_agentic_schedules.sql` |
| `38_bom_consumption_schema.sql` | `0037_bom_consumption_schema.sql` |
| `39_thread_consumption_schema.sql` | `0038_thread_consumption_schema.sql` |
| `41_po_fabric_requirements.sql` | `0039_po_fabric_requirements.sql` |
| `42_fabric_order_generation.sql` | `0040_fabric_order_generation.sql` |

Migration 40 (cutting room) is explicitly skipped per prompt (line 532).

---

## 3 · "Already applied from prior session" claim — FALSE

The MEGA_PROMPT (line 96-99) says ERP's migrations 30-33 are already applied. **They are not.** Live-DB existence check confirmed: of the 24 tables those migrations create or seed, only `email_crawl_log` exists — and that's ERP's own much richer Gmail-pipeline table (32 columns), not the MAS one.

| Table the prompt expects "already there" | Exists on ERP? | Action |
|---|---|---|
| `email_po_drafts` | ❌ | Apply migration 0029 fresh |
| `gmail_tokens` | ❌ | Apply 0030 fresh |
| `agent_run_log` | ❌ | Apply 0030 fresh |
| `imap_credentials` | ❌ | Apply 0031 fresh |
| `tna_risk_thresholds` | ❌ | Apply 0032 fresh |
| `tna_risk_drafts` | ❌ | Apply 0032 fresh |
| `email_crawl_log` | ✅ (ERP gmail-crawl owns it) | **Do NOT recreate.** ALTERs in mig 0030 + 0031 (`ADD COLUMN IF NOT EXISTS`) are additive; safe — they bolt on new fields without touching ERP's existing 32 columns |

So Phase 5 reads "check, then apply" — and on ERP it'll always need to apply. No skip path actually fires.

---

## 4 · Postgres extensions — BLOCKERS

| Extension | Required by | Currently enabled? | Action |
|---|---|---|---|
| `supabase_vault` | mig 0031 (IMAP password encryption) | ✅ v0.3.1 | none |
| **`pg_cron`** | mig 0036 (full_agentic_schedules) | ❌ MISSING | **Manual: enable via Supabase Dashboard → Database → Extensions** |
| **`pg_net`** | mig 0034 (`net.http_post` to fire orchestrator) + mig 0036 (`net.http_post` from cron jobs) | ❌ MISSING | **Manual: enable via Dashboard** |

Without `pg_cron` and `pg_net` enabled, migrations 0034 and 0036 will **fail at apply time**. These cannot be enabled by an SQL migration — they require Supabase Dashboard access (or `supabase_admin` role).

**Recommendation:** stop and enable these two extensions before Phase 2 of the run. If you'd rather defer them, we can also rewrite migrations 0034 and 0036 to skip the trigger function bodies and cron registrations (defeating the agentic real-time path) — not recommended.

---

## 5 · Schema column mismatches — every adaptation needed

Prompt assumed many column names that don't exist in ERP. Cataloguing them so Phase 0 (the prompt's own exploration step) doesn't have to be re-run:

### `po_items` (used by mig 0039 RPC, Phase 11 po-fabric-calculator)

| Prompt assumed | ERP actual | Adaptation |
|---|---|---|
| `po_items.article_id` (FK) | ❌ does not exist | Use `master_article_id` (uuid) |
| `po_items.sku` | ❌ does not exist | Use `style_sku` (text) or `item_code` |
| `po_items.size_code` | ❌ does not exist | Sizes live in `size_breakdown` (jsonb) and `size_labels` (text array) — RPC needs to unfold these |
| `po_items.quantity` | ✅ `quantity` (int) | none |

### `fabric_orders` (used by mig 0040 + Phase 12 generator)

| Prompt assumed | ERP actual | Adaptation |
|---|---|---|
| `material_description` | ❌ | Use `fabric_type` + `quality_spec` |
| `quantity` (generic) | ❌ | Use `quantity_meters` (numeric) |
| `unit` | ❌ | Always meters; drop or hardcode |
| `supplier_id` (FK) | ❌ | No FK column; use `mill_name` (text) |
| `po_id`, `status`, `created_at` | ✅ all exist | none |

### `articles` (Phase 13 BOMCalculator)

| Prompt assumed | ERP actual | Adaptation |
|---|---|---|
| `articles.sku` | ❌ | Use `article_code` |
| `articles.category` | ⚠️ exists as `product_category` | Rename in Phase 8 mig 0037 column refs + Phase 10 inferCategory |
| `articles.description` | ❌ (text-shape) | Use `article_name` + `notes` |

### `tech_packs` (Phase 10 bom-calculator)

| Prompt assumed | ERP actual | Adaptation |
|---|---|---|
| `tech_packs.style_name` | ❌ | Use `article_name` |
| `tech_packs.raw_text` | ❌ | No raw text column. Use the seven `extracted_*` JSONB columns (`extracted_data`, `extracted_fabric_specs`, etc.) |
| `tech_packs.extracted_data` | ✅ (jsonb) | none |
| `tech_packs.fabric_content` | ❌ | Use `extracted_fabric_specs` (jsonb) |
| `tech_packs.construction_notes` | ❌ | Use `extracted_construction` (jsonb) |

### `tna_milestones` (mig 0032 risk thresholds, Phase 6)

| Prompt assumed | ERP actual | Adaptation |
|---|---|---|
| `milestone_name` | ❌ | Column is `name` |
| Mig 0032 INSERT seeds 11 milestone names | ⚠️ Need to verify against actual `name` values in DB | Run `SELECT DISTINCT name FROM tna_milestones LIMIT 50;` and adapt the seed |

### `tna_templates` (Phase 3 orchestrator's `seedTnaCalendar`)

| Prompt assumed | ERP actual | Adaptation |
|---|---|---|
| `tna_templates.offset_days` (column) | ❌ | Schema is `id, name, product_type, milestones (jsonb), is_default, default_for_customer_name, created_at` — all the per-milestone offset_days are inside the `milestones` jsonb array. Orchestrator must unfold the jsonb |

### `suppliers` (Phase 12 fabric-order-generator)

| Prompt assumed | ERP actual | Adaptation |
|---|---|---|
| `name`, `status`, `category` | ✅ all exist | none |
| `type` | ⚠️ ERP uses `supplier_type` | Rename in query |

---

## 6 · Edge-function overlap audit

| Function the prompt wants | Already on ERP? | Decision |
|---|---|---|
| `ai-proxy` | ✅ (with v2 hardening: rate limit + admin client) | Don't touch. Prompt's Phase 4 adds NEW `ai-assistant-v2` alongside via feature flag — that's correct |
| `gmail-oauth` | ✅ (v2, full Gmail OAuth flow used by `EmailCrawler` + `GmailCallback.jsx`) | Don't touch. **Skip placing `gmail-oauth-exchange`** (Phase 5). Adapt new email agents to call existing `gmail-oauth` instead — same exchange/refresh logic |
| `gmail-crawl` | ✅ (243 lines, current production crawler) | Coexists with new `email-crawler-agent`. The new one is the agentic version that writes to `email_po_drafts`. Existing one continues to write to `email_crawl_log` directly. Wire the EmailCrawler page to expose both |
| `extract-document`, `extract-barcodes`, `classify-components`, `backup-hourly`, `notify-pricing-pending`, `user-approval` | ✅ all live | None of these are touched by the prompt |
| `email-po-agent` | ❌ | NEW — place from prompt |
| `email-crawler-agent` | ❌ | NEW — place. Adapt to call existing `gmail-oauth` for token exchange |
| `imap-test-connection` | ❌ | NEW — place |
| `imap-credentials-save` | ❌ | NEW — place |
| `tna-risk-agent` | ❌ | NEW — place |
| `memory-writer` | ❌ | NEW — place |
| `agent-orchestrator` | ❌ | NEW — place |
| `ai-assistant-v2` | ❌ | NEW — place |
| `memory-consolidation-agent` | ❌ | NEW — place |
| `bom-calculator` | ❌ | NEW — place |
| `po-fabric-calculator` | ❌ | NEW — place |
| `fabric-order-generator` | ❌ | NEW — place |

**Net new edge functions: 12** (not 13 — `gmail-oauth-exchange` skipped per overlap rule).

---

## 7 · Frontend wiring shape — corrected

### Supabase client import path

Prompt asked: `js or ts?` → ERP has **`src/api/supabaseClient.js`** (no `src/lib/supabaseClient.*`). Imports use `@/api/supabaseClient` via the Vite alias (or `../../api/supabaseClient` for relative). Every prompt-side file that imports `from '../lib/supabaseClient'` must be patched.

### `useAuth()` return shape

```js
// from src/lib/AuthContext.jsx line 147
{
  session, user, profile, role, team,
  isOwner, isManager, isMerchandiser, isAdmin, isPending, isRejected,
  isLoading,
  can, canSeePage, canSeeField,
  signIn, signUp, signOut, resetPassword, updateProfile, refreshProfile, fetchProfile,
}
```

No `customers` or `canSeeCustomer` (that's a MAS-only feature deliberately not ported per earlier T1.5 decision).

### `App.jsx` route pattern

```jsx
<Routes>
  <Route path="/" element={<RouteGuard pageName={mainPageKey}>...</RouteGuard>} />
  {pageKeys.map((path) => (
    <Route key={path} path={`/${path}`} element={<RouteGuard pageName={path}>...</RouteGuard>} />
  ))}
  <Route path="*" element={...} />
</Routes>
```

Routes are **driven by the `PAGES` map keys** — they're auto-registered. Adding a page means adding it to `pages.config.js` PAGES map; **no manual `<Route>` JSX edit needed in App.jsx.**

This invalidates the prompt's "Wire into App.jsx: Add route: /agent-memory" instructions — the right place is `pages.config.js`.

### `pages.config.js` entry format

It's a **flat `{ key: ComponentClass }` map**, NOT a `{ key: { module, icon, roles, ... } }` object as the prompt assumed (Phase 7 line 489-493 is wrong shape).

```js
export const PAGES = {
  PurchaseOrders: PurchaseOrders,
  AIAssistant:    AIAssistant,
  ...
};
```

The metadata (icon, group, permission) lives in **`Layout.jsx`** instead.

### `Layout.jsx` sidebar entry format

```js
{ group: "Orders", name: "Email Crawler", icon: Inbox, page: "EmailCrawler", permission: "PO_CREATE" }
```

Keys: `group` (string — section header), `name` (display label), `icon` (lucide-react component reference), `page` (key matching `PAGES`), optional `permission` (matches `PERMISSIONS` in `permissions.js`), optional `accent`/`pinned`/`badge`.

### Pages that already exist (skip create / use existing)

- ✅ `AIAssistant.jsx` → wire feature flag (Phase 4 OK)
- ✅ `EmailCrawler.jsx` → embed `EmailCrawlerAgentPanel` + `ImapCredentialsForm` as new tabs (Phase 7 OK)
- ✅ `FabricOrders.jsx` → embed `FabricOrderDrafts` as new tab (Phase 15 OK)
- ✅ `PODetail.jsx` → already a separate page, embed `POFabricRequirements` as new tab (Phase 14 Case A)
- ✅ `GmailCallback.jsx` → **already exists.** Skip prompt's Phase 7 instruction to "create src/pages/GmailCallback.jsx". Verify the existing one works with the new flow; if it calls the existing `gmail-oauth` it likely already does what's needed
- ✅ `TNACalendar.jsx` → exists; wire `TNARiskAgent` link from it if useful

---

## 8 · Cron-job project ref — correction

Mig 0036 (`full_agentic_schedules.sql`) registers pg_cron jobs that POST to edge functions via `net.http_post`. The base URL is built from `app.supabase_project_ref`. **All occurrences of `ecjqdyruwqlesfthgphv` in the migration must be replaced with `jcbxmpgjirxqszodotmx`** before applying. Plus the prompt's Phase 18 final ALTER:

```sql
-- WRONG (MEGA_PROMPT line 1043)
ALTER DATABASE postgres SET app.supabase_project_ref = 'ecjqdyruwqlesfthgphv';

-- CORRECT for ERP
ALTER DATABASE postgres SET app.supabase_project_ref = 'jcbxmpgjirxqszodotmx';
```

---

## 9 · Service-role key — required setup for cron HTTP calls

`net.http_post` from migrations needs an Authorization header with the service-role key. Prompt assumes `app.service_role_key` is already set in DB. **It is not on ERP.** Required pre-Phase-3 setup:

```sql
ALTER DATABASE postgres SET app.service_role_key = '<service-role-key>';
```

The key value lives in Supabase Dashboard → Project Settings → API. **Manual step — not scriptable from inside a migration.** Must be done before any cron job actually fires.

---

## 10 · Adapted phase order

The prompt's 20 phases stay; key adaptations per phase:

| Phase | Adaptation |
|---|---|
| 0 | DONE (this document is the deliverable). `tasks/mega-todo.md` to be created at run-start |
| 1 | Apply mig **0033** (renamed). All seed data + RLS additive |
| 2 | Apply mig **0034**. **Replace project ref in migration body before applying.** Requires `pg_net` enabled |
| 3 | Apply migs **0035 + 0036**. Mig 0036 cron jobs require `pg_cron` + `pg_net` + `app.service_role_key` set. **If extensions not enabled, defer 0036.** Adapt orchestrator's `seedTnaCalendar` to read offsets from `tna_templates.milestones` jsonb (not `offset_days` column) |
| 4 | Place `ai-assistant-v2` edge fn. Verify `exec_sql` RPC exists (it does — see commit 4a3572e earlier this branch) |
| 5 | Apply migs **0029, 0030, 0031**. `email_crawl_log` ALTERs are additive — safe. Mig 0031 (vault) — extension is enabled. **Skip placing `gmail-oauth-exchange`** — adapt agents to call existing `gmail-oauth` |
| 6 | Apply mig **0032**. **Re-seed `tna_risk_thresholds` against actual `tna_milestones.name` values in this DB** (must run `SELECT DISTINCT name FROM tna_milestones`). Skip placing `tna-risk-agent` if it already exists (it doesn't — verified, no overlap) |
| 7 | Place 4 pages. Use `@/api/supabaseClient` import path. Wire via `pages.config.js` PAGES map + `Layout.jsx` sidebar (NOT App.jsx routes). **Skip create GmailCallback.jsx** — already exists |
| 8 | Apply migs **0037, 0038, 0039, 0040**. Adapt 0037's `articles` FK and column refs (no `category`, use `product_category`; no `sku`, use `article_code`). Adapt 0039's `po_items` query (uses jsonb `size_breakdown`, not `size_code` column) |
| 9 | Place 2 formula engines. Run 10 self-tests (5 fabric + 5 thread). Self-tests are pure JS, no DB dependency |
| 10-12 | Place 3 BOM edge functions. Adapt all column refs per section 5. Confirm thread patch merge into bom-calculator |
| 13 | Place `BOMCalculator.jsx` + `SeamEditor.jsx`. Use `articles.article_code` (not `sku`) |
| 14 | `PODetail.jsx` exists — Case A. Add new tab inside the existing page |
| 15 | `FabricOrders.jsx` exists. Need to read it first to determine if Case A (has tabs) or Case B (no tabs) |
| 16 | New `EventStreamPanel` component. Subscribe to `agent_events` realtime |
| 17 | Full E2E test |
| 18 | **Replace project ref before running** the `ALTER DATABASE` SET. Service-role key must already be in DB |
| 19 | Manual env var checklist for Netlify |
| 20 | Final summary, optional `_claude-code-ready` cleanup |

---

## 11 · Open blockers / manual steps required from you

Before Phase 2 can run:

| # | Task | Where |
|---|---|---|
| 1 | Enable `pg_cron` extension | Supabase Dashboard → Database → Extensions |
| 2 | Enable `pg_net` extension | Supabase Dashboard → Database → Extensions |
| 3 | Set `app.service_role_key` on the DB | SQL Editor (run with the actual key from Project Settings → API) |
| 4 | Confirm `app.supabase_project_ref` should be `jcbxmpgjirxqszodotmx` (this exploration confirms it should) | already correct |
| 5 | Decide: re-seed `tna_risk_thresholds` from actual ERP milestone names? | Yes, queryable; I'll do it as part of Phase 6 |
| 6 | (Phase 19) Add `VITE_USE_AI_V2=true` and `VITE_GOOGLE_CLIENT_ID=<your-id>` to Netlify env vars after deploy | Netlify dashboard |

I can run phases 0-1, 4, 5 (partial), 6-15 without those blockers. **Phases 2, 3, 18 are blocked until extensions are enabled.**

---

## 12 · Recommended execution order

Given the blockers, my proposed sequencing differs slightly from the prompt's linear 1→20:

1. **Phase 1** (mig 0033 agent_memory_layer + memory-reader + memory-writer) — no extension dep
2. **Phase 4** (ai-assistant-v2 + AIAssistant flag wiring) — no extension dep
3. **Phase 5 partial** (migs 0029/0030/0031 + email-po-agent + imap fns; SKIP `email-crawler-agent` deploy until mig 0034 lands so the trigger path doesn't fire to a missing handler) — vault is enabled, safe
4. **Phase 6** (mig 0032 + tna-risk-agent + adapted milestone seed) — no extension dep
5. **Phase 7** (4 pages + wiring) — no extension dep
6. **Phase 8** (BOM migs 0037-0040) — no extension dep
7. **Phase 9-15** (formula engines, edge fns, BOM pages) — no extension dep
8. **STOP for extensions.** Once you confirm `pg_cron` and `pg_net` are enabled + service-role key set:
9. **Phase 2** (mig 0034 realtime triggers) — needs `pg_net`
10. **Phase 3** (migs 0035 + 0036 + orchestrator) — needs `pg_cron` + `pg_net` + service-role key
11. **Phase 16** (EventStreamPanel — works without extensions but agent_events table comes from 0034)
12. **Phase 17-20** (E2E test + deploy + Netlify env)

This way 90% of the work lands without waiting on extension enablement. The agentic real-time path activates the moment you flip the extensions on.

---

## 13 · Confirmed unaffected / stays as-is

- All 28 existing migrations (`0001` … `0028`)
- All 9 existing edge functions (with the v2 hardening)
- All 53 existing pages
- `permissions.js` matrix (BUYER role + AI_VOICE_ENTRY + AI_DATA_QUERY = Owner/Manager etc.)
- ERP's CORS regex fix (commit 811f2e6 from earlier today)
- ERP's spec-conformance work (consumption_library item_name, accessory_items placement, descriptionResolver value-field handling, BOB tech-pack parser, etc.)

---

## 14 · Sign-off ask

Please review and confirm one of:

1. **"Approved — execute the adapted plan in the order from §12"** → I run with no further pauses except the extension blocker (will pause and ask before Phase 2)
2. **"Approved + I've enabled pg_cron + pg_net + set service-role key"** → I run all 20 phases linearly per prompt
3. **"Hold — modify these specific items: …"** → I update this document and re-present
4. **"Hold — too risky right now, defer"** → I write nothing else and the doc stays as a record

Until I see one of those, the only artefacts on disk from this session are:
- `tasks/mega-exploration.md` (this file)

No migrations applied, no edge functions placed, no pages added, no commits made.

---

# APPENDIX A — Deep-read findings (gap-fill)

Filled at user request after the initial doc was written. These are the
items I'd otherwise have had to verify "at execution time."

## A.1 — `supabase/functions/_shared/` directory

**Does not exist.** First action of any execution would be `mkdir -p
supabase/functions/_shared`. Files to land there:
- `memory-reader.ts` (Phase 1)
- `imap-fetcher.ts` (Phase 5)
- `bom-formula-engine.ts` (Phase 9)
- `thread-formula-engine.ts` (Phase 9)

No deno.json or shared utility module pre-exists — each placed file
is self-contained.

## A.2 — `AIAssistant.jsx` Phase 4 flag wiring

**File length:** 599 lines.
**Call site:** line 423, inside `sendMessage()` function (line 402).
**Existing call:**
```js
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
  body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 4000, system: ROLE_SYSTEM, messages: history }),
});
```

**Adaptation for Phase 4:** wrap the URL string with a flag check:
```js
const useV2 = import.meta.env.VITE_USE_AI_V2 === 'true';
const endpoint = useV2 ? 'ai-assistant-v2' : 'ai-proxy';
const response = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, ...);
```

The body shape (`messages`, `system`) likely needs adjustment for v2
— prompt says ai-assistant-v2 takes `{messages, context: {buyer_name, po_id, page}}`.
At execute time, read ai-assistant-v2's request shape from its source
file before patching the call site.

**Yellow info banner for queued actions** (prompt requirement):
ai-assistant-v2 may return `{ queued_action_id, action_summary }` when
it triggers an agent action. The wiring needs to detect that response
shape and render a banner with link to `/agent-actions`. Implementation
~10 lines of JSX, gated on response.queued_action_id presence.

## A.3 — `EmailCrawler.jsx` Phase 7 tab insertion

**File length:** 1150 lines. **Has NO existing Tabs UI components.**
Top-level structure: monolithic page with sections rendered linearly
under one `<h1>` at line 983. Single Card at line 1015 holds the main
content.

**Phase 7 plan was "add a new Agent tab and IMAP Setup tab" — not
applicable as written.** Two viable adaptations:

**Option α (preferred — minimal):** Add the two new components as
collapsible sections at the bottom of the page, BEFORE the closing
container div:
```jsx
<details className="...">
  <summary>Agent Pipeline (auto-extract POs from emails)</summary>
  <EmailCrawlerAgentPanel />
</details>
<details className="...">
  <summary>IMAP / Outlook Setup</summary>
  <ImapCredentialsForm />
</details>
```

**Option β (heavier):** Wrap the whole page in a Tabs container. Move
existing 1150-line content into "Crawler" tab, add "Agent" + "IMAP"
tabs. ~30-60 min of work and risks regressions on existing
functionality.

**My recommendation:** option α. Surface the new panels as expandable
sections; preserves all current behaviour.

## A.4 — `FabricOrders.jsx` Phase 15 — Case B (no tabs)

**File length:** 247 lines. **No existing Tabs.** Layout is a single
`<h1>Fabric Mill Orders</h1>` card + a Table.

So Phase 15 is **Case B** per the prompt:
> Add a tab bar at the top: "All Orders" | "Generated Drafts"
> Wrap existing content in "All Orders" tab
> Add FabricOrderDrafts in "Generated Drafts" tab

Concrete edit at execute time:
1. Import `Tabs, TabsList, TabsTrigger, TabsContent` from `@/components/ui/tabs`
2. Wrap line 174 onwards (`return (...)`) — inner JSX moves into `<TabsContent value="orders">...</TabsContent>`
3. Add `<TabsTrigger value="drafts">Generated Drafts</TabsTrigger>` and content
4. Default tab `orders` so existing UX is the entry point
5. ~20 lines of JSX changes

## A.5 — `PODetail.jsx` Phase 14 — Case A (Tabs already present)

**File length:** 552 lines. **Already uses Tabs** at line 525. Current
4 tabs (line 526-531):
1. Shipments (default)
2. Pricing & CBM
3. Payments
4. Change Log

`<TabsList className="grid grid-cols-4 w-full max-w-2xl">` — width is
`grid-cols-4`, fixed. Adding a 5th tab requires changing to `grid-cols-5`.

Concrete edit at execute time:
1. Change `grid-cols-4` → `grid-cols-5` on line 526
2. Add `<TabsTrigger value="fabric" className="text-xs">Fabric</TabsTrigger>` after line 530
3. Add `<TabsContent value="fabric" className="mt-3">...<POFabricRequirements poId={po.id} poNumber={po.po_number} /></TabsContent>` after line 543
4. Import `POFabricRequirements` at top
5. ~6-line JSX change

## A.6 — Migration 0036 (`37_full_agentic_schedules.sql`) full body

**Length:** 79 lines. Contents:
- `cron.unschedule()` + `cron.schedule()` for `memory-consolidation-agent` (Sunday 8 PM UTC)
- `cron.unschedule()` + `cron.schedule()` for `expire-agent-actions` (hourly)
- `cron.schedule()` for `cleanup-agent-events` (daily 3 AM UTC)
- `COMMENT ON TABLE agent_events`

**Project ref hardcoded at line 23** in the `net.http_post(url := 'https://ecjqdyruwqlesfthgphv.supabase.co/...')` — must be replaced
with `jcbxmpgjirxqszodotmx` before applying.

**Comment at line 8** mentions `app.service_role_key` was set in mig
31. **This is wrong for ERP** — that setup was never done. Service-
role key must be set manually before mig 0036 cron jobs fire (or
they'll fail with 401 from the Authorization header).

## A.7 — Migration 0039 (`41_po_fabric_requirements.sql`) RPC body

**Length:** 326 lines. The RPC `calculate_po_fabric_requirements()`
references many columns that don't exist on ERP `po_items` / `articles`.

Confirmed bad refs (lines 105-119):
```sql
SELECT
  pi.id          AS po_item_id,
  pi.quantity,                              -- ✓ OK
  pi.description AS item_description,       -- ✗ ERP uses item_description directly
  COALESCE(pi.article_id, a_sku.id) AS resolved_article_id,
                                            -- ✗ ERP has master_article_id, not article_id
  COALESCE(pi.sku, pi.style_number, pi.description) AS sku_ref,
                                            -- ✗ ERP has style_sku + item_code; no `sku` or `style_number`
  COALESCE(pi.size_code, pi.size, 'ONE SIZE') AS size_code
                                            -- ✗ ERP has neither size_code nor size; sizes live in size_breakdown jsonb
FROM po_items pi
LEFT JOIN articles a_sku
  ON LOWER(TRIM(a_sku.sku)) = LOWER(TRIM(COALESCE(pi.sku, pi.style_number, '')))
                                            -- ✗ a_sku.sku doesn't exist; ERP has article_code
WHERE pi.po_id = p_po_id
  AND COALESCE(pi.quantity, 0) > 0;
```

**Adaptation required (rewriting roughly 30 lines of the RPC):**
```sql
SELECT
  pi.id          AS po_item_id,
  pi.quantity,
  pi.item_description,
  COALESCE(pi.master_article_id, a_sku.id) AS resolved_article_id,
  COALESCE(pi.style_sku, pi.item_code, pi.item_description) AS sku_ref,
  -- ERP doesn't have a single size_code column. Two paths:
  --   1. If po_items.size_breakdown is one size, use the key.
  --   2. Otherwise unfold size_breakdown jsonb into one requirement
  --      row per size — meaning the LOOP below needs to fan out per
  --      size, not per po_item.
  -- Simplest first pass: take the first key of size_breakdown.
  COALESCE(
    (SELECT key FROM jsonb_each_text(pi.size_breakdown) LIMIT 1),
    'ONE SIZE'
  ) AS size_code
FROM po_items pi
LEFT JOIN articles a_sku
  ON LOWER(TRIM(a_sku.article_code)) = LOWER(TRIM(COALESCE(pi.style_sku, pi.item_code, '')))
WHERE pi.po_id = p_po_id
  AND COALESCE(pi.quantity, 0) > 0;
```

The "first key of size_breakdown" approximation works for single-size
items but loses fidelity for multi-size POs. **Proper fix: fan out the
LOOP per size_breakdown entry, multiplying quantity by the per-size
allocation.** That's ~50 lines of SQL rewrite. Defer to execute time
based on actual data shape (need to check what real `size_breakdown`
jsonb looks like — single key/value vs. multi-size dict).

## A.8 — Migration 0040 (`42_fabric_order_generation.sql`) — clean

**Length:** 374 lines. Three sections:
1. Creates `facility_capabilities` (line 13) — pure additive, no
   conflicts with ERP
2. Creates `fabric_order_drafts` (line 86) — new table, additive
3. **`ALTER TABLE fabric_orders` (line 231)** — adds 9 new columns,
   all `ADD COLUMN IF NOT EXISTS`. ERP's existing `fabric_orders`
   schema (24 cols) coexists fine — none of the new columns
   (`fulfillment_type`, `facility_id`, `source_po_id`,
   `source_requirement_id`, `source_draft_id`, `quantity_yards`,
   `quantity_metres`, `quantity_kg`, `primary_unit`,
   `routing_reason`) overlap with existing column names. Net +9 cols.
4. RPC body + seed `INSERT INTO facility_capabilities` of 3 example
   facilities (line 331) — applies cleanly.

**No column-name fixes needed for mig 0040 itself.** The RPC inside it
uses ERP-side column references that are correct (`fabric_orders.po_id`,
`suppliers.id`, etc.).

## A.9 — Table count after run — 22 not 23

Phase 17 expects 23 tables. With cutting room (mig 40) skipped:

| Table | Created by | On ERP after run |
|---|---|---|
| agent_memories | 0033 | ✓ |
| memory_retrieval_log | 0033 | ✓ |
| agent_events | 0034 | ✓ |
| agent_action_policy | 0035 | ✓ |
| agent_action_queue | 0035 | ✓ |
| email_po_drafts | 0029 | ✓ |
| email_crawl_log | (existing — extended) | ✓ |
| gmail_tokens | 0030 | ✓ |
| imap_credentials | 0031 | ✓ |
| tna_risk_drafts | 0032 | ✓ |
| tna_risk_thresholds | 0032 | ✓ |
| size_masters | 0037 | ✓ |
| article_components | 0037 | ✓ |
| bom_results | 0037 | ✓ |
| bom_set_totals | 0037 | ✓ |
| thread_bom_results | 0038 | ✓ |
| thread_bom_totals | 0038 | ✓ |
| article_seams | 0038 | ✓ |
| stitch_library | 0038 | ✓ |
| po_fabric_requirements | 0039 | ✓ |
| fabric_order_drafts | 0040 | ✓ |
| facility_capabilities | 0040 | ✓ |
| wastage_memory | 0037 | ✓ |
| **cutting_marker_efficiency** | **40 (SKIPPED)** | ✗ — not landing |
| **agent_run_log** | 0030 | ✓ — prompt didn't list this in §17 verification but it IS created |

So Phase 17's verification query should expect **22 of the 23 listed
tables** to exist. Plus `agent_run_log` is created by mig 0030 but not
in the prompt's verify list — the prompt's checklist undercounts by 1.
Net: **23 new tables on ERP after run** (22 from prompt's list + 1
extra `agent_run_log`).

Update Phase 17 verification SQL: drop `cutting_marker_efficiency` from
the IN-list; add `agent_run_log`. Result: should return 23 rows.

## A.10 — Sidebar entry recommendations (Phase 7)

ERP has no `group: "AI"` section — AI items are pinned at the top
with `group: ""` + `accent: true, pinned: true`. Recommended Phase 7
sidebar entries:

```js
// Pinned area (top)
{ group: "", name: "Agent Memory",  icon: Brain,    page: "AgentMemory",  permission: "AI_DATA_QUERY", accent: true, pinned: true },
{ group: "", name: "Agent Actions", icon: Zap,      page: "AgentActions", permission: "AI_DATA_QUERY", accent: true, pinned: true },
{ group: "", name: "Email Agent",   icon: Sparkles, page: "EmailPOAgent", permission: "PO_CREATE",     accent: true, pinned: true },

// Tracking group (existing)
{ group: "Tracking", name: "T&A Risk Agent", icon: AlertTriangle, page: "TNARiskAgent", permission: "TNA_APPROVE" },

// Materials group (existing) — Phase 13
{ group: "Materials", name: "BOM Calculator", icon: Calculator, page: "BOMCalculator", permission: "FABRIC_SPEC_EDIT" },
```

The four AI pages slot into the existing "pinned at top" pattern that
File Feeder and AI Assistant already use. Cleaner than introducing a
new `group: "AI"` heading just for these.

---

# APPENDIX B — Process / mechanical items deferred until execution

These were in the MEGA_PROMPT's absolute rules section but only matter
at execute time, not exploration:

1. **`tasks/mega-todo.md`** — checklist file with 20 phases as `[ ]` /
   `[x]` markers. Created as the FIRST file at run-start, updated after
   each phase. Not created now because execution is deferred.

2. **Build gate** — `npm run build` recorded baseline + after each
   phase. Recorded baseline now: ✅ build was clean as of last commit
   `811f2e6` (verified earlier this session).

3. **Test gate** — Phase 9's 10-test self-test gate. Engines are pure
   JS, no DB dependency, runs via `deno run --allow-read /tmp/test-
   engines.ts`. No exploration needed; runs at Phase 9 itself.

4. **Commit discipline** — one commit per phase, no force, no squash.
   Standard.

5. **Resume contract** — read `tasks/mega-todo.md` after compaction.
   Will be in place once execution starts.

---

**Doc complete.** Truly nothing else to verify before Phase 1. Awaiting
your sign-off (1 / 2 / 3 / 4 from §14 of the main doc).

