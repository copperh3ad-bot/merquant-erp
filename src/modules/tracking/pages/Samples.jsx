import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, samples } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Package2, Plus, Pencil, Trash2, Search, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";
import POSelector from "@/components/shared/POSelector";

const SAMPLE_TYPES = ["Development","Fit","Size Set","Pre-Production","Top of Production","Salesmen","Photo","Counter","Other"];
const STATUSES = ["Pending","Dispatched","Delivered","Approved","Rejected","Amendment Required","Hold"];
const STATUS_STYLES = {
  "Approved":            "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Dispatched":          "bg-blue-50 text-blue-700 border-blue-200",
  "Delivered":           "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Rejected":            "bg-red-50 text-red-700 border-red-200",
  "Amendment Required":  "bg-amber-50 text-amber-700 border-amber-200",
  "Pending":             "bg-gray-50 text-gray-600 border-gray-200",
  "Hold":                "bg-orange-50 text-orange-700 border-orange-200",
};
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };
const empty = { po_id:"", style_number:"", article_name:"", sample_type:"Development", round_number:1, dispatch_date:"", courier:"", tracking_number:"", expected_feedback_date:"", actual_feedback_date:"", buyer_comments:"", status:"Pending", internal_notes:"" };

function SampleForm({ open, onOpenChange, onSave, initialData, pos }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p => ({ ...p, [k]:v }));
  React.useEffect(() => { if (open) setForm(initialData ? {...empty,...initialData} : empty); }, [open, initialData]);
  const handleSave = async () => { setSaving(true); try { await onSave({...form, round_number:Number(form.round_number)||1}); } finally { setSaving(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData ? "Edit Sample" : "New Sample Record"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">PO</Label>
            <Select value={form.po_id} onValueChange={v => u("po_id",v)}>
              <SelectTrigger><SelectValue placeholder="Select PO" /></SelectTrigger>
              <SelectContent>{pos.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {[["style_number","Style Number",""],["article_name","Article / Description","Men Polo Shirt"]].map(([k,l,ph]) => (
            <div key={k} className="space-y-1.5"><Label className="text-xs">{l}</Label><Input value={form[k]} onChange={e=>u(k,e.target.value)} placeholder={ph}/></div>
          ))}
          <div className="space-y-1.5"><Label className="text-xs">Sample Type</Label>
            <Select value={form.sample_type} onValueChange={v=>u("sample_type",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{SAMPLE_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Round #</Label><Input type="number" min="1" value={form.round_number} onChange={e=>u("round_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Dispatch Date</Label><Input type="date" value={form.dispatch_date} onChange={e=>u("dispatch_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Expected Feedback</Label><Input type="date" value={form.expected_feedback_date} onChange={e=>u("expected_feedback_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Courier</Label><Input value={form.courier} onChange={e=>u("courier",e.target.value)} placeholder="DHL / FedEx"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Tracking Number</Label><Input value={form.tracking_number} onChange={e=>u("tracking_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Actual Feedback Date</Label><Input type="date" value={form.actual_feedback_date} onChange={e=>u("actual_feedback_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Buyer Comments</Label><Textarea value={form.buyer_comments} onChange={e=>u("buyer_comments",e.target.value)} rows={2} placeholder="Buyer feedback..."/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Internal Notes</Label><Textarea value={form.internal_notes} onChange={e=>u("internal_notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving?"Saving…":"Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SamplesPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "__all");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const qc = useQueryClient();

  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: sampleList=[], isLoading } = useQuery({ queryKey:["samples"], queryFn:()=>samples.list() });

  const handleSave = async (data) => {
    const po = pos.find(p=>p.id===data.po_id);
    const payload = { ...data, po_number: po?.po_number||"" };
    if (editing) { await samples.update(editing.id, payload); } else { await samples.create(payload); }
    qc.invalidateQueries({ queryKey:["samples"] });
    setShowForm(false); setEditing(null);
  };
  const handleDelete = async (id) => { if (!confirm("Delete?")) return; await samples.delete(id); qc.invalidateQueries({ queryKey:["samples"] }); };

  const filtered = useMemo(() => sampleList.filter(s => {
    const mpo = poFilter==="__all" || s.po_id === poFilter;
    const ms = filterStatus==="All"||s.status===filterStatus;
    const mt = filterType==="All"||s.sample_type===filterType;
    const mq = !search||s.article_name?.toLowerCase().includes(search.toLowerCase())||s.po_number?.toLowerCase().includes(search.toLowerCase())||s.style_number?.toLowerCase().includes(search.toLowerCase());
    return mpo&&ms&&mt&&mq&&ma;
  }), [sampleList,filterStatus,filterType,search,poFilter,articleFilter]);

  const stats = useMemo(() => ({
    awaiting: sampleList.filter(s=>["Dispatched","Delivered"].includes(s.status)).length,
    overdue: sampleList.filter(s=>s.expected_feedback_date&&new Date(s.expected_feedback_date)<new Date()&&!["Approved","Rejected"].includes(s.status)).length,
    approved: sampleList.filter(s=>s.status==="Approved").length,
    total: sampleList.length,
  }), [sampleList]);

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Package2 className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Sample Tracking</h1></div>
        <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}}><Plus className="h-4 w-4 mr-1.5"/>Add Sample</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Awaiting Feedback" value={stats.awaiting} icon={Clock} iconBg="bg-blue-100"/>
        <StatCard title="Overdue Response" value={stats.overdue} icon={AlertCircle} iconBg="bg-red-100"/>
        <StatCard title="Approved" value={stats.approved} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Total Samples" value={stats.total} icon={Package2} iconBg="bg-primary/10"/>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search style, article, PO…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40 h-9 text-sm"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="All">All Types</SelectItem>{SAMPLE_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 h-9 text-sm"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="All">All Statuses</SelectItem>{STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {filtered.length===0 ? <EmptyState icon={Package2} title="No samples yet" description="Track development, fit, PP and TOP samples here." actionLabel="Add Sample" onAction={()=>setShowForm(true)}/> : (
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {["PO","Type","Article","Round","Dispatched","Expected","Courier","Tracking","Status","Days Waiting",""].map(h=><TableHead key={h} className="text-xs">{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(s=>{
                  const waiting = s.dispatch_date&&!["Approved","Rejected"].includes(s.status)?differenceInDays(new Date(),new Date(s.dispatch_date)):null;
                  const overdue = s.expected_feedback_date&&new Date(s.expected_feedback_date)<new Date()&&!["Approved","Rejected"].includes(s.status);
                  return (
                    <TableRow key={s.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium text-primary">{s.po_number}</TableCell>
                      <TableCell className="text-xs">{s.sample_type}</TableCell>
                      <TableCell className="text-xs max-w-[130px] truncate">{s.article_name||"—"}</TableCell>
                      <TableCell className="text-xs text-center">R{s.round_number}</TableCell>
                      <TableCell className="text-xs">{fmt(s.dispatch_date)}</TableCell>
                      <TableCell className={cn("text-xs",overdue?"text-red-600 font-medium":"")}>{fmt(s.expected_feedback_date)}</TableCell>
                      <TableCell className="text-xs">{s.courier||"—"}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{s.tracking_number||"—"}</TableCell>
                      <TableCell><span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border",STATUS_STYLES[s.status]||"bg-gray-50 text-gray-600 border-gray-200")}>{s.status}</span></TableCell>
                      <TableCell className={cn("text-xs",waiting>7?"text-red-600 font-semibold":"text-muted-foreground")}>{waiting!==null?`${waiting}d`:"—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>{setEditing(s);setShowForm(true);}}><Pencil className="h-3 w-3 text-muted-foreground"/></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>handleDelete(s.id)}><Trash2 className="h-3 w-3 text-muted-foreground"/></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent></Card>
      )}
      <SampleForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} pos={pos}/>
    </div>
  );
}

