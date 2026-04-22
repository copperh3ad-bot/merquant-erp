// ── Role hierarchy ────────────────────────────────────────────────────────
// Owner       → full access to everything including AI system edits
// Manager     → manage operations, approve/reject, human-in-loop gating
// Merchandiser → upload BOMs, manage data foundation (articles, fabric specs, trims)
// QC Inspector → inspections, lab dips, samples
// Supplier    → view only their linked POs
// Viewer      → read-only

export const ROLES = {
  OWNER:        "Owner",
  MANAGER:      "Manager",
  MERCHANDISER: "Merchandiser",
  QC_INSPECTOR: "QC Inspector",
  SUPPLIER:     "Supplier",
  VIEWER:       "Viewer",
};

// Role rank — higher number = more permissions
export const ROLE_RANK = {
  Owner:         100,
  Manager:        80,
  Merchandiser:   60,
  "QC Inspector": 40,
  Supplier:       20,
  Viewer:         10,
};

export function hasRole(userRole, requiredRole) {
  return (ROLE_RANK[userRole] || 0) >= (ROLE_RANK[requiredRole] || 0);
}

// ── Permission matrix ─────────────────────────────────────────────────────
export const PERMISSIONS = {
  // AI Programmer — system edits (DDL, code generation, schema changes)
  AI_SYSTEM_EDIT:       ["Owner"],
  ADMIN_AUDIT:          ["Owner"],
  // AI data queries (read-only natural language queries)
  AI_DATA_QUERY:        ["Owner", "Manager", "Merchandiser"],

  // PO management
  PO_CREATE:            ["Owner", "Manager", "Merchandiser"],
  PO_EDIT:              ["Owner", "Manager"],            // Only Owner/Manager can edit POs
  PO_DELETE:            ["Owner"],
  PO_STATUS_ADVANCE:    ["Owner", "Manager"],
  PO_VIEW:              ["Owner", "Manager", "Merchandiser", "QC Inspector", "Supplier", "Viewer"],
  PO_SUBMIT_APPROVAL:   ["Owner", "Manager", "Merchandiser"],  // Anyone can submit for approval
  PO_APPROVE:           ["Owner", "Manager"],            // Only Manager+ can approve/reject
  PRICE_OVERRIDE:       ["Owner", "Manager"],            // Manager can override po_item prices

  // T&A — human-in-loop approval (Managers must review)
  TNA_APPROVE:          ["Owner", "Manager"],
  TNA_CREATE:           ["Owner", "Manager", "Merchandiser"],
  TNA_EDIT:             ["Owner", "Manager", "Merchandiser"],
  TNA_GCAL_SYNC:        ["Owner", "Manager"],            // Only Managers+ can sync to Google Calendar

  // BOM / data foundation uploads (Merchandiser's core responsibility)
  BOM_UPLOAD:           ["Owner", "Manager", "Merchandiser"],
  FABRIC_SPEC_EDIT:     ["Owner", "Manager", "Merchandiser"],
  ARTICLE_CREATE:       ["Owner", "Manager", "Merchandiser"],
  TRIM_EDIT:            ["Owner", "Manager", "Merchandiser"],
  ACCESSORY_EDIT:       ["Owner", "Manager", "Merchandiser"],
  SKU_APPROVE:          ["Owner", "Manager"],            // SKU review approval: Managers must do it

  // QC — QC Inspector's domain
  QC_CREATE:            ["Owner", "Manager", "QC Inspector"],
  LAB_DIP_EDIT:         ["Owner", "Manager", "QC Inspector", "Merchandiser"],
  SAMPLE_EDIT:          ["Owner", "Manager", "QC Inspector", "Merchandiser"],

  // Finance / costing
  COSTING_EDIT:         ["Owner", "Manager"],
  PAYMENT_EDIT:         ["Owner", "Manager"],

  // User management
  USER_MANAGE:          ["Owner"],
  TEAM_MANAGE:          ["Owner", "Manager"],

  // Reports
  REPORTS_VIEW:         ["Owner", "Manager"],
  REPORTS_EXPORT:       ["Owner", "Manager"],
};

export function can(userRole, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(userRole);
}

// ── Page visibility matrix ────────────────────────────────────────────────
// Source of truth for which roles can SEE which pages in the sidebar.
// Owner always sees everything (not listed here — assumed Y for every page).
// Values: array of roles that can see the page. Empty array = Owner-only.
//
// Edited from merquant-role-matrix.xlsx (2026-04-20).
export const PAGE_VISIBILITY = {
  // Pinned
  AIAssistant:                ["Owner", "Manager"],

  // Orders
  Dashboard:                  ["Owner", "Manager"],
  CustomerOrderStatus:        ["Owner", "Manager", "Merchandiser"],
  PurchaseOrders:             ["Owner", "Manager"],
  SeasonPlanning:             ["Owner", "Manager"],
  EmailCrawler:               ["Owner", "Manager"],

  // Tracking — QC Inspector restored on QC-relevant pages
  TechPacks:                  ["Owner", "Manager", "Merchandiser", "QC Inspector"],
  ShortageAlerts:             ["Owner", "Manager", "Merchandiser"],
  PrintLayouts:               ["Owner", "Manager", "Merchandiser"],
  SKUReviewQueue:             ["Owner", "Manager"],
  TNACalendar:                ["Owner", "Manager", "Merchandiser"],
  LabDips:                    ["Owner", "Manager", "Merchandiser", "QC Inspector"],
  Samples:                    ["Owner", "Manager", "Merchandiser", "QC Inspector"],
  QCInspections:              ["Owner", "Manager", "Merchandiser", "QC Inspector"],
  JobCards:                   ["Owner", "Manager", "Merchandiser", "QC Inspector"],

  // Materials
  Articles:                   ["Owner", "Manager", "Merchandiser"],
  FabricWorking:              ["Owner", "Manager", "Merchandiser"],
  FabricOrders:               ["Owner", "Manager", "Merchandiser"],
  RMCoverage:                 ["Owner", "Manager", "Merchandiser"],
  ConsumptionLibrary:         ["Owner", "Manager", "Merchandiser"],
  YarnPlanning:               ["Owner", "Manager", "Merchandiser"],
  Trims:                      ["Owner", "Manager", "Merchandiser"],
  PackagingPlanning:          ["Owner", "Manager", "Merchandiser"],
  AccessoryPurchaseOrders:    ["Owner", "Manager", "Merchandiser"],

  // Logistics
  Suppliers:                  ["Owner", "Manager", "Merchandiser"],
  Shipments:                  ["Owner", "Manager", "Merchandiser"],
  CommercialInvoices:         ["Owner", "Manager"],
  ShippingDocuments:          ["Owner", "Manager"],
  Production:                 ["Owner", "Manager", "Merchandiser"],
  CapacityPlanning:           ["Owner", "Manager"],
  WIPTracker:                 ["Owner", "Manager", "Merchandiser"],
  ProductionDashboard:        ["Owner", "Manager", "Merchandiser"],
  PackingList:                ["Owner", "Manager"],
  ProformaInvoice:            ["Owner", "Manager"],

  // Finance
  CostingSheet:               ["Owner", "Manager"],
  POVariance:                 ["Owner", "Manager"],
  Payments:                   ["Owner", "Manager"],
  Compliance:                 ["Owner", "Manager"],
  Reports:                    ["Owner", "Manager"],

  // CRM
  CRM:                        ["Owner", "Manager"],
  BuyerContacts:              ["Owner", "Manager"],
  SupplierPerformance:        ["Owner", "Manager"],

  // Admin
  UserManagement:             ["Owner", "Manager"],
  MasterDataImport:           ["Owner", "Manager"],
  Settings:                   ["Owner"],
  AuditDashboard:             ["Owner"],
};

export function canSeePage(userRole, pageName) {
  if (userRole === "Owner") return true; // Owner always sees everything
  const allowed = PAGE_VISIBILITY[pageName];
  if (allowed === undefined) return true; // Pages not in matrix default to visible (safe fallback for new pages)
  return allowed.includes(userRole);
}

// ── Field-level access ────────────────────────────────────────────────────
// Restricted field groups — hidden from roles not in the allowed list.
// Use with canSeeField() + <RedactedValue/> component.
export const FIELD_GROUPS = {
  // PO & item-level financial values
  PO_FINANCIAL: {
    allowed: ["Owner", "Manager"],
    fields: [
      "total_po_value", "unit_price", "total_price", "expected_price",
      "price_status", "po_value", "line_total", "total_cost",
    ],
  },
  // Costing sheet values and margin
  COSTING: {
    allowed: ["Owner", "Manager"],
    fields: [
      "fob_price", "cmt_cost", "fabric_cost", "trim_cost", "accessory_cost",
      "overhead", "margin", "markup", "target_cost", "standard_cost",
      "costing_total", "landed_cost",
    ],
  },
  // Payments & banking
  PAYMENTS: {
    allowed: ["Owner", "Manager"],
    fields: [
      "amount", "paid_amount", "outstanding", "lc_amount", "lc_number",
      "bank_name", "swift_code", "iban", "payment_terms_value",
    ],
  },
  // Buyer contact information
  BUYER_CONTACT: {
    allowed: ["Owner", "Manager"],
    fields: [
      "email", "phone", "mobile", "whatsapp", "contact_email",
      "contact_phone", "buyer_email", "buyer_phone",
    ],
  },
};

export function canSeeField(userRole, groupKey) {
  if (userRole === "Owner") return true;
  const group = FIELD_GROUPS[groupKey];
  if (!group) return true; // Unknown group = visible (safe fallback)
  return group.allowed.includes(userRole);
}

// ── Role descriptions ─────────────────────────────────────────────────────
export const ROLE_INFO = {
  Owner: {
    color:       "bg-red-100 text-red-800 border-red-200",
    badgeColor:  "bg-red-500",
    description: "Full system access. Can edit AI system, schema, and all data. Cannot be restricted.",
    capabilities: ["All permissions", "AI system programming", "User management", "Delete any record", "Override any approval"],
  },
  Manager: {
    color:       "bg-violet-100 text-violet-800 border-violet-200",
    badgeColor:  "bg-violet-500",
    description: "Manages operations. Must perform human-in-loop approvals. Cannot edit AI system backend.",
    capabilities: ["Approve SKU specs", "Advance PO workflow", "Approve T&A milestones", "Sync to Google Calendar", "Manage teams"],
    restricted:   ["AI system/schema editing", "User role management", "Delete POs"],
  },
  Merchandiser: {
    color:       "bg-blue-100 text-blue-800 border-blue-200",
    badgeColor:  "bg-blue-500",
    description: "Data foundation team. Responsible for uploading BOMs, fabric specs, trims, and articles.",
    capabilities: ["Upload BOMs & fabric specs", "Create articles", "Edit trims & accessories", "Import POs", "Track samples & lab dips"],
    restricted:   ["AI system editing", "Approve SKU queue", "Edit confirmed POs", "Financial data"],
  },
  "QC Inspector": {
    color:       "bg-lime-100 text-lime-800 border-lime-200",
    badgeColor:  "bg-lime-500",
    description: "Quality control team. Manages inspections, lab dips, and sample approvals.",
    capabilities: ["QC inspections", "Lab dip tracking", "Sample records", "Compliance docs"],
    restricted:   ["PO editing", "Financial data", "AI features"],
  },
  Supplier: {
    color:       "bg-amber-100 text-amber-800 border-amber-200",
    badgeColor:  "bg-amber-500",
    description: "External supplier/factory. Read-only view of their linked POs.",
    capabilities: ["View their POs", "View their shipments"],
    restricted:   ["All editing", "Other suppliers' data", "Financial data"],
  },
  Viewer: {
    color:       "bg-gray-100 text-gray-700 border-gray-200",
    badgeColor:  "bg-gray-400",
    description: "Read-only access to non-sensitive data.",
    capabilities: ["View POs, shipments, production"],
    restricted:   ["All editing", "Financial data", "AI features"],
  },
};

