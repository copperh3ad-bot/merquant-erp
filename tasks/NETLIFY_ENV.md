# Netlify Env Vars + Supabase Edge Secrets — Phase 19

Audit of all environment variables the post-MEGA_PROMPT codebase touches,
and where each one lives. Run through this when promoting a branch from
local → Netlify, and after rotating any secrets.

## 1. Netlify build env (Site → Settings → Environment variables)

These are read by Vite at build time and embedded into the JS bundle.
**They are visible in the browser.** Don't put secrets here — only the
anon-key and identifiers that are safe to expose.

| Var | Required | Set | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ Yes | TBD | `https://jcbxmpgjirxqszodotmx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | ✅ Yes | TBD | Anon (publishable) key from Project Settings → API |
| `VITE_USE_AI_V2` | Optional | TBD | `true` enables ai-assistant-v2 routing (Phase 4). Default off. |
| `VITE_GOOGLE_CLIENT_ID` | Conditional | TBD | Required if you want the Gmail-connect flow in EmailCrawlerAgentPanel to work. Same value as the corresponding edge-function secret. |

**Action:** confirm each row above is set in Netlify → Site → Settings →
Environment variables. Re-deploy after any change.

## 2. Supabase Edge Function secrets (`supabase secrets list`)

These are NOT in the browser bundle. They're read by edge functions via
`Deno.env.get(...)`. Verified live state as of 2026-05-08:

| Secret | Required by | Set | Notes |
|---|---|---|---|
| `SUPABASE_URL` | All edge fns | ✅ | Auto-injected |
| `SUPABASE_ANON_KEY` | imap-credentials-save (auth resolution) | ✅ | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | All agentic fns | ✅ | Auto-injected |
| `ANTHROPIC_API_KEY` | memory-writer, ai-assistant-v2, email-po-agent, tna-risk-agent, bom-calculator, agent-orchestrator, memory-consolidation-agent, email-crawler-agent | ✅ | Used by every Claude tool-use loop. |
| `GMAIL_TOKEN_KEY` | email-crawler-agent, gmail-oauth | ✅ | Used to encrypt stored OAuth refresh tokens. |
| `GOOGLE_CLIENT_ID` | gmail-oauth, email-crawler-agent | ✅ | Same value as `VITE_GOOGLE_CLIENT_ID`. |
| `GOOGLE_CLIENT_SECRET` | gmail-oauth | ✅ | Server-side only; never in the browser. |
| `OWNER_EMAIL` | user-approval, notify-pricing-pending | ✅ | Owner notification target. |
| `RESEND_API_KEY` | notify-pricing-pending | ✅ | Used for outbound email. |
| `ALLOWED_ORIGINS` | All edge fns (CORS) | Optional | Comma-separated extra origins. The DEFAULT_ALLOWED_ORIGINS list in each fn already covers the production Netlify URL + localhost dev ports. Set this only if you add a new domain. |

To add a new secret, run:
```bash
supabase secrets set FOO=bar --project-ref jcbxmpgjirxqszodotmx
```

## 3. Supabase Vault (Project → Integrations → Vault → Secrets)

Stored encrypted in `vault.secrets`, read at runtime via
`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '...'`.

| Vault secret | Required by | Set | Notes |
|---|---|---|---|
| `service_role_key` | mig 0034 fire_agent_event, mig 0036 cron jobs | ✅ | The same JWT as `SUPABASE_SERVICE_ROLE_KEY`, but stored in Vault because Supabase platform blocks `ALTER DATABASE ... SET app.service_role_key`. |
| `imap_*` (per-user) | imap-credentials-save | (per-user) | Each user storing IMAP credentials creates a vault entry via the `store_imap_password(p_credential_id, p_password)` RPC. Auto-managed; no manual ops. |

**If you rotate the project's service-role JWT:**
1. Update Edge Function secret: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<new>` (auto if rotated via dashboard)
2. Update Vault entry: open Dashboard → Integrations → Vault → Secrets → `service_role_key` → update value.
   Both must match or pg_cron jobs will start 401-failing.

## 4. Domain allowlists (Google Cloud Console)

For Gmail OAuth to work the redirect URIs must match exactly. After
deploying to a new Netlify URL, add it to the OAuth client:

Google Cloud → APIs & Services → Credentials → your OAuth 2.0 Client ID
→ Authorized redirect URIs:

- `https://merquanterp.netlify.app/gmail-callback` (production)
- `http://localhost:5173/gmail-callback` (and the other dev ports your team uses)
- Any preview URL pattern Netlify generates

## 5. Smoke test after env changes

After updating any of the above:

```bash
# 1. Re-deploy Netlify (push or click "Trigger deploy")
# 2. Sanity-check edge fn auth still works:
curl -s -X POST https://jcbxmpgjirxqszodotmx.supabase.co/functions/v1/agent-orchestrator \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"event_id":"test","event_type":"po.created","entity_type":"purchase_order","entity_id":"00000000-0000-0000-0000-000000000000","payload":{}}'
# Expect 200 with {"skipped":false, "actions_run":1, ...}
# (will fail to find the entity but the orchestrator returns success)
```

```sql
-- 3. Verify the Vault read pattern still works:
SELECT LENGTH(decrypted_secret) FROM vault.decrypted_secrets
 WHERE name = 'service_role_key';
-- Expect ~219 chars; if 0 or NULL, the Vault entry is gone.
```
