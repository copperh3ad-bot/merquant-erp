import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StatCard from "@/components/shared/StatCard";
import { ClipboardList, Plus, Loader2, CheckCircle2, Search, ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import POSelector from "@/components/shared/POSelector";

const JC_STATUSES = ["Pending", "In Progress", "Completed", "On Hold", "Cancelled"];
const STEP_STATUSES = ["Pending", "In Progress", "Completed", "On Hold", "Cancelled"];

function StepRow({ step, onUpdate, onSave }) {
  const [local, setLocal] = useState(step);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setLocal(step); setDirty(false); }, [step.id, step.updated_at]);
  const u = (k, v) => { setLocal(p => ({ ...p, [k]: v })); setDirty(true); };
  const badgeColor = {
    "Completed": "bg-emerald-100 text-emerald-700",
    "In Progress": "bg-amber-100 text-amber-700",
    "Pending": "bg-slate-100 text-slate-600",
    "On Hold": "bg-orange-100 text-orange-700",
    "Cancelled": "bg-red-100 text-red-700"
  }[local.status] || "bg-slate-100";

  return (
    <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground w-6">#{local.step_number}</span>
        <span className="text-sm font-medium flex-1">{local.step_name}</span>
        <Badge className={`${badgeColor} text-xs`}>{local.status}</Badge>
      </div>
      <div className="grid grid-cols-6 gap-2 text-xs">
        <div className="col-span-2">
          <Label className="text-[10px]">Card Number (manual)</Label>
          <Input value={local.card_number || ""} onChange={e => u("card_number", e.target.value)} placeholder="e.g. YB-001" className="h-7 text-xs"/>
        </div>
        <div className="col-span-2">
          <Label className="text-[10px]">Assigned To</Label>
          <Input value={local.assigned_to || ""} onChange={e => u("assigned_to", e.target.value)} className="h-7 text-xs"/>
        </div>
        <div>
          <Label className="text-[10px]">Qty Issued</Label>
          <Input type="number" value={local.quantity_issued || ""} onChange={e => u("quantity_issued", e.target.value)} className="h-7 text-xs"/>
        </div>
        <div>
          <Label className="text-[10px]">Qty Recvd</Label>
          <Input type="number" value={local.quantity_received || ""} onChange={e => u("quantity_received", e.target.value)} className="h-7 text-xs"/>
        </div>
        <div>
          <Label className="text-[10px]">Start</Label>
          <Input type="date" value={local.start_date || ""} onChange={e => u("start_date", e.target.value)} className="h-7 text-xs"/>
        </div>
        <div>
          <Label className="text-[10px]">End</Label>
          <Input type="date" value={local.end_date || ""} onChange={e => u("end_date", e.target.value)} className="h-7 text-xs"/>
        </div>
        <div className="col-span-2">
          <Label className="text-[10px]">Status</Label>
          <Select value={local.status || "Pending"} onValueChange={v => u("status", v)}>
            <SelectTrigger className="h-7 text-xs"><SelectValue/></SelectTrigger>
            <SelectContent>{STEP_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2 flex items-end">
          <Button size="sm" className="h-7 text-xs w-full" disabled={!dirty} onClick={() => onSave(local)}>Save Step</Button>
        </div>
      </div>
      <Textarea value={local.notes || ""} onChange={e => u("notes", e.target.value)} rows={1} placeholder="Notes…" className="text-xs"/>
    </div>
  );
}

function JobCardForm({ open, onOpenChange, onSave, initialData, pos }) {
  const [form, setForm] = useState({
    job_card_number: "", po_id: "__none", article_name: "", article_code: "",
    fabric_details: "", yarn_details: "", quantity: "",
    start_date: "", due_date: "", status: "Pending", notes: ""
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          job_card_number: "", po_id: "__none", article_name: "", article_code: "",
          fabric_details: "", yarn_details: "", quantity: "",
          start_date: "", due_date: "", status: "Pending", notes: "",
          ...initialData,
          po_id: initialData.po_id || "__none"
        });
      } else {
        setForm({
          job_card_number: "", po_id: "__none", article_name: "", article_code: "",
          fabric_details: "", yarn_details: "", quantity: "",
          start_date: "", due_date: "", status: "Pending", notes: ""
        });
      }
    }
  }, [open, initialData]);

  const u = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    setSaving(true);
    const payload = { ...form, po_id: form.po_id === "__none" ? null : form.po_id };
    await onSave(payload);
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData ? "Edit Job Card" : "New Job Card"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1.5"><Label className="text-xs">Job Card Number (manual)</Label><Input value={form.job_card_number} onChange={e => u("job_card_number", e.target.value)} placeholder="e.g. JC-2026-001"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Purchase Order</Label>
            <Select value={form.po_id} onValueChange={v => u("po_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select PO"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None —</SelectItem>
                {pos.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Article Name</Label><Input value={form.article_name} onChange={e => u("article_name", e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Article Code</Label><Input value={form.article_code} onChange={e => u("article_code", e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Quantity</Label><Input type="number" value={form.quantity} onChange={e => u("quantity", e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status || "Pending"} onValueChange={v => u("status", v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{JC_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Start Date</Label><Input type="date" value={form.start_date} onChange={e => u("start_date", e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Due Date</Label><Input type="date" value={form.due_date} onChange={e => u("due_date", e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Fabric Details</Label><Textarea value={form.fabric_details} onChange={e => u("fabric_details", e.target.value)} rows={2}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Yarn Details</Label><Textarea value={form.yarn_details} onChange={e => u("yarn_details", e.target.value)} rows={2}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => u("notes", e.target.value)} rows={2}/></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={submit}>{saving ? "Saving…" : "Save Job Card"}</Button>
        </div>
        {!initialData && <p className="text-xs text-muted-foreground mt-2">Note: 7 default process steps (Yarn Booking → Ready to Ship) will be auto-created. You can edit each step's card number, assignee, quantities, and dates after saving.</p>}
      </DialogContent>
    </Dialog>
  );
}

export default function JobCards() {
  const [searchParams] = useSearchParams();
  const [jcs, setJcs] = useState([]);
  const [pos, setPos] = useState([]);
  const [stepsMap, setStepsMap] = useState({}); // parent_id -> [steps]
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "__all");
  const [filterStatus, setFilterStatus] = useState("All");
  const [expanded, setExpanded] = useState({}); // parent_id -> bool

  const load = async () => {
    setLoading(true);
    const [jc, po, steps] = await Promise.all([
      supabase.from("job_cards").select("*").order("created_at", { ascending: false }),
      supabase.from("purchase_orders").select("id, po_number, customer_name").order("po_number"),
      supabase.from("job_card_steps").select("*").order("step_number")
    ]);
    setJcs(jc.data || []);
    setPos(po.data || []);
    const m = {};
    (steps.data || []).forEach(s => {
      if (!m[s.parent_job_card_id]) m[s.parent_job_card_id] = [];
      m[s.parent_job_card_id].push(s);
    });
    setStepsMap(m);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    total: jcs.length,
    active: jcs.filter(j => j.status !== "Completed" && j.status !== "Cancelled").length,
    inProgress: jcs.filter(j => j.status === "In Progress").length,
    completed: jcs.filter(j => j.status === "Completed").length
  }), [jcs]);

  const filtered = useMemo(() => jcs.filter(j => {
    if (search && !`${j.job_card_number} ${j.po_number || ""} ${j.article_name} ${j.article_code}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (poFilter !== "__all" && j.po_id !== poFilter) return false;
    if (filterStatus !== "All" && j.status !== filterStatus) return false;
    return true;
  }), [jcs, search, poFilter, filterStatus]);

  const handleSave = async (payload) => {
    const po = pos.find(p => p.id === payload.po_id);
    const fullPayload = { ...payload, po_number: po?.po_number || null, customer_name: po?.customer_name || null };
    if (editing) {
      await supabase.from("job_cards").update(fullPayload).eq("id", editing.id);
    } else {
      await supabase.from("job_cards").insert(fullPayload);
    }
    setEditing(null);
    await load();
  };

  const handleSaveStep = async (step) => {
    const { id, ...upd } = step;
    upd.quantity_issued = upd.quantity_issued === "" ? null : upd.quantity_issued;
    upd.quantity_received = upd.quantity_received === "" ? null : upd.quantity_received;
    upd.updated_at = new Date().toISOString();
    await supabase.from("job_card_steps").update(upd).eq("id", id);
    await load();
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this job card and all its steps?")) return;
    await supabase.from("job_cards").delete().eq("id", id);
    await load();
  };

  const toggleExpand = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Job Cards</h1><p className="text-sm text-muted-foreground">Nested job cards with 7-stage process tracking.</p></div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="h-4 w-4 mr-2"/>New Job Card</Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard title="Active" value={stats.active} icon={ClipboardList} iconBg="bg-primary/10"/>
        <StatCard title="In Progress" value={stats.inProgress} icon={Loader2} iconBg="bg-amber-100"/>
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Total" value={stats.total} icon={ClipboardList} iconBg="bg-muted/50"/>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
              <Input placeholder="Search job card, PO, article…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm"/>
            </div>
            <Select value={poFilter} onValueChange={setPoFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="All POs"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All POs</SelectItem>
                {pos.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px]"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Statuses</SelectItem>
                {JC_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading ? <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></div>
            : filtered.length === 0 ? <p className="text-center text-sm text-muted-foreground py-8">No job cards. Click "New Job Card" to create one.</p>
            : <div className="space-y-2">
                {filtered.map(j => {
                  const steps = stepsMap[j.id] || [];
                  const completedSteps = steps.filter(s => s.status === "Completed").length;
                  const isOpen = expanded[j.id];
                  return (
                    <div key={j.id} className="border rounded-lg">
                      <div className="p-3 flex items-center gap-3 hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpand(j.id)}>
                        {isOpen ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                        <div className="flex-1 grid grid-cols-5 gap-3 text-sm">
                          <div><span className="font-semibold">{j.job_card_number || "—"}</span></div>
                          <div className="text-muted-foreground">{j.po_number || "—"}</div>
                          <div>{j.article_name || "—"}</div>
                          <div>{j.quantity || "—"} pcs</div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{j.status}</Badge>
                            <span className="text-xs text-muted-foreground">{completedSteps}/{steps.length} steps</span>
                          </div>
                        </div>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(j); setShowForm(true); }}><Pencil className="h-3.5 w-3.5"/></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => handleDelete(j.id)}><Trash2 className="h-3.5 w-3.5"/></Button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="border-t p-3 bg-muted/10 space-y-2">
                          {steps.length === 0 ? <p className="text-xs text-muted-foreground text-center py-2">No steps — refresh page if just created.</p>
                            : steps.map(s => <StepRow key={s.id} step={s} onSave={handleSaveStep}/>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
          }
        </CardContent>
      </Card>

      <JobCardForm open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditing(null); }} onSave={handleSave} initialData={editing} pos={pos}/>
    </div>
  );
}
