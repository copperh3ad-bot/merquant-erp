import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { db, production, mfg, tna, qcInspections, payments, supabase } from "@/api/supabaseClient";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users, Search, ArrowLeft, AlertTriangle, Clock, CheckCircle2, Package, FileText, Ship, TrendingUp, DollarSign, ChevronRight } from "lucide-react";
import { format, isPast, differenceInDays } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";
import StatusBadge from "@/components/shared/StatusBadge";
import RedactedValue from "@/components/shared/RedactedValue";
import { cn } from "@/lib/utils";

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };
const DONE_STATUSES = ["Delivered", "Shipped", "Cancelled"];

function CustomerCard({ customer, pos, onSelect }) {
  const stats = useMemo(() => {
    const active = pos.filter(p => !DONE_STATUSES.includes(p.status));
    const now = new Date();
    const overdue = pos.filter(p => {
      if (DONE_STATUSES.includes(p.status)) return false;
      const d = p.ex_factory_date || p.etd;
      return d && isPast(new Date(d));
    });
    const value = pos.reduce((s, p) => s + (p.total_po_value || 0), 0);
    const nextEtd = pos.filter(p => p.etd && !DONE_STATUSES.includes(p.status))
      .sort((a, b) => new Date(a.etd) - new Date(b.etd))[0]?.etd;
    return {
      total: pos.length,
      active: active.length,
      overdue: overdue.length,
      value,
      currency: pos[0]?.currency || "USD",
      nextEtd,
    };
  }, [pos]);

  return (
    <Card className={cn("cursor-pointer hover:shadow-md transition-shadow", stats.overdue > 0 && "border-red-300")}
          onClick={() => onSelect(customer)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{customer}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
              {stats.total} PO{stats.total !== 1 ? "s" : ""} · {stats.active} active
            </p>
          </div>
          {stats.overdue > 0 && (
            <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-full px-2 py-0.5 shrink-0">
              <AlertTriangle className="h-3 w-3 text-red-600"/>
              <span className="text-[10px] font-bold text-red-700">{stats.overdue}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg px-2 py-1.5">
            <p className="text-[9px] text-muted-foreground uppercase">Value</p>
            <RedactedValue group="PO_FINANCIAL" placeholder={`${stats.currency} ••••`}>
              <p className="font-semibold tabular-nums">{stats.currency} {stats.value ? (stats.value / 1000).toFixed(0) + "k" : "0"}</p>
            </RedactedValue>
          </div>
          <div className="bg-muted/40 rounded-lg px-2 py-1.5">
            <p className="text-[9px] text-muted-foreground uppercase">Next ETD</p>
            <p className="font-semibold">{fmt(stats.nextEtd)}</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
          <span>Click for details</span>
          <ChevronRight className="h-3 w-3"/>
        </div>
      </CardContent>
    </Card>
  );
}

function CustomerDetail({ customer, pos, onBack }) {
  // Fetch related data for this customer's POs
  const poIds = pos.map(p => p.id);

  const { data: milestones = [] } = useQuery({
    queryKey: ["custMilestones", customer],
    queryFn: () => tna.milestones.list(),
    enabled: poIds.length > 0,
  });
  const { data: wip = [] } = useQuery({
    queryKey: ["custWip", customer],
    queryFn: () => production.wip.list(),
    enabled: poIds.length > 0,
  });
  const { data: inspections = [] } = useQuery({
    queryKey: ["custInspections", customer],
    queryFn: () => qcInspections.list(),
    enabled: poIds.length > 0,
  });
  const { data: paymentList = [] } = useQuery({
    queryKey: ["custPayments", customer],
    queryFn: () => payments.listAll(),
    enabled: poIds.length > 0,
  });
  const { data: shortages = [] } = useQuery({
    queryKey: ["custShortages", customer],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fabric_orders")
        .select("*")
        .in("po_id", poIds)
        .lt("received_meters", "quantity_meters")
        .neq("status", "Cancelled");
      if (error) return [];
      return data || [];
    },
    enabled: poIds.length > 0,
  });

  // Filter children to this customer's POs
  const relMilestones = useMemo(() => milestones.filter(m => poIds.includes(m.po_id)), [milestones, poIds]);
  const relWip       = useMemo(() => wip.filter(w => poIds.includes(w.po_id)), [wip, poIds]);
  const relPayments  = useMemo(() => paymentList.filter(p => poIds.includes(p.po_id)), [paymentList, poIds]);
  const relShortages = useMemo(() => shortages || [], [shortages]);

  // Alerts
  const alerts = useMemo(() => {
    const now = new Date();
    const overdueMs = relMilestones.filter(m =>
      m.target_date && isPast(new Date(m.target_date)) && m.status !== "completed"
    );
    const pendingApprovals = pos.filter(p => p.approval_status === "pending");
    const overduePayments = relPayments.filter(p =>
      p.expected_date && isPast(new Date(p.expected_date)) && p.status !== "Received"
    );
    const fabricShortages = relShortages.filter(s =>
      (Number(s.quantity_meters) || 0) - (Number(s.received_meters) || 0) > 0
    );
    return { overdueMs, pendingApprovals, overduePayments, fabricShortages };
  }, [relMilestones, pos, relPayments, relShortages]);

  const totalAlerts = alerts.overdueMs.length + alerts.pendingApprovals.length + alerts.overduePayments.length + alerts.fabricShortages.length;

  // Per-PO progress rollup
  const poProgress = useMemo(() => {
    return pos.map(po => {
      const poMs = relMilestones.filter(m => m.po_id === po.id);
      const completed = poMs.filter(m => m.status === "completed").length;
      const tnaPct = poMs.length > 0 ? (completed / poMs.length) * 100 : 0;

      const poWip = relWip.filter(w => w.po_id === po.id);
      const totalPlanned = poWip.reduce((s, w) => s + (w.planned_qty || 0), 0);
      const totalProduced = poWip.reduce((s, w) => s + (w.produced_qty || 0), 0);
      const prodPct = totalPlanned > 0 ? (totalProduced / totalPlanned) * 100 : 0;

      const poQc = inspections.filter(q => q.po_id === po.id);
      const qcPassed = poQc.filter(q => q.final_result === "Passed").length;

      const poPay = relPayments.filter(p => p.po_id === po.id);
      const received = poPay.filter(p => p.status === "Received").reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const expected = poPay.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const payPct = expected > 0 ? (received / expected) * 100 : 0;

      const isOverdue = (po.ex_factory_date || po.etd) && isPast(new Date(po.ex_factory_date || po.etd)) && !DONE_STATUSES.includes(po.status);

      return { po, tnaPct, prodPct, qcPassed, qcTotal: poQc.length, payPct, isOverdue };
    }).sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return b.isOverdue - a.isOverdue;
      const ad = new Date(a.po.ex_factory_date || a.po.etd || 0);
      const bd = new Date(b.po.ex_factory_date || b.po.etd || 0);
      return ad - bd;
    });
  }, [pos, relMilestones, relWip, inspections, relPayments]);

  const totalValue = pos.reduce((s, p) => s + (p.total_po_value || 0), 0);
  const currency = pos[0]?.currency || "USD";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5 mr-1"/>Back</Button>
        <Users className="h-5 w-5 text-primary"/>
        <h1 className="text-base font-bold">{customer}</h1>
        <span className="text-xs text-muted-foreground">· {pos.length} PO{pos.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-primary/10 text-primary rounded-xl p-3">
          <p className="text-xl font-bold">{pos.length}</p>
          <p className="text-[10px] uppercase mt-0.5 opacity-80">Total POs</p>
        </div>
        <div className="bg-blue-50 text-blue-700 rounded-xl p-3">
          <p className="text-xl font-bold">{pos.filter(p => !DONE_STATUSES.includes(p.status)).length}</p>
          <p className="text-[10px] uppercase mt-0.5 opacity-80">Active</p>
        </div>
        <div className={cn("rounded-xl p-3", poProgress.filter(p => p.isOverdue).length > 0 ? "bg-red-50 text-red-700" : "bg-muted/40")}>
          <p className="text-xl font-bold">{poProgress.filter(p => p.isOverdue).length}</p>
          <p className="text-[10px] uppercase mt-0.5 opacity-80">Overdue</p>
        </div>
        <div className="bg-emerald-50 text-emerald-700 rounded-xl p-3">
          <RedactedValue group="PO_FINANCIAL" placeholder={`${currency} •••k`}>
            <p className="text-xl font-bold">{currency} {(totalValue / 1000).toFixed(0)}k</p>
          </RedactedValue>
          <p className="text-[10px] uppercase mt-0.5 opacity-80">Portfolio Value</p>
        </div>
        <div className={cn("rounded-xl p-3", totalAlerts > 0 ? "bg-amber-50 text-amber-700" : "bg-muted/40")}>
          <p className="text-xl font-bold">{totalAlerts}</p>
          <p className="text-[10px] uppercase mt-0.5 opacity-80">Alerts</p>
        </div>
      </div>

      {/* Alerts panel */}
      {totalAlerts > 0 && (
        <Card className="border-amber-200">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600"/>
              <p className="text-sm font-semibold">Alerts ({totalAlerts})</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {alerts.overdueMs.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="font-semibold text-red-800 mb-1">{alerts.overdueMs.length} overdue T&A milestone{alerts.overdueMs.length !== 1 ? "s" : ""}</p>
                  <ul className="space-y-0.5">{alerts.overdueMs.slice(0, 3).map(m => <li key={m.id} className="text-red-700 truncate">{m.po_number} — {m.milestone_name} ({fmt(m.target_date)})</li>)}</ul>
                </div>
              )}
              {alerts.pendingApprovals.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="font-semibold text-amber-800 mb-1">{alerts.pendingApprovals.length} PO approval{alerts.pendingApprovals.length !== 1 ? "s" : ""} pending</p>
                  <ul className="space-y-0.5">{alerts.pendingApprovals.slice(0, 3).map(p => <li key={p.id} className="text-amber-700 truncate">{p.po_number}</li>)}</ul>
                </div>
              )}
              {alerts.overduePayments.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="font-semibold text-red-800 mb-1">{alerts.overduePayments.length} overdue payment{alerts.overduePayments.length !== 1 ? "s" : ""}</p>
                  <ul className="space-y-0.5">{alerts.overduePayments.slice(0, 3).map(p => <li key={p.id} className="text-red-700 truncate">{p.po_number} — {fmt(p.expected_date)}</li>)}</ul>
                </div>
              )}
              {alerts.fabricShortages.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="font-semibold text-amber-800 mb-1">{alerts.fabricShortages.length} fabric shortage{alerts.fabricShortages.length !== 1 ? "s" : ""}</p>
                  <ul className="space-y-0.5">{alerts.fabricShortages.slice(0, 3).map(s => <li key={s.id} className="text-amber-700 truncate">{s.po_number} — short {((s.quantity_meters || 0) - (s.received_meters || 0)).toFixed(0)}m</li>)}</ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-PO detail */}
      <Card><CardContent className="p-0">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary"/>
          <p className="text-sm font-semibold">PO Status Detail</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#1F3864] text-white">
              <tr>{["PO", "Status", "Ex-Factory", "T&A", "Production", "QC", "Payment", "Value", ""].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {poProgress.map(({ po, tnaPct, prodPct, qcPassed, qcTotal, payPct, isOverdue }, i) => (
                <tr key={po.id} className={cn("border-b hover:bg-muted/20", i % 2 === 0 && "bg-[#EBF0FA]/50", isOverdue && "bg-red-50/50")}>
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/PODetail?id=${po.id}`} className="text-primary hover:underline">{po.po_number}</Link>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={po.status}/></td>
                  <td className={cn("px-3 py-2", isOverdue && "text-red-700 font-semibold")}>
                    {fmt(po.ex_factory_date || po.etd)}
                    {isOverdue && <span className="ml-1 text-[10px]">OVERDUE</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, tnaPct)}%` }}/>
                      </div>
                      <span className="text-[10px] tabular-nums">{tnaPct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, prodPct)}%` }}/>
                      </div>
                      <span className="text-[10px] tabular-nums">{prodPct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {qcTotal > 0 ? `${qcPassed}/${qcTotal}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <RedactedValue group="PAYMENTS" placeholder="•••">
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(100, payPct)}%` }}/>
                        </div>
                        <span className="text-[10px] tabular-nums">{payPct.toFixed(0)}%</span>
                      </div>
                    </RedactedValue>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <RedactedValue group="PO_FINANCIAL" placeholder={`${po.currency || ""} ••••`}>
                      {po.currency} {po.total_po_value?.toLocaleString() || "—"}
                    </RedactedValue>
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/PODetail?id=${po.id}`}><ChevronRight className="h-3.5 w-3.5 text-muted-foreground"/></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}

export default function CustomerOrderStatus() {
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");

  const { data: pos = [], isLoading } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => db.purchaseOrders.list("-created_at"),
  });

  // Group POs by customer
  const byCustomer = useMemo(() => {
    const m = {};
    for (const po of pos) {
      const key = po.customer_name?.trim() || "(Unknown)";
      (m[key] = m[key] || []).push(po);
    }
    return m;
  }, [pos]);

  const customers = useMemo(() => {
    const list = Object.keys(byCustomer).sort();
    if (!search) return list;
    return list.filter(c => c.toLowerCase().includes(search.toLowerCase()));
  }, [byCustomer, search]);

  if (selected) {
    return <CustomerDetail customer={selected} pos={byCustomer[selected] || []} onBack={() => setSelected(null)}/>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Users className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Order Status by Customer</h1></div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search customer…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-32 rounded-xl"/>)}</div>
      ) : customers.length === 0 ? (
        <EmptyState icon={Users} title="No customers" description="Customers appear here as POs are created."/>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {customers.map(c => <CustomerCard key={c} customer={c} pos={byCustomer[c]} onSelect={setSelected}/>)}
        </div>
      )}
    </div>
  );
}
