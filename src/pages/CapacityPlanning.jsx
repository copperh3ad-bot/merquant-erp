import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db, production } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Factory, Plus, Pencil, Trash2, Calendar, AlertTriangle, Settings } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  planned:     "bg-gray-100 text-gray-700 border-gray-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  completed:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  on_hold:     "bg-amber-100 text-amber-700 border-amber-200",
};

const PRIORITY_LABELS = { 1: "Rush", 2: "High", 3: "Normal", 4: "Low", 5: "Backlog" };
const PRIORITY_STYLES = {
  1: "bg-red-100 text-red-700 border-red-200",
  2: "bg-orange-100 text-orange-700 border-orange-200",
  3: "bg-gray-100 text-gray-700 border-gray-200",
  4: "bg-blue-50 text-blue-700 border-blue-200",
  5: "bg-slate-100 text-slate-600 border-slate-200",
};

function PlanForm({ open, onOpenChange, onSave, initial, pos, lines, stages }) {
  const [f, setF] = useState(initial || {
    po_id: "", article_code: "", line_id: "", stage_id: "",
    planned_qty: 0, start_date: "", end_date: "", priority: 3, status: "planned", notes: "",
  });
  const u = (k, v) => setF(p => ({ ...p, [k]: v }));

  const selectedPo = pos.find(p => p.id === f.po_id);

  const handleSave = () => {
    if (!f.po_id || !f.line_id || !f.stage_id || !f.planned_qty) {
      alert("PO, Line, Stage and Planned Quantity are required");
      return;
    }
    const payload = {
      ...f,
      po_number: selectedPo?.po_number || "",
      planned_qty: Number(f.planned_qty) || 0,
      priority: Number(f.priority) || 3,
    };
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{initial?.id ? "Edit" : "New"} Capacity Plan</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2"><Label className="text-xs">Purchase Order</Label>
            <Select value={f.po_id} onValueChange={v => u("po_id", v)}>
              <SelectTrigger><SelectValue placeholder="Choose PO"/></SelectTrigger>
              <SelectContent>{pos.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Article Code</Label><Input value={f.article_code||""} onChange={e=>u("article_code", e.target.value)} placeholder="optional"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Planned Qty</Label><Input type="number" value={f.planned_qty} onChange={e=>u("planned_qty", e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Line</Label>
            <Select value={f.line_id} onValueChange={v => u("line_id", v)}>
              <SelectTrigger><SelectValue placeholder="Choose line"/></SelectTrigger>
              <SelectContent>{lines.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.line_type}, {l.daily_capacity}/day)</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Stage</Label>
            <Select value={f.stage_id} onValueChange={v => u("stage_id", v)}>
              <SelectTrigger><SelectValue placeholder="Choose stage"/></SelectTrigger>
              <SelectContent>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.stage_order}. {s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Start Date</Label><Input type="date" value={f.start_date||""} onChange={e=>u("start_date", e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">End Date</Label><Input type="date" value={f.end_date||""} onChange={e=>u("end_date", e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Priority</Label>
            <Select value={String(f.priority)} onValueChange={v => u("priority", Number(v))}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n} — {PRIORITY_LABELS[n]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={f.status} onValueChange={v => u("status", v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["planned","in_progress","completed","on_hold"].map(s => <SelectItem key={s} value={s}>{s.replace("_"," ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2"><Label className="text-xs">Notes</Label><Textarea rows={2} value={f.notes||""} onChange={e=>u("notes", e.target.value)}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineManagerDialog({ open, onOpenChange }) {
  const qc = useQueryClient();
  const { data: lines = [], isLoading } = useQuery({ queryKey: ["prodLines"], queryFn: () => production.lines.list(false) });
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const blank = { name: "", line_type: "stitching", daily_capacity: 0, operator_count: 0, is_active: true, notes: "" };
  const [f, setF] = useState(blank);
  const u = (k, v) => setF(p => ({ ...p, [k]: v }));

  const openNew  = () => { setEditing(null); setF(blank); setShowForm(true); };
  const openEdit = (l) => { setEditing(l); setF({ ...blank, ...l }); setShowForm(true); };

  const handleSave = async () => {
    if (!f.name.trim()) { alert("Name required"); return; }
    const payload = { ...f, daily_capacity: Number(f.daily_capacity) || 0, operator_count: Number(f.operator_count) || 0 };
    if (editing?.id) await production.lines.update(editing.id, payload);
    else             await production.lines.create(payload);
    qc.invalidateQueries({ queryKey: ["prodLines"] });
    setShowForm(false);
  };
  const handleDelete = async (id) => {
    if (!confirm("Delete this line? Existing plans will lose their line reference.")) return;
    await production.lines.delete(id);
    qc.invalidateQueries({ queryKey: ["prodLines"] });
  };
  const toggleActive = async (l) => {
    await production.lines.update(l.id, { is_active: !l.is_active });
    qc.invalidateQueries({ queryKey: ["prodLines"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Manage Production Lines</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{lines.length} line{lines.length !== 1 ? "s" : ""} configured</p>
            <Button size="sm" onClick={openNew}><Plus className="h-3.5 w-3.5 mr-1"/>New Line</Button>
          </div>

          {isLoading ? <Skeleton className="h-32"/> : lines.length === 0 ? (
            <EmptyState icon={Factory} title="No lines yet" description="Add your first production line to start scheduling." actionLabel="Add Line" onAction={openNew}/>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[#1F3864] text-white"><tr>{["Name","Type","Capacity/day","Operators","Active",""].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id} className={cn("border-b", i % 2 === 0 && "bg-[#EBF0FA]", !l.is_active && "opacity-50")}>
                      <td className="px-3 py-2 font-medium">{l.name}</td>
                      <td className="px-3 py-2 capitalize">{l.line_type}</td>
                      <td className="px-3 py-2 tabular-nums">{l.daily_capacity?.toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums">{l.operator_count || "—"}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => toggleActive(l)} className={cn("text-[10px] px-1.5 py-0.5 rounded border", l.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-600 border-gray-200")}>
                          {l.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(l)}><Pencil className="h-3 w-3"/></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(l.id)}><Trash2 className="h-3 w-3"/></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Inline form */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Line</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label className="text-xs">Name</Label><Input value={f.name} onChange={e => u("name", e.target.value)} placeholder="e.g. Line 1, Stitching A"/></div>
              <div className="space-y-1.5"><Label className="text-xs">Type</Label>
                <Select value={f.line_type} onValueChange={v => u("line_type", v)}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{["cutting","stitching","finishing","packing"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Daily Capacity (pcs)</Label><Input type="number" value={f.daily_capacity} onChange={e => u("daily_capacity", e.target.value)}/></div>
              <div className="space-y-1.5"><Label className="text-xs">Operators</Label><Input type="number" value={f.operator_count} onChange={e => u("operator_count", e.target.value)}/></div>
              <div className="space-y-1.5 col-span-2"><Label className="text-xs">Notes</Label><Textarea rows={2} value={f.notes || ""} onChange={e => u("notes", e.target.value)}/></div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CapacityPlanning() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showLines, setShowLines] = useState(false);
  const [filterLine, setFilterLine] = useState("__all");
  const [filterStatus, setFilterStatus] = useState("__all");

  const { data: plans = [], isLoading } = useQuery({ queryKey: ["capacityPlans"], queryFn: () => production.capacity.list() });
  const { data: lines = [] }  = useQuery({ queryKey: ["prodLines"],  queryFn: () => production.lines.list() });
  const { data: stages = [] } = useQuery({ queryKey: ["prodStages"], queryFn: () => production.stages.list() });
  const { data: pos = [] }    = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list() });

  const filtered = useMemo(() => plans.filter(p =>
    (filterLine === "__all" || p.line_id === filterLine) &&
    (filterStatus === "__all" || p.status === filterStatus)
  ), [plans, filterLine, filterStatus]);

  // Per-line load: sum of planned qty ÷ line daily capacity × plan days
  const lineLoad = useMemo(() => {
    const m = {};
    for (const l of lines) m[l.id] = { line: l, planned: 0, days: 0, overloaded: false };
    for (const p of plans) {
      if (!m[p.line_id] || p.status === "completed") continue;
      m[p.line_id].planned += p.planned_qty || 0;
      if (p.start_date && p.end_date) {
        const d = Math.max(1, differenceInDays(new Date(p.end_date), new Date(p.start_date)) + 1);
        m[p.line_id].days = Math.max(m[p.line_id].days, d);
      }
    }
    for (const k of Object.keys(m)) {
      const { line, planned, days } = m[k];
      const capacity = (line.daily_capacity || 0) * (days || 1);
      m[k].utilization = capacity > 0 ? (planned / capacity) * 100 : 0;
      m[k].overloaded = m[k].utilization > 100;
    }
    return Object.values(m);
  }, [plans, lines]);

  const handleSave = async (data) => {
    if (editing?.id) await production.capacity.update(editing.id, data);
    else             await production.capacity.create(data);
    qc.invalidateQueries({ queryKey: ["capacityPlans"] });
    setShowForm(false); setEditing(null);
  };
  const handleDelete = async (id) => {
    if (!confirm("Delete this plan?")) return;
    await production.capacity.delete(id);
    qc.invalidateQueries({ queryKey: ["capacityPlans"] });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Factory className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Capacity Planning</h1></div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowLines(true)}><Settings className="h-4 w-4 mr-1.5"/>Manage Lines</Button>
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="h-4 w-4 mr-1.5"/>New Plan</Button>
        </div>
      </div>

      {/* Per-line load strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {lineLoad.map(({ line, planned, days, utilization, overloaded }) => (
          <Card key={line.id} className={cn(overloaded && "border-red-300")}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{line.name}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">{line.line_type} · {line.daily_capacity}/day</p>
                </div>
                {overloaded && <AlertTriangle className="h-4 w-4 text-red-600 shrink-0"/>}
              </div>
              <div className="mt-3">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">Load</span>
                  <span className={cn("font-bold", overloaded ? "text-red-700" : "text-foreground")}>{utilization.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                  <div className={cn("h-full rounded-full", overloaded ? "bg-red-500" : utilization > 80 ? "bg-amber-500" : "bg-emerald-500")}
                       style={{ width: `${Math.min(100, utilization)}%` }}/>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{planned.toLocaleString()} pcs across {days || 0}d</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Select value={filterLine} onValueChange={setFilterLine}>
          <SelectTrigger className="w-48 text-xs"><SelectValue placeholder="All lines"/></SelectTrigger>
          <SelectContent><SelectItem value="__all">All lines</SelectItem>{lines.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 text-xs"><SelectValue placeholder="All statuses"/></SelectTrigger>
          <SelectContent><SelectItem value="__all">All statuses</SelectItem>{["planned","in_progress","completed","on_hold"].map(s => <SelectItem key={s} value={s}>{s.replace("_"," ")}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? <Skeleton className="h-40"/> : filtered.length === 0 ? (
        <EmptyState icon={Calendar} title="No capacity plans" description="Create a plan to schedule production of a PO on a line." actionLabel="New Plan" onAction={() => { setEditing(null); setShowForm(true); }}/>
      ) : (
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#1F3864] text-white">
                <tr>
                  {["PO","Article","Line","Stage","Qty","Start","End","Pri","Status",""].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr key={p.id} className={cn("border-b", i % 2 === 0 && "bg-[#EBF0FA]")}>
                    <td className="px-3 py-2 font-medium">{p.po_number || "—"}</td>
                    <td className="px-3 py-2">{p.article_code || "—"}</td>
                    <td className="px-3 py-2">{p.line?.name || "—"}</td>
                    <td className="px-3 py-2">{p.stage?.name || "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{p.planned_qty?.toLocaleString()}</td>
                    <td className="px-3 py-2">{p.start_date ? format(new Date(p.start_date), "dd MMM") : "—"}</td>
                    <td className="px-3 py-2">{p.end_date ? format(new Date(p.end_date), "dd MMM") : "—"}</td>
                    <td className="px-3 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded border", PRIORITY_STYLES[p.priority])}>{PRIORITY_LABELS[p.priority] || "—"}</span></td>
                    <td className="px-3 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded border capitalize", STATUS_STYLES[p.status])}>{p.status.replace("_"," ")}</span></td>
                    <td className="px-3 py-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditing(p); setShowForm(true); }}><Pencil className="h-3 w-3"/></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(p.id)}><Trash2 className="h-3 w-3"/></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}

      <PlanForm open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditing(null); }} onSave={handleSave} initial={editing} pos={pos} lines={lines} stages={stages}/>
      <LineManagerDialog open={showLines} onOpenChange={setShowLines}/>
    </div>
  );
}
