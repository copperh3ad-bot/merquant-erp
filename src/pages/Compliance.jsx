import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, compliance } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert, Plus, Pencil, Trash2, Search, AlertCircle, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { format, isPast, addDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";

const DOC_TYPES = ["OEKO-TEX","REACH","Test Report","Wash Care Approval","Certificate of Origin","Factory Audit","ISO Cert","Other"];
const STATUSES = ["Pending","Received","Valid","Expired","Rejected"];
const STATUS_STYLES = {
  "Valid":    "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Received": "bg-blue-50 text-blue-700 border-blue-200",
  "Pending":  "bg-amber-50 text-amber-700 border-amber-200",
  "Expired":  "bg-red-50 text-red-700 border-red-200",
  "Rejected": "bg-red-50 text-red-700 border-red-200",
};
const fmt = (d) => { try { return d?format(new Date(d),"dd MMM yy"):"—"; } catch { return "—"; } };
const empty = { po_id:"", article_code:"", doc_type:"Test Report", doc_number:"", issued_by:"", issue_date:"", expiry_date:"", status:"Pending", file_url:"", notes:"" };

function ComplianceForm({ open, onOpenChange, onSave, initialData, pos }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v)=>setForm(p=>({...p,[k]:v}));
  React.useEffect(()=>{ if(open) setForm(initialData?{...empty,...initialData}:empty); },[open,initialData]);
  const handleSave = async()=>{ setSaving(true); try { await onSave(form); } finally { setSaving(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData?"Edit Document":"Add Compliance Document"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">PO (optional)</Label>
            <Select value={form.po_id || "__none"} onValueChange={v=>u("po_id",v||null)}>
              <SelectTrigger><SelectValue placeholder="Not linked to specific PO"/></SelectTrigger>
              <SelectContent><SelectItem value="__none">Not linked</SelectItem>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Document Type</Label>
            <Select value={form.doc_type} onValueChange={v=>u("doc_type",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{DOC_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Document Number</Label><Input value={form.doc_number} onChange={e=>u("doc_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Article Code</Label><Input value={form.article_code} onChange={e=>u("article_code",e.target.value)} placeholder="Applicable SKU"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Issued By</Label><Input value={form.issued_by} onChange={e=>u("issued_by",e.target.value)} placeholder="SGS, Intertek…"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Issue Date</Label><Input type="date" value={form.issue_date} onChange={e=>u("issue_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Expiry Date</Label><Input type="date" value={form.expiry_date} onChange={e=>u("expiry_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">File URL</Label><Input value={form.file_url} onChange={e=>u("file_url",e.target.value)} placeholder="https://drive.google.com/…"/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving?"Saving…":"Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CompliancePage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "");
  const qc = useQueryClient();

  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: docs=[], isLoading } = useQuery({ queryKey:["compliance"], queryFn:()=>compliance.list() });

  const handleSave = async(data) => {
    const po = pos.find(p=>p.id===data.po_id);
    if (editing) { await compliance.update(editing.id,{...data,po_number:po?.po_number||""}); }
    else { await compliance.create({...data,po_number:po?.po_number||""}); }
    qc.invalidateQueries({queryKey:["compliance"]});
    setShowForm(false); setEditing(null);
  };
  const handleDelete = async(id)=>{ if(!confirm("Delete?"))return; await compliance.delete(id); qc.invalidateQueries({queryKey:["compliance"]}); };

  const today = new Date();
  const filtered = useMemo(()=>docs.filter(d=>(!poFilter||d.po_id===poFilter)&&(!search||d.doc_type?.toLowerCase().includes(search.toLowerCase())||d.article_code?.toLowerCase().includes(search.toLowerCase())||d.doc_number?.toLowerCase().includes(search.toLowerCase()))),[docs,search,poFilter]);
  const stats = useMemo(()=>({
    valid: docs.filter(d=>d.status==="Valid"||d.status==="Received").length,
    expiringSoon: docs.filter(d=>d.expiry_date&&isPast(addDays(new Date(d.expiry_date),-30))&&!isPast(new Date(d.expiry_date))).length,
    expired: docs.filter(d=>d.expiry_date&&isPast(new Date(d.expiry_date))).length,
    pending: docs.filter(d=>d.status==="Pending").length,
  }),[docs]);

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><ShieldAlert className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Compliance Documents</h1></div>
        <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}}><Plus className="h-4 w-4 mr-1.5"/>Add Document</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Valid" value={stats.valid} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Expiring Soon" value={stats.expiringSoon} icon={Clock} iconBg="bg-amber-100" subtitle="within 30 days"/>
        <StatCard title="Expired" value={stats.expired} icon={AlertCircle} iconBg="bg-red-100"/>
        <StatCard title="Pending" value={stats.pending} icon={Clock} iconBg="bg-blue-100"/>
      </div>
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search type, article, doc number…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
      </div>
      {filtered.length===0?<EmptyState icon={ShieldAlert} title="No compliance documents" description="Track OEKO-TEX, REACH, test reports, and other compliance certificates here." actionLabel="Add Document" onAction={()=>setShowForm(true)}/>:(
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {["Type","Doc Number","Article","Issued By","Issue Date","Expiry","Status",""].map(h=><TableHead key={h} className="text-xs">{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(d=>{
                  const expiring = d.expiry_date&&isPast(addDays(new Date(d.expiry_date),-30))&&!isPast(new Date(d.expiry_date));
                  const expired = d.expiry_date&&isPast(new Date(d.expiry_date));
                  return (
                    <TableRow key={d.id} className={cn("hover:bg-muted/30",expired&&"bg-red-50/30",expiring&&"bg-amber-50/30")}>
                      <TableCell className="text-xs font-medium">{d.doc_type}</TableCell>
                      <TableCell className="text-xs font-mono">{d.doc_number||"—"}</TableCell>
                      <TableCell className="text-xs">{d.article_code||"All"}</TableCell>
                      <TableCell className="text-xs">{d.issued_by||"—"}</TableCell>
                      <TableCell className="text-xs">{fmt(d.issue_date)}</TableCell>
                      <TableCell className={cn("text-xs",expired?"text-red-600 font-semibold":expiring?"text-amber-600 font-medium":"")}>{fmt(d.expiry_date)}{expiring&&" ⚠"}{expired&&" ✕"}</TableCell>
                      <TableCell><span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border",STATUS_STYLES[d.status]||"")}>{d.status}</span></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {d.file_url&&<a href={d.file_url} target="_blank" rel="noreferrer"><Button variant="ghost" size="icon" className="h-6 w-6"><ExternalLink className="h-3 w-3 text-muted-foreground"/></Button></a>}
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>{setEditing(d);setShowForm(true);}}><Pencil className="h-3 w-3 text-muted-foreground"/></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>handleDelete(d.id)}><Trash2 className="h-3 w-3 text-muted-foreground"/></Button>
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
      <ComplianceForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} pos={pos}/>
    </div>
  );
}

