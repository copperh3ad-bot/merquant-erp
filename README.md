# MerQuant
### Quantitative Merchandising, Powered by AI

A production-grade AI-powered ERP system for textile merchandising operations.

---

## Live System

- **Production:** https://merquant.netlify.app *(deploy to activate)*
- **Supabase Project:** `ecjqdyruwqlesfthgphv` (ap-south-1)
- **Stack:** React 18 + Vite + Tailwind CSS + shadcn/ui + Supabase + Anthropic Claude

---

## Modules

| Module | Features |
|--------|---------|
| **Orders** | PO management · 16-stage workflow · Batch splitting · Email crawler |
| **Tracking** | T&A Calendar · Lab Dips · Samples · QC Inspections · Job Cards · Tech Packs |
| **Materials** | Fabric Working · Yarn Planning · Trims · Accessories · Fabric Orders |
| **Logistics** | Shipments · Commercial Invoices · Shipping Docs · Packing Lists · Proforma |
| **Finance** | Costing sheets · Margin analysis · Payments & LC · Compliance |
| **CRM** | RFQ management · Quotations · Complaints · Buyer Contacts · Supplier Performance |
| **AI** | Tech pack extraction · Email classification · Natural language queries · AI Programmer |

---

## Quick Start

```bash
git clone https://github.com/copperh3ad-bot/MerQuant.git
cd MerQuant
npm install
cp .env.example .env   # add your Supabase credentials
npm run dev            # runs at http://localhost:5173
```

## Environment Variables

```env
VITE_SUPABASE_URL=https://ecjqdyruwqlesfthgphv.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
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
