# MerQuant
### Quantitative Merchandising, Powered by AI

A production-grade AI-powered ERP system for textile merchandising operations.

---

## Live System

- **Production:** see Netlify dashboard for the project's primary domain
- **Supabase Project:** see your `.env` (`VITE_SUPABASE_URL`) and the Supabase dashboard for the project ref / region
- **Stack:** React 19 + Vite + Tailwind CSS v3 + shadcn/ui + Supabase + Anthropic Claude

---

## Modules

| Module | Features |
|--------|---------|
| **Orders** | PO management · 16-stage workflow · Batch splitting · Email crawler |
| **Tracking** | T&A Calendar · Lab Dips · Samples · QC Inspections · Job Cards · Tech Packs |
| **Materials** | Fabric Working · Yarn Planning · Trims · Accessories · Fabric Orders · Fabric Inventory (rolls + AI shade grouping) |
| **Production** | Capacity Planning (with AI line allocation) · Shop Floor (real-time stage tracking + AI bottleneck) · Job Work (subcontractor orders + jspdf gate pass) |
| **Logistics** | Shipments · Commercial Invoices · Shipping Docs · Packing Lists · Proforma |
| **Finance** | Costing sheets · Margin analysis · Payments & LC · Compliance |
| **CRM** | RFQ management · Quotations · Complaints · Buyer Contacts · Supplier Performance (with AI risk scoring) |
| **Buyer** | Cost-blind Buyer Portal — POs / shipments / samples scoped via RLS, customer-service AI chat |
| **AI** | Tech pack extraction · Email classification · Natural language queries · AI Programmer · AIVoiceEntry mic |

---

## Quick Start

```bash
git clone <repo-url>
cd merquant-erp
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev            # runs at http://localhost:5173
git config core.hooksPath .githooks   # opt into the secret-scan pre-commit hook (one-time)
```

## Environment Variables

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

## Deploy

### Netlify (recommended)
1. Connect this repo to Netlify
2. Build command: `npm run build` · Publish dir: `dist`
3. Add environment variables above
4. Add Supabase Edge Function secret: `ANTHROPIC_API_KEY`

### Required GitHub Secrets (for CI/CD)
| Secret | Description |
|--------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token |
| `NETLIFY_SITE_ID` | Netlify site ID |

---

## First Login

1. Sign up at `/LoginPage`
2. In Supabase → `user_profiles` → set your `role = 'Owner'`
3. Log in — full Owner access unlocked

---

*Beta repository: [Merquant-AI](https://github.com/copperh3ad-bot/Merquant-AI)*
