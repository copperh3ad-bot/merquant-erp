import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  FileText, DollarSign, Ship, TrendingUp, AlertTriangle,
  Calendar, ArrowRight, CheckCircle2, Clock, Droplets,
  CreditCard, Package2, Factory, AlertCircle, Users
} from "lucide-react";
import { format, addDays, isAfter, isBefore, differenceInDays, isPast, isToday, startOfWeek, endOfWeek } from "date-fns";
import { db, tna, labDips, samples, payments, production, supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import StatusBadge from "@/components/shared/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import DashboardCharts from "@/components/dashboard/DashboardCharts";
import RecentPOTable from "@/components/dashboard/RecentPOTable";
import RedactedValue from "@/components/shared/RedactedValue";

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM") : "—"; } catch { return "—"; } };
const fmtFull = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

function AlertCard({ icon: Icon, title, count, items, linkTo, color, emptyMsg }) {
  return (
    <div className={cn("rounded-xl border p-4", color)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{count}</span>
          {linkTo && count > 0 && (
            <Link to={linkTo} className="text-xs opacity-70 hover:opacity-100 flex items-center gap-0.5">
              View <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs opacity-60 italic">{emptyMsg}</p>
      ) : (
        <div className="space-y-1.5">
          {items.slice(0, 4).map((item, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="font-medium truncate max-w-[180px]">{item.label}</span>
              <span className="opacity-70 whitespace-nowrap ml-2">{item.sub}</span>
            </div>
          ))}
          {items.length > 4 && <p className="text-xs opacity-50">+{items.length - 4} more</p>}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { role, profile, refreshProfile, can } = useAuth();
  const canApprovePOs = can("PO_APPROVE");

  // Pending approvals query (only loads for Managers/Owners)
  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ["pendingApprovals"],
    queryFn: () => db.purchaseOrders.listPendingApproval(),
    enabled: canApprovePOs,
    refetchInterval: 60000,
  });
  const { data: purchaseOrders = [], isLoading } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const { data: shipments = [] } = useQuery({ queryKey: ["shipments"], queryFn: () => db.shipments.list() });
  const { data: allMilestones = [] } = useQuery({ queryKey: ["tnaMilestones"], queryFn: () => tna.milestones.listAll() });
  const { data: dipsList = [] } = useQuery({ queryKey: ["labDips"], queryFn: () => labDips.list() });
  const { data: sampleList = [] } = useQuery({ queryKey: ["samples"], queryFn: () => samples.list() });
  const { data: paymentList = [] } = useQuery({ queryKey: ["payments"], queryFn: () => payments.listAll() });
  const { data: fabricOrders = [] } = useQuery({
    queryKey: ["fabricOrdersDash"],
    queryFn: async () => {
      const { data } = await supabase.from("fabric_orders").select("*").neq("status", "Cancelled");
      return data || [];
    },
  });
  const { data: trimItemsOpen = [] } = useQuery({
    queryKey: ["trimItemsOpenDash"],
    queryFn: async () => {
      const { data } = await supabase.from("trim_items").select("*").in("status", ["Planned", "Ordered"]);
      return data || [];
    },
  });
  const { data: accItemsOpen = [] } = useQuery({
    queryKey: ["accItemsOpenDash"],
    queryFn: async () => {
      const { data } = await supabase.from("accessory_items").select("*").in("status", ["Planned", "Ordered"]);
      return data || [];
    },
  });
  const { data: dailyCap = [] } = useQuery({ queryKey: ["dailyCapacityDash"], queryFn: () => production.dailyCapacity.list(7) });
  const { data: lines = [] } = useQuery({ queryKey: ["prodLinesDash"], queryFn: () => production.lines.list() });

  const now = new Date();

  // KPIs
  const totalValue = purchaseOrders.reduce((s, po) => s + (po.total_po_value || 0), 0);
  const activePos = purchaseOrders.filter(p => !["Delivered","Cancelled","Shipped"].includes(p.status)).length;
  const activeShipments = shipments.filter(s => !["Delivered","Cancelled"].includes(s.status)).length;
  const outstandingPayments = paymentList.filter(p => p.status !== "Received").reduce((s, p) => s + (p.amount || 0), 0);

  // T&A overdue
  const overdueMs = allMilestones.filter(m =>
    m.target_date && isPast(new Date(m.target_date)) && !isToday(new Date(m.target_date)) && m.status !== "completed"
  );
  const dueTodayMs = allMilestones.filter(m =>
    m.target_date && isToday(new Date(m.target_date)) && m.status !== "completed"
  );

  // Lab dips awaiting
  const waitingDips = dipsList.filter(d => ["Submitted","Resubmit"].includes(d.status));
  const overdueDips = dipsList.filter(d => d.expected_response_date && isPast(new Date(d.expected_response_date)) && !["Approved","Rejected"].includes(d.status));

  // Samples awaiting
  const waitingSamples = sampleList.filter(s => ["Dispatched","Delivered"].includes(s.status));
  const overdueSamples = sampleList.filter(s => s.expected_feedback_date && isPast(new Date(s.expected_feedback_date)) && !["Approved","Rejected"].includes(s.status));

  // Overdue payments
  const overduePayments = paymentList.filter(p => p.expected_date && isPast(new Date(p.expected_date)) && p.status !== "Received");

  // Upcoming ex-factory (next 30 days)
  const in30Days = addDays(now, 30);
  const upcomingShipments = purchaseOrders
    .filter((po) => {
      const date = po.etd || po.ex_factory_date;
      if (!date) return false;
      const d = new Date(date);
      return isAfter(d, now) && isBefore(d, addDays(now, 90));
    })
    .sort((a, b) => new Date(a.etd || a.ex_factory_date) - new Date(b.etd || b.ex_factory_date))
    .slice(0, 6);

  const upcomingExFactory = purchaseOrders
    .filter(po => po.ex_factory_date && isAfter(new Date(po.ex_factory_date), now) && isBefore(new Date(po.ex_factory_date), in30Days) && !["Delivered","Cancelled"].includes(po.status))
    .sort((a, b) => new Date(a.ex_factory_date) - new Date(b.ex_factory_date));

  // POs needing action (not yet in production, ex-factory within 45 days)
  const in45Days = addDays(now, 45);
  const needAction = purchaseOrders.filter(po =>
    !["In Production","QC Inspection","Ready to Ship","Shipped","At Port","Delivered","Cancelled"].includes(po.status) &&
    po.ex_factory_date && isBefore(new Date(po.ex_factory_date), in45Days) && isAfter(new Date(po.ex_factory_date), now)
  );

  const totalAlerts = overdueMs.length + overdueDips.length + overdueSamples.length + overduePayments.length + needAction.length + pendingApprovals.length;

  // ─── Roll-up widget data ────────────────────────────────────────────────
  // 1. Top 5 overdue POs
  const overduePos = purchaseOrders
    .filter(po => {
      if (["Delivered","Cancelled","Shipped"].includes(po.status)) return false;
      const d = po.ex_factory_date || po.etd;
      return d && isPast(new Date(d));
    })
    .map(po => ({ po, daysLate: Math.abs(differenceInDays(new Date(po.ex_factory_date || po.etd), now)) }))
    .sort((a, b) => b.daysLate - a.daysLate)
    .slice(0, 5);

  // 2. This week's ETDs
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd   = endOfWeek(now,   { weekStartsOn: 1 });
  const thisWeekEtds = purchaseOrders
    .filter(po => {
      if (["Delivered","Cancelled"].includes(po.status)) return false;
      const d = po.etd || po.ex_factory_date;
      if (!d) return false;
      const dt = new Date(d);
      return dt >= weekStart && dt <= weekEnd;
    })
    .sort((a, b) => new Date(a.etd || a.ex_factory_date) - new Date(b.etd || b.ex_factory_date));

  // 3. Today's shipments (any shipment with ETD today or status In Transit / At Port)
  const todayShipments = shipments.filter(s => {
    if (["Delivered","Cancelled"].includes(s.status)) return false;
    if (s.etd && isToday(new Date(s.etd))) return true;
    return ["In Transit","At Port","Loaded","Booking Confirmed","Booked"].includes(s.status);
  });

  // 4. Shortage count (fabric + trim + accessory, filtered to ETD within 30 days)
  const shortages = {
    fabric: fabricOrders.filter(fo => {
      const shortfall = (Number(fo.quantity_meters) || 0) - (Number(fo.received_meters) || 0);
      if (shortfall <= 0 || fo.status === "Received") return false;
      const po = purchaseOrders.find(p => p.id === fo.po_id);
      const etd = po?.ex_factory_date || po?.etd;
      if (!etd) return true;
      return differenceInDays(new Date(etd), now) <= 30;
    }).length,
    trim: trimItemsOpen.filter(t => {
      const po = purchaseOrders.find(p => p.id === t.po_id);
      const etd = po?.ex_factory_date || po?.etd;
      if (!etd) return false;
      return differenceInDays(new Date(etd), now) <= 30;
    }).length,
    accessory: accItemsOpen.filter(a => {
      const po = purchaseOrders.find(p => p.id === a.po_id);
      const etd = po?.ex_factory_date || po?.etd;
      if (!etd) return false;
      return differenceInDays(new Date(etd), now) <= 30;
    }).length,
  };
  const totalShortages = shortages.fabric + shortages.trim + shortages.accessory;

  // 5. Production utilization (7-day avg across all lines)
  const prodUtil = (() => {
    if (!lines.length || !dailyCap.length) return { pct: 0, avgDaily: 0, totalCapacity: 0 };
    const totalCap = lines.reduce((s, l) => s + (l.daily_capacity || 0), 0);
    const sumProduced = dailyCap.reduce((s, d) => s + (d.total_produced || 0), 0);
    const sumCapacity = dailyCap.reduce((s, d) => s + (d.daily_capacity || 0), 0);
    const pct = sumCapacity > 0 ? (sumProduced / sumCapacity) * 100 : 0;
    return { pct, avgDaily: Math.round(sumProduced / 7), totalCapacity: totalCap };
  })();

  if (isLoading) return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Role debug banner — shows if profile not loaded correctly */}
      {role === "Viewer" && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-amber-800">⚠ Logged in as Viewer — profile may not have loaded</p>
            <p className="text-xs text-amber-700 mt-0.5">Your database role is Owner. Click Refresh to reload your permissions.</p>
          </div>
          <button
            onClick={refreshProfile}
            className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
            Refresh Role
          </button>
        </div>
      )}
      {/* Morning briefing banner */}
      <div className="bg-card border border-border rounded-xl px-5 py-3.5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{format(now, "EEEE, dd MMMM yyyy")}</p>
          <p className="text-base font-bold text-foreground mt-0.5">
            {totalAlerts === 0 ? "All clear — no urgent items today" : `${totalAlerts} item${totalAlerts !== 1 ? "s" : ""} need your attention`}
          </p>
        </div>
        {dueTodayMs.length > 0 && (
          <div className="flex items-center gap-2 text-amber-600 text-sm font-medium bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <Calendar className="h-4 w-4" />
            {dueTodayMs.length} T&A milestone{dueTodayMs.length !== 1 ? "s" : ""} due today
          </div>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "Active POs",         value: activePos,                           sub: `${purchaseOrders.length} total`, icon: FileText,    bg: "bg-primary/10",  iconColor: "text-primary" },
          { title: "Portfolio Value",     value: `$${(totalValue/1000).toFixed(0)}k`, sub: "all currencies",               icon: DollarSign,  bg: "bg-emerald-100", iconColor: "text-emerald-600", group: "PO_FINANCIAL" },
          { title: "Active Shipments",   value: activeShipments,                     sub: "in transit or booked",          icon: Ship,        bg: "bg-cyan-100",    iconColor: "text-cyan-600" },
          { title: "Outstanding Recv.",  value: `$${(outstandingPayments/1000).toFixed(0)}k`, sub: `${overduePayments.length} overdue`, icon: CreditCard, bg: overduePayments.length > 0 ? "bg-red-100" : "bg-amber-100", iconColor: overduePayments.length > 0 ? "text-red-600" : "text-amber-600", group: "PAYMENTS" },
        ].map(k => (
          <div key={k.title} className="bg-card border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{k.title}</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {k.group ? (
                    <RedactedValue group={k.group} placeholder="$•••k">{k.value}</RedactedValue>
                  ) : k.value}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
              </div>
              <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", k.bg)}>
                <k.icon className={cn("h-5 w-5", k.iconColor)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Roll-up widgets — replaces old alert grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

        {/* 1. Top Overdue POs */}
        <div className={cn("rounded-xl border p-4", overduePos.length > 0 ? "border-red-200 bg-red-50/40" : "border-border bg-card")}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className={cn("h-4 w-4", overduePos.length > 0 ? "text-red-600" : "text-muted-foreground")}/>
              <span className="text-sm font-semibold">Overdue POs</span>
            </div>
            <span className={cn("text-lg font-bold", overduePos.length > 0 && "text-red-700")}>{overduePos.length}</span>
          </div>
          {overduePos.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nothing overdue — nice</p>
          ) : (
            <div className="space-y-1">
              {overduePos.map(({ po, daysLate }) => (
                <Link key={po.id} to={createPageUrl("PODetail") + `?id=${po.id}`}
                      className="flex items-center justify-between text-xs hover:underline">
                  <span className="font-medium truncate max-w-[170px]">{po.po_number}</span>
                  <span className="text-red-700 font-bold ml-2">{daysLate}d late</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* 2. This Week's ETDs */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Ship className="h-4 w-4 text-blue-600"/>
              <span className="text-sm font-semibold">This Week's ETDs</span>
            </div>
            <span className="text-lg font-bold text-blue-700">{thisWeekEtds.length}</span>
          </div>
          {thisWeekEtds.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No shipments scheduled this week</p>
          ) : (
            <div className="space-y-1">
              {thisWeekEtds.slice(0, 4).map(po => (
                <Link key={po.id} to={createPageUrl("PODetail") + `?id=${po.id}`}
                      className="flex items-center justify-between text-xs hover:underline">
                  <span className="font-medium truncate max-w-[170px]">{po.po_number}</span>
                  <span className="text-muted-foreground ml-2">{fmt(po.etd || po.ex_factory_date)}</span>
                </Link>
              ))}
              {thisWeekEtds.length > 4 && <p className="text-xs text-muted-foreground">+{thisWeekEtds.length - 4} more</p>}
            </div>
          )}
        </div>

        {/* 3. Today's Shipments */}
        <div className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Ship className="h-4 w-4 text-cyan-600"/>
              <span className="text-sm font-semibold">Active Shipments</span>
            </div>
            <Link to={createPageUrl("Shipments")} className="flex items-center gap-1 text-lg font-bold text-cyan-700 hover:underline">
              {todayShipments.length} <ArrowRight className="h-3 w-3"/>
            </Link>
          </div>
          {todayShipments.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No active shipments</p>
          ) : (
            <div className="space-y-1">
              {todayShipments.slice(0, 4).map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate max-w-[170px]">{s.shipment_number || s.po_number || "—"}</span>
                  <span className="text-cyan-700 ml-2">{s.status}</span>
                </div>
              ))}
              {todayShipments.length > 4 && <p className="text-xs text-muted-foreground">+{todayShipments.length - 4} more</p>}
            </div>
          )}
        </div>

        {/* 4. Shortage Count */}
        <div className={cn("rounded-xl border p-4", totalShortages > 0 ? "border-amber-200 bg-amber-50/40" : "border-border bg-card")}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className={cn("h-4 w-4", totalShortages > 0 ? "text-amber-600" : "text-muted-foreground")}/>
              <span className="text-sm font-semibold">Shortages (ETD ≤30d)</span>
            </div>
            <Link to={createPageUrl("ShortageAlerts")} className={cn("flex items-center gap-1 text-lg font-bold hover:underline", totalShortages > 0 ? "text-amber-700" : "text-muted-foreground")}>
              {totalShortages} <ArrowRight className="h-3 w-3"/>
            </Link>
          </div>
          {totalShortages === 0 ? (
            <p className="text-xs text-muted-foreground italic">No shortages detected</p>
          ) : (
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span>Fabric</span><span className="font-semibold">{shortages.fabric}</span></div>
              <div className="flex justify-between"><span>Trim</span><span className="font-semibold">{shortages.trim}</span></div>
              <div className="flex justify-between"><span>Accessory</span><span className="font-semibold">{shortages.accessory}</span></div>
            </div>
          )}
        </div>

        {/* 5. Pending Approvals */}
        {canApprovePOs && (
          <div className={cn("rounded-xl border p-4", pendingApprovals.length > 0 ? "border-amber-200 bg-amber-50/40" : "border-border bg-card")}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className={cn("h-4 w-4", pendingApprovals.length > 0 ? "text-amber-600" : "text-muted-foreground")}/>
                <span className="text-sm font-semibold">PO Approvals</span>
              </div>
              <Link to={createPageUrl("PurchaseOrders")} className={cn("flex items-center gap-1 text-lg font-bold hover:underline", pendingApprovals.length > 0 ? "text-amber-700" : "text-muted-foreground")}>
                {pendingApprovals.length} <ArrowRight className="h-3 w-3"/>
              </Link>
            </div>
            {pendingApprovals.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No pending approvals</p>
            ) : (
              <div className="space-y-1">
                {pendingApprovals.slice(0, 4).map(p => (
                  <Link key={p.id} to={createPageUrl("PODetail") + `?id=${p.id}`}
                        className="flex items-center justify-between text-xs hover:underline">
                    <span className="font-medium truncate max-w-[170px]">{p.po_number}</span>
                    <span className="text-muted-foreground ml-2 truncate max-w-[100px]">{p.customer_name}</span>
                  </Link>
                ))}
                {pendingApprovals.length > 4 && <p className="text-xs text-muted-foreground">+{pendingApprovals.length - 4} more</p>}
              </div>
            )}
          </div>
        )}

        {/* 6. Production Utilization (7d avg) */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Factory className="h-4 w-4 text-emerald-600"/>
              <span className="text-sm font-semibold">Production (7d avg)</span>
            </div>
            <Link to={createPageUrl("ProductionDashboard")} className="flex items-center gap-1 text-lg font-bold text-emerald-700 hover:underline">
              {prodUtil.pct.toFixed(0)}% <ArrowRight className="h-3 w-3"/>
            </Link>
          </div>
          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No production lines configured</p>
          ) : (
            <div className="space-y-2">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", prodUtil.pct > 100 ? "bg-red-500" : prodUtil.pct > 80 ? "bg-emerald-500" : "bg-amber-500")}
                     style={{ width: `${Math.min(100, prodUtil.pct)}%` }}/>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{prodUtil.avgDaily.toLocaleString()} pcs/day avg</span>
                <span>{prodUtil.totalCapacity.toLocaleString()} capacity</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Charts */}
      <DashboardCharts purchaseOrders={purchaseOrders} />

      {/* Upcoming Shipments — next 90 days (smart-tex logic) */}
      {upcomingShipments.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Upcoming Shipments (Next 90 Days)</h3>
            </div>
            <Link to={createPageUrl("PurchaseOrders")} className="text-xs text-primary hover:underline flex items-center gap-1">
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcomingShipments.map((po) => {
              const shipDate = po.etd || po.ex_factory_date;
              return (
                <Link key={po.id} to={createPageUrl("PODetail") + `?id=${po.id}`}>
                  <div className="p-3 bg-muted/40 hover:bg-muted/70 rounded-lg transition-colors border border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-foreground">{po.po_number}</span>
                      <StatusBadge status={po.status} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{po.customer_name}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px] font-medium text-primary">
                        {po.etd ? "ETD" : "Ex-Factory"}: {shipDate ? format(new Date(shipDate), "dd MMM yyyy") : "—"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{po.total_quantity?.toLocaleString()} pcs</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming ex-factory */}
      {upcomingExFactory.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Ex-Factory Next 30 Days</h3>
            </div>
            <Link to="/PurchaseOrders" className="text-xs text-primary hover:underline flex items-center gap-1">
              All POs <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcomingExFactory.map(po => {
              const days = differenceInDays(new Date(po.ex_factory_date), now);
              return (
                <Link key={po.id} to={`/PODetail?id=${po.id}`}>
                  <div className={cn("p-3 rounded-lg border transition-colors hover:bg-muted/50",
                    days <= 7 ? "border-red-200 bg-red-50/30" : days <= 14 ? "border-amber-200 bg-amber-50/30" : "border-border bg-muted/20"
                  )}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">{po.po_number}</span>
                      <StatusBadge status={po.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{po.customer_name}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className={cn("text-[11px] font-semibold", days <= 7 ? "text-red-600" : days <= 14 ? "text-amber-600" : "text-primary")}>
                        {fmtFull(po.ex_factory_date)} ({days}d)
                      </span>
                      <span className="text-[11px] text-muted-foreground">{po.total_quantity?.toLocaleString()} pcs</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* T&A due today */}
      {dueTodayMs.length > 0 && (
        <div className="bg-card border border-amber-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-800">T&A Milestones Due Today</h3>
            </div>
            <Link to="/TNACalendar" className="text-xs text-primary hover:underline flex items-center gap-1">
              Open T&A <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {dueTodayMs.map(ms => {
              const po = purchaseOrders.find(p => p.id === ms.po_id);
              return (
                <div key={ms.id} className="flex items-start gap-2 p-2.5 bg-amber-50/60 rounded-lg border border-amber-200">
                  <Clock className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-amber-900">{ms.name}</p>
                    <p className="text-[11px] text-amber-700">{po ? `${po.po_number} — ${po.customer_name}` : "—"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <RecentPOTable purchaseOrders={purchaseOrders} />
    </div>
  );
}

