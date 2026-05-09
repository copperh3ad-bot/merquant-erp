# MerQuant ERP — Full Session Integration Mega Prompt
# Claude Code autonomous implementation across 5 feature areas
# 48 pre-written files → integrated, tested, committed to git

## USAGE
```bash
cd merquant-erp
claude --permission-mode auto -p "$(cat _claude-code-ready/MEGA_PROMPT.md)"

# Resume after compaction:
claude
> Read tasks/mega-todo.md, check git log --oneline -20, resume from last completed phase.
```

---

## ⚠️ READ THIS FIRST

This prompt implements 5 major feature areas across 48 files.
All source files are pre-written in `_claude-code-ready/` subfolders.
Your job: read → adapt → test → integrate → commit. Not rewrite.

Total phases: 20. Estimated time: 2–3 hours autonomous runtime.
Context will compact. This is expected. Resume instructions are at the bottom.

---

```
You are implementing a complete feature upgrade for MerQuant ERP — a production
React 18 + Supabase SaaS for bedding and textile manufacturing.

All 48 source files are pre-written in _claude-code-ready/ subfolders.
Read each file before placing it. Adapt imports and field names to match
the existing codebase. Test. Fix. Commit after every phase.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE RULES — NEVER VIOLATE THESE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ADDITIVE ONLY. Never modify existing migrations (01-34 series).
   Never change existing table schemas — only ALTER ADD COLUMN.
   Never modify existing edge functions or pages except the 3 wiring files.

2. WIRING FILES ONLY. The only existing files you may edit:
     src/App.jsx               (add routes)
     src/pages.config.js       (register pages)
     src/Layout.jsx            (add sidebar entries)
   For PODetail, EmailCrawler, FabricOrders, AIAssistant:
     Add imports + component renders only. Never touch existing logic.

3. BUILD GATE. Run npm run build at the START. Record: PASS or FAIL.
   Run npm run build after EVERY phase. Zero new errors tolerated.
   If a phase introduces build errors → fix before committing.

4. TEST GATE. All formula engine self-tests must pass before Phase 10 commit.
   Run: deno run --allow-read /tmp/test-engines.ts
   Expected: fabric 5/5 + thread 5/5 + cutting 5/5 = 15 tests total.

5. COMMIT DISCIPLINE. One commit per phase, descriptive message.
   Never --force. Never delete files. Never squash during this run.

6. EXPLORATION FIRST. Phase 0 is mandatory. Do not write a single line
   of implementation code until tasks/mega-exploration.md is complete.

7. PROGRESS FILE. Write tasks/mega-todo.md after every phase.
   Format: [ ] Phase N — description | [x] Phase N — done (commit: abc1234)
   This file is your resume point after context compaction.

8. CONTEXT COMPACTION. Your context will compact automatically.
   When it does: read tasks/mega-todo.md + git log --oneline -20.
   Resume from the first unchecked phase. Never redo completed phases.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stack:
  React 18 + Vite + Tailwind CSS v3 + shadcn/ui + lucide-react
  Supabase: PostgreSQL + Auth + Edge Functions (Deno) + pg_cron + pg_net
  Anthropic Claude: claude-sonnet-4-5 via Supabase Edge Functions
  Deployed: Netlify | Supabase project ref: ecjqdyruwqlesfthgphv

Supabase project specifics:
  Region: ap-south-1
  Edge function runtime: Deno, Deno.serve() pattern
  Shared modules: supabase/functions/_shared/
  All imports from esm.sh with pinned versions
  Model: claude-sonnet-4-5 for all Claude API calls

Domain:
  Bedding manufacturing — mattress protectors, fitted sheets,
  flat sheets, pillowcases, duvet covers, multi-piece sets.
  In-house + outsourced fabrication and processing.
  Buyers include: Purecare, Fabrictech, Global Mattress, MFRM.

Existing migrations already applied (DO NOT TOUCH):
  01-29: core ERP schema
  30-32: email crawler + IMAP (from prior session)
  33:    T&A risk agent (from prior session)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOURCE FILE MAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_claude-code-ready/
├── agentic/
│   ├── 34_agent_memory_layer.sql
│   ├── 35_realtime_event_triggers.sql
│   ├── 36_agent_action_policy.sql
│   ├── 37_full_agentic_schedules.sql
│   ├── memory-reader.ts                    → _shared/
│   ├── memory-writer/index.ts              → edge function
│   ├── agent-orchestrator/index.ts         → edge function
│   ├── ai-assistant-v2/index.ts            → edge function
│   ├── memory-consolidation-agent/index.ts → edge function
│   ├── AgentMemory.jsx                     → src/pages/
│   └── AgentActions.jsx                    → src/pages/
│
├── email-agent/
│   ├── 30_email_po_drafts.sql
│   ├── 31_email_crawler_agent.sql
│   ├── 32_imap_credentials.sql
│   ├── email-po-agent/index.ts             → edge function
│   ├── email-crawler-agent/index.ts        → edge function
│   ├── gmail-oauth-exchange/index.ts       → edge function
│   ├── imap-test-connection/index.ts       → edge function
│   ├── imap-credentials-save/index.ts      → edge function (see imap-edge-functions.ts)
│   ├── imap-fetcher.ts                     → _shared/
│   ├── memory-reader-patch.ts              → patch for email agents
│   ├── emailPoAgent.js                     → src/api/
│   ├── EmailPOAgent.jsx                    → src/pages/
│   ├── EmailCrawlerAgentPanel.jsx          → src/components/email/
│   └── ImapCredentialsForm.jsx             → src/components/email/
│
├── tna-agent/
│   ├── 33_tna_risk_agent.sql
│   ├── tna-risk-agent/index.ts             → edge function
│   └── TNARiskAgent.jsx                    → src/pages/
│
└── bom/
    ├── 38_bom_consumption_schema.sql
    ├── 39_thread_consumption_schema.sql
    ├── 40_cutting_room_schema.sql           (SKIP — cutting room deferred)
    ├── 41_po_fabric_requirements.sql
    ├── 42_fabric_order_generation.sql
    ├── bom-formula-engine.ts               → _shared/
    ├── thread-formula-engine.ts            → _shared/
    ├── cutting-efficiency-engine.ts        (SKIP — cutting room deferred)
    ├── bom-calculator/index.ts             → edge function
    ├── bom-calculator-thread-patch.ts      → patch for bom-calculator
    ├── po-fabric-calculator/index.ts       → edge function
    ├── fabric-order-generator/index.ts     → edge function
    ├── BOMCalculator.jsx                   → src/pages/
    ├── SeamEditor.jsx                      → src/components/bom/
    ├── POFabricRequirements.jsx            → src/components/po/
    └── FabricOrderDrafts.jsx              → src/components/fabric/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 0 — MANDATORY EXPLORATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run first:
  npm run build           → must pass, record result
  git log --oneline -5    → record last commit hash

Read ALL source files in _claude-code-ready/ (skim for structure, deep-read for imports).

Read these existing codebase files fully:
  src/App.jsx
  src/pages.config.js
  src/Layout.jsx
  src/lib/AuthContext.jsx         → exact useAuth() return shape
  src/lib/supabaseClient.js       → exact import path (js or ts?)
  src/api/supabaseClient.js       → check which path exists
  src/pages/AIAssistant.jsx       → existing AI page pattern
  src/pages/PurchaseOrders.jsx    → PO detail pattern, tab structure
  src/pages/FabricOrders.jsx      → existing fabric orders structure
  src/pages/EmailCrawler.jsx      → existing email crawler pattern
  supabase/functions/ai-proxy/index.ts        → edge fn pattern
  supabase/functions/tna-risk-agent/index.ts  → existing agent pattern
  supabase/functions/_shared/                 → what shared modules exist
  package.json                               → exact dependency versions

Query DB for critical schema info:
  SELECT column_name FROM information_schema.columns
    WHERE table_name = 'tech_packs' ORDER BY ordinal_position;
  SELECT column_name FROM information_schema.columns
    WHERE table_name = 'articles' ORDER BY ordinal_position;
  SELECT column_name FROM information_schema.columns
    WHERE table_name = 'po_items' ORDER BY ordinal_position;
  SELECT column_name FROM information_schema.columns
    WHERE table_name = 'fabric_orders' ORDER BY ordinal_position;
  SELECT column_name FROM information_schema.columns
    WHERE table_name = 'suppliers' ORDER BY ordinal_position;
  SELECT column_name FROM information_schema.columns
    WHERE table_name = 'purchase_orders' ORDER BY ordinal_position;
  SELECT MAX(REPLACE(table_name,'_','.'))
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name ~ '^\d';

Write tasks/mega-exploration.md with ALL findings:
  - supabase client import path (exact)
  - useAuth() return shape (exact property names)
  - App.jsx route pattern (lazy/eager, Suspense?)
  - pages.config.js entry format (all keys)
  - Layout.jsx sidebar nav format per module
  - po_items columns (especially: article_id? sku? size_code? size?)
  - fabric_orders columns (especially: quantity? unit? supplier_id? po_id?)
  - suppliers columns (especially: name? status? type? category?)
  - purchase_orders columns (delivery_date? ex_factory_date?)
  - articles columns (category? article_type? sku exact name?)
  - tech_packs columns (raw_text? style_name? extracted_data?)
  - Last migration number confirmed
  - Does PODetail.jsx exist or is PO detail inline in PurchaseOrders.jsx?
  - Does FabricOrders.jsx have tabs already?
  - EmailCrawler.jsx structure — does it have tabs?
  - Any TypeScript strict mode or ESLint rules affecting new files

Create tasks/mega-todo.md with all 20 phases listed as [ ] unchecked.

DO NOT PROCEED until both files are written.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1 — AGENT MEMORY LAYER (Migration 34)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check first: SELECT to_regclass('public.agent_memories');
  If NOT NULL: skip migration, log "Phase 1: agent_memories exists — skipped"
  If NULL: apply _claude-code-ready/agentic/34_agent_memory_layer.sql

Verify after:
  SELECT COUNT(*) FROM agent_memories;          → should not error
  SELECT proname FROM pg_proc
    WHERE proname IN ('retrieve_memories_for_agent','search_memories_by_keyword');
    → must return 2 rows

Place shared module:
  _claude-code-ready/agentic/memory-reader.ts
  → supabase/functions/_shared/memory-reader.ts
  Adapt: confirm createClient import version matches existing _shared files

Deploy memory-writer edge function:
  _claude-code-ready/agentic/memory-writer/index.ts
  → supabase/functions/memory-writer/index.ts

Test:
  supabase functions serve memory-writer --no-verify-jwt &
  curl -s -X POST http://localhost:54321/functions/v1/memory-writer \
    -H "Content-Type: application/json" \
    -d '{"event_type":"po_confirmed","entity_type":"buyer","entity_id":"Test Buyer",
         "entity_label":"Test Buyer","context":"Test PO confirmed","agent_name":"test"}'
  → expect: {"success":true,"memory_id":"..."}
  Fix any errors before proceeding.
  Kill serve process.

npm run build → must pass

Commit: "feat(memory): migration 34, memory-writer edge fn, memory-reader shared module"
Update tasks/mega-todo.md: mark Phase 1 complete with commit hash

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2 — REAL-TIME EVENT TRIGGERS (Migration 35)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check: SELECT to_regclass('public.agent_events');
  If exists: skip, log skipped.
  If not: apply _claude-code-ready/agentic/35_realtime_event_triggers.sql

CRITICAL ADAPTATION before applying:
  The migration references Supabase project ref in fire_agent_event().
  Confirm project ref is already set:
    SHOW app.supabase_project_ref;
  If not set, add to migration before running:
    ALTER DATABASE postgres SET app.supabase_project_ref = 'ecjqdyruwqlesfthgphv';

Verify:
  SELECT COUNT(*) FROM agent_events;                  → 0 rows, no error
  SELECT proname FROM pg_proc WHERE proname = 'fire_agent_event';
    → 1 row
  SELECT COUNT(*) FROM information_schema.triggers
    WHERE trigger_name LIKE 'trg_%_events';
    → 6 triggers (po, milestone, email_draft, shipment, qc, tna_draft)

npm run build → must pass

Commit: "feat(agentic): migration 35 — realtime DB event triggers + agent_events queue"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3 — ACTION POLICY + ORCHESTRATOR + SCHEDULES (Migrations 36-37)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Apply migrations (check existence first, same pattern):
  _claude-code-ready/agentic/36_agent_action_policy.sql
  _claude-code-ready/agentic/37_full_agentic_schedules.sql

Verify migration 36:
  SELECT COUNT(*) FROM agent_action_policy;  → 15 rows (seeded)
  SELECT COUNT(*) FROM agent_action_queue;   → 0 rows

Verify migration 37:
  SELECT jobname FROM cron.job
    WHERE jobname IN ('email-crawler-agent','tna-risk-agent',
                      'memory-consolidation-agent','expire-agent-actions',
                      'cleanup-agent-events');
    → 5 rows

Place edge functions (adapt imports to match project patterns):
  _claude-code-ready/agentic/agent-orchestrator/index.ts
  → supabase/functions/agent-orchestrator/index.ts

  ADAPTATION: In seedTnaCalendar(), the function reads tna_templates.
  Confirm column names from exploration notes.
  If offset_days column is named differently, update the query.
  If tna_templates is empty, the function skips gracefully — this is OK.

  _claude-code-ready/agentic/memory-consolidation-agent/index.ts
  → supabase/functions/memory-consolidation-agent/index.ts

Test orchestrator:
  supabase functions serve agent-orchestrator --no-verify-jwt &
  curl -s -X POST http://localhost:54321/functions/v1/agent-orchestrator \
    -H "Content-Type: application/json" \
    -d '{"event_id":"00000000-0000-0000-0000-000000000001",
         "event_type":"po.approved","entity_type":"purchase_order",
         "entity_id":"00000000-0000-0000-0000-000000000001",
         "payload":{"po_number":"TEST","buyer_name":"Test","delivery_date":"2026-12-01"}}'
  → expect: {"success":true} or event skipped gracefully
  Kill serve.

npm run build → must pass

Commit: "feat(agentic): migrations 36-37, orchestrator + consolidation agent edge fns"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 4 — AI ASSISTANT V2 EDGE FUNCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Place:
  _claude-code-ready/agentic/ai-assistant-v2/index.ts
  → supabase/functions/ai-assistant-v2/index.ts

ADAPTATION — tool enforcement:
  The query_database tool rejects non-SELECT queries.
  Verify exec_sql RPC exists: SELECT proname FROM pg_proc WHERE proname = 'exec_sql';
  If it doesn't exist, update the tool to use supabase.from() queries instead.

Test:
  supabase functions serve ai-assistant-v2 --no-verify-jwt &
  curl -s -X POST http://localhost:54321/functions/v1/ai-assistant-v2 \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"How many purchase orders exist?"}]}'
  → expect: response with a numeric answer (may be 0 if DB is empty, that is OK)
  Kill serve.

Wire into existing AIAssistant.jsx:
  Read AIAssistant.jsx first.
  Add a feature flag check using VITE_USE_AI_V2 env var.
  If flag is true, call ai-assistant-v2 instead of ai-proxy.
  Pass context: { buyer_name, po_id, page: 'ai-assistant' }
  Handle queued action response: show yellow info banner with link to /agent-actions
  If flag is false (default), existing ai-proxy call is unchanged.
  Zero regression on existing functionality.

npm run build → must pass

Commit: "feat(agentic): ai-assistant-v2 edge fn + AIAssistant feature flag wiring"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 5 — EMAIL PO AGENT (Migrations 30-32 + Edge Functions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Apply migrations (check existence first):
  30_email_po_drafts.sql
  31_email_crawler_agent.sql
  32_imap_credentials.sql

CRITICAL: Migration 32 requires supabase_vault extension.
  Check: SELECT extname FROM pg_extension WHERE extname = 'supabase_vault';
  If not present:
    Try: CREATE EXTENSION IF NOT EXISTS supabase_vault;
    If that fails: comment out vault-dependent parts of 32_imap_credentials.sql
    and add a note in tasks/mega-todo.md that vault setup is a manual step.

Place shared module:
  _claude-code-ready/email-agent/imap-fetcher.ts
  → supabase/functions/_shared/imap-fetcher.ts

Place edge functions:
  _claude-code-ready/email-agent/email-po-agent/index.ts
  → supabase/functions/email-po-agent/index.ts

  _claude-code-ready/email-agent/email-crawler-agent/index.ts
  → supabase/functions/email-crawler-agent/index.ts
  ADAPTATION: This imports from ../_shared/imap-fetcher.ts — confirm path.

  _claude-code-ready/email-agent/gmail-oauth-exchange/index.ts
  → supabase/functions/gmail-oauth-exchange/index.ts

  For imap-test-connection and imap-credentials-save:
  Read _claude-code-ready/email-agent/imap-edge-functions.ts
  It contains two functions as comments/templates.
  Extract and create:
    supabase/functions/imap-test-connection/index.ts
    supabase/functions/imap-credentials-save/index.ts

Place API helper:
  _claude-code-ready/email-agent/emailPoAgent.js
  → src/api/emailPoAgent.js
  ADAPTATION: Update supabase client import to match exact path from exploration.

Test email-po-agent:
  supabase functions serve email-po-agent --no-verify-jwt &
  curl -s -X POST http://localhost:54321/functions/v1/email-po-agent \
    -H "Content-Type: application/json" \
    -d '{"subject":"Test PO","body":"Please process PO #TEST-001, 500 pcs Queen Mattress Protector at USD 4.50, delivery Dec 2026"}'
  → expect: {"success":true,"draft":{...},"draft.is_po_email":true}
  Kill serve.

npm run build → must pass

Commit: "feat(email-agent): migrations 30-32, email-po-agent, crawler, oauth, IMAP"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 6 — TNA RISK AGENT (Migration 33 + Edge Function)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check: SELECT to_regclass('public.tna_risk_drafts');
  If exists: skip migration.
  If not: apply _claude-code-ready/tna-agent/33_tna_risk_agent.sql

ADAPTATION before applying:
  The migration seeds tna_risk_thresholds with standard milestone names.
  These names must match the milestone_name values actually used in
  your tna_milestones table. Query:
    SELECT DISTINCT milestone_name FROM tna_milestones LIMIT 20;
  If milestone names differ from the seeded values, update the INSERT
  in 33_tna_risk_agent.sql before applying.

Place edge function:
  _claude-code-ready/tna-agent/tna-risk-agent/index.ts
  → supabase/functions/tna-risk-agent/index.ts

  ADAPTATION: Check if tna-risk-agent edge function already exists
  from a prior session. If it does, compare with the source file.
  If the existing version is functional, skip placing this file.
  If the source file has improvements, replace carefully.

Test:
  supabase functions serve tna-risk-agent --no-verify-jwt &
  curl -s -X POST http://localhost:54321/functions/v1/tna-risk-agent \
    -d '{}'
  → expect: {"success":true,"calendars_scanned":N}
    (N=0 is OK if no active calendars yet)
  Kill serve.

npm run build → must pass

Commit: "feat(tna): migration 33 (if new), tna-risk-agent edge fn"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 7 — AGENTIC FRONTEND PAGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Adapt and place these 4 pages.
For EACH page: read source → update imports → place → wire → verify build.

Pages to place:
  _claude-code-ready/agentic/AgentMemory.jsx   → src/pages/AgentMemory.jsx
  _claude-code-ready/agentic/AgentActions.jsx  → src/pages/AgentActions.jsx
  _claude-code-ready/email-agent/EmailPOAgent.jsx → src/pages/EmailPOAgent.jsx
  _claude-code-ready/tna-agent/TNARiskAgent.jsx  → src/pages/TNARiskAgent.jsx

For each page, adapt:
  1. supabase client import → match exact path from exploration
  2. useAuth() destructuring → match exact shape from AuthContext
  3. Any other imports that reference non-existent paths

Wire all 4 into App.jsx (match existing route pattern):
  /agent-memory    → AgentMemory
  /agent-actions   → AgentActions
  /email-po-agent  → EmailPOAgent
  /tna-risk-agent  → TNARiskAgent

Register all 4 in pages.config.js (match existing format exactly):
  AgentMemory:  module: 'AI',       icon: 'Brain',         roles: ['Owner','Manager']
  AgentActions: module: 'AI',       icon: 'Zap',           roles: ['Owner','Manager','Merchandiser']
  EmailPOAgent: module: 'AI',       icon: 'Sparkles',      roles: ['Owner','Manager','Merchandiser']
  TNARiskAgent: module: 'Tracking', icon: 'AlertTriangle', roles: ['Owner','Manager','Merchandiser']

Add to Layout.jsx sidebar (match existing nav format):
  AI section:       AgentMemory, AgentActions, EmailPOAgent
  Tracking section: TNARiskAgent

Add EmailCrawlerAgentPanel and ImapCredentialsForm as components:
  _claude-code-ready/email-agent/EmailCrawlerAgentPanel.jsx
  → src/components/email/EmailCrawlerAgentPanel.jsx

  _claude-code-ready/email-agent/ImapCredentialsForm.jsx
  → src/components/email/ImapCredentialsForm.jsx

  Wire into existing EmailCrawler.jsx:
    Add a new "Agent" tab (or panel below) showing EmailCrawlerAgentPanel
    Add an "IMAP Setup" tab showing ImapCredentialsForm
    Preserve ALL existing EmailCrawler functionality

Add /gmail-callback route to App.jsx:
  Create src/pages/GmailCallback.jsx:
    This page reads ?code= from URL, calls handleGmailOAuthCallback(),
    then redirects to /email-po-agent on success.
  Import handleGmailOAuthCallback from src/api/emailPoAgent.js

npm run build → zero errors

Manual verification (dev server):
  npm run dev
  Navigate to: /agent-memory, /agent-actions, /email-po-agent, /tna-risk-agent
  Each page must render without console errors.
  Sidebar must show new entries in correct sections.

Commit: "feat(ui): AgentMemory, AgentActions, EmailPOAgent, TNARiskAgent pages + EmailCrawler integration"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 8 — BOM SCHEMA (Migrations 38-39, 41-42)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NOTE: Migration 40 (cutting_room_schema) is SKIPPED — cutting room deferred.

Apply in order (check existence before each):
  38_bom_consumption_schema.sql
  39_thread_consumption_schema.sql
  41_po_fabric_requirements.sql
  42_fabric_order_generation.sql

CRITICAL ADAPTATIONS:
  38: The migration references articles(id) as FK for article_components.
    Confirm articles table exists: SELECT to_regclass('public.articles');
    If 'articles' is named differently (e.g. 'article_masters'), update FKs.

  38: size_masters seed data uses US bedding standards.
    Apply as-is — these are reference data, safe to seed.

  39: stitch_library seed data — 15 ISO stitch types.
    Apply as-is.

  41: calculate_po_fabric_requirements() RPC references po_items columns.
    From exploration notes, confirm exact column names for:
      po_items.article_id (FK or null?)
      po_items.sku (or style_number? or description?)
      po_items.size_code (or size? or separate column?)
      po_items.quantity (confirm exact name)
    Update the RPC body to use confirmed column names.

  42: The migration seeds 3 example facilities.
    Apply as-is — these are examples that Union Fabrics can edit.
    match_facility_for_material() RPC uses GIN index on capable_materials array.
    Confirm pg_trgm or array operators are available.

Verify key tables:
  SELECT COUNT(*) FROM size_masters;       → 23 rows
  SELECT COUNT(*) FROM stitch_library;     → 15 rows
  SELECT COUNT(*) FROM facility_capabilities; → 3 rows

npm run build → must pass (no frontend changes in this phase)

Commit: "feat(bom): migrations 38-39-41-42 — BOM schema, thread, PO requirements, fabric orders"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 9 — BOM FORMULA ENGINES (Shared Modules)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Place shared formula engines:
  _claude-code-ready/bom/bom-formula-engine.ts
  → supabase/functions/_shared/bom-formula-engine.ts

  _claude-code-ready/bom/thread-formula-engine.ts
  → supabase/functions/_shared/thread-formula-engine.ts

Create combined test file at /tmp/test-engines.ts:

  import { runEngineTests as runFabric }
    from "./supabase/functions/_shared/bom-formula-engine.ts";
  import { runThreadEngineTests as runThread }
    from "./supabase/functions/_shared/thread-formula-engine.ts";

  const fabric = runFabric();
  const thread = runThread();

  console.log("=== FABRIC ENGINE ===");
  fabric.results.forEach(r => console.log(r));
  console.log(`Fabric: ${fabric.passed}/5 passed, ${fabric.failed} failed`);

  console.log("\n=== THREAD ENGINE ===");
  thread.results.forEach(r => console.log(r));
  console.log(`Thread: ${thread.passed}/5 passed, ${thread.failed} failed`);

  const total = fabric.passed + thread.passed;
  const totalFail = fabric.failed + thread.failed;
  if (totalFail > 0) {
    console.error(`\n❌ ${totalFail} TESTS FAILED`);
    Deno.exit(1);
  }
  console.log(`\n✅ ALL ${total}/10 TESTS PASSED`);

Run: deno run --allow-read /tmp/test-engines.ts

Expected results:
  Fabric engine (5 tests):
    ✓ Queen protector skirt:    ~2.42 yds  (±0.15)
    ✓ King protector skirt:     ~2.85 yds  (±0.20)
    ✓ Queen flat sheet panel:   ~3.00 yds  (±0.25)
    ✓ Queen 200GSM fill:        ~630  g    (±50)
    ✓ Queen elastic perimeter:  ~7.50 m    (±0.50)

  Thread engine (5 tests):
    ✓ Queen top+skirt join:     ~35.7 m/thread (±3.0)
    ✓ Queen corner seams:       ~2.0  m/thread (±0.5)
    ✓ Queen perimeter hem:      ~9.4  m/thread (±1.0)
    ✓ Total Ecru aggregation:   ~165  m total  (±20)
    ✓ Label attachment:         ~0.14 m/thread (±0.05)

If any test fails:
  Print full calculation_steps for the failing test.
  Identify the wrong step. Fix only that step.
  Re-run until all 10 pass.
  DO NOT proceed to Phase 10 until all 10 pass.

npm run build → must pass

Commit: "feat(bom): formula engines placed — 10/10 self-tests passing"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 10 — BOM CALCULATOR EDGE FUNCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read _claude-code-ready/bom/bom-calculator/index.ts fully.
Read _claude-code-ready/bom/bom-calculator-thread-patch.ts fully.

ADAPTATIONS (critical — do these before placing):

  A) tech_packs field names:
     From exploration notes, update parseTechPack() contentParts array.
     Only reference columns that actually exist in tech_packs table.
     Map:
       tech_packs.style_name     → use if exists, else tech_packs.name
       tech_packs.raw_text       → use if exists, else tech_packs.content/body
       tech_packs.extracted_data → use if exists, else tech_packs.parsed_data
       tech_packs.fabric_content → use if exists (optional)
       tech_packs.construction_notes → use if exists (optional)

  B) articles category field:
     In inferCategory() function, update to use the correct column name
     from exploration notes. If no category column: use description + sku.

  C) Thread patch integration:
     Read bom-calculator-thread-patch.ts.
     The patch adds calculateThreadBOM() and saveSuggestedSeams().
     Merge these functions into bom-calculator/index.ts:
       - Add imports at top
       - Add "suggest_seams" to the mode dispatch in main handler
       - Add "calculate_cutting" mode to dispatch (returns empty for now)
       - After fabric BOM calculates in calculateBOM(),
         call calculateThreadBOM() and include result in response

Place adapted file:
  → supabase/functions/bom-calculator/index.ts

Test sequence:
  supabase functions serve bom-calculator --no-verify-jwt &

  Test 1 — Self-tests via HTTP:
    curl -s -X POST http://localhost:54321/functions/v1/bom-calculator \
      -H "Content-Type: application/json" \
      -d '{"run_tests":true}'
    → {"passed":10,"failed":0} (fabric 5 + thread 5)
    MUST PASS before continuing.

  Test 2 — Calculate (with any real article):
    SELECT id, sku FROM articles LIMIT 1;
    curl -s -X POST .../bom-calculator \
      -d '{"mode":"calculate","article_id":"<id>"}'
    → {"success":true} or "No components found" (OK on fresh DB)

  Test 3 — Suggest seams:
    curl -s -X POST .../bom-calculator \
      -d '{"mode":"suggest_seams","article_id":"<id>"}'
    → {"saved":N} where N≥0

  Kill serve.

npm run build → must pass

Commit: "feat(bom): bom-calculator edge fn with thread integration — HTTP tests 10/10"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 11 — PO FABRIC CALCULATOR EDGE FUNCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read _claude-code-ready/bom/po-fabric-calculator/index.ts fully.

ADAPTATIONS:
  resolveArticleId() tries po_items.article_id FK then SKU text match.
  From exploration: confirm po_items column names for:
    article reference (article_id? article_fk? sku?)
    size (size_code? size? size_name?)
    quantity (quantity? qty? pieces?)
  Update resolveArticleId() and the main po_items query accordingly.

Place:
  → supabase/functions/po-fabric-calculator/index.ts

Test:
  supabase functions serve po-fabric-calculator --no-verify-jwt &
  SELECT id, po_number FROM purchase_orders LIMIT 1;
  curl -s -X POST .../po-fabric-calculator \
    -d '{"po_id":"<id>","mode":"preview","buffer_pct":5}'
  → {"success":true} or "No line items" (OK if PO has no items)
  If items exist: response should show materials array.
  Kill serve.

npm run build → must pass

Commit: "feat(bom): po-fabric-calculator edge fn"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 12 — FABRIC ORDER GENERATOR EDGE FUNCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read _claude-code-ready/bom/fabric-order-generator/index.ts fully.

ADAPTATIONS:
  findExternalSupplier() queries suppliers table.
  From exploration: confirm suppliers column names (name, status, type, category).
  Update query accordingly.

  confirmDraft() inserts into fabric_orders.
  From exploration: map to actual fabric_orders columns.
  The function has a comment "Claude Code will adapt these field names".
  Update the insert to use confirmed column names:
    Minimum required: po_id, material_description, quantity, unit, status
    All others: include if column exists, skip if not.

Place:
  → supabase/functions/fabric-order-generator/index.ts

Test:
  supabase functions serve fabric-order-generator --no-verify-jwt &
  SELECT id FROM purchase_orders LIMIT 1;
  curl -s -X POST .../fabric-order-generator \
    -d '{"po_id":"<id>","mode":"generate"}'
  → {"success":true} or "No fabric requirements" (OK if po-fabric-calculator not run yet)
  Kill serve.

npm run build → must pass

Commit: "feat(bom): fabric-order-generator edge fn with capacity-first routing"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 13 — BOM CALCULATOR PAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read _claude-code-ready/bom/BOMCalculator.jsx fully.
Read _claude-code-ready/bom/SeamEditor.jsx fully.

ADAPTATIONS for BOMCalculator.jsx:
  1. Update supabase client import to match exact path
  2. Update useAuth() destructuring to match exact shape
  3. The page uses supabase.from('articles').select() — confirm 'articles' table name

ADAPTATIONS for SeamEditor.jsx:
  1. Same import updates
  2. The component imports from supabase — same path fix

Place:
  _claude-code-ready/bom/BOMCalculator.jsx → src/pages/BOMCalculator.jsx
  _claude-code-ready/bom/SeamEditor.jsx    → src/components/bom/SeamEditor.jsx

Wire BOMCalculator.jsx to import SeamEditor:
  Update import in BOMCalculator.jsx to use correct relative path:
    import { SeamEditorTab, ThreadBOMResultsPanel } from '../components/bom/SeamEditor';

Wire into App.jsx:
  Add route: <Route path="/bom-calculator" element={<BOMCalculator />} />

Register in pages.config.js:
  path: '/bom-calculator', label: 'BOM Calculator',
  icon: 'Calculator', module: 'Materials',
  roles: ['Owner','Manager','Merchandiser']

Add to Layout.jsx Materials section:
  { path: '/bom-calculator', label: 'BOM', icon: Calculator }
  Import Calculator from 'lucide-react' if not already imported.

npm run lint → fix any errors in new files
npm run build → zero errors

Verify:
  npm run dev
  Navigate to /bom-calculator
  ✓ Article dropdown loads without crash
  ✓ Tabs switch: Components / BOM Results / Seams & Thread
  ✓ "Add Component" shows editable row
  ✓ No console errors

Commit: "feat(bom): BOMCalculator page + SeamEditor component (3-tab: fabric/seams/thread)"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 14 — PO FABRIC REQUIREMENTS COMPONENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read _claude-code-ready/bom/POFabricRequirements.jsx fully.

ADAPTATIONS:
  1. Update supabase + useAuth imports
  2. The component is designed to embed in PO detail view

Place:
  → src/components/po/POFabricRequirements.jsx

Wire into PO detail:
  From exploration notes: determine how PO detail is rendered.
  Case A — PODetail.jsx exists as a separate page:
    Find the tabs/sections in PODetail.jsx.
    Add a "Fabric Requirements" tab.
    Import and render:
      import POFabricRequirements from '../components/po/POFabricRequirements';
      <POFabricRequirements poId={po.id} poNumber={po.po_number} />

  Case B — PO detail is inline in PurchaseOrders.jsx (modal/drawer):
    Find the PO detail panel/modal.
    Add a "Fabric" tab or section at the bottom.
    Same import and render pattern.

  Case C — No existing detail view:
    Create minimal src/pages/PODetail.jsx:
      Reads po_id from URL params
      Fetches PO data
      Renders <POFabricRequirements poId={id} poNumber={po.po_number} />
    Add route in App.jsx: /purchase-orders/:id

Also add "Generate Fabric Orders" button to POFabricRequirements:
  Below the Export CSV button, add:
    <button onClick={handleGenerateOrders}>Generate Fabric Orders</button>
  handleGenerateOrders:
    Calls fabric-order-generator edge function with po_id
    On success: show toast/notification "N drafts created"
    Navigate to /fabric-orders?tab=drafts on success

npm run build → zero errors

Verify:
  Open any PO in the UI
  "Fabric Requirements" tab/section should appear
  Click "Calculate Requirements" → should show loading state

Commit: "feat(bom): POFabricRequirements component wired into PO detail view"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 15 — FABRIC ORDER DRAFTS COMPONENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read _claude-code-ready/bom/FabricOrderDrafts.jsx fully.

ADAPTATIONS:
  1. Update supabase + useAuth imports
  2. The confirm button calls fabric-order-generator edge fn

Place:
  → src/components/fabric/FabricOrderDrafts.jsx

Wire into existing FabricOrders.jsx:
  From exploration notes: determine FabricOrders.jsx structure.

  Case A — FabricOrders.jsx already has tabs:
    Add "Generated Drafts" as a new tab.
    Import: import FabricOrderDrafts from '../components/fabric/FabricOrderDrafts';
    Render in that tab: <FabricOrderDrafts />
    Add draft count badge to tab label (fetch from DB on mount)

  Case B — FabricOrders.jsx has no tabs:
    Add a tab bar at the top: "All Orders" | "Generated Drafts"
    Wrap existing content in "All Orders" tab
    Add FabricOrderDrafts in "Generated Drafts" tab
    Preserve ALL existing functionality in "All Orders" tab

npm run build → zero errors

Verify:
  Navigate to /fabric-orders
  "Generated Drafts" tab must appear
  Tab renders FabricOrderDrafts without crash
  Existing fabric orders functionality must still work

Commit: "feat(bom): FabricOrderDrafts component wired into FabricOrders page"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 16 — EVENT STREAM PANEL (AgentMemory 4th tab)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create src/components/agent/EventStreamPanel.jsx:

  This component shows recent agent_events in real-time.
  Use Supabase realtime subscription.
  Schema: agent_events (id, event_type, entity_type, status, triggered_at, payload)

  Implementation:
    - On mount: fetch last 50 events ordered by triggered_at DESC
    - Subscribe: supabase.channel('agent_events')
        .on('postgres_changes', { event: '*', schema: 'public',
            table: 'agent_events' }, handleNewEvent)
        .subscribe()
    - Display as a live feed list:
        event_type badge | entity_type | status dot | relative time
    - Filter bar: all / pending / done / failed
    - Status dot colors: pending=yellow, done=green, failed=red, skipped=gray
    - Auto-scroll to latest (newest at top)
    - Unsubscribe on unmount

Add as 4th tab in AgentMemory.jsx:
  Import EventStreamPanel
  Add tab: { id: 'events', label: 'Event Stream' }
  Render: <EventStreamPanel />

npm run build → zero errors

Verify:
  Navigate to /agent-memory → Event Stream tab
  Component renders without crash
  Empty state shows "No events yet" message

Commit: "feat(agentic): EventStreamPanel realtime feed — 4th tab in AgentMemory"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 17 — FULL END-TO-END INTEGRATION TEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run the full test suite:
  npm run lint   → 0 errors in ANY new file
  npm run test   → ALL pre-existing tests still pass
  npm run build  → successful production build

Verify all new routes render without crash:
  npm run dev
  Open each URL and confirm it loads without white screen or console errors:
    /agent-memory       → 4 tabs: Memories, Components, Query, Event Stream
    /agent-actions      → 2 tabs: Queue, Policy
    /email-po-agent     → paste email, extract button present
    /tna-risk-agent     → 3 tabs: Queue, Thresholds, History
    /bom-calculator     → article selector, 3 tabs: Components/BOM/Seams
    /fabric-orders      → existing + new "Generated Drafts" tab

Verify edge functions list:
  supabase functions list
  Expected functions present:
    ai-proxy (existing)
    email-po-agent
    email-crawler-agent
    gmail-oauth-exchange
    imap-test-connection
    imap-credentials-save
    tna-risk-agent
    memory-writer
    agent-orchestrator
    ai-assistant-v2
    memory-consolidation-agent
    bom-calculator
    po-fabric-calculator
    fabric-order-generator

  If any are missing: create their directory and index.ts file.

Verify migrations applied:
  SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN (
      'agent_memories','memory_retrieval_log','agent_events',
      'agent_action_policy','agent_action_queue',
      'email_po_drafts','email_crawl_log','gmail_tokens','imap_credentials',
      'tna_risk_drafts','tna_risk_thresholds',
      'size_masters','article_components','bom_results','bom_set_totals',
      'thread_bom_results','thread_bom_totals','article_seams','stitch_library',
      'po_fabric_requirements','fabric_order_drafts','facility_capabilities',
      'wastage_memory','cutting_marker_efficiency'
    )
  ORDER BY table_name;
  → expect 23 tables

Write tasks/integration-test-results.md with:
  - npm run lint: PASS/FAIL + error count
  - npm run test: PASS/FAIL + test count
  - npm run build: PASS/FAIL
  - Formula engine tests: N/10
  - Routes verified: list each with PASS/FAIL
  - Edge functions: list each with present/missing
  - Tables: count found vs expected

Commit: "test: full integration validation — all routes render, build passes"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 18 — DEPLOY ALL EDGE FUNCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deploy all new edge functions to Supabase:

  supabase functions deploy memory-writer
  supabase functions deploy agent-orchestrator
  supabase functions deploy memory-consolidation-agent
  supabase functions deploy ai-assistant-v2
  supabase functions deploy email-po-agent
  supabase functions deploy email-crawler-agent
  supabase functions deploy gmail-oauth-exchange
  supabase functions deploy imap-test-connection
  supabase functions deploy imap-credentials-save
  supabase functions deploy bom-calculator
  supabase functions deploy po-fabric-calculator
  supabase functions deploy fabric-order-generator

  Note: tna-risk-agent may already be deployed from prior session.
  Run: supabase functions deploy tna-risk-agent
  (safe to redeploy — idempotent)

After each deploy: check for errors. If any function fails to deploy,
note the error in tasks/mega-todo.md and continue with others.
Deployment errors are non-blocking for the git commit.

Run SQL for one-time DB settings (if not already set):
  ALTER DATABASE postgres
    SET app.supabase_project_ref = 'ecjqdyruwqlesfthgphv';
  -- (app.service_role_key should already be set from prior session)

Commit: "chore: deploy all edge functions to Supabase production"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 19 — NETLIFY ENVIRONMENT VARIABLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add these environment variables to Netlify dashboard
(Site → Environment Variables):

  VITE_USE_AI_V2=true
  VITE_GOOGLE_CLIENT_ID=<from Google Cloud Console — you add this>

These require manual addition via Netlify dashboard.
Claude cannot access Netlify dashboard.

Create tasks/netlify-env-checklist.md with:
  [ ] VITE_USE_AI_V2=true          → enables ai-assistant-v2 in AIAssistant page
  [ ] VITE_GOOGLE_CLIENT_ID=...    → needed for Gmail OAuth in EmailPOAgent
  [ ] Verify: VITE_SUPABASE_URL is set (should already be)
  [ ] Verify: VITE_SUPABASE_ANON_KEY is set (should already be)

Commit: "chore: add netlify env checklist for manual steps"
Update tasks/mega-todo.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 20 — FINAL SUMMARY + CLEANUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run final build:
  npm run lint    → 0 errors
  npm run test    → all pass
  npm run build   → production build successful

Clean up:
  Remove _claude-code-ready/ directory from repo
  (it served its purpose — all files are now integrated)
  git rm -r _claude-code-ready/

Write tasks/IMPLEMENTATION_COMPLETE.md with:

  # MerQuant Session Implementation — Complete

  ## What Was Built
  [List all 5 feature areas with file counts]

  ## New Pages (6)
  - /agent-memory     — Browse, search, verify agent memories
  - /agent-actions    — Approve/reject queued agent actions + policy config
  - /email-po-agent   — AI extracts POs from buyer emails
  - /tna-risk-agent   — T&A milestone risk monitoring + buyer email drafts
  - /bom-calculator   — Fabric consumption BOM with thread + seam editor
  - /gmail-callback   — OAuth callback handler

  ## New Edge Functions (13)
  [List all 13 with brief description]

  ## New Migrations Applied
  [List 30-39, 41-42 with table counts]

  ## New DB Tables (23)
  [List all table names]

  ## Agentic Score
  Before this session: 2.5/5
  After this session:  4.9/5

  ## Remaining Manual Steps
  1. Add VITE_GOOGLE_CLIENT_ID to Netlify env vars
  2. Enable Gmail API in Google Cloud Console
  3. Add OAuth redirect URI: https://merquanterp.netlify.app/gmail-callback
  4. Edit facility_capabilities rows to match actual Union Fabrics facilities
  5. Supabase Vault setup for IMAP password encryption (optional)
  6. Set app.service_role_key in DB for pg_cron HTTP calls

  ## Known Deferred Items
  - Cutting room module (migration 40, CuttingRoomPanel.jsx)
  - Costing sheet auto-population from BOM
  - Apparel size ratio BOM (home textiles only for now)

Final commit: "feat: complete MerQuant session integration — 5 feature areas, 13 edge fns, 23 tables, 6 pages"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESUME INSTRUCTIONS (after context compaction)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Read tasks/mega-todo.md — find first [ ] unchecked phase
2. Run: git log --oneline -5 — confirm last completed phase
3. Read tasks/mega-exploration.md — has all DB column names
4. Resume from the unchecked phase
5. Do NOT redo any [x] completed phase
6. If uncertain what was done: check git log + grep for new files

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONSTRAINTS SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NEVER:
  Modify migrations 01-29 (core ERP)
  Touch existing edge functions except to add feature flags
  Break existing pages or functionality
  Use localStorage/sessionStorage in React
  Use <form> tags — use onClick handlers
  Use inline styles — Tailwind only
  Skip the exploration phase
  Guess column names — always confirm from exploration notes
  Commit with --force

ALWAYS:
  Read a file before editing it
  Check table existence before applying migration
  Confirm import paths from package.json
  Handle null/undefined in all DB results
  Add RLS policies to every new table (check migrations — they're included)
  Test edge functions locally before declaring phase complete
  Match code style of adjacent files exactly
  Update tasks/mega-todo.md after every phase
```
