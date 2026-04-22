# GitHub Repository Secrets

Go to: Settings → Secrets and variables → Actions → New repository secret

## Required

| Secret | Value |
|--------|-------|
| `VITE_SUPABASE_URL` | `https://ecjqdyruwqlesfthgphv.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase project anon key (from Supabase → Settings → API) |

## Optional (Netlify backup deploy)
| Secret | Value |
|--------|-------|
| `NETLIFY_AUTH_TOKEN` | From Netlify → User Settings → Access tokens |
| `NETLIFY_SITE_ID` | From Netlify site settings |

## After adding secrets

### Enable GitHub Pages:
1. Repo → Settings → Pages
2. Source: **GitHub Actions**
3. Push to main — auto deploys
4. Live at: `https://copperh3ad-bot.github.io/MerQuant/`
