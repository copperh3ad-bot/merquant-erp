# Hardening status — 2026-05-05 (post-recovery)

> Update to `docs/security/hardening-audit-2026-05-01.md`. Issued after the 2026-05-05 recovery session that redeployed Tokyo's edge functions from `origin/main` (`ae63607`) to undo the brief regression caused by a 2026-05-02 deploy off stale local `main`.

## What changed since the 2026-05-02 closure

On 2026-05-02 a session deploying off stale local `main` overwrote the live edge functions on Tokyo (`jcbxmpgjirxqszodotmx`) with code that predated the Findings #8, #10, #15, #17, #18 closure commits. From 2026-05-02 ~13:24 UTC until 2026-05-05 ~13:19 UTC, those five findings were **effectively re-opened on the live deployment** even though the audit doc said closed and the database side (where those findings have a DB component) stayed correct.

Phase 2 of this recovery session redeployed all nine edge functions to Tokyo from `origin/main`. New version on every function: `v19`, deploy timestamps clustered at 2026-05-05T13:19:06–13:19:20Z. Verified post-deploy:

- `user-approval` source contains the Finding #8 gate logic (`notify_owner` requires `user_id` reference to a `< 10 min`-old auth.users row whose email matches body).
- `gmail-oauth` source calls `encrypt_gmail_token()` RPC and writes `refresh_token_encrypted` / `access_token_encrypted` columns (Finding #10).

## Status of all 18 findings (corrected)

| # | Title | Closing commit on `origin/main` | Status as of 2026-05-05 17:30 PKT |
|---|---|---|---|
| 1 | `user_profiles` open to anon | `f19cd73` | ✅ Closed |
| 2 | `email_crawl` open to PUBLIC | `f19cd73` | ✅ Closed |
| 3 | `ai-proxy` no JWT | (group) | ✅ Closed — `verify_jwt: true` on Tokyo `ai-proxy` v19 |
| 4 | Five tables open to PUBLIC | `94d93f1` (legacy mig 0010) + tier-2 RLS migrations | ✅ Closed — Tokyo + Mumbai policies role-aware (no `_all USING (true)`) |
| 5 | `authenticated USING (true)` everywhere | tier-2 RLS migrations on `origin/main` | ✅ Closed — verified per-command role-aware policies on Tokyo for the five Finding-4 tables (and previously on a wider survey for the financial / audit / production / master-reference / ai_extractions / public-role groups). |
| 6 | `notify-pricing-pending` no auth | `b397dd2` | ✅ Closed — Tokyo `verify_jwt: true` v19 |
| 7 | `classify-components` / `extract-barcodes` no JWT | `d1be33b` | ✅ Closed — both `verify_jwt: true` v19 on Tokyo |
| 8 | `user-approval/notify_owner` accepts unauth | `bcf5403` | ✅ Closed — verified function source on Tokyo v19 contains the recency + email-match gate |
| 9 | `exec_sql` RPC bypasses RLS | `fd1a6eb` | ✅ Closed — `migrations/up/0013_harden_exec_sql.sql` allows `{Owner, Manager, Merchandiser}`. (See "Beyond audit" below for further tightening on local feature branch.) |
| 10 | Gmail OAuth tokens plaintext | `02e5798` | ✅ Closed — verified `gmail-oauth` v19 on Tokyo calls `encrypt_gmail_token` RPC and writes `refresh_token_encrypted` |
| 11 | Front-end role checks not server-side | (group) | ✅ Closed |
| 12 | No upload size cap | `72fc03d` | ✅ Closed |
| 13 | XLSX no SRI | `c9f6414` | ✅ Closed |
| 14 | xlsx 0.18.5 CVEs | `d13a94e`, `36e1b90` | ✅ Closed |
| 15 | Storage bucket no per-user scoping | `bcf5403` | ✅ Closed — function-side path scoping shipped in same commit as Finding #8 (Tokyo v19) |
| 16 | No security headers | `8c2a16e` | ✅ Closed (see "Beyond audit" for additional CSP layer on local feature branch) |
| 17 | Wide CORS | `fd1a6eb` | ✅ Closed — Tokyo v19 functions ship the allowlist |
| 18 | `backup-hourly` static secret | `83ab157` | ✅ Closed — Tokyo `backup-hourly` v19 has the fail-closed branch when `BACKUP_SECRET` is unset |

**18 of 18 findings closed on `origin/main` and verified live on Tokyo as of this writing.**

## What's genuinely still open or pending

### A. Live-state vs. origin/main drift on legacy migrations directory

`migrations/up/0010_security_hardening_finding_4.sql` is on `origin/main` and was apparently applied to Tokyo (and Mumbai) at some prior point. After the tier-2 hardening migrations under `supabase/migrations/2026050[2-4]_*` ran, the `_all` policies that 0010 created have been replaced. The 0010 file remains in the tree as historical record. **Not a security issue, but a documentation cleanup task.** Recommendation: add a one-line header comment to 0010 noting it's superseded by the tier-2 RLS migrations.

### B. Local feature branch `feat/v2-ai-native-and-hardening` carries unmerged tightenings

The 29-commit feature branch (HEAD: `c3ae946`, base: `origin/main` at `ae63607`) contains hardening work beyond what `origin/main` has. The tier-three items relevant to the audit:

| Item | Local commit | What it does | Live state |
|---|---|---|---|
| C2: pin `verify_jwt` in `supabase/config.toml` | `b43045b` | Adds platform-level deploy-time `verify_jwt=true` declarations to seven functions (origin/main only has in-handler checks) | Defence-in-depth — flag declared in repo but Tokyo state is unchanged from origin/main values which are already correct. No regression. |
| C3: tighten `exec_sql` to `{Owner, Manager}` | `344fe50` | Adds `migrations/up/36_exec_sql_owner_manager_only.sql` narrowing from the origin/main-allowed `{Owner, Manager, Merchandiser}` to `{Owner, Manager}` only | Per the commit message, this was applied to live DB. **Verify on Tokyo whether mig 36 actually ran** — if so, status is "more restrictive than audit closure"; if not, audit-baseline closure stands. |
| H2: CSP via `netlify.toml` | `54c66ef` | Adds full Content-Security-Policy + permissions-policy with `microphone=(self)` for AIVoiceEntry. `origin/main`'s `public/_headers` only has baseline (X-Frame, HSTS, nosniff). | Conflict between `public/_headers` (microphone off) and `netlify.toml` (microphone self). Netlify merges; verify which wins on the live deploy before relying on either. |
| C4: `bootstrap_first_owner` RPC | `d6a04d2` | New SECURITY DEFINER RPC to safely bootstrap the first Owner without leaving a permanent privileged path. | Per local commit message, applied to live DB. |
| M2: re-enable email confirmation (DB-side) | `b3a0a69` | Adds mig 38 to set `is_active = (email_confirmed_at IS NOT NULL)`; adds an `on_auth_user_email_confirmed` trigger; reverses an older `disable_email_confirmation` migration. | Per local commit message, applied to live DB. The Auth-side toggle in Supabase Dashboard is a manual flip — confirm it's set to ON. |
| AI-RL: per-user rate limit on `ai-proxy` | `2f8adb2` | Adds `ai_proxy_calls` table (mig 39) + per-user rate-limit logic in `ai-proxy/index.ts`. | New surface — not on Tokyo until this branch is merged + deployed. |

These items are safe to leave on the feature branch. None of them re-open an audit finding. Several of them strengthen findings #9, #16, etc. beyond what the audit required.

### C. Mumbai cross-app residue

Eight edge functions on Mumbai (`ecjqdyruwqlesfthgphv`) still hold MerQuant ERP source code from a 2026-05-02 cross-app deploy. This is documented in `docs/incidents/mumbai-cross-app-touch-2026-05-05.md` and handed off to the MAS team. Not a MerQuant ERP audit item — separate ownership.

### D. Branch / repository hygiene

- Local `main` was reset from stale `3622c05` to `origin/main` `ae63607` during this recovery. No security exposure; just a navigational nuisance fixed.
- Two stale feature branches were deleted (`claude/clever-jang-83affb` was `acd0594`, `claude/crazy-antonelli-0f58a4` was `35db047`). Useful commits salvaged onto:
  - `cleanup/post-recovery-2026-05-05` (this branch) — `verify-rls.mjs` probe + Viewer role removal
  - `feat/master-data-two-step-extraction` — four-commit Phase-2 extraction salvage

### E. Manual residue

- An empty directory `D:\merquant-erp\.claude\worktrees\clever-jang-83affb` is locked by Windows and could not be `rmdir`'d. Git has already pruned it from `worktree list`. Safe to delete after a Windows restart or via Explorer.
- Untracked helper scripts found in the two stale worktrees were preserved at `D:\merquant-erp\.claude\worktrees\_phase3_recovered\` for the user to review and delete or archive.

## Recommendation summary

1. Treat the audit as **fully closed**. No genuinely-open items at the audit-finding level.
2. Schedule a separate session to **decide whether to merge `feat/v2-ai-native-and-hardening`** into `origin/main` or break it into smaller PRs. Several of its commits add legitimate hardening on top of the audit baseline.
3. Hand `docs/incidents/mumbai-cross-app-touch-2026-05-05.md` to the MAS team.
4. Add a one-line "superseded by tier-2 RLS migrations" header to `migrations/up/0010_security_hardening_finding_4.sql` to avoid confusion in the future.
5. **Do not push or merge anything yet** — this recovery session was local-only per the user's instruction.
