/**
 * tests/unit/rbac.buyer.test.js
 * Verifies the Buyer role is correctly isolated — can only access their
 * own portal data, cannot access any internal staff operations.
 */
import { describe, it, expect } from "vitest";
import { can, canSeePage, hasRole, PERMISSIONS, PAGE_VISIBILITY, ROLE_RANK } from "@/lib/permissions";

const ALL_WRITE_PERMS = [
  "PO_CREATE", "PO_EDIT", "PO_DELETE", "PO_APPROVE",
  "PRICE_OVERRIDE", "BOM_UPLOAD", "FABRIC_SPEC_EDIT",
  "COSTING_EDIT", "PAYMENT_EDIT", "USER_MANAGE",
  "TEAM_MANAGE", "QC_CREATE", "LAB_DIP_EDIT",
  "SAMPLE_EDIT", "SKU_APPROVE", "AI_SYSTEM_EDIT",
];

describe("Buyer role — rank and hierarchy", () => {
  it("Buyer has a defined rank", () => {
    expect(ROLE_RANK["Buyer"]).toBeGreaterThan(0);
  });

  it("Buyer rank is the lowest of all defined roles", () => {
    // Buyer is external — lower rank than every internal role.
    // ('Viewer' is referenced in the original Fix 5 spec but was
    // deprecated from this codebase before this test was written;
    // Supplier (20) is now the next-lowest real role above Buyer.)
    const ranks = Object.values(ROLE_RANK);
    expect(ROLE_RANK["Buyer"]).toBe(Math.min(...ranks));
    expect(ROLE_RANK["Buyer"]).toBeLessThan(ROLE_RANK["Supplier"]);
  });

  it("Buyer does not satisfy Supplier requirement via hasRole", () => {
    // Same intent as the original "vs Viewer" check, retargeted at the
    // next real internal role above Buyer.
    expect(hasRole("Buyer", "Supplier")).toBe(false);
  });
});

describe("Buyer role — portal permissions", () => {
  it("can VIEW_OWN_POS", () => expect(can("Buyer", "VIEW_OWN_POS")).toBe(true));
  it("can VIEW_OWN_SHIPMENTS", () => expect(can("Buyer", "VIEW_OWN_SHIPMENTS")).toBe(true));
  it("can VIEW_OWN_SAMPLES", () => expect(can("Buyer", "VIEW_OWN_SAMPLES")).toBe(true));
  it("can AI_BUYER_QUERY", () => expect(can("Buyer", "AI_BUYER_QUERY")).toBe(true));
});

describe("Buyer role — blocked from all write permissions", () => {
  ALL_WRITE_PERMS.forEach(perm => {
    it(`cannot ${perm}`, () => {
      if (PERMISSIONS[perm]) {
        expect(can("Buyer", perm)).toBe(false);
      }
    });
  });
});

describe("Buyer role — blocked from all internal pages", () => {
  const internalPages = [
    "Dashboard", "PurchaseOrders", "EmailCrawler", "CostingSheet",
    "TNACalendar", "FabricWorking", "YarnPlanning", "TechPacks",
    "LabDips", "Samples", "QCInspections", "Shipments",
    "CommercialInvoices", "Payments", "Reports", "UserManagement",
    "Settings", "AuditDashboard", "CapacityPlanning",
    "ShopFloor", "FabricInventory", "JobWork",
  ];
  internalPages.forEach(page => {
    it(`cannot see ${page}`, () => {
      if (PAGE_VISIBILITY[page]) {
        expect(canSeePage("Buyer", page)).toBe(false);
      }
    });
  });

  it("can see BuyerPortal", () => expect(canSeePage("Buyer", "BuyerPortal")).toBe(true));
});

describe("Buyer role — internal roles blocked from Buyer portal perms", () => {
  ["Owner", "Manager", "Merchandiser", "QC Inspector", "Supplier"].forEach(role => {
    it(`${role} cannot VIEW_OWN_POS (Buyer-only permission)`, () => {
      expect(can(role, "VIEW_OWN_POS")).toBe(false);
    });
  });
});
