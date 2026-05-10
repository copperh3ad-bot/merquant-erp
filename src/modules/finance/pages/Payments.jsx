import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, payments } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import PermissionGate from "@/components/shared/PermissionGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CreditCard, Plus, Pencil, Trash2, Search, DollarSign, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { format, isPast } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";

const PAYMENT_TYPES = ["Advance","Against Documents","Balance","LC Payment","LC","TT","Other"];
const STATUSES = ["Pending","Received","Overdue","Partial","Disputed"];
const STATUS_STYLES = {
  "Received": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Pending":  "bg-blue-50 text-blue-700 border-blue-200",
  "Overdue":  "bg-red-50 text-red-700 border-red-200",
  "Partial":  "bg-amber-50 text-amber-700 border-amber-200",
  "Disputed": "bg-orange-50 text-orange-700 border-orange-200",
};
const fmt = (d) => { try { return d?format(new Date(d),"dd MMM yy"):"—"; } catch { return "—"; } };
const empty = { po_id:"", payment_type:"Against Documents", lc_number:"", lc_bank:"", lc_expiry:"", amount:"", currency:"USD", expected_date:"", actual_date:"", status:"Pending", notes:"" };

function PaymentForm({ open, onOpenChange, onSave, initialData, pos }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p=>({...p,[k]:v}));
  React.useEffect(()=>{ if(open) setForm(initialData?{...empty,...initialData}:empty); },[open,initialData]);
  const handleSave = async () => { setSaving(true); try { await onSave({...form, amount:Number(form.amount)||null}); } finally { setSaving(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData?"Edit Payment":"New Payment"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">PO</Label>
            <Select value={form.po_id} onValueChange={v=>u("po_id",v)}>
              <SelectTrigger><SelectValue placeholder="Select PO"/></SelectTrigger>
              <SelectContent>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Payment Type</Label>
            <Select value={form.payment_type} onValueChange={v=>u("payment_type",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{PAYMENT_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Currency</Label>
            <Select value={form.currency} onValueChange={v=>u("currency",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["USD","EUR","GBP","INR","PKR","BDT"].map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Amount</Label><Input type="number" value={form.amount} onChange={e=>u("amount",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">LC Number</Label><Input value={form.lc_number} onChange={e=>u("lc_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">LC Bank</Label><Input value={form.lc_bank} onChange={e=>u("lc_bank",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">LC Expiry</Label><Input type="date" value={form.lc_expiry} onChange={e=>u("lc_expiry",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Expected Date</Label><Input type="date" value={form.expected_date} onChange={e=>u("expected_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Actual Received Date</Label><Input type="date" value={form.actual_date} onChange={e=>u("actual_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
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

export default function PaymentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "");
  const qc = useQueryClient();

  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: paymentList=[], isLoading } = useQuery({ queryKey:["payments"], queryFn:()=>payments.listAll() });

  const handleSave = async (data) => {
    const po = pos.find(p=>p.id===data.po_id);
    const payload = {...data, po_number:po?.po_number||""};
    if (editing) { await payments.update(editing.id,payload); } else { await payments.create(payload); }
    qc.invalidateQueries({queryKey:["payments"]});
    setShowForm(false); setEditing(null);
  };
  const handleDelete = async (id) => { if(!confirm("Delete?"))return; await payments.delete(id); qc.invalidateQueries({queryKey:["payments"]}); };

  const filtered = useMemo(()=>paymentList.filter(p=>(!poFilter||p.po_id===poFilter)&&(!search||p.po_number?.toLowerCase().includes(search.toLowerCase())||p.lc_number?.toLowerCase().includes(search.toLowerCase()))),[paymentList,search,poFilter]);

  const stats = useMemo(()=>{
    const totalOutstanding = paymentList.filter(p=>p.status!=="Received").reduce((s,p)=>s+(p.amount||0),0);
    const totalReceived = paymentList.filter(p=>p.status==="Received").reduce((s,p)=>s+(p.amount||0),0);
    const overdue = paymentList.filter(p=>p.expected_date&&isPast(new Date(p.expected_date))&&p.status!=="Received").length;
    return { totalOutstanding, totalReceived, overdue, total:paymentList.length };
  },[paymentList]);

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Payments & LC Tracking</h1></div>
        <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}}><Plus className="h-4 w-4 mr-1.5"/>Add Payment</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Outstanding" value={`$${(stats.totalOutstanding/1000).toFixed(1)}k`} icon={Clock} iconBg="bg-amber-100"/>
        <StatCard title="Received" value={`$${(stats.totalReceived/1000).toFixed(1)}k`} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Overdue" value={stats.overdue} icon={AlertCircle} iconBg="bg-red-100"/>
        <StatCard title="Total Payments" value={stats.total} icon={CreditCard} iconBg="bg-primary/10"/>
      </div>
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search PO, LC number…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
      </div>
      {filtered.length===0?<EmptyState icon={CreditCard} title="No payments yet" description="Track advance payments, LC payments, and receivables here." actionLabel="Add Payment" onAction={()=>setShowForm(true)}/>:(
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {["PO","Type","Currency","Amount","LC Number","LC Bank","LC Expiry","Expected","Received","Status",""].map(h=><TableHead key={h} className="text-xs">{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p=>{
                  const overdue = p.expected_date&&isPast(new Date(p.expected_date))&&p.status!=="Received";
                  return (
                    <TableRow key={p.id} className={cn("hover:bg-muted/30",overdue&&"bg-red-50/30")}>
                      <TableCell className="text-xs font-medium text-primary">{p.po_number}</TableCell>
                      <TableCell className="text-xs">{p.payment_type}</TableCell>
                      <TableCell className="text-xs">{p.currency}</TableCell>
                      <TableCell className="text-xs font-semibold">{p.amount?Number(p.amount).toLocaleString():"—"}</TableCell>
                      <TableCell className="text-xs font-mono">{p.lc_number||"—"}</TableCell>
                      <TableCell className="text-xs">{p.lc_bank||"—"}</TableCell>
                      <TableCell className="text-xs">{fmt(p.lc_expiry)}</TableCell>
                      <TableCell className={cn("text-xs",overdue?"text-red-600 font-medium":"")}>{fmt(p.expected_date)}</TableCell>
                      <TableCell className="text-xs">{fmt(p.actual_date)}</TableCell>
                      <TableCell><span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border",STATUS_STYLES[p.status]||"")}>{p.status}</span></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>{setEditing(p);setShowForm(true);}}><Pencil className="h-3 w-3 text-muted-foreground"/></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>handleDelete(p.id)}><Trash2 className="h-3 w-3 text-muted-foreground"/></Button>
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
      <PaymentForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} pos={pos}/>
    </div>
  );
}

