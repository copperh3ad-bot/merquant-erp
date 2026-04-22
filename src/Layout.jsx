import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard, FileText, Building2, Ship, Factory,
  BarChart2, Menu, Package, Sparkles, Scissors, Layers, Tag, Receipt,
  Inbox, ClipboardList, Calendar, Droplets, Package2, Shield, ShieldCheck,
  DollarSign, CreditCard, ShieldAlert, Shirt, Sun, Users,
  ClipboardCheck, FileSearch, FileBox, BookOpen, FileImage,
  Briefcase, MessageSquare, TrendingUp, PackageCheck, Settings, Warehouse, ChevronDown, ChevronRight, Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import UserMenu from "@/components/shared/UserMenu";
import { useQuery } from "@tanstack/react-query";
import { skuQueue, tna, labDips, supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const ALL_NAV = [
  { group: "",               name: "AI Assistant",             icon: Sparkles,         page: "AIAssistant",            permission: "AI_DATA_QUERY", accent: true, pinned: true },
  // ── Orders & Planning ──────────────────────────────────────────
  { group: "Orders",          name: "Dashboard",                icon: LayoutDashboard,  page: "Dashboard" },
  { group: "Orders",          name: "Order Status by Customer", icon: Users,            page: "CustomerOrderStatus" },
  { group: "Orders",          name: "Purchase Orders",          icon: FileText,         page: "PurchaseOrders",        badge: "pendingApprovals" },
  { group: "Orders",          name: "Season Planning",          icon: Sun,              page: "SeasonPlanning" },
  { group: "Orders",          name: "Email Crawler",            icon: Inbox,            page: "EmailCrawler",           permission: "PO_CREATE" },
  // ── Tracking & Approvals ───────────────────────────────────────
  { group: "Tracking",        name: "Tech Packs",               icon: FileSearch,       page: "TechPacks" },
  { group: "Tracking",        name: "Shortage Alerts",          icon: ShieldAlert,      page: "ShortageAlerts" },
  { group: "Tracking",        name: "Accessories & Trims Approval",            icon: FileImage,        page: "PrintLayouts" },
  { group: "Tracking",        name: "SKU Review",               icon: ClipboardList,    page: "SKUReviewQueue",         badge: "skuPending",    permission: "SKU_APPROVE" },
  { group: "Tracking",        name: "T&A Calendar",             icon: Calendar,         page: "TNACalendar",            badge: "tnaOverdue" },
  { group: "Tracking",        name: "Lab Dips",                 icon: Droplets,         page: "LabDips",                badge: "labDipPending" },
  { group: "Tracking",        name: "Samples",                  icon: Package2,         page: "Samples" },
  { group: "Tracking",        name: "QC Inspections",           icon: ShieldCheck,      page: "QCInspections",          permission: "QC_CREATE" },
  { group: "Tracking",        name: "Job Cards",                icon: ClipboardCheck,   page: "JobCards" },
  // ── Materials & Production ─────────────────────────────────────
  { group: "Materials",       name: "Articles",                 icon: BookOpen,         page: "Articles",               permission: "FABRIC_SPEC_EDIT" },
  { group: "Materials",       name: "Fabric Working",           icon: Layers,           page: "FabricWorking",          permission: "FABRIC_SPEC_EDIT" },
  { group: "Materials",       name: "Fabric Orders",            icon: Shirt,            page: "FabricOrders",           permission: "FABRIC_SPEC_EDIT" },
    { group: "Materials",       name: "RM Coverage",              icon: Warehouse,        page: "RMCoverage" },
  { group: "Materials",       name: "Consumption Library",      icon: BookOpen,         page: "ConsumptionLibrary" },
{ group: "Materials",       name: "Yarn Planning",            icon: Scissors,         page: "YarnPlanning",           permission: "BOM_UPLOAD" },
  { group: "Materials",       name: "Trims",                    icon: Tag,              page: "Trims",                  permission: "TRIM_EDIT" },
  { group: "Materials",       name: "Accessories & Packaging",  icon: Package,          page: "PackagingPlanning",      permission: "ACCESSORY_EDIT" },
  { group: "Materials",       name: "Accessory POs",            icon: FileBox,          page: "AccessoryPurchaseOrders",permission: "ACCESSORY_EDIT" },
  // ── Logistics & Finance ────────────────────────────────────────
  { group: "Logistics",       name: "Suppliers",                icon: Building2,        page: "Suppliers" },
  { group: "Logistics",       name: "Shipments",                icon: Ship,             page: "Shipments" },
  { group: "Logistics",       name: "Commercial Invoices",      icon: FileText,         page: "CommercialInvoices" },
  { group: "Logistics",       name: "Shipping Docs",            icon: FileSearch,       page: "ShippingDocuments" },
  { group: "Logistics",       name: "Production",               icon: Factory,          page: "Production" },
  { group: "Logistics",       name: "Capacity Planning",        icon: Factory,          page: "CapacityPlanning" },
  { group: "Logistics",       name: "WIP Tracker",              icon: Factory,          page: "WIPTracker" },
  { group: "Logistics",       name: "Production Dashboard",     icon: Factory,          page: "ProductionDashboard" },
  { group: "Logistics",       name: "Packing List",             icon: Package,          page: "PackingList" },
  { group: "Logistics",       name: "Proforma Invoice",         icon: Receipt,          page: "ProformaInvoice" },
  { group: "Finance",         name: "Costing",                  icon: DollarSign,       page: "CostingSheet",           permission: "COSTING_EDIT" },
  { group: "Finance",         name: "PO Variance",              icon: DollarSign,       page: "POVariance" },
  { group: "Finance",         name: "Payments & LC",            icon: CreditCard,       page: "Payments",               permission: "PAYMENT_EDIT" },
  { group: "Finance",         name: "Compliance",               icon: ShieldAlert,      page: "Compliance" },
  { group: "Finance",         name: "Reports",                  icon: BarChart2,        page: "Reports",                permission: "REPORTS_VIEW" },
  // ── CRM ──────────────────────────────────────────────────────────────────
  { group: "CRM",             name: "RFQ & Quotations",         icon: Briefcase,        page: "CRM" },
  { group: "CRM",             name: "Buyer Contacts",           icon: Users,            page: "BuyerContacts" },
  { group: "CRM",             name: "Supplier Performance",     icon: TrendingUp,       page: "SupplierPerformance" },
  // ── Admin ──────────────────────────────────────────────────────────────
  { group: "Admin",           name: "Users & Teams",            icon: Users,            page: "UserManagement",         permission: "TEAM_MANAGE" },
  { group: "Admin",           name: "Master Data",              icon: Package,          page: "MasterDataImport" },
  { group: "Admin",           name: "Settings",                 icon: Settings,         page: "Settings" },
  { group: "Admin",           name: "Audit & Health",           icon: Shield,           page: "AuditDashboard",         permission: "ADMIN_AUDIT" },
];

const GROUP_ORDER = ["","Orders","Tracking","Materials","Logistics","Finance","CRM","Admin"];

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { can, canSeePage } = useAuth();

  const { data: skuPending = 0 }  = useQuery({ queryKey: ["skuQueueCount"],     queryFn: () => skuQueue.count(),              refetchInterval: 60000 });
  const { data: tnaOverdue = 0 }  = useQuery({ queryKey: ["tnaOverdueCount"],   queryFn: () => tna.milestones.overdueCount(), refetchInterval: 60000 });
  const { data: labDipPending = 0 } = useQuery({ queryKey: ["labDipPendingCount"], queryFn: () => labDips.pendingCount(),    refetchInterval: 60000 });
  const canApprove = can("PO_APPROVE");
  const { data: pendingApprovals = 0 } = useQuery({
    queryKey: ["pendingApprovalsCount"],
    queryFn: async () => { const { count, error } = await supabase.from("purchase_orders").select("*", { count: "exact", head: true }).eq("approval_status", "pending"); return error ? 0 : (count || 0); },
    enabled: canApprove,
    refetchInterval: 60000,
  });
  const badges = { skuPending, tnaOverdue, labDipPending, pendingApprovals };

  // --- Sidebar collapse + most-used state ---
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mq_nav_collapsed") || "{}"); } catch { return {}; }
  });
  const [visits, setVisits] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mq_nav_visits") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    // increment current page
    if (currentPageName) {
      setVisits(prev => {
        const next = { ...prev, [currentPageName]: (prev[currentPageName] || 0) + 1 };
        localStorage.setItem("mq_nav_visits", JSON.stringify(next));
        return next;
      });
    }
  }, [currentPageName]);
  const toggleGroup = (g) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [g]: !prev[g] };
      localStorage.setItem("mq_nav_collapsed", JSON.stringify(next));
      return next;
    });
  };
  const top5Pages = Object.entries(visits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([page]) => page);
  const allowed = ALL_NAV.filter(item =>
    canSeePage(item.page) && (!item.permission || can(item.permission))
  );

  // Group items
  const grouped = GROUP_ORDER.map(g => ({
    group: g,
    items: allowed.filter(i => i.group === g),
  })).filter(g => g.items.length > 0);

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)}/>
      )}

      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 w-60 h-screen bg-card border-r border-border flex flex-col transition-transform duration-300 lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0 text-primary-foreground font-black text-sm tracking-tight select-none">
              MQ
            </div>
            <div>
              <h1 className="font-bold text-foreground text-sm leading-tight">MerQuant</h1>
              <p className="text-[9px] text-muted-foreground leading-tight">Powered by AI</p>
            </div>
          </div>
        </div>

        {/* Nav with groups */}
        <nav className="flex-1 overflow-y-auto py-2">
          {(() => {
            const renderItem = (item) => {
              const isActive = currentPageName === item.page;
              const badgeCount = item.badge ? (badges[item.badge] || 0) : 0;
              return (
                <Link
                  key={item.page}
                  to={"/" + item.page}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 mx-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : item.accent
                      ? "text-primary hover:bg-primary/10 border border-dashed border-primary/30 my-0.5"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0"/>
                  <span className="flex-1 truncate">{item.name}</span>
                  {badgeCount > 0 && (
                    <span className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center",
                      isActive ? "bg-white/30 text-white" : "bg-amber-500 text-white"
                    )}>{badgeCount}</span>
                  )}
                </Link>
              );
            };
            const pinnedGroup = grouped.find(g => g.group === "");
            const realGroups = grouped.filter(g => g.group !== "");
            const topItems = top5Pages
              .map(page => allowed.find(i => i.page === page))
              .filter(Boolean)
              .filter(i => i.group !== "");  // don't duplicate pinned AI Assistant
            return (
              <>
                {pinnedGroup && pinnedGroup.items.map(renderItem)}

                {topItems.length > 0 && (
                  <div className="mb-1 mt-2">
                    <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                      <Star className="h-2.5 w-2.5" /> Most Used
                    </p>
                    {topItems.map(renderItem)}
                  </div>
                )}

                {realGroups.map(({ group, items }) => {
                  const isCollapsed = collapsedGroups[group];
                  const hasActive = items.some(i => i.page === currentPageName);
                  const effectivelyCollapsed = isCollapsed && !hasActive;
                  return (
                    <div key={group} className="mb-1 mt-2">
                      <button
                        onClick={() => toggleGroup(group)}
                        className="w-full px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {effectivelyCollapsed ? <ChevronRight className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                        <span>{group}</span>
                        <span className="ml-auto text-[9px] text-muted-foreground/40">{items.length}</span>
                      </button>
                      {!effectivelyCollapsed && items.map(renderItem)}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-border">
          <UserMenu/>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 bg-card border-b border-border flex items-center px-4 lg:px-6 sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-muted mr-3">
            <Menu className="h-5 w-5"/>
          </button>
          <h2 className="text-sm font-semibold text-foreground flex-1">
            {ALL_NAV.find(n => n.page === currentPageName)?.name || currentPageName}
          </h2>
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

