import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { production } from "@/api/supabaseClient";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Search, CheckCircle2, Clock, AlertCircle, PauseCircle } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";

const STATUS_ICONS = {
  planned:     Clock,
  in_progress: Activity,
  completed:   CheckCircle2,
  on_hold:     PauseCircle,
};
const STATUS_COLORS = {
  planned:     "text-gray-500",
  in_progress: "text-blue-600",
  completed:   "text-emerald-600",
  on_hold:     "text-amber-600",
};

export default function WIPTracker() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("__all");
  const [filterLine, setFilterLine] = useState("__all");

  const { data: wip = [], isLoading } = useQuery({ queryKey: ["wipStatus"], queryFn: () => production.wip.list(), refetchInterval: 60000 });
  const { data: lines = [] } = useQuery({ queryKey: ["prodLines"], queryFn: () => production.lines.list() });

  const filtered = useMemo(() => wip.filter(w =>
    (search === "" || w.po_number?.toLowerCase().includes(search.toLowerCase()) || w.article_code?.toLowerCase().includes(search.toLowerCase())) &&
    (filterStatus === "__all" || w.status === filterStatus) &&
    (filterLine === "__all" || w.line_id === filterLine)
  ), [wip, search, filterStatus, filterLine]);

  // Group by PO
  const byPO = useMemo(() => {
    const m = {};
    for (const w of filtered) {
      const k = w.po_number || "Unassigned";
      (m[k] = m[k] || { po_number: k, items: [], total_planned: 0, total_produced: 0 });
      m[k].items.push(w);
      m[k].total_planned  += w.planned_qty  || 0;
      m[k].total_produced += w.produced_qty || 0;
    }
    return Object.values(m).sort((a, b) => a.po_number.localeCompare(b.po_number));
  }, [filtered]);

  // Summary stats
  const summary = useMemo(() => {
    const totalPlans = filtered.length;
    const inProgress = filtered.filter(w => w.status === "in_progress").length;
    const completed = filtered.filter(w => w.status === "completed").length;
    const onHold    = filtered.filter(w => w.status === "on_hold").length;
    const overdue = filtered.filter(w => w.end_date && w.status !== "completed" && differenceInDays(new Date(), new Date(w.end_date)) > 0).length;
    return { totalPlans, inProgress, completed, onHold, overdue };
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><Activity className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">WIP Tracker</h1></div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ["Active Plans", summary.totalPlans,  "bg-primary/10 text-primary"],
          ["In Progress",  summary.inProgress, "bg-blue-50 text-blue-700"],
          ["Completed",    summary.completed,  "bg-emerald-50 text-emerald-700"],
          ["On Hold",      summary.onHold,     "bg-amber-50 text-amber-700"],
          ["Overdue",      summary.overdue,    summary.overdue > 0 ? "bg-red-50 text-red-700" : "bg-muted/50 text-muted-foreground"],
        ].map(([label, val, cls]) => (
          <div key={label} className={cn("rounded-xl p-3", cls)}>
            <p className="text-2xl font-bold">{val}</p>
            <p className="text-[10px] uppercase tracking-wide opacity-80 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/><Input placeholder="Search PO or article…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/></div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="__all">All statuses</SelectItem>{["planned","in_progress","completed","on_hold"].map(s => <SelectItem key={s} value={s}>{s.replace("_"," ")}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterLine} onValueChange={setFilterLine}>
          <SelectTrigger className="w-48 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="__all">All lines</SelectItem>{lines.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading ? <Skeleton className="h-40"/> : byPO.length === 0 ? (
        <EmptyState icon={AlertCircle} title="No WIP" description="Create a capacity plan in Capacity Planning to see WIP here."/>
      ) : (
        <div className="space-y-3">
          {byPO.map(po => {
            const pct = po.total_planned > 0 ? (po.total_produced / po.total_planned) * 100 : 0;
            return (
              <Card key={po.po_number}>
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{po.po_number}</p>
                      <p className="text-xs text-muted-foreground">{po.items.length} plan{po.items.length !== 1 ? "s" : ""} · {po.total_produced.toLocaleString()} / {po.total_planned.toLocaleString()} pcs</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }}/>
                      </div>
                      <span className="text-xs font-bold tabular-nums w-12 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {po.items.map(w => {
                      const StatusIcon = STATUS_ICONS[w.status] || Clock;
                      const itemPct = w.planned_qty > 0 ? (w.produced_qty / w.planned_qty) * 100 : 0;
                      const isOverdue = w.end_date && w.status !== "completed" && differenceInDays(new Date(), new Date(w.end_date)) > 0;
                      return (
                        <div key={w.plan_id} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/20 text-xs">
                          <StatusIcon className={cn("h-4 w-4 shrink-0", STATUS_COLORS[w.status])}/>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{w.article_code || "—"} <span className="text-muted-foreground font-normal">· {w.line_name || "—"} · {w.stage_name || "—"}</span></p>
                            <p className="text-[10px] text-muted-foreground">
                              {w.produced_qty.toLocaleString()} / {w.planned_qty.toLocaleString()}
                              {w.rejected_qty > 0 && <span className="text-red-600"> · {w.rejected_qty} rejected</span>}
                              {w.end_date && <span> · due {format(new Date(w.end_date), "dd MMM")}</span>}
                              {isOverdue && <span className="text-red-600 font-bold"> · OVERDUE</span>}
                              {w.last_output_date && <span> · last output {format(new Date(w.last_output_date), "dd MMM")}</span>}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full", isOverdue && w.status !== "completed" ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, itemPct)}%` }}/>
                            </div>
                            <span className="text-[10px] tabular-nums w-8 text-right">{itemPct.toFixed(0)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
