# MerQuant ERP — Supabase Cutover Plan

Source: `textile-manager-pro` / `ecjqdyruwqlesfthgphv` (Mumbai)
Target: `MerQuant ERP` / `jcbxmpgjirxqszodotmx` (Tokyo)

Phases 1–4 are **complete**. This document covers Phase 5 — the
manual cutover steps you do yourself.

---

## What's already on the new project

- ✅ Schema (74 tables, 22 functions, 87 RLS policies, 66 triggers)
- ✅ All 9 edge functions deployed (ai-proxy, extract-document, etc.)
- ✅ 1234 rows of business data: articles, POs, tech packs, consumption library, price list, suppliers, etc.
- ✅ 81 storage files (~19 MB) — ai-extraction-sources + backups
- ✅ Storage buckets and their RLS policies

## What's NOT migrated (intentional, dev-phase project)

- ❌ User accounts (`auth.users` + `user_profiles`) — you re-sign up on cutover
- ❌ Audit log (history-only, not needed on fresh project)
- ❌ `_pre_cleanup_backup` (a leftover backup table)

---

## Cutover checklist — do these in order

### 1. Set edge function secrets on the new project (~5 min)

Open: https://supabase.com/dashboard/project/jcbxmpgjirxqszodotmx/settings/functions

Click **Add new secret** and add each one. Copy the values from the
**old** project's same page:
https://supabase.com/dashboard/project/ecjqdyruwqlesfthgphv/settings/functions

Required secrets:

| Name | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Console → API keys (or copy from old project) |
| `RESEND_API_KEY` | Resend dashboard (or copy from old project) |
| `GOOGLE_CLIENT_ID` | Google Cloud → APIs → Credentials → OAuth 2.0 Client IDs |
| `GOOGLE_CLIENT_SECRET` | Same as above |
| `OWNER_EMAIL` | `waqas.ahmed358@gmail.com` |
| `BACKUP_SECRET` | Generate a new random 32-char string |

**Don't forget:** without these, the edge functions will return 500s.

### 2. Update Google OAuth redirect URI (~3 min)

Open Google Cloud Console → APIs & Services → Credentials → click your
OAuth 2.0 Client ID. Under **Authorized redirect URIs**, add:

```
https://jcbxmpgjirxqszodotmx.supabase.co/functions/v1/gmail-oauth/callback
```

(Keep the old URL too if you want both projects to work for now.)

### 3. Update Netlify env vars (~2 min)

Open Netlify → your MerQuant site → Site settings → Environment variables.

Update or add:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://jcbxmpgjirxqszodotmx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjYnhtcGdqaXJ4cXN6b2RvdG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjU0MDAsImV4cCI6MjA5MjA0MTQwMH0.9n29qbTIxJ_-PrbUzE1Kz-ArB7OlrR210yoZtde8W6c` |

Then click **Trigger deploy → Clear cache and deploy site**. Wait ~3–5 minutes.

### 4. Sign up on the new project (~3 min)

Once Netlify finishes deploying, open your live site and click **Sign Up**
(not Login — your old account isn't there).

Use the same email as before: `waqas.ahmed358@gmail.com`.

You'll start with role=Merchandiser and approval_status=approved (because
of the auto-approve trigger that recognizes your email from the
`signup_whitelist` table — which we did migrate).

### 5. Promote yourself to Owner

Run this in the SQL editor of the new project:
https://supabase.com/dashboard/project/jcbxmpgjirxqszodotmx/sql

```sql
UPDATE public.user_profiles
SET role = 'Owner'
WHERE email = 'waqas.ahmed358@gmail.com';
```

Refresh the app. You should now see all admin features.

### 6. Re-invite your team (optional, when ready)

Sadia (`sadia.yousuf57@gmail.com`) was in the old `user_profiles` but
wasn't migrated. Either:

- Have her sign up fresh on the new app, then `UPDATE user_profiles SET role='Manager' WHERE email='sadia.yousuf57@gmail.com'`
- Or add her to `signup_whitelist` and have her sign up

### 7. Reconnect Gmail (optional)

If you use the Gmail crawler, you'll need to reconnect Gmail to the new
project. Open the app → Settings → Gmail Sync → Connect Gmail. The
existing Gmail OAuth row from the old project did NOT migrate.

### 8. Verify the migration (~5 min)

Click around the app and confirm:

- [ ] PurchaseOrders page shows your 5 POs
- [ ] Articles page shows your 92 articles
- [ ] TechPacks page shows your 47 tech packs
- [ ] Fabric Working Sheet renders for an active PO with correct dimensions
- [ ] AI Assistant works (tests ai-proxy + ANTHROPIC_API_KEY)
- [ ] Master Data Import works (tests extract-document + ANTHROPIC_API_KEY)
- [ ] Dashboard fabric-bag nag banner appears (if any SKUs need it)

### 9. Decommission the old project (when you're confident — wait at least 1 week)

Once you've used the new project for a few days and confirmed everything
works, you can:

- Pause or delete the old project from the Supabase dashboard
- Revoke the personal access token (`sbp_...`) at https://supabase.com/dashboard/account/tokens

---

## If something breaks

### Edge function returns 500 / "ANTHROPIC_API_KEY not configured"
You forgot step 1. Re-check secrets are set.

### "Invalid JWT" or login fails
Netlify env vars haven't redeployed yet. Wait for deploy to finish, then
hard-refresh (Ctrl+Shift+R).

### Gmail sync broken
Step 2 (OAuth redirect) and step 7 (reconnect).

### Some data missing
Tell me which page/SKU. I can re-pull specific rows from the source
project (still alive until step 9).

### Want to roll back entirely
Update the same Netlify env vars back to the OLD project's values:
- `VITE_SUPABASE_URL=https://ecjqdyruwqlesfthgphv.supabase.co`
- `VITE_SUPABASE_ANON_KEY=`*old anon key from Supabase dashboard*

Trigger redeploy. The old project still has all your data and is
untouched by this migration.

---

## Source project secrets not yet rotated

Your `.supabase-token` file is in the project root and gitignored. After
the migration is verified, you should **revoke the token**:

https://supabase.com/dashboard/account/tokens → delete the migration tool
token.

The service-role and anon keys for the OLD project are also in your
shell history from this session. They're tied to a soon-to-be-decommissioned
project, but for cleanliness, rotate them via:
- Old project → Settings → Database → Reset password (rotates DB password)
- Old project → Settings → API → Generate new keys (rotates anon + service)

After rotation the old project becomes inaccessible from anything still
using the old keys, which is what you want before decommissioning.
