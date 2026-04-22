import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, qcInspections } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Plus, Pencil, Trash2, Search, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";
import POSelector from "@/components/shared/POSelector";

const TYPES = ["In-line","Final","Pre-shipment","Third-party","AQL","Factory Audit"];
const AQL_LEVELS = ["0.65","1.0","1.5","2.5","4.0","6.5"];
const VERDICTS = ["Pass","Fail","Conditional Pass","Pending"];
const COMPANIES = ["In-house","SGS","Intertek","Bureau Veritas","QIMA","TUV","Other"];
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };

const VERDICT_STYLES = {
  "Pass":             "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Fail":             "bg-red-50 text-red-700 border-red-200",
  "Conditional Pass": "bg-amber-50 text-amber-700 border-amber-200",
  "Pending":          "bg-gray-50 text-gray-600 border-gray-200",
};

const empty = { po_id:"", inspection_type:"Final", inspection_date:"", inspector_name:"", inspection_company:"In-house", aql_level:"2.5", sample_size:"", qty_offered:"", qty_passed:"", critical_defects:0, major_defects:0, minor_defects:0, verdict:"Pending", report_url:"", re_inspection_required:false, notes:"" };

function QCForm({ open, onOpenChange, onSave, initialData, pos }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p=>({...p,[k]:v}));
  React.useEffect(()=>{ if(open) setForm(initialData?{...empty,...initialData}:empty); },[open,initialData]);
  const handleSave = async () => {
    setSaving(true);
    try { await onSave({...form, sample_size:Number(form.sample_size)||null, qty_offered:Number(form.qty_offered)||null, qty_passed:Number(form.qty_passed)||null, critical_defects:Number(form.critical_defects)||0, major_defects:Number(form.major_defects)||0, minor_defects:Number(form.minor_defects)||0}); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData?"Edit Inspection":"New QC Inspection"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">PO</Label>
            <Select value={form.po_id} onValueChange={v=>u("po_id",v)}>
              <SelectTrigger><SelectValue placeholder="Select PO"/></SelectTrigger>
              <SelectContent>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Inspection Type</Label>
            <Select value={form.inspection_type} onValueChange={v=>u("inspection_type",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Inspection Date</Label><Input type="date" value={form.inspection_date} onChange={e=>u("inspection_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Inspector Name</Label><Input value={form.inspector_name} onChange={e=>u("inspector_name",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Company</Label>
            <Select value={form.inspection_company} onValueChange={v=>u("inspection_company",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{COMPANIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">AQL Level</Label>
            <Select value={form.aql_level} onValueChange={v=>u("aql_level",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{AQL_LEVELS.map(l=><SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Qty Offered</Label><Input type="number" value={form.qty_offered} onChange={e=>u("qty_offered",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Sample Size</Label><Input type="number" value={form.sample_size} onChange={e=>u("sample_size",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Critical Defects</Label><Input type="number" value={form.critical_defects} onChange={e=>u("critical_defects",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Major Defects</Label><Input type="number" value={form.major_defects} onChange={e=>u("major_defects",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Minor Defects</Label><Input type="number" value={form.minor_defects} onChange={e=>u("minor_defects",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Verdict</Label>
            <Select value={form.verdict} onValueChange={v=>u("verdict",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{VERDICTS.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Report URL</Label><Input value={form.report_url} onChange={e=>u("report_url",e.target.value)} placeholder="https://..."/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={form.re_inspection_required} onChange={e=>u("re_inspection_required",e.target.checked)} className="w-4 h-4"/>
            <Label className="text-xs">Re-inspection required</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving?"Saving…":"Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function QCInspectionsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "__all");
  const qc = useQueryClient();

  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: inspections=[], isLoading } = useQuery({ queryKey:["qcInspections"], queryFn:()=>qcInspections.list() });

  const handleSave = async (data) => {
    const po = pos.find(p=>p.id===data.po_id);
    const payload = {...data, po_number:po?.po_number||""};
    if (editing) { await qcInspections.update(editing.id,payload); } else { await qcInspections.create(payload); }
    qc.invalidateQueries({queryKey:["qcInspections"]});
    setShowForm(false); setEditing(null);
  };
  const handleDelete = async (id) => { if(!confirm("Delete?"))return; await qcInspections.delete(id); qc.invalidateQueries({queryKey:["qcInspections"]}); };

  const filtered = useMemo(() => inspections.filter(i => (poFilter==="__all"||i.po_id===poFilter)&&(!search||i.po_number?.toLowerCase().includes(search.toLowerCase())||i.inspector_name?.toLowerCase().includes(search.toLowerCase()))), [inspections,search,poFilter]);
  const stats = useMemo(() => ({ pass:inspections.filter(i=>i.verdict==="Pass").length, fail:inspections.filter(i=>i.verdict==="Fail").length, pending:inspections.filter(i=>i.verdict==="Pending").length, total:inspections.length }), [inspections]);

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">QC Inspections</h1></div>
        <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}}><Plus className="h-4 w-4 mr-1.5"/>New Inspection</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Pass" value={stats.pass} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Fail" value={stats.fail} icon={XCircle} iconBg="bg-red-100"/>
        <StatCard title="Pending" value={stats.pending} icon={AlertCircle} iconBg="bg-amber-100"/>
        <StatCard title="Total" value={stats.total} icon={ShieldCheck} iconBg="bg-primary/10"/>
      </div>
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search PO, inspector…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
      </div>
      {filtered.length===0 ? <EmptyState icon={ShieldCheck} title="No inspections yet" description="Log QC inspections with AQL results here." actionLabel="Add Inspection" onAction={()=>setShowForm(true)}/> : (
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {["PO","Type","Date","Inspector","Company","AQL","Qty Offered","Critical","Major","Minor","Verdict","Re-inspect",""].map(h=><TableHead key={h} className="text-xs">{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(i=>(
                  <TableRow key={i.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-medium text-primary">{i.po_number}</TableCell>
                    <TableCell className="text-xs">{i.inspection_type}</TableCell>
                    <TableCell className="text-xs">{fmt(i.inspection_date)}</TableCell>
                    <TableCell className="text-xs">{i.inspector_name||"—"}</TableCell>
                    <TableCell className="text-xs">{i.inspection_company||"—"}</TableCell>
                    <TableCell className="text-xs">{i.aql_level}</TableCell>
                    <TableCell className="text-xs">{i.qty_offered?.toLocaleString()||"—"}</TableCell>
                    <TableCell className={cn("text-xs font-semibold",(i.critical_defects||0)>0?"text-red-600":"")}>{i.critical_defects||0}</TableCell>
                    <TableCell className={cn("text-xs",(i.major_defects||0)>0?"text-amber-600":"")}>{i.major_defects||0}</TableCell>
                    <TableCell className="text-xs">{i.minor_defects||0}</TableCell>
                    <TableCell><span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border",VERDICT_STYLES[i.verdict]||"")}>{i.verdict}</span></TableCell>
                    <TableCell className="text-xs">{i.re_inspection_required?"Yes":""}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>{setEditing(i);setShowForm(true);}}><Pencil className="h-3 w-3 text-muted-foreground"/></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>handleDelete(i.id)}><Trash2 className="h-3 w-3 text-muted-foreground"/></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent></Card>
      )}
      <QCForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} pos={pos}/>
    </div>
  );
}

