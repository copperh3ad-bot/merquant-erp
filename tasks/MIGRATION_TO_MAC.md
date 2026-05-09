# Migration: Windows → Mac (Claude Code)

This is the handoff doc for picking up MerQuant ERP development on a Mac
with Claude Code, after the Windows session that completed the MEGA_PROMPT
integration (20 phases) plus the XLSX chunker work.

**Branch with all the work:** `feat/mega-prompt-integration`
**State at handoff:** working tree clean, 22 commits ahead of `origin/main`,
build green (8.77s, 3119 modules), all infra deployed live to project
`jcbxmpgjirxqszodotmx`.

---

## 1. Mac prerequisites (install before cloning)

```bash
# Node 22+ — required for the BOM self-tests' --experimental-strip-types flag
brew install node@22
node --version   # should print v22.x.x or higher

# Supabase CLI — needed for edge function deploys
brew install supabase/tap/supabase
supabase --version

# Python 3.11+ — used by the xlsx skill scripts
brew install python@3.11

# Git — comes with macOS / Xcode CLI tools, but ensure recent
git --version

# Claude Code — install per the latest Anthropic docs
# https://docs.claude.com/en/docs/claude-code/setup
```

## 2. Clone + checkout

```bash
cd ~/Code   # or wherever you keep projects
git clone https://github.com/copperh3ad-bot/merquant-erp.git
cd merquant-erp
git checkout feat/mega-prompt-integration
git log --oneline -5   # should show fde738d at the top
```

## 3. Recreate `.env` (NOT in git — secrets)

Copy these values from your Windows `.env` (`D:\merquant-erp\.env`) into
a new file at the repo root on the Mac:

```
VITE_SUPABASE_URL=https://jcbxmpgjirxqszodotmx.supabase.co
VITE_SUPABASE_ANON_KEY=<copy from Windows .env>
# Optional (only set if you want to use these features)
# VITE_USE_AI_V2=true
# VITE_GOOGLE_CLIENT_ID=<your google oauth client id>
```

The full env-var reference is in `tasks/NETLIFY_ENV.md`.

## 4. Install dependencies + verify

```bash
npm install              # ~30s — pulls jszip, all React+Vite deps
npm run build            # should finish in ~10s, build green
npm run dev              # http://localhost:5173/

# Verify the BOM/thread formula self-tests still pass (10/10)
node --experimental-strip-types tasks/run-bom-tests.ts
```

## 5. Authenticate the Supabase CLI

```bash
supabase login           # opens browser, sign in with the same account
supabase functions list --project-ref jcbxmpgjirxqszodotmx
# should show 21 functions (9 pre-existing + 12 from MEGA_PROMPT)
```

## 6. Configure Claude Code MCP servers (if you want them)

The Windows session used the **Supabase MCP server** for direct DB +
edge-function operations. If you want the same on Mac, add it to your
Claude Code MCP config (typically `~/Library/Application Support/Claude/claude_desktop_config.json`
or the per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=jcbxmpgjirxqszodotmx"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "<your supabase personal access token>"
      }
    }
  }
}
```

(Generate a personal access token at https://supabase.com/dashboard/account/tokens)

---

## 7. Resume prompt for Claude Code

When you start a fresh Claude Code session on the Mac, paste this prompt
to bring it up to speed without re-spending tokens summarising:

````
We're resuming MerQuant ERP development on a new machine (Mac). The previous
session on Windows completed the entire MEGA_PROMPT integration (20 phases:
agent memory layer, agentic AI Assistant v2, email-to-PO + IMAP + crawler,
TNA risk agent, BOM/fabric calculator + auto-routing) and an XLSX-chunking
follow-up for large tech-pack files.

**Current state:**
- Branch: `feat/mega-prompt-integration` (22 commits ahead of origin/main)
- Latest commit: fde738d "fix(techpacks): tighten Re-upload button"
- Build: green (8.77s, 3119 modules)
- Live infra (project ref `jcbxmpgjirxqszodotmx`):
  - 14 new migrations applied (0029-0036, 0037-0040)
  - 12 new edge functions deployed (memory-writer, ai-assistant-v2,
    email-po-agent, tna-risk-agent, bom-calculator, po-fabric-calculator,
    fabric-order-generator, agent-orchestrator, memory-consolidation-agent,
    email-crawler-agent, imap-test-connection, imap-credentials-save)
  - 6 pg_cron jobs registered + active
  - 6 DB triggers firing into agent_events
  - extract-barcodes edge fn extended for client-supplied images mode

**Read these first to get full context (DO NOT re-summarise):**
1. `tasks/MEGA_PROMPT_SUMMARY.md` — single-page overview of everything that
   shipped, plus 4 critical Supabase-platform adaptations and ~20 ERP
   column-name patches vs. the original MAS spec.
2. `tasks/mega-todo.md` — phase tracker, all 20 phases marked [x].
3. `tasks/NETLIFY_ENV.md` — production env-var checklist.
4. `tasks/MIGRATION_TO_MAC.md` — this file (setup steps for the Mac).

**Repo conventions to remember:**
- Path style: forward slashes everywhere now (Mac), not backslashes.
- Migrations: `migrations/up/00NN_*.sql`, NOT in `supabase/migrations/`.
  Apply via Supabase MCP `apply_migration` or Dashboard SQL Editor.
- Edge functions: `supabase/functions/<name>/index.ts`. Deploy with
  `supabase functions deploy <name> --project-ref jcbxmpgjirxqszodotmx`
  (DO NOT pass `--no-verify-jwt` unless explicitly removing JWT gating).
- ERP project ref is `jcbxmpgjirxqszodotmx` — distinct from the MAS sister
  project at `ecjqdyruwqlesfthgphv`. Never mix them up — Vault secrets
  and DB state are project-specific.
- Service-role JWT lives in Vault (`vault.secrets` named
  `service_role_key`) because Supabase blocks `ALTER DATABASE ... SET`
  for `app.service_role_key`. mig 0034 + 0036 read it via
  `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')`.

**Outstanding follow-ups (none urgent):**
1. mig 0039's RPC uses a "first-key of size_breakdown" approximation for
   multi-size POs. Per Appendix A.7 of `tasks/mega-exploration.md`, a
   proper fix fans out the LOOP per size_breakdown entry. Defer until
   real multi-size data shows the limitation.
2. Orchestrator's `runTargetedTnaRisk` passes `calendar_id` to
   tna-risk-agent, but the agent currently scans all calendars. Targeted
   run is a future optimisation.
3. CI integration for `tasks/run-bom-tests.ts` — currently manual.
4. notify-pricing-pending edge fn returned a 500 once on 2026-05-08
   (pre-MEGA_PROMPT, unrelated). Worth investigating if it recurs.

**What we just shipped that's hot:**
- `src/lib/xlsxChunker.js` — shared `splitXlsxBySheet` +
  `extractImagesFromXlsx` + `chunkImagesForBatching` helpers. JSZip-based
  client-side image extraction lets large tech packs (>10 MB, with
  embedded barcode images) flow through extract-barcodes in batched calls
  under the Supabase 6 MB edge-fn payload cap.
- `src/pages/TechPacks.jsx` upload cap raised 10 MB → 100 MB; barcode OCR
  uses the new chunker; "Re-upload" button only shows when re-uploading
  would actually help (no UPCs yet).
- `src/pages/FileFeeder.jsx` — migrated to import the chunker from the
  shared lib (no behaviour change, just dedup).
- `extract-barcodes` edge fn — added Mode B `{ images: [...] }` for
  pre-extracted images, deployed live.

**Open question the user wanted to bump on Supabase Dashboard:**
- Project Settings → Storage → Global file size limit is 50 MB (free tier
  default). Bumping to 100 MB+ lets the source XLSX persist in
  ai-extraction-sources bucket instead of falling back to a `blob:` URL.
  Until they bump it, the Re-upload button will appear on rows uploaded
  before the OCR finishes (we tightened the condition so it hides once
  UPCs are extracted). Verify with them whether they bumped this yet.

Don't repeat work. Don't re-derive what's in MEGA_PROMPT_SUMMARY.md.
Ask before applying new migrations or deploying. The user is Waqas (GM
Union Fabrics, plain-English answers please, no menus of choices for
trivial calls).
````

## 8. Sanity checks once everything is set up

Run these on the Mac and confirm before doing any new work:

```bash
# Build is green
npm run build

# All 10 BOM/thread self-tests pass
node --experimental-strip-types tasks/run-bom-tests.ts
# Expect: "10 passed, 0 failed (10 expected)"

# Edge functions list — should show 21 ACTIVE
supabase functions list --project-ref jcbxmpgjirxqszodotmx

# Cron jobs are registered + active (6 of them)
# Run via Supabase MCP or Dashboard SQL Editor:
#   SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;

# Vault secret is in place
#   SELECT name, LENGTH((SELECT decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id = s.id)) AS secret_length
#   FROM vault.secrets s WHERE name = 'service_role_key';
# Expect: 1 row, secret_length ~219
```

## 9. Things that DON'T transfer

- `node_modules/` — `npm install` rebuilds everything.
- `dist/` — build artifact, regenerate with `npm run build`.
- `.claude/` — Windows agent worktree state, not portable.
- `_claude-code-ready/` — staging files from MEGA_PROMPT, already
  integrated. Delete if you want, or keep for reference (716 KB).
- The user's local Supabase CLI session — re-run `supabase login` on Mac.
- The Windows-side `dev.log` / runtime caches — none of these matter.

## 10. After the Mac is up + verified

Once you're confident the Mac dev environment works end-to-end:

```bash
# Optional: archive the staging dir on the Mac to free space
tar czf _claude-code-ready.tar.gz _claude-code-ready/ && rm -rf _claude-code-ready/

# Optional: start a fresh Claude Code session and paste the resume prompt
# from section 7 above to brief it.
```

That's it — the integration is shippable as-is, all live infra is healthy,
and the next session on Mac can pick up wherever you want.
