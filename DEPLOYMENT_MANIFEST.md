# MerQuant ERP — Deployment Manifest
**Generated:** 2026-04-17  
**Live URL:** https://merquant2.netlify.app  
**GitHub:** https://github.com/copperh3ad-bot/Merquant-AI  
**Latest commit:** 248d6ec

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS v3 + shadcn/ui |
| State | @tanstack/react-query |
| DB | Supabase (PostgreSQL, ap-south-1) |
| Auth | Supabase Auth |
| AI | Anthropic Claude via Supabase Edge Function |
| Deploy | Netlify (auto-deploy from GitHub main) |

## Credentials & IDs

| Resource | Value |
|---|---|
| Supabase Project ID | ecjqdyruwqlesfthgphv |
| Supabase URL | https://ecjqdyruwqlesfthgphv.supabase.co |
| Netlify Site ID | 5f7b7802-0082-4db3-ac07-242aa888187d |
| Netlify Site | merquant2.netlify.app |
| GitHub Repo | copperh3ad-bot/Merquant-AI |

## Supabase Secrets Required
- `ANTHROPIC_API_KEY` — set in Supabase Edge Functions → Secrets

---

## DB: 53 Tables (all in public schema, all with RLS enabled)

| Table | Cols | Purpose |
|---|---|---|
| purchase_orders | 36 | Core PO records with approval workflow |
| po_items | 31 | Line items per PO |
| articles | 15 | Article/SKU master with fabric components (JSONB) |
| fabric_templates | 15 | Fabric working sheet templates per article |
| yarn_requirements | 17 | Yarn planning per PO |
| trim_items | 23 | Trim requirements per article/PO |
| accessory_items | 23 | Accessories per PO |
| accessory_templates | 11 | Reusable accessory templates |
| accessory_purchase_orders | 14 | Accessory POs to suppliers |
| article_packaging | 13 | Packaging data per article |
| costing_sheets | 23 | Cost breakdown per article/PO |
| payments | 16 | Payment schedule per PO |
| job_cards | 19 | Production job cards |
| qc_inspections | 20 | QC inspection records |
| lab_dips | 18 | Lab dip/colour approval tracking |
| samples | 18 | Sample tracking |
| shipments | 27 | Shipment records |
| shipping_doc_register | 12 | Shipping documents |
| shipping_documents | 10 | Additional shipping docs |
| compliance_docs | 13 | Compliance/testing certificates |
| commercial_invoices | 35 | Commercial invoice generation |
| packing_lists | 14 | Packing lists |
| tech_packs | 32 | Tech pack storage with AI extraction |
| print_layouts | 35 | Print layout tracking |
| tna_milestones | 14 | T&A calendar milestones |
| tna_calendars | 9 | T&A calendar headers |
| tna_templates | 5 | Reusable T&A templates |
| fabric_orders | 24 | Fabric purchase orders to mills |
| suppliers | 21 | Supplier/factory directory |
| supplier_performance | 18 | Supplier KPI metrics |
| rfqs | 27 | Request for quotations |
| quotations | 37 | Quotation records |
| quotation_items | 10 | Quotation line items |
| buyer_contacts | 14 | Buyer contact directory |
| comms_log | 13 | Communication log |
| complaints | 31 | Customer complaint tracking |
| seasons | 9 | Season planning |
| price_list | 12 | Standard price list |
| po_batches | 31 | PO batch splits |
| batch_items | 14 | Items in each batch |
| batch_split_snapshots | 8 | Batch split history |
| sku_review_queue | 16 | SKU specification review |
| crosscheck_discrepancies | 14 | Data discrepancy tracking |
| status_logs | 8 | PO status change history |
| po_change_log | 12 | PO edit history |
| email_crawl_log | 19 | Email crawler history |
| notifications | 13 | In-app notifications |
| permission_denials | 7 | Permission denial audit log |
| user_profiles | 10 | User roles and profiles |
| teams | 10 | Team structure |
| customer_team_assignments | 9 | Customer-team mapping |
| gcal_sync_log | 6 | Google Calendar sync log |
| app_users | 7 | Auth users mirror |

## DB Migrations (30 total)

1. initial_schema
2. add_manufacturing_modules
3. auth_rls_lockdown
4. email_crawl_log
5. sku_review_queue
6. manufacturing_features_full
7. fabric_procurement_season
8. rbac_teams_roles
9. auto_create_user_profile_trigger
10. customer_team_assignment
11. gap_analysis_new_tables
12. po_batches_and_invoice_splits
13. mid_execution_batch_split
14. techpack_layouts_crosscheck
15. crm_full_schema
16. fix_rls_and_owner_access
17. fix_constraints_portal_source_payment_types
18. add_missing_fk_indexes
19. disable_email_confirmation
20. add_po_number_to_compliance_docs
21. extend_fabric_templates_for_master_sheet
22. add_accessory_templates_and_packaging_fields
23. apply_heavy_textile_flow_v3
24. add_missing_po_items_fields
25. enable_rls_accessory_templates
26. add_pi_fields_to_purchase_orders
27. create_exec_sql_rpc
28. add_costing_sheets_unique_constraint
29. add_po_approval_workflow ← LATEST

---

## Supabase Edge Functions

| Function | Version | Purpose |
|---|---|---|
| ai-proxy | v18 | Proxies Anthropic API calls. Uses Deno.serve() (no imports). Normalises model names. |

---

## Frontend: 37 Pages

### Orders
- Dashboard, PurchaseOrders, PODetail, SeasonPlanning, EmailCrawler

### Tracking
- TechPacks, PrintLayouts, TNACalendar, LabDips, Samples, JobCards

### Materials
- Articles, FabricWorking, FabricOrders, YarnPlanning, Trims, AccessoriesPackaging, PackagingPlanning, AccessoryPurchaseOrders

### Logistics
- Suppliers, Shipments, CommercialInvoices, ShippingDocuments

### Finance
- CostingSheet, Payments, ProformaInvoice, PackingList

### Quality
- QCInspections, Compliance

### CRM
- CRM, BuyerContacts, SupplierPerformance

### Reports
- Reports

### AI
- AIAssistant

### Production
- Production

### Admin
- UserManagement, Templates (CSV download page)

### Auth
- LoginPage

---

## Roles & Permissions

| Role | Rank | Key Capabilities |
|---|---|---|
| Owner | 100 | Full access. AI system edits, schema, delete POs, manage users |
| Manager | 80 | Approve POs, override prices, approve SKUs, sync Google Calendar |
| Merchandiser | 60 | Upload POs, edit line items, upload FWS/accessories/trims/tech packs, submit for approval |
| QC Inspector | 40 | QC inspections, lab dips, samples |
| Supplier | 20 | View their linked POs only |
| Viewer | 10 | Read-only |

### Key Permission Flags
- `PO_SUBMIT_APPROVAL` — Owner, Manager, Merchandiser
- `PO_APPROVE` — Owner, Manager
- `PRICE_OVERRIDE` — Owner, Manager
- `BOM_UPLOAD` — Owner, Manager, Merchandiser (controls line item editing)
- `AI_SYSTEM_EDIT` — Owner only

---

## Approval Workflow

1. Merchandiser uploads PO and line items
2. Clicks **"Submit for Approval"** → `approval_status = pending`
3. Manager sees alert on Dashboard + amber badge on sidebar
4. Manager opens PO → approves/requests-changes/rejects with notes
5. `approval_status` → approved/changes_requested/rejected
6. If rejected/changes_requested → Merchandiser re-submits after fixes

### approval_status values
`not_submitted` | `pending` | `approved` | `rejected` | `changes_requested`

---

## AI Assistant (Edge Function v18)

- Endpoint: `https://ecjqdyruwqlesfthgphv.supabase.co/functions/v1/ai-proxy`
- Model: `claude-sonnet-4-5` (normalises any claude-*-4-* variant)
- Auth: `verify_jwt: false` (frontend uses Supabase anon key)
- Handles: SQL queries (exec_sql RPC), React component generation, data answers
- exec_sql RPC: SELECT-only, returns JSONB array

---

## Key Files

```
src/
  pages.config.js          ← Page registry (37 pages)
  App.jsx                  ← Router + PageErrorBoundary on every route
  Layout.jsx               ← Sidebar nav + badge counts
  lib/
    AuthContext.jsx         ← Auth + profile with 3-retry fetch
    permissions.js          ← Role-permission matrix
    aiProxy.js              ← Calls edge function
  api/
    supabaseClient.js       ← All DB operations + approval workflow methods
  pages/
    PODetail.jsx            ← Main PO page (line items, approval panel, price override)
    AIAssistant.jsx         ← AI programmer interface
    Templates.jsx           ← CSV download templates (NEW)
    ...35 more
  components/
    po/
      POApprovalPanel.jsx   ← Approval submit/approve/reject UI
      PriceOverrideCell.jsx ← Inline price editing for Managers
    shared/
      PageErrorBoundary.jsx ← Catches all JS crashes per page

supabase/
  functions/
    ai-proxy/index.ts       ← Edge function v18 (Deno.serve)
```

---

## Session Fixes Applied (this deployment)

| Commit | Fix |
|---|---|
| 248d6ec | CSV Templates page + inline download buttons |
| 2caabd5 | Merchandiser line item edit access in PODetail |
| cadc014 | Manager approval workflow + price override |
| 0ab4b08 | ProformaInvoice blank page fix |
| 75104b6 | JobCards null process_steps crash |
| 6e0b4f5 | Null-safe toFixed in FabricWorking/YarnPlanning |
| 29113d0 | Row limits + SupplierPerformance score bug |
| 561647e | PageErrorBoundary + unsafe date crashes |
| 05bd2d6 | PDF import truncated JSON fix |
| caee8f9 | AI assistant semicolon + role badge race |
| 4b3a364 | Edge function v18 Deno.serve() |
| 0831926 | Model names claude-sonnet-4-5 |

---

## BOB Beta Dataset (live in production DB)

- 11 Purchase Orders — Bob's Discount Furniture
- 254 Articles with fabric components
- 1,483 Accessory items
- 234 Costing sheets
- 68 Yarn requirements
- 170 T&A milestones
- 15 Shipments
- 20 Job cards
- 10 QC inspections
- 5 RFQs

