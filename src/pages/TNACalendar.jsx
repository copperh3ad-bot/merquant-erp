import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, tna } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Plus, CheckCircle2, AlertTriangle, Clock, ChevronDown, ChevronRight, Pencil, Check, X, RefreshCw } from "lucide-react";
import { format, differenceInDays, addDays, isPast, isToday } from "date-fns";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import GCalSync from "@/components/tna/GCalSync";

const CATEGORY_COLORS = {
  PO:         "bg-blue-100 text-blue-700 border-blue-200",
  Fabric:     "bg-amber-100 text-amber-700 border-amber-200",
  Approvals:  "bg-violet-100 text-violet-700 border-violet-200",
  Sampling:   "bg-pink-100 text-pink-700 border-pink-200",
  Trims:      "bg-orange-100 text-orange-700 border-orange-200",
  Production: "bg-cyan-100 text-cyan-700 border-cyan-200",
  QC:         "bg-lime-100 text-lime-700 border-lime-200",
  Shipping:   "bg-teal-100 text-teal-700 border-teal-200",
};
const STATUS_COLORS = {
  completed:   "bg-emerald-100 text-emerald-700",
  in_progress: "bg-blue-100 text-blue-700",
  at_risk:     "bg-amber-100 text-amber-700",
  delayed:     "bg-red-100 text-red-700",
  pending:     "bg-gray-100 text-gray-600",
};
const STATUS_ICONS = {
  completed:   <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  in_progress: <Clock className="h-3.5 w-3.5 text-blue-500" />,
  at_risk:     <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
  delayed:     <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
  pending:     <Clock className="h-3.5 w-3.5 text-gray-400" />,
};

function computeStatus(ms) {
  if (ms.status === "completed") return "completed";
  if (!ms.target_date) return "pending";
  const d = new Date(ms.target_date);
  if (isPast(d) && !isToday(d)) return "delayed";
  if (differenceInDays(d, new Date()) <= 3) return "at_risk";
  if (ms.status === "in_progress") return "in_progress";
  return "pending";
}

function MilestoneRow({ ms, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [actualDate, setActualDate] = useState(ms.actual_date || "");
  const status = computeStatus(ms);
  const daysLeft = ms.target_date ? differenceInDays(new Date(ms.target_date), new Date()) : null;

  const handleComplete = async () => {
    await onUpdate(ms.id, { status: "completed", actual_date: new Date().toISOString().split("T")[0] });
  };
  const handleSaveDate = async () => {
    await onUpdate(ms.id, { actual_date: actualDate, status: actualDate ? "completed" : ms.status });
    setEditing(false);
  };

  return (
    <tr className={cn("border-b border-border/50 hover:bg-muted/20 transition-colors", status === "delayed" && "bg-red-50/40")}>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          {STATUS_ICONS[status]}
          <span className="text-xs font-medium text-foreground">{ms.name}</span>
        </div>
      </td>
      <td className="py-2.5 px-3">
        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", CATEGORY_COLORS[ms.category] || "bg-gray-100 text-gray-600 border-gray-200")}>
          {ms.category}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
        {ms.target_date ? format(new Date(ms.target_date), "dd MMM") : "—"}
      </td>
      <td className="py-2.5 px-3">
        {daysLeft !== null && status !== "completed" && (
          <span className={cn("text-[11px] font-semibold",
            status === "delayed" ? "text-red-600" :
            status === "at_risk" ? "text-amber-600" : "text-muted-foreground"
          )}>
            {status === "delayed" ? `${Math.abs(daysLeft)}d late` : daysLeft === 0 ? "Today" : `${daysLeft}d`}
          </span>
        )}
      </td>
      <td className="py-2.5 px-3">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input type="date" value={actualDate} onChange={e => setActualDate(e.target.value)} className="h-6 text-xs w-28 py-0" />
            <button onClick={handleSaveDate} className="text-emerald-600 hover:text-emerald-800"><Check className="h-3.5 w-3.5" /></button>
            <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="text-xs text-muted-foreground hover:text-foreground">
            {ms.actual_date ? format(new Date(ms.actual_date), "dd MMM") : <span className="italic">— click to set</span>}
          </button>
        )}
      </td>
      <td className="py-2.5 px-3">
        <Select value={ms.status} onValueChange={val => onUpdate(ms.id, { status: val })}>
          <SelectTrigger className="h-6 text-[11px] w-28 py-0 border-0 bg-transparent p-0 focus:ring-0">
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_COLORS[ms.status] || STATUS_COLORS.pending)}>
              {ms.status?.replace("_", " ")}
            </span>
          </SelectTrigger>
          <SelectContent>
            {["pending","in_progress","completed","delayed","at_risk"].map(s => (
              <SelectItem key={s} value={s} className="text-xs">{s.replace("_"," ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-2.5 px-3">
        {status !== "completed" && (
          <button onClick={handleComplete} className="text-[10px] text-emerald-600 hover:text-emerald-800 font-medium">
            ✓ Done
          </button>
        )}
      </td>
    </tr>
  );
}

function POTNAPanel({ po, milestones, templates, onUpdate, onGenerate }) {
  const [open, setOpen] = useState(true);
  const [generating, setGenerating] = useState(false);
  const poMs = milestones.filter(m => m.po_id === po.id).sort((a, b) => new Date(a.target_date) - new Date(b.target_date));
  const delayed = poMs.filter(m => computeStatus(m) === "delayed").length;
  const completed = poMs.filter(m => m.status === "completed").length;
  const pct = poMs.length ? Math.round((completed / poMs.length) * 100) : 0;

  const generate = async (templateId) => {
    setGenerating(true);
    try { await onGenerate(po, templateId); } finally { setGenerating(false); }
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <div className="text-left">
            <p className="text-sm font-semibold text-foreground">{po.po_number} — {po.customer_name}</p>
            <p className="text-xs text-muted-foreground">Ex-Factory: {po.ex_factory_date ? format(new Date(po.ex_factory_date), "dd MMM yyyy") : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {delayed > 0 && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">{delayed} delayed</span>}
          <div className="text-right">
            <p className="text-xs font-semibold text-foreground">{pct}%</p>
            <div className="w-24 h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          {poMs.length === 0 ? (
            <div className="px-4 py-4 flex items-center gap-3">
              <p className="text-sm text-muted-foreground flex-1">No T&A set up for this PO.</p>
              <Select onValueChange={generate} disabled={generating}>
                <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder={generating ? "Generating…" : "Generate from template"} /></SelectTrigger>
                <SelectContent>{templates.map(t => <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Milestone</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Category</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Target</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Days</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Actual</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {poMs.map(ms => <MilestoneRow key={ms.id} ms={ms} onUpdate={onUpdate} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TNACalendar() {
  const [searchParams] = useSearchParams();
  const [filterPO, setFilterPO] = useState(searchParams.get("po_id") || "all");
  const [view, setView] = useState("po");
  const qc = useQueryClient();
  const { can } = useAuth();

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const { data: allMilestones = [], isLoading, refetch } = useQuery({ queryKey: ["tnaMilestones"], queryFn: () => tna.milestones.listAll() });
  const { data: templates = [] } = useQuery({ queryKey: ["tnaTemplates"], queryFn: () => tna.templates.list() });

  const activePOs = useMemo(() => pos.filter(p => !["Delivered","Cancelled","Shipped"].includes(p.status)), [pos]);
  const displayPOs = filterPO === "all" ? activePOs : activePOs.filter(p => p.id === filterPO);

  const stats = useMemo(() => {
    const today = new Date();
    const delayed = allMilestones.filter(m => m.target_date && isPast(new Date(m.target_date)) && !isToday(new Date(m.target_date)) && m.status !== "completed").length;
    const dueThisWeek = allMilestones.filter(m => m.target_date && differenceInDays(new Date(m.target_date), today) <= 7 && differenceInDays(new Date(m.target_date), today) >= 0 && m.status !== "completed").length;
    const completed = allMilestones.filter(m => m.status === "completed").length;
    return { delayed, dueThisWeek, completed, total: allMilestones.length };
  }, [allMilestones]);

  const handleUpdate = async (id, payload) => {
    if (!can("TNA_EDIT")) return;
    await tna.milestones.update(id, payload);
    qc.invalidateQueries({ queryKey: ["tnaMilestones"] });
  };

  const handleGenerate = async (po, templateId) => {
    const tmpl = templates.find(t => t.id === templateId);
    if (!tmpl || !po.ex_factory_date) return alert("PO needs an ex-factory date to generate T&A.");
    const exFactory = new Date(po.ex_factory_date);
    const calRecord = await tna.calendars.create({ po_id: po.id, po_number: po.po_number, customer_name: po.customer_name, ex_factory_date: po.ex_factory_date, template_id: templateId });
    const rows = (tmpl.milestones || []).map((ms, i) => ({
      tna_id: calRecord.id, po_id: po.id,
      name: ms.name, category: ms.category,
      target_date: format(addDays(exFactory, -ms.days_before_exfactory), "yyyy-MM-dd"),
      status: "pending", sort_order: i,
    }));
    await tna.milestones.bulkCreate(rows);
    qc.invalidateQueries({ queryKey: ["tnaMilestones"] });
  };

  // Weekly view — group milestones by week
  const weeklyGroups = useMemo(() => {
    const today = new Date();
    const weeks = [];
    for (let w = -1; w <= 8; w++) {
      const start = addDays(today, w * 7 - today.getDay());
      const end = addDays(start, 6);
      const msList = allMilestones.filter(m => {
        if (!m.target_date || m.status === "completed") return false;
        const d = new Date(m.target_date);
        return d >= start && d <= end;
      });
      if (msList.length > 0 || w === 0) weeks.push({ start, end, milestones: msList });
    }
    return weeks;
  }, [allMilestones]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold text-foreground">T&A Calendar</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded-lg overflow-hidden text-xs">
            {["po","weekly"].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={cn("px-3 py-1.5 transition-colors capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                {v === "po" ? "By PO" : "Weekly"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Overdue" value={stats.delayed} icon={AlertTriangle} iconBg="bg-red-100" subtitle="milestones" />
        <StatCard title="Due this week" value={stats.dueThisWeek} icon={Clock} iconBg="bg-amber-100" subtitle="milestones" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} iconBg="bg-emerald-100" subtitle="milestones" />
        <StatCard title="Active POs" value={activePOs.length} icon={Calendar} iconBg="bg-primary/10" subtitle="in pipeline" />
      </div>

      {/* Google Calendar sync — visible to Manager+ */}
      <GCalSync
        milestones={allMilestones}
        poMap={Object.fromEntries(pos.map(p => [p.id, p]))}
      />

      {/* PO filter */}
      {view === "po" && (
        <div className="flex items-center gap-3">
          <Select value={filterPO} onValueChange={setFilterPO}>
            <SelectTrigger className="w-72 text-sm h-9"><SelectValue placeholder="All active POs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Active POs</SelectItem>
              {activePOs.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* BY PO VIEW */}
      {view === "po" && (
        <div className="space-y-3">
          {displayPOs.length === 0 ? (
            <EmptyState icon={Calendar} title="No active POs" description="All POs are delivered or cancelled." />
          ) : displayPOs.map(po => (
            <POTNAPanel key={po.id} po={po} milestones={allMilestones} templates={templates} onUpdate={handleUpdate} onGenerate={handleGenerate} />
          ))}
        </div>
      )}

      {/* WEEKLY VIEW */}
      {view === "weekly" && (
        <div className="space-y-4">
          {weeklyGroups.map(({ start, end, milestones: wms }) => {
            const delayed = wms.filter(m => computeStatus(m) === "delayed").length;
            return (
              <Card key={start.toISOString()}>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    {format(start, "dd MMM")} – {format(end, "dd MMM yyyy")}
                    {isToday(start) || (new Date() >= start && new Date() <= end) ? <span className="ml-2 text-xs text-primary font-normal">This week</span> : null}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {delayed > 0 && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{delayed} delayed</span>}
                    <span className="text-xs text-muted-foreground">{wms.length} milestone{wms.length !== 1 ? "s" : ""}</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {wms.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-5 pb-4">No milestones this week</p>
                  ) : (
                    <table className="w-full text-xs">
                      <tbody>
                        {wms.map(ms => {
                          const po = pos.find(p => p.id === ms.po_id);
                          const status = computeStatus(ms);
                          return (
                            <tr key={ms.id} className={cn("border-b border-border/50 hover:bg-muted/20", status === "delayed" && "bg-red-50/40")}>
                              <td className="px-4 py-2.5 w-32 text-muted-foreground whitespace-nowrap">{ms.target_date ? format(new Date(ms.target_date), "EEE dd MMM") : "—"}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                  {STATUS_ICONS[status]}
                                  <span className="font-medium">{ms.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-muted-foreground">{po ? `${po.po_number} — ${po.customer_name}` : "—"}</td>
                              <td className="px-3 py-2.5">
                                <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", CATEGORY_COLORS[ms.category] || "bg-gray-100 text-gray-600 border-gray-200")}>{ms.category}</span>
                              </td>
                              <td className="px-3 py-2.5">
                                {status !== "completed" && (
                                  <button onClick={() => handleUpdate(ms.id, { status: "completed", actual_date: new Date().toISOString().split("T")[0] })}
                                    className="text-[10px] text-emerald-600 hover:text-emerald-800 font-medium whitespace-nowrap">✓ Done</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

