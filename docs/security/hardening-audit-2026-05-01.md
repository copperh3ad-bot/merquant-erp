# MerQuant Hardening Audit — 2026-05-01

> Auditor: Claude Opus 4.7. Read-only. No code changes, no deploys, no SQL writes.

---

## Closure status — 2026-05-02

All 18 findings have been remediated as of 2026-05-02. Closure commits:

| # | Title | Status | Commit |
|---|---|---|---|
| 1 | `user_profiles` readable by unauthenticated users | ✅ Closed | `f19cd73` |
| 2 | `email_crawl` open to PUBLIC (read/write/delete) | ✅ Closed | `f19cd73` |
| 3 | `ai-proxy` edge function has no JWT verification | ✅ Closed | `787411c` |
| 4 | Other tables open to PUBLIC | ✅ Closed | `94d93f1` |
| 5 | Almost every business table has `USING (true)` for `authenticated` | ✅ Closed | Group commits `03008f4`, `a4ac244`, `b6fef6f`, `791c7ba`, `50b2467`, `ea5a39e`, `2660743`, `a0df5a1` |
| 6 | `notify-pricing-pending` edge function has no auth | ✅ Closed | `b397dd2` |
| 7 | `classify-components` and `extract-barcodes` do not actually verify the JWT | ✅ Closed | `d1be33b` |
| 8 | `user-approval` `notify_owner` action accepts unauthenticated input | ✅ Closed | `bcf5403` (this session) |
| 9 | `exec_sql` RPC bypasses RLS and uses regex-based input validation | ✅ Closed | `fd1a6eb` (this session) |
| 10 | gmail OAuth refresh tokens stored in plaintext | ✅ Closed | `02e5798` (this session) |
| 11 | Front-end role checks not backed by server-side enforcement | ✅ Closed (covered by #5) | (group commits) |
| 12 | No client-side file size or type cap on several upload paths | ✅ Closed | `72fc03d` |
| 13 | CDN-loaded XLSX library has no Subresource Integrity | ✅ Closed | `c9f6414` |
| 14 | xlsx 0.18.5 has known CVEs | ✅ Closed | `d13a94e`, `36e1b90` |
| 15 | Storage bucket `ai-extraction-sources` has no per-user scoping | ✅ Closed | `bcf5403` (this session) |
| 16 | No security headers in the deployment | ✅ Closed | `8c2a16e` |
| 17 | Wide CORS on every edge function | ✅ Closed | `fd1a6eb` (this session) |
| 18 | `backup-hourly` auth uses a shared static secret | ✅ Closed | `83ab157` |

For Supabase secrets created during this work, see
[`docs/security/SUPABASE_SECRETS.md`](SUPABASE_SECRETS.md).

---

## Plain-English summary (read this first)

I went through MerQuant's code, database schema (from the migration baseline), edge functions, deployment config, and dependencies. **I found a small number of issues that need to be fixed urgently and several smaller hardening items.** The good news: the basics are mostly right — your real secrets (Anthropic key, Resend key, Google client secret, service-role key) live on the server and are not in your client code, your `.gitignore` correctly blocks `.env` files, and your auth flow uses Supabase properly.

The bad news, in one sentence: **your database has been configured to assume the front-end is the security boundary, but Supabase's anon key is publicly available, so an attacker who reads it from your bundle can talk directly to the database.** That means the role-permission matrix you have in `permissions.js` is effectively cosmetic — it stops normal users from clicking buttons they shouldn't, but it cannot stop a determined attacker. The fix for most of this is server-side: tighten Row-Level Security (RLS) policies on Postgres tables.

I could not run live SQL against your Supabase project (the MCP write/read tools were denied in this sandbox), so RLS findings below are based on reading your migration baseline `migrations/up/0001_init.sql` (committed schema, applied to prod per your repo structure). If a policy was changed in production after that baseline was committed, the actual state may differ — I flag this in "Out of scope".

---

## TL;DR

- **18 findings total**: 4 Critical, 6 High, 5 Medium, 3 Low.
- **Top concern:** `user_profiles` is readable by anyone on the internet (no login needed); `email_crawl`, `bom_explosion_log`, `whatsapp_crawl`, `user_settings`, `job_card_steps`, `sample_invoices` are read+write to anyone on the internet; the `ai-proxy` edge function has no JWT verification, so anyone can burn your Anthropic API budget.
- **Estimated fix time:** ~2 to 3 focused hours for the Critical/High items (mostly tightening RLS policies and adding `verify_jwt: true` to two edge functions). Medium/Low are a half-day of polish.

---

## WAKE UP NOW

Three things are exposed enough that I'd treat them as urgent — not "drop everything" emergencies, but worth knowing about before coffee:

1. **`user_profiles` is publicly readable (no login).** Policy `profiles_anon_select ON public.user_profiles FOR SELECT TO anon USING (true)` (`migrations/up/0001_init.sql:7279`) lets any unauthenticated visitor read every employee's email, full name, role, team, department, and approval status by hitting `https://ecjqdyruwqlesfthgphv.supabase.co/rest/v1/user_profiles?select=*` with the anon key from your bundle. This is essentially an open-on-the-internet HR directory.

2. **`email_crawl` is publicly read/write/delete (no login).** Policies at `migrations/up/0001_init.sql:7000, 7007, 7020, 7027` use `USING (true)` with no `TO` clause, so they apply to PUBLIC (which includes the anon role). This table contains full email bodies, sender/receiver addresses, AI-extracted PO content, prices — i.e. your buyers' confidential commercial data. Anyone could read it all, modify it, or wipe it.

3. **`ai-proxy` edge function has no auth.** `DEPLOYMENT_MANIFEST.md:213` confirms `verify_jwt: false`, and `supabase/functions/ai-proxy/index.ts` doesn't read or check the Authorization header. Anyone on the internet who finds the function URL (which is essentially public) can send unlimited prompts to Claude on your dime. With current Anthropic pricing, a script running `claude-sonnet-4-5` calls in a loop could rack up four-figure USD bills overnight.

These three are why I'd recommend you tackle the Critical section before you do anything else tomorrow.

---

## Critical

### Finding 1: user_profiles is readable by unauthenticated users
- **Where:** `migrations/up/0001_init.sql:7279`
  ```sql
  CREATE POLICY profiles_anon_select ON public.user_profiles
    FOR SELECT TO anon USING (true);
  ```
- **What:** This policy explicitly grants the `anon` role full read access to your user table. The `anon` role is what an unauthenticated client gets when they use your public anon key (which is in every page of your bundle). So no login is needed.
- **Risk:** An attacker can scrape your full employee directory: emails, full names, roles ("Owner"/"Manager"), team, department, approval status. That's everything they need to run a phishing campaign targeted at your team — they can pretend to be the Owner emailing a Merchandiser, etc. Also a privacy/GDPR exposure for staff data.
- **Fix:** Drop `profiles_anon_select`. The existing `profiles_select_authenticated` policy already covers logged-in users, which is the only legitimate use case (the login screen does not need to read user_profiles).

### Finding 2: email_crawl table is open to PUBLIC (read/write/delete)
- **Where:** `migrations/up/0001_init.sql:7000-7027`
  ```sql
  CREATE POLICY email_crawl_delete ON public.email_crawl FOR DELETE USING (true);
  CREATE POLICY email_crawl_insert ON public.email_crawl FOR INSERT WITH CHECK (true);
  CREATE POLICY email_crawl_read   ON public.email_crawl FOR SELECT USING (true);
  CREATE POLICY email_crawl_update ON public.email_crawl FOR UPDATE USING (true);
  ```
  None of these specify a `TO` clause, so Postgres applies them to PUBLIC (anon + authenticated).
- **What:** The `email_crawl` table holds full Gmail message contents — bodies, senders, attachments, AI-extracted PO data, buyer addresses, item prices, all the commercially-sensitive content.
- **Risk:** With the public anon key, anyone can read your entire email_crawl table (commercial intelligence on every PO from every buyer) and can also delete or tamper with it (sabotage your own audit trail; insert fake "approved POs" before your team imports them).
- **Fix:** Recreate each policy with `TO authenticated`. Even better: scope reads to the user who owns the email or to Owner/Manager only.

### Finding 3: ai-proxy edge function has no JWT verification
- **Where:** `supabase/functions/ai-proxy/index.ts` (full file); `DEPLOYMENT_MANIFEST.md:213` documents `verify_jwt: false`.
- **What:** The function reads `ANTHROPIC_API_KEY` from env and forwards any incoming `messages`/`tools` payload to `https://api.anthropic.com/v1/messages`. There is no check that the caller is authenticated. The CORS header is `Access-Control-Allow-Origin: *`, so any browser, anywhere, can call it.
- **Risk:** Cost exhaustion. An attacker who finds the URL `https://ecjqdyruwqlesfthgphv.supabase.co/functions/v1/ai-proxy` (it's in the deployment manifest in this repo and visible in network traffic when any logged-in user uses AI Assistant) can run unlimited prompts. With `claude-sonnet-4-5` at ~$3/M input + $15/M output, sustained abuse is several hundred dollars per hour. Anthropic also rate-limits but the bill lands on you.
- **Fix:** Add `verify_jwt: true` (Supabase config) AND inside the handler call `supabase.auth.getUser(token)` to confirm a real user. The other extract-* functions already do this — copy that pattern. As a belt-and-suspenders, also tighten CORS to your Netlify domain.

### Finding 4: Other tables open to PUBLIC (anon read/write)
- **Where:** Same pattern as Finding 2. All these policies omit `TO authenticated`:
  - `bom_explosion_log` — `migrations/up/0001_init.sql:6895` (`bom_log_all`)
  - `job_card_steps` — line 7072 (`jcs_all`)
  - `sample_invoices` — line 7363 (`sample_invoices_all`)
  - `user_settings` — line 7473 (`us_all`)
  - `whatsapp_crawl` — line 7492 (`wa_all`)
- **What:** Same root cause as Finding 2 — Postgres defaults `CREATE POLICY ... USING(true)` to PUBLIC when no `TO` clause is given.
- **Risk:** `user_settings` is the most concerning — it likely contains per-user preferences and possibly tokens; `sample_invoices` has financial figures; `whatsapp_crawl` (if populated) has private chats; `bom_explosion_log` is internal data; `job_card_steps` is production data. All exposed.
- **Fix:** `ALTER POLICY <name> ON public.<table> TO authenticated;` (or recreate with the role). Lower priority than email_crawl + user_profiles because some are less sensitive, but same one-line fix per table.

---

## High

### Finding 5: Almost every business table has `USING (true)` for `authenticated`
- **Where:** `migrations/up/0001_init.sql:6520-6870` and many more — the policy named `auth_all` (or variants like `auth_all_po`, `auth_all_items`, etc.) is applied to ~30+ tables.
- **What:** Any logged-in user, regardless of role, can read every row, write every row, and delete every row in: `purchase_orders`, `po_items`, `articles`, `payments`, `commercial_invoices`, `tech_packs`, `costing_sheets`, `suppliers`, `quotations`, etc. Your `permissions.js` file gates UI buttons by role (Viewer/Supplier/QC Inspector/etc.), but the database doesn't enforce any of it.
- **Risk:** A user with a "Viewer" or "Supplier" role can sign in, open the browser dev console, run `await supabase.from('purchase_orders').delete().neq('id', '00000000-0000-0000-0000-000000000000')` and wipe every PO. Or read every supplier's pricing. Or update payments to mark them paid. Anything the most-privileged user can do, the least-privileged user can do via the API. (The reason this isn't Critical is that it requires a valid login first — but you have a self-signup flow gated by an owner-approval step, which is a good speed bump but not a real wall.)
- **Fix:** Replace each `auth_all` policy with role-aware versions, e.g.:
  ```sql
  CREATE POLICY po_select ON public.purchase_orders
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
                   AND role IN ('Owner','Manager','Merchandiser','QC Inspector','Supplier','Viewer')));
  CREATE POLICY po_insert ON public.purchase_orders ...  -- subset of roles
  CREATE POLICY po_update ON public.purchase_orders ...
  CREATE POLICY po_delete ON public.purchase_orders ...  -- Owner only
  ```
  This is a multi-hour project — consider a session dedicated to it. The pattern is already used correctly on `capacity_plans`, `consumption_library`, `price_list`, `production_lines`, `production_output`, `po_item_sizes` (see lines 6914-7257) — those are good templates.

### Finding 6: notify-pricing-pending edge function has no auth
- **Where:** `supabase/functions/notify-pricing-pending/index.ts:104-136`.
- **What:** Reads request body and sends an email to OWNER_EMAIL. No `Authorization` check.
- **Risk:** Anyone on the internet can spam the owner's mailbox by POSTing to this function. The HTML is escaped, so it's not an injection vector, but Resend has per-domain sending limits and could rate-limit your domain or flag it as a spam source if abused at volume.
- **Fix:** Add `verify_jwt: true` and verify the caller is an authenticated user (or, since this is invoked from `MasterDataImport.jsx` only, verify they have the `Manager` role).

### Finding 7: classify-components and extract-barcodes do not actually verify the JWT
- **Where:** `supabase/functions/classify-components/index.ts:82-83` and `supabase/functions/extract-barcodes/index.ts:183-184`. Both check that an `Authorization` header *exists* but never call `supabase.auth.getUser(token)` to confirm it's valid.
- **What:** Any string is accepted as a token, e.g. `Authorization: Bearer x`. The function then proceeds to call Anthropic.
- **Risk:** Same as the ai-proxy finding — cost exhaustion. Less severe because each call processes a real file payload (slower attack), but still abusable.
- **Fix:** Copy the `getUser()` pattern from `extract-document/index.ts:314-318`.

### Finding 8: user-approval `notify_owner` action accepts unauthenticated input
- **Where:** `supabase/functions/user-approval/index.ts:250-279`.
- **What:** This action runs with the SERVICE_ROLE key and unconditionally upserts whatever `user_id`, `email`, `full_name`, `signup_method` the body contains, then emails the owner. It's deliberately public so a user can call it right after signing up.
- **Risk:** A spammer can send 1,000 fake signups (each a real-looking name and email), each one sends an email to the owner via Resend. Beyond mailbox spam, this could trigger Resend's rate limits or pollute your `user_profiles` table with bogus rows. The body is `escapeHtml`-ed so XSS is mitigated, but the email content is attacker-controlled.
- **Fix:** Two options. Cleanest: require the caller to pass a valid Supabase auth token (the user has just signed up; they DO have a session) and verify `data.user.id === body.user_id`. Lighter touch: rate-limit by IP (1 per minute) and require the email to match a real `auth.users` row.

### Finding 9: exec_sql RPC bypasses RLS and uses regex-based input validation
- **Where:** `migrations/up/0001_init.sql:121-137`.
- **What:** Defined as `SECURITY DEFINER`, so it runs as the database owner and ignores RLS. It tries to restrict to read-only by string-matching `SELECT%`, `WITH%`, `EXPLAIN%` at the start of the query. The user-supplied `query` is then concatenated into another `EXECUTE` string — this is classic SQL-string injection territory.
- **Risk:** A determined attacker (logged in, with PUBLIC EXECUTE on the function) can craft input that opens the parenthesis early and appends arbitrary statements: e.g. `query = '1) t; ALTER TABLE user_profiles DROP COLUMN role; SELECT * FROM (SELECT 1`. Even if injection fails, the `SELECT%` filter still allows reading any table — including ones the user shouldn't see — because RLS is off in `SECURITY DEFINER`.
- **Fix:** Either remove this RPC entirely (the AI Assistant could use parameterised supabase.from() calls instead) or rewrite it to use a parser, restrict to specific allow-listed tables, and `REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC; GRANT EXECUTE ... TO authenticated;` and combine with a per-user role check inside the function body.

### Finding 10: gmail OAuth refresh tokens stored in plaintext
- **Where:** `migrations/up/0001_init.sql:1612` — `refresh_token text NOT NULL`.
- **What:** Long-lived Google refresh tokens are stored as plain text in `gmail_oauth.refresh_token`. There is a per-user RLS policy (`gmail_oauth_own_user`, line 7058) that does limit reads to the row's owner, which is good — but a SECURITY DEFINER function or a service-role compromise reads them in the clear.
- **Risk:** If anyone gets DB access (a compromised SUPABASE_SERVICE_ROLE_KEY in a CI log, a stolen backup file from the `backups` bucket, a future SQL-injection bug), they get long-lived access to every connected Gmail inbox. Refresh tokens don't expire, so the blast radius lasts until each user revokes app permissions.
- **Fix:** Wrap with `pgcrypto`'s `pgp_sym_encrypt`/`pgp_sym_decrypt` using a key stored as a Supabase secret. The edge function decrypts at use-time. Or move to encrypted-at-rest storage via Supabase Vault if available.

---

## Medium

### Finding 11: Front-end role checks are not backed by server-side enforcement
- **Where:** `src/lib/permissions.js`, `src/App.jsx:33-46` (RouteGuard), `src/components/shared/PermissionGate.jsx`.
- **What:** Permission gates and route guards run only on the client. Removing them in the dev console gives the user UI access; calling `supabase.from(...)` directly bypasses them entirely.
- **Risk:** Defence in depth — covered functionally by Finding 5 above (RLS policies). Worth fixing alongside that work.
- **Fix:** This is the same fix as #5. Once RLS enforces roles server-side, the client-side guards become a UX nicety rather than a security control.

### Finding 12: No client-side file size or type cap on several upload paths
- **Where:**
  - `src/pages/MasterDataImport.jsx:778` — `accept=".xlsx,.xlsm,.pdf,.png,.jpg,.jpeg,.csv,.txt,.tsv"`, no `file.size` check.
  - `src/components/po/POImportDialog.jsx:322` — accept many types, no size cap.
  - `src/components/fabric/UploadFabricSheet.jsx:290` — no size cap.
  - `src/components/packaging/UploadPackagingSheet.jsx:131` — no size cap.
  - `src/pages/TechPacks.jsx:1317` — no size cap.
- **What:** The edge function `extract-document` has a 10 MB cap server-side (good), but for code paths that go directly to the browser-side XLSX parser via the CDN script, a user can upload a 200 MB XLSX and crash the tab or run the SheetJS parser into a memory wedge.
- **Risk:** Self-inflicted DoS plus parser CVE exposure (see Finding 14). Not a security exploit per se, but a stability/cost concern.
- **Fix:** Add `if (file.size > 10 * 1024 * 1024) throw new Error("File too large")` at the entry point of every upload handler. The pattern from `src/components/shared/TryAIExtractionButton.jsx:43` is the right reference.

### Finding 13: CDN-loaded XLSX library has no Subresource Integrity (SRI) hash
- **Where:** ~13 files load `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` via dynamic `<script>` injection (see `src/pages/MasterDataImport.jsx:20`, `src/lib/bobTechPackParser.js:478`, `src/components/po/POImportDialog.jsx:52`, etc.).
- **What:** No `integrity="sha384-..."` attribute, no `crossorigin`. If jsdelivr's CDN is ever compromised, or if jsdelivr serves a tampered version, you'll execute attacker code with full DOM access in the user's session.
- **Risk:** Supply-chain attack. Low likelihood (jsdelivr is reputable), high impact if it happens.
- **Fix:** Either pin to a hash with SRI (`script.integrity = "sha384-..."; script.crossOrigin = "anonymous"`), or import xlsx as an npm dependency and let Vite bundle it. Bundling is cleaner and removes the runtime dependency on jsdelivr.

### Finding 14: xlsx 0.18.5 has known CVEs (prototype pollution + ReDoS)
- **Where:** All the CDN loads from Finding 13, plus `supabase/functions/extract-document/index.ts:21` (`https://esm.sh/xlsx@0.18.5`).
- **What:** SheetJS 0.18.5 is affected by GHSA-4r6h-8v6p-xvw6 (prototype pollution) and GHSA-5pgg-2g60-rcc5 (ReDoS via crafted XLSX). Both are fixed in 0.20.2+. The official npm package was unpublished from npm in early 2024; you must install from `https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz` per the SheetJS docs.
- **Risk:** A user uploading a malicious XLSX (especially in MasterDataImport flow, which auto-parses untrusted spreadsheets) could trigger prototype pollution leading to JS-level privilege escalation in the tab, or a ReDoS that hangs the browser/edge function.
- **Fix:** Upgrade to `xlsx@0.20.x` from sheetjs.com, in both the front-end (npm-bundle it via Vite) and the edge function (replace the `https://esm.sh/xlsx@0.18.5` URL).

### Finding 15: Storage bucket `ai-extraction-sources` has no per-user scoping
- **Where:** `migrations/up/0002_ai_extractions.sql:102-112`.
  ```sql
  CREATE POLICY ai_extraction_sources_select ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'ai-extraction-sources');
  ```
- **What:** Bucket is private to anon (good), but every authenticated user can read every other user's uploaded files. Filenames are like `{extraction_id}/{filename}` so guessing isn't easy, but listing the bucket reveals everything.
- **Risk:** A QC Inspector can read the Owner's master-data XLSX uploads, etc. Same flavour of issue as Finding 5.
- **Fix:** Scope by `(storage.foldername(name))[1]::uuid` matching `ai_extractions.created_by = auth.uid()`. Or redirect downloads through a signed-URL edge function that enforces role.

---

## Low

### Finding 16: No security headers in the deployment
- **Where:** `netlify.toml` (3 lines, only sets publish dir + SPA redirect). No `_headers` file in `public/`. `index.html` has no CSP meta tag.
- **What:** Missing `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`.
- **Risk:** Clickjacking (no XFO), MIME sniffing, and an unbounded surface area for any future XSS bug. Best-practice hardening rather than an active hole.
- **Fix:** Create `public/_headers` (Netlify reads this automatically):
  ```
  /*
    X-Frame-Options: DENY
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    Strict-Transport-Security: max-age=31536000; includeSubDomains
    Permissions-Policy: camera=(), microphone=(), geolocation=()
  ```
  CSP is more involved because of the CDN script loads — defer until Finding 13 is resolved.

### Finding 17: Wide CORS on every edge function
- **Where:** Every edge function: `Access-Control-Allow-Origin: *`.
- **What:** Anyone's browser, anywhere, can invoke your functions cross-origin.
- **Risk:** Combined with the auth issues in Findings 3, 6, 7, 8, this lowers the friction for an attacker. With proper auth, wide CORS is mostly fine.
- **Fix:** Set `Access-Control-Allow-Origin` to `https://merquanterp.netlify.app` (your prod domain). Keep `*` only on functions explicitly intended to be public.

### Finding 18: backup-hourly auth uses a shared static secret
- **Where:** `supabase/functions/backup-hourly/index.ts:108-113`.
- **What:** A single `BACKUP_SECRET` env var gates the function. If `BACKUP_SECRET` is empty (`Deno.env.get("BACKUP_SECRET") || ""`), the check is skipped and anyone can trigger a backup run, which writes JSON dumps of every table to the `backups` bucket.
- **Risk:** If the secret is unset, anyone can trigger backups (DoS / cost). Even if set, leaking the secret (e.g. it ends up in a CI log) gives full data exfil if the `backups` bucket is also readable. I couldn't see the bucket's RLS policies.
- **Fix:** Treat empty string as "deny all". `if (!BACKUP_SECRET) return j({ error: "not_configured" }, 503);` and check the bucket is private. Rotate the secret to be safe.

---

## Out of scope / requires owner input

These are things I noticed but couldn't decide alone or couldn't confirm without live tools:

- **Live RLS state vs migration baseline.** All RLS findings (1, 2, 4, 5, 10, 15) are derived from `migrations/up/0001_init.sql` (committed Apr 26). If anyone has run a manual `ALTER POLICY` in the Supabase dashboard since then, the live state may differ. The Supabase MCP tools were denied in this audit so I could not query `pg_policies` directly. **Action: Waqas, run the Supabase advisors check (`Database → Advisors → Security`) — it lists RLS gaps live.** Or grant the audit MCP read access and re-run.
- **`ai-proxy` as a deliberate design choice.** `DEPLOYMENT_MANIFEST.md:213` notes `verify_jwt: false` matter-of-factly, so this might be intentional. If it is, the abuse surface (Anthropic billing) needs *some* mitigation — at minimum, a tight per-IP rate limit and a strict token budget on the Anthropic console.
- **Git history scanning.** Bash was denied, so I couldn't run `git log -p | grep` for accidentally-committed secrets. Manual check recommended: GitHub repo → Security → Secret scanning. The current `.env` is correctly gitignored, but if a previous commit ever included one, the leaked key is still in the history and needs rotation.
- **Storage `backups` bucket policies.** The `backup-hourly` function writes to a `backups` bucket but the migration baseline doesn't show its RLS. Need to confirm it's private and scoped to service-role only.
- **`gmail_oauth_service` policy intent.** The policy `gmail_oauth_service ON public.gmail_oauth TO service_role USING (true)` (line 7065) is fine — but it implies your edge functions run as service-role, which is normal. Just confirming this is intentional.
- **Supplier role usage.** Your permissions matrix has a `Supplier` role with very narrow read access ("only their linked POs"). RLS doesn't enforce this. If you're not actually using the Supplier role yet, the risk is theoretical — but worth confirming before someone gets invited.
- **`xlsx` upgrade path.** Upgrading from 0.18.5 to 0.20.x is a non-trivial change because the package source moved off npm. Worth scheduling a half-day to do it cleanly across all 13 call sites.

---

## Suggested fix order

If you want a one-page playbook to work through with me:

1. (10 min) Drop `profiles_anon_select`. Re-test that login still works.
2. (15 min) Tighten `email_crawl` policies to `TO authenticated`. Verify the email crawler still works for the Owner.
3. (15 min) Same for `bom_explosion_log`, `job_card_steps`, `sample_invoices`, `user_settings`, `whatsapp_crawl`.
4. (20 min) Add `verify_jwt: true` to `ai-proxy` and `notify-pricing-pending`. Add a real `getUser()` call inside `classify-components` and `extract-barcodes`. Redeploy each.
5. (30 min) Add `_headers` file with security headers; tighten CORS on each edge function to your Netlify domain.
6. (multi-hour, separate session) Replace `auth_all` policies with role-aware ones across all ~30 business tables. This is the big one — needs careful testing per role.
7. (ongoing) Schedule the xlsx 0.18.5 upgrade and the gmail-token encryption work.
