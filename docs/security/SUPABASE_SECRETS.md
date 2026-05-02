# Supabase Edge-Function Secrets

These secrets are set per-project on Supabase Dashboard → **Settings →
Edge Functions → Secrets**. They are **not** committed to the repo;
this doc records what each one is for, who set it, and how to rotate.

The secret VALUES live only on the Supabase Dashboard. To retrieve a
value, sign in to Supabase as a project member and read it there. To
rotate, follow the per-secret rotation steps below.

Two projects use these:

| Project | Region | Used by |
|---|---|---|
| `jcbxmpgjirxqszodotmx` | Tokyo (ap-northeast-1) | MerQuant ERP (parent product) |
| `ecjqdyruwqlesfthgphv` | Mumbai (ap-south-1) | MerQuant MAS (sister fork) |

Every secret below must exist on **both** projects. Edge functions
fail closed when a required secret is missing.

---

## Secret inventory

| Secret | Purpose | Set in commit | Required by | Rotation impact |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Forwarded by `ai-proxy` to Anthropic's API. Powers File Feeder, AI Assistant, and every AI extraction. | (initial deploy) | `ai-proxy`, `extract-document`, `extract-barcodes`, `classify-components` | None — change on Anthropic side, paste new value into Supabase |
| `SUPABASE_URL` | Self-reference. Used by edge functions when they need to call back into their own DB. | (auto-set by Supabase) | All functions | n/a (managed) |
| `SUPABASE_ANON_KEY` | Same JWT the browser uses, for in-handler `auth.getUser()` checks. | (auto-set by Supabase) | `ai-proxy`, `classify-components`, `extract-barcodes`, `notify-pricing-pending` | n/a (managed) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin key. Never sent to the browser. Used for RLS-bypassing operations like the Gmail OAuth refresh and the user-approval flow. | (auto-set by Supabase) | `gmail-oauth`, `gmail-crawl`, `user-approval`, `backup-hourly` | n/a (managed) |
| `BACKUP_SECRET` | Bearer token gating `backup-hourly`. Without it, the function fails closed (503 not_configured). | `83ab157` | `backup-hourly` | None on backups already taken; rotate by generating a new token (`openssl rand -hex 32`) and updating any cron job that calls the function. |
| `RESEND_API_KEY` | Resend.com API key. Sends owner-notification emails on user signup + pricing-pending alerts. | (initial deploy) | `notify-pricing-pending`, `user-approval` | None on emails already delivered; rotate at resend.com → API Keys |
| `OWNER_EMAIL` | Where signup-approval + pricing-pending notifications go. Default: `waqas.ahmed@unionfabrics.com`. | (initial deploy) | `notify-pricing-pending`, `user-approval` | None |
| `EMAIL_FROM` | Resend "from" header. Default: `MerQuant <onboarding@resend.dev>`. | (initial deploy) | `notify-pricing-pending`, `user-approval` | None |
| `APP_URL` | Used in email links to point recipients back to the app. Default: `https://merquanterp.netlify.app`. | (initial deploy) | `notify-pricing-pending`, `user-approval` | None |
| `GOOGLE_CLIENT_ID` | OAuth 2 client ID for Gmail integration. From Google Cloud Console. | (initial deploy) | `gmail-oauth`, `gmail-crawl` | Re-authentication required for every connected user |
| `GOOGLE_CLIENT_SECRET` | OAuth 2 client secret pair to the above. | (initial deploy) | `gmail-oauth`, `gmail-crawl` | Same as above |
| **`GMAIL_TOKEN_KEY`** | **Symmetric passphrase used by `pgp_sym_encrypt`/`decrypt` (pgcrypto) to protect Google refresh + access tokens at rest in `gmail_oauth.refresh_token_encrypted` / `access_token_encrypted`.** | **`02e5798`** (Finding 10) | **`gmail-oauth`, `gmail-crawl`** | **Rotation re-encrypts every existing `gmail_oauth` row. See dedicated section below.** |
| `ALLOWED_ORIGINS` | (Optional, comma-separated) Extra origins to add to the CORS allowlist beyond the hardcoded defaults (`https://merquanterp.netlify.app`, `https://merquant-mas.netlify.app`, `http://localhost:5173-5175`). Set this for Netlify branch deploys / staging. | `fd1a6eb` (Finding 17) | All edge functions | None — just edit the comma-list |

---

## GMAIL_TOKEN_KEY — special handling

This secret is the encryption passphrase for Gmail OAuth tokens. Unlike
the other secrets, **rotating it requires a database backfill** because
existing ciphertext was encrypted with the old key.

### Initial setup (already done 2026-05-02)
- Generated with `randomBytes(32).toString("hex")` → 64-char hex string.
- Set on both projects via `node scripts/apply-0015.mjs --regenerate`.
- Existing `gmail_oauth` rows backfilled with `node scripts/backfill-gmail-tokens.mjs`.
- Round-trip verified: `decrypt(encrypt('hello', k), k) → 'hello'` on both projects.

### Retrieving the current value
Sign in to Supabase Dashboard → relevant project → **Edge Functions →
Secrets** → `GMAIL_TOKEN_KEY` → reveal/copy.

### Rotation procedure
**Don't rotate casually — every connected Gmail user has a row that
must be re-encrypted.** Do this only if the key is suspected leaked.

```bash
# 1. Decrypt all existing rows with the OLD key into a temporary table
#    (pseudocode — adapt for prod):
psql "<session-pooler-uri>" <<SQL
CREATE TEMP TABLE gmail_oauth_dec AS
  SELECT user_id,
         public.decrypt_gmail_token(refresh_token_encrypted, '<OLD_KEY>') AS rt,
         public.decrypt_gmail_token(access_token_encrypted,  '<OLD_KEY>') AS at
    FROM public.gmail_oauth;
SQL

# 2. Roll the secret + apply migration (no DDL changes; just rotates):
node scripts/apply-0015.mjs --regenerate
# Capture the new key from the script's stdout.

# 3. Re-encrypt with the new key:
GMAIL_TOKEN_KEY=<NEW_KEY> node scripts/backfill-gmail-tokens.mjs

# 4. Verify decryption works:
GMAIL_TOKEN_KEY=<NEW_KEY> node scripts/verify-0015.mjs
```

If the OLD key is lost (not just suspected leaked), every connected
Gmail user must re-OAuth from scratch — the encrypted tokens become
irrecoverable. This is the same blast radius as losing an external
service's master key.

### Why pass the key per-call rather than store on the DB

The pgcrypto helpers `encrypt_gmail_token(plain, key)` /
`decrypt_gmail_token(ct, key)` take the passphrase as an argument. The
edge function reads `GMAIL_TOKEN_KEY` from `Deno.env` and passes it on
each RPC. The DB stores only ciphertext.

Storing the key in the DB itself (e.g. as a GUC or in a settings table)
would defeat the purpose — anyone with DB access could decrypt.

`EXECUTE` on both helpers is REVOKED from PUBLIC, anon, authenticated
and GRANTed only to `service_role` — so a logged-in user cannot decrypt
tokens via a client-side RPC call.

---

## Setting a secret

### Via Dashboard (preferred for one-off changes)
Supabase Dashboard → project → Settings → Edge Functions → Secrets →
**Add new secret** → save.

### Via Management API (for scripted setup / rotation)
```bash
TOKEN=$(cat .supabase-token)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name":"NAME","value":"VALUE"}]' \
  https://api.supabase.com/v1/projects/<project_ref>/secrets
```

`scripts/apply-0015.mjs` is a worked example.

### After setting a secret
Edge functions read secrets at cold-start. Secrets set after a function
last started won't take effect until the function is invoked again.
For an immediate refresh, redeploy the function:

```bash
node scripts/deploy-edge-functions.mjs <project_ref>
```

---

## Audit history

- 2026-05-01 — Hardening audit
  (`docs/security/hardening-audit-2026-05-01.md`)
  identified Gmail refresh tokens stored in plaintext (Finding 10).
- 2026-05-02 — Finding 10 closed in commit `02e5798`. Migration 0015
  added the encrypted columns + helper functions. Edge functions
  updated to encrypt-on-write / decrypt-on-read with plaintext
  fallback during the rollout window.
- TODO — Drop the legacy plaintext columns (`refresh_token`,
  `access_token`) once we've confirmed every code path uses the
  encrypted columns. Tracked as a follow-up migration.
