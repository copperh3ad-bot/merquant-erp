import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase, mfg, db } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Search, Download, Layers, Tag, Package, ExternalLink } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };

function severityOf(shortfallPct, daysToEtd) {
  // Critical: >30% short OR ETD within 7 days
  // High:     >15% short OR ETD within 14 days
  // Medium:   any shortage
  if (shortfallPct >= 30 || (daysToEtd != null && daysToEtd <= 7))  return "critical";
  if (shortfallPct >= 15 || (daysToEtd != null && daysToEtd <= 14)) return "high";
  return "medium";
}

const SEV_STYLES = {
  critical: "bg-red-50 border-red-300 text-red-800",
  high:     "bg-orange-50 border-orange-300 text-orange-800",
  medium:   "bg-amber-50 border-amber-200 text-amber-800",
};
const SEV_BADGE = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high:     "bg-orange-100 text-orange-700 border-orange-200",
  medium:   "bg-amber-100 text-amber-700 border-amber-200",
};

export default function ShortageAlerts() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("__all");
  const [typeFilter, setTypeFilter] = useState("__all");

  // Fabric shortages from fabric_orders (received < planned)
  const { data: fabricOrders = [], isLoading: l1 } = useQuery({
    queryKey: ["fabricOrdersShortage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fabric_orders")
        .select("*")
        .neq("status", "Cancelled")
        .order("expected_delivery", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Article-level fabric requirement vs received (across all fabric_orders per PO+fabric)
  const { data: articles = [], isLoading: l2 } = useQuery({
    queryKey: ["articlesAllShort"],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*").limit(2000);
      if (error) throw error; return data || [];
    },
  });

  // Trim shortages: trim_items with status='Planned' past ex-factory
  const { data: trims = [], isLoading: l3 } = useQuery({
    queryKey: ["trimItemsShortage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trim_items")
        .select("*")
        .in("status", ["Planned", "Ordered"])
        .order("po_number");
      if (error) throw error; return data || [];
    },
  });

  // Accessory shortages: accessory_items with status='Planned' past ex-factory
  const { data: accessories = [], isLoading: l4 } = useQuery({
    queryKey: ["accItemsShortage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accessory_items")
        .select("*")
        .in("status", ["Planned", "Ordered"])
        .order("po_number");
      if (error) throw error; return data || [];
    },
  });

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list() });
  const poMap = useMemo(() => { const m = {}; for (const p of pos) m[p.id] = p; return m; }, [pos]);

  const now = new Date();

  // Combine into unified alert list
  const alerts = useMemo(() => {
    const rows = [];

    // Fabric orders with shortfall
    for (const fo of fabricOrders) {
      const planned  = Number(fo.quantity_meters) || 0;
      const received = Number(fo.received_meters) || 0;
      const shortfall = planned - received;
      if (shortfall <= 0.01 || fo.status === "Received") continue;
      const po = poMap[fo.po_id];
      const etd = po?.ex_factory_date || po?.etd;
      const daysToEtd = etd ? differenceInDays(new Date(etd), now) : null;
      const shortfallPct = planned > 0 ? (shortfall / planned) * 100 : 100;

      rows.push({
        type: "fabric",
        id: `fo-${fo.id}`,
        po_id: fo.po_id,
        po_number: fo.po_number,
        customer: po?.customer_name,
        item: fo.fabric_type || "—",
        spec: [fo.gsm && `${fo.gsm}gsm`, fo.width_cm && `${fo.width_cm}cm`, fo.color].filter(Boolean).join(" · "),
        planned,
        received,
        shortfall,
        shortfallPct,
        unit: "m",
        supplier: fo.mill_name,
        etd,
        daysToEtd,
        severity: severityOf(shortfallPct, daysToEtd),
        status: fo.status,
        expected_delivery: fo.expected_delivery,
      });
    }

    // Trims — unordered vs planned relative to ex-factory
    for (const t of trims) {
      if (t.status === "Received") continue;
      const po = poMap[t.po_id];
      const etd = po?.ex_factory_date || po?.etd;
      const daysToEtd = etd ? differenceInDays(new Date(etd), now) : null;
      // Only flag if ETD is approaching (within 30 days) or already passed
      if (daysToEtd != null && daysToEtd > 30) continue;
      const required = Number(t.quantity_required) || 0;
      if (!required) continue;

      rows.push({
        type: "trim",
        id: `tr-${t.id}`,
        po_id: t.po_id,
        po_number: t.po_number,
        customer: po?.customer_name,
        item: `${t.trim_category || ""}${t.item_description ? " · " + t.item_description : ""}`,
        spec: [t.color, t.size_spec].filter(Boolean).join(" · "),
        planned: required,
        received: 0,
        shortfall: required,
        shortfallPct: 100,
        unit: t.unit || "pcs",
        supplier: t.supplier,
        etd,
        daysToEtd,
        severity: severityOf(100, daysToEtd),
        status: t.status || "Planned",
      });
    }

    // Accessories — same logic as trims
    for (const a of accessories) {
      if (a.status === "Received") continue;
      const po = poMap[a.po_id];
      const etd = po?.ex_factory_date || po?.etd;
      const daysToEtd = etd ? differenceInDays(new Date(etd), now) : null;
      if (daysToEtd != null && daysToEtd > 30) continue;
      const required = Number(a.quantity_required) || 0;
      if (!required) continue;

      rows.push({
        type: "accessory",
        id: `ac-${a.id}`,
        po_id: a.po_id,
        po_number: a.po_number,
        customer: po?.customer_name,
        item: `${a.category || ""}${a.item_description ? " · " + a.item_description : ""}`,
        spec: [a.color, a.size_spec].filter(Boolean).join(" · "),
        planned: required,
        received: 0,
        shortfall: required,
        shortfallPct: 100,
        unit: a.unit || "pcs",
        supplier: a.supplier,
        etd,
        daysToEtd,
        severity: severityOf(100, daysToEtd),
        status: a.status || "Planned",
      });
    }

    // Sort: severity first (critical > high > medium), then daysToEtd asc
    const sevRank = { critical: 0, high: 1, medium: 2 };
    rows.sort((a, b) => {
      if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
      return (a.daysToEtd ?? 999) - (b.daysToEtd ?? 999);
    });
    return rows;
  }, [fabricOrders, trims, accessories, poMap]);

  const filtered = useMemo(() => {
    return alerts.filter(r =>
      (typeFilter === "__all" || r.type === typeFilter) &&
      (severityFilter === "__all" || r.severity === severityFilter) &&
      (!search ||
        r.po_number?.toLowerCase().includes(search.toLowerCase()) ||
        r.customer?.toLowerCase().includes(search.toLowerCase()) ||
        r.item?.toLowerCase().includes(search.toLowerCase()) ||
        r.supplier?.toLowerCase().includes(search.toLowerCase()))
    );
  }, [alerts, search, typeFilter, severityFilter]);

  const summary = useMemo(() => ({
    total: alerts.length,
    critical: alerts.filter(a => a.severity === "critical").length,
    high:     alerts.filter(a => a.severity === "high").length,
    fabric:   alerts.filter(a => a.type === "fabric").length,
    trim:     alerts.filter(a => a.type === "trim").length,
    accessory: alerts.filter(a => a.type === "accessory").length,
  }), [alerts]);

  const downloadCSV = () => {
    const headers = ["Severity","Type","PO","Customer","Item","Spec","Planned","Received","Shortfall","Unit","Supplier","ETD","Days to ETD","Status"];
    const rows = filtered.map(r => [
      r.severity, r.type, r.po_number, r.customer, r.item, r.spec,
      r.planned, r.received, r.shortfall.toFixed(2), r.unit,
      r.supplier || "", fmt(r.etd), r.daysToEtd ?? "", r.status,
    ]);
    const csv = [headers, ...rows].map(row =>
      row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: `shortage_alerts_${format(now, "yyyy-MM-dd")}.csv`,
    });
    a.click();
  };

  const isLoading = l1 || l2 || l3 || l4;
  const typeIcon = { fabric: Layers, trim: Tag, accessory: Package };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600"/>
          <h1 className="text-base font-bold">Shortage Alerts</h1>
        </div>
        <Button size="sm" variant="outline" onClick={downloadCSV} disabled={!filtered.length}>
          <Download className="h-3.5 w-3.5 mr-1.5"/>Export CSV
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          ["Total",     summary.total,    "bg-muted/50 text-foreground"],
          ["Critical",  summary.critical, summary.critical > 0 ? "bg-red-50 text-red-700" : "bg-muted/40"],
          ["High",      summary.high,     summary.high > 0 ? "bg-orange-50 text-orange-700" : "bg-muted/40"],
          ["Fabric",    summary.fabric,   "bg-blue-50 text-blue-700"],
          ["Trim",      summary.trim,     "bg-violet-50 text-violet-700"],
          ["Accessory", summary.accessory,"bg-cyan-50 text-cyan-700"],
        ].map(([label, val, cls]) => (
          <div key={label} className={cn("rounded-xl p-3", cls)}>
            <p className="text-xl font-bold tabular-nums">{val}</p>
            <p className="text-[10px] uppercase mt-0.5 opacity-80">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search PO, customer, item, supplier…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All types</SelectItem>
            <SelectItem value="fabric">Fabric</SelectItem>
            <SelectItem value="trim">Trim</SelectItem>
            <SelectItem value="accessory">Accessory</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-36 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-40"/>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title={alerts.length === 0 ? "No shortages detected" : "No alerts match filters"}
          description={alerts.length === 0
            ? "Fabric, trim, and accessory shortages will appear here when ETD approaches and material hasn't arrived."
            : "Try clearing the filters above."}
        />
      ) : (
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#1F3864] text-white">
                <tr>{["Severity","Type","PO","Customer","Item","Shortfall","Supplier","ETD",""].map(h =>
                  <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                )}</tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const Icon = typeIcon[r.type] || Package;
                  const isOverdue = r.daysToEtd != null && r.daysToEtd < 0;
                  return (
                    <tr key={r.id} className={cn("border-b hover:bg-muted/20", i % 2 === 0 && "bg-[#EBF0FA]/40")}>
                      <td className="px-3 py-2">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded border uppercase font-bold", SEV_BADGE[r.severity])}>
                          {r.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 capitalize">
                          <Icon className="h-3 w-3 text-muted-foreground"/>{r.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <Link to={`/PODetail?id=${r.po_id}`} className="text-primary hover:underline">{r.po_number || "—"}</Link>
                      </td>
                      <td className="px-3 py-2 truncate max-w-[160px]">{r.customer || "—"}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium truncate max-w-[220px]">{r.item}</p>
                        {r.spec && <p className="text-[10px] text-muted-foreground truncate max-w-[220px]">{r.spec}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold tabular-nums">{r.shortfall.toFixed(r.unit === "m" ? 1 : 0)} {r.unit}</p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {r.received.toLocaleString()} / {r.planned.toLocaleString()} · {r.shortfallPct.toFixed(0)}% short
                        </p>
                      </td>
                      <td className="px-3 py-2 truncate max-w-[140px]">{r.supplier || "—"}</td>
                      <td className={cn("px-3 py-2", isOverdue && "text-red-700 font-semibold")}>
                        {fmt(r.etd)}
                        {r.daysToEtd != null && (
                          <p className={cn("text-[10px]", r.daysToEtd < 0 ? "text-red-700 font-bold" : "text-muted-foreground")}>
                            {r.daysToEtd < 0 ? `${Math.abs(r.daysToEtd)}d overdue` : `in ${r.daysToEtd}d`}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Link to={`/PODetail?id=${r.po_id}`}><ExternalLink className="h-3.5 w-3.5 text-muted-foreground"/></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
