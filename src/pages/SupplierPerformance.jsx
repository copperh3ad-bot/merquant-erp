import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  TrendingUp, Star, AlertTriangle, CheckCircle2,
  Truck, Shield, Package, Pencil, RefreshCw, Search
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";
import { db, supabase } from "@/api/supabaseClient";

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

function ScoreBar({ score, max=100 }) {
  const pct = Math.min(100, (score/max)*100);
  const color = pct>=80?"bg-emerald-500":pct>=60?"bg-amber-500":"bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{width:`${pct}%`}}/>
      </div>
      <span className={cn("text-xs font-bold w-8 text-right",pct>=80?"text-emerald-600":pct>=60?"text-amber-600":"text-red-600")}>{Math.round(score)}</span>
    </div>
  );
}

function ScoreBadge({ score }) {
  if (!score && score!==0) return <span className="text-xs text-muted-foreground">—</span>;
  const cls = score>=80?"bg-emerald-100 text-emerald-700":score>=60?"bg-amber-100 text-amber-700":"bg-red-100 text-red-600";
  return <span className={cn("text-sm font-bold px-2.5 py-1 rounded-lg", cls)}>{Math.round(score)}/100</span>;
}

function SupplierForm({ open, onOpenChange, onSave, initialData }) {
  const empty = { audit_date:"", audit_score:"", audit_status:"Not Audited", capacity_units_per_month:"", lead_time_days:"", min_order_qty:"", certifications:[] };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v)=>setForm(p=>({...p,[k]:v}));
  React.useEffect(()=>{ if(open&&initialData) setForm({...empty,...initialData, certifications:initialData.certifications||[], audit_score:initialData.audit_score||"", audit_date:initialData.audit_date||""}); },[open,initialData]);
  const handleSave=async()=>{ setSaving(true); try{await onSave({capacity_units_per_month:form.capacity_units_per_month?Number(form.capacity_units_per_month):null, lead_time_days:form.lead_time_days?Number(form.lead_time_days):null, min_order_qty:form.min_order_qty?Number(form.min_order_qty):null, audit_date:form.audit_date||null, audit_score:form.audit_score?Number(form.audit_score):null, audit_status:form.audit_status});}finally{setSaving(false);} };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Update Supplier Details</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="space-y-1.5"><Label className="text-xs">Capacity (units/month)</Label><Input type="number" value={form.capacity_units_per_month||""} onChange={e=>u("capacity_units_per_month",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Lead Time (days)</Label><Input type="number" value={form.lead_time_days||""} onChange={e=>u("lead_time_days",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">MOQ</Label><Input type="number" value={form.min_order_qty||""} onChange={e=>u("min_order_qty",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Audit Status</Label>
            <Select value={form.audit_status} onValueChange={v=>u("audit_status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["Not Audited","Passed","Failed","Conditional","Expired"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Last Audit Date</Label><Input type="date" value={form.audit_date||""} onChange={e=>u("audit_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Audit Score (0-100)</Label><Input type="number" min="0" max="100" value={form.audit_score||""} onChange={e=>u("audit_score",e.target.value)}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving?"Saving…":"Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SupplierPerformance() {
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  const { data: suppList=[], isLoading } = useQuery({ queryKey:["suppliers"], queryFn:()=>db.suppliers.list() });
  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: qcList=[] } = useQuery({ queryKey:["qcInspections"], queryFn:async()=>{ const {data}=await supabase.from("qc_inspections").select("*").limit(500); return data||[]; }});
  const { data: complaintList=[] } = useQuery({ queryKey:["complaints"], queryFn:async()=>{ try{const {data}=await supabase.from("complaints").select("*").limit(200); return data||[];}catch{return [];} }});
  const { data: shipmentList=[] } = useQuery({ queryKey:["shipments"], queryFn:async()=>{ const {data}=await supabase.from("shipments").select("*").limit(500); return data||[]; }});

  // Calculate live performance metrics per supplier
  const supplierMetrics = useMemo(()=>{
    return suppList.map(s=>{
      const supplierPOs = pos.filter(p=>p.supplier_id===s.id);
      const supplierShipments = shipmentList.filter(sh=>supplierPOs.some(p=>p.id===sh.po_id));
      const supplierQC = qcList.filter(q=>supplierPOs.some(p=>p.id===q.po_id));
      const supplierComplaints = complaintList.filter(c=>c.supplier_id===s.id||supplierPOs.some(p=>p.id===c.po_id));

      // On-time delivery
      const deliveredShipments = supplierShipments.filter(sh=>sh.actual_departure||sh.status==="Delivered");
      const onTimeDel = deliveredShipments.filter(sh=>{
        if (!sh.etd || !sh.actual_departure) return false;
        return new Date(sh.actual_departure) <= new Date(sh.etd);
      });
      const onTimePct = deliveredShipments.length>0 ? (onTimeDel.length/deliveredShipments.length)*100 : null;

      // QC pass rate
      const qcWithVerdict = supplierQC.filter(q=>q.verdict);
      const qcPassed = qcWithVerdict.filter(q=>["Pass","Conditional Pass"].includes(q.verdict));
      const qcPct = qcWithVerdict.length>0 ? (qcPassed.length/qcWithVerdict.length)*100 : null;

      // Complaint rate
      const openComplaints = supplierComplaints.filter(c=>!["Resolved","Closed"].includes(c.status||"")).length;
      const criticalComplaints = supplierComplaints.filter(c=>c.severity==="Critical"&&!["Resolved","Closed"].includes(c.status||"")).length;

      // Overall score
      let score = null;
      const components = [];
      if (onTimePct!==null) components.push(onTimePct*0.4);
      if (qcPct!==null) components.push(qcPct*0.4);
      if (supplierPOs.length>0) {
        const complaintScore = Math.max(0, 100-(openComplaints*10)-(criticalComplaints*20));
        components.push(complaintScore*0.2);
      }
      if (components.length>0) score = components.reduce((a,b)=>a+b,0) / components.length;
      // If only 1-2 components, not enough signal — scale up proportionally
      if (components.length===2) score = score * (3/2);
      if (components.length===1) score = null; // not enough data

      return { ...s, metrics: { totalOrders:supplierPOs.length, deliveredShipments:deliveredShipments.length, onTimePct, qcPct, openComplaints, criticalComplaints, totalComplaints:supplierComplaints.length, score } };
    });
  },[suppList,pos,shipmentList,qcList,complaintList]);

  const filtered = useMemo(()=>supplierMetrics.filter(s=>!search||s.name?.toLowerCase().includes(search.toLowerCase())||s.country?.toLowerCase().includes(search.toLowerCase())),[supplierMetrics,search]);

  const stats = useMemo(()=>({
    total: suppList.length,
    active: suppList.filter(s=>s.status==="Active").length,
    audited: suppList.filter(s=>s.audit_status==="Passed").length,
    critical: supplierMetrics.filter(s=>s.metrics.criticalComplaints>0).length,
  }),[suppList,supplierMetrics]);

  const handleUpdate = async(data)=>{ await supabase.from("suppliers").update(data).eq("id",editing.id); qc.invalidateQueries({queryKey:["suppliers"]}); setEditing(null); };

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-28 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><TrendingUp className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Supplier Performance</h1></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Total Suppliers" value={stats.total} icon={Package} iconBg="bg-primary/10"/>
        <StatCard title="Active" value={stats.active} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Audit Passed" value={stats.audited} icon={Shield} iconBg="bg-blue-100"/>
        <StatCard title="Critical Issues" value={stats.critical} icon={AlertTriangle} iconBg={stats.critical>0?"bg-red-100":"bg-muted/50"}/>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search supplier…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
      </div>

      <div className="space-y-3">
        {filtered.map(s=>{
          const m = s.metrics;
          const auditExpired = s.audit_date && differenceInDays(new Date(), new Date(s.audit_date)) > 365;
          return (
            <Card key={s.id} className={cn("hover:shadow-sm", m.criticalComplaints>0&&"border-red-200")}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-bold text-sm">{s.name}</span>
                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", s.status==="Active"?"bg-emerald-100 text-emerald-700":"bg-gray-100 text-gray-600")}>{s.status}</span>
                      {s.country&&<span className="text-[10px] text-muted-foreground">{s.city?`${s.city}, `:""}{s.country}</span>}
                      {s.audit_status&&s.audit_status!=="Not Audited"&&(
                        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold",
                          s.audit_status==="Passed"&&!auditExpired?"bg-emerald-50 text-emerald-700 border-emerald-200":
                          s.audit_status==="Failed"?"bg-red-50 text-red-600 border-red-200":"bg-amber-50 text-amber-700 border-amber-200"
                        )}>
                          {auditExpired?"AUDIT EXPIRED":s.audit_status}{s.audit_score?` (${s.audit_score})`:""}</span>
                      )}
                      {m.criticalComplaints>0&&<span className="text-[10px] bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded font-semibold">{m.criticalComplaints} Critical</span>}
                    </div>

                    {/* Performance metrics grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                      <div><p className="text-muted-foreground mb-1">On-Time Delivery</p>
                        {m.onTimePct!==null ? <ScoreBar score={m.onTimePct}/> : <span className="text-muted-foreground">No data</span>}
                      </div>
                      <div><p className="text-muted-foreground mb-1">QC Pass Rate</p>
                        {m.qcPct!==null ? <ScoreBar score={m.qcPct}/> : <span className="text-muted-foreground">No data</span>}
                      </div>
                      <div><p className="text-muted-foreground mb-1">Open Complaints</p>
                        <span className={cn("font-bold text-sm", m.openComplaints>0?"text-amber-600":"text-emerald-600")}>{m.openComplaints}</span>
                        {m.totalComplaints>0&&<span className="text-muted-foreground ml-1">/ {m.totalComplaints}</span>}
                      </div>
                      <div><p className="text-muted-foreground mb-1">Overall Score</p>
                        <ScoreBadge score={m.score}/>
                      </div>
                    </div>

                    {/* Capacity info */}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Orders: <span className="font-medium text-foreground">{m.totalOrders}</span></span>
                      {s.capacity_units_per_month&&<span>Capacity: <span className="font-medium text-foreground">{Number(s.capacity_units_per_month).toLocaleString()} pcs/mo</span></span>}
                      {s.lead_time_days&&<span>Lead time: <span className="font-medium text-foreground">{s.lead_time_days}d</span></span>}
                      {s.min_order_qty&&<span>MOQ: <span className="font-medium text-foreground">{Number(s.min_order_qty).toLocaleString()}</span></span>}
                      {s.audit_date&&<span>Last audit: {fmt(s.audit_date)}{auditExpired?" ⚠":""}</span>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={()=>setEditing(s)}><Pencil className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {editing&&<SupplierForm open={!!editing} onOpenChange={v=>{if(!v)setEditing(null);}} onSave={handleUpdate} initialData={editing}/>}
    </div>
  );
}

