import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, fabricOrders, mfg } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Shirt, Plus, Pencil, Trash2, Search, AlertCircle, CheckCircle2, Clock, TrendingDown, RefreshCw } from "lucide-react";
import { format, isPast } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";
import POSelector from "@/components/shared/POSelector";

const STATUSES = ["Pending","Confirmed","Weaving","Dyeing/Processing","Dispatched","Received","Shortfall","Cancelled"];
const STATUS_STYLES = {
  "Received":         "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Confirmed":        "bg-blue-50 text-blue-700 border-blue-200",
  "Weaving":          "bg-violet-50 text-violet-700 border-violet-200",
  "Dyeing/Processing":"bg-purple-50 text-purple-700 border-purple-200",
  "Dispatched":       "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Pending":          "bg-gray-50 text-gray-600 border-gray-200",
  "Shortfall":        "bg-red-50 text-red-700 border-red-200",
  "Cancelled":        "bg-red-50 text-red-500 border-red-200",
};
const fmt = (d) => { try { return d?format(new Date(d),"dd MMM yy"):"—"; } catch { return "—"; } };

const empty = { po_id:"", fabric_order_number:"", mill_name:"", mill_contact:"", fabric_type:"", quality_spec:"", gsm:"", width_cm:"", color:"", quantity_meters:"", unit_price:"", currency:"USD", order_date:"", expected_delivery:"", actual_delivery:"", received_meters:"", status:"Pending", notes:"" };

function FabricOrderForm({ open, onOpenChange, onSave, initialData, pos }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v)=>setForm(p=>({ ...p,[k]:v }));
  React.useEffect(()=>{ if(open) setForm(initialData?{...empty,...initialData}:empty); },[open,initialData]);

  const totalCost = useMemo(()=>+(Number(form.quantity_meters||0)*Number(form.unit_price||0)).toFixed(2),[form.quantity_meters,form.unit_price]);
  const shortfall = useMemo(()=>{
    if(!form.received_meters||form.status!=="Received") return 0;
    return Math.max(0,Number(form.quantity_meters||0)-Number(form.received_meters||0));
  },[form]);

  const handleSave = async()=>{
    setSaving(true);
    try {
      await onSave({...form,
        gsm:form.gsm?Number(form.gsm):null, width_cm:form.width_cm?Number(form.width_cm):null,
        quantity_meters:Number(form.quantity_meters)||0, unit_price:form.unit_price?Number(form.unit_price):null,
        total_cost:totalCost||null, received_meters:form.received_meters?Number(form.received_meters):null,
        shortfall_meters:shortfall>0?shortfall:null,
      });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData?"Edit Fabric Order":"New Fabric Mill Order"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Linked PO (optional)</Label>
            <Select value={form.po_id || "__none"} onValueChange={v=>u("po_id",v||null)}>
              <SelectTrigger><SelectValue placeholder="Not linked to specific PO"/></SelectTrigger>
              <SelectContent><SelectItem value="__none">Not linked</SelectItem>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Order Number</Label><Input value={form.fabric_order_number} onChange={e=>u("fabric_order_number",e.target.value)} placeholder="FO-2025-001"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Mill Name *</Label><Input value={form.mill_name} onChange={e=>u("mill_name",e.target.value)} placeholder="Faisalabad Textile Mill"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Mill Contact</Label><Input value={form.mill_contact} onChange={e=>u("mill_contact",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Fabric Type</Label><Input value={form.fabric_type} onChange={e=>u("fabric_type",e.target.value)} placeholder="Single Jersey 100% Cotton"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Quality Spec</Label><Input value={form.quality_spec} onChange={e=>u("quality_spec",e.target.value)} placeholder="30/1 combed, compact"/></div>
          <div className="space-y-1.5"><Label className="text-xs">GSM</Label><Input type="number" value={form.gsm} onChange={e=>u("gsm",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Width (cm)</Label><Input type="number" value={form.width_cm} onChange={e=>u("width_cm",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Color</Label><Input value={form.color} onChange={e=>u("color",e.target.value)} placeholder="Navy PMS 289C"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Quantity (meters) *</Label><Input type="number" value={form.quantity_meters} onChange={e=>u("quantity_meters",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Unit Price (per meter)</Label><Input type="number" step="any" value={form.unit_price} onChange={e=>u("unit_price",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Currency</Label>
            <Select value={form.currency} onValueChange={v=>u("currency",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["USD","EUR","GBP","INR","PKR","BDT"].map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Total Cost (auto)</Label><Input readOnly value={totalCost||""} className="bg-muted/40 font-semibold"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Order Date</Label><Input type="date" value={form.order_date} onChange={e=>u("order_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Expected Delivery</Label><Input type="date" value={form.expected_delivery} onChange={e=>u("expected_delivery",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Actual Delivery</Label><Input type="date" value={form.actual_delivery} onChange={e=>u("actual_delivery",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Received (meters)</Label><Input type="number" value={form.received_meters} onChange={e=>u("received_meters",e.target.value)}/></div>
          {shortfall > 0 && <div className="col-span-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 font-medium">⚠ Shortfall: {shortfall} meters below ordered quantity</div>}
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.mill_name}>{saving?"Saving…":"Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FabricOrdersPage() {
  const [showForm, setShowForm] = useState(false);
  const [searchParams] = useSearchParams();
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("po_id") || "");
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: orders=[], isLoading } = useQuery({ queryKey:["fabricOrders"], queryFn:()=>fabricOrders.list() });

  const handleSave = async(data)=>{
    const po = pos.find(p=>p.id===data.po_id);
    const payload = {...data,po_number:po?.po_number||""};
    if(editing){await fabricOrders.update(editing.id,payload);}else{await fabricOrders.create(payload);}
    qc.invalidateQueries({queryKey:["fabricOrders"]});
    setShowForm(false); setEditing(null);
  };
  const handleDelete=async(id)=>{if(!confirm("Delete?"))return;await fabricOrders.delete(id);qc.invalidateQueries({queryKey:["fabricOrders"]});};

  const handleAutoFromYarn = async () => {
    const po = selectedPoId ? pos.find(p=>p.id===selectedPoId) : pos[0];
    if (!po) return alert("Select a PO first.");
    const existing = orders.filter(o => o.po_id === po.id);
    if (existing.length > 0) {
      if (!confirm(`${existing.length} fabric order(s) already exist for ${po.po_number}. Regenerate? This will add new rows (existing will not be deleted).`)) return;
    } else {
      if (!confirm(`Generate fabric orders from yarn requirements for ${po.po_number}?`)) return;
    }
    setGenerating(true);
    try {
      const yarns = await mfg.yarn.listByPO(po.id);
      if (!yarns.length) { alert("No yarn requirements found. Run 'Auto from FWS' in Yarn Planning first."); return; }
      for (const y of yarns) {
        if (!y.fabric_type || !y.total_meters) continue;
        await fabricOrders.create({
          po_id: po.id, po_number: po.po_number,
          fabric_order_number: `FO-${po.po_number}-${y.fabric_type.replace(/[^A-Za-z0-9]/g,"").substring(0,8).toUpperCase()}`,
          fabric_type: y.fabric_type,
          gsm: y.gsm || null, width_cm: y.width_cm || null,
          quantity_meters: y.total_meters,
          status: "Pending",
          notes: `Auto-generated from yarn planning. Yarn type: ${y.yarn_type||"—"}, Count: ${y.yarn_count||"—"}`,
        });
      }
      qc.invalidateQueries({queryKey:["fabricOrders"]});
    } finally { setGenerating(false); }
  };
  const filtered = useMemo(()=>orders.filter(o=>{
    const matchPo = !selectedPoId || o.po_id === selectedPoId;
    const matchSearch = !search||o.mill_name?.toLowerCase().includes(search.toLowerCase())||o.fabric_type?.toLowerCase().includes(search.toLowerCase())||o.po_number?.toLowerCase().includes(search.toLowerCase())||o.fabric_order_number?.toLowerCase().includes(search.toLowerCase());
    return matchPo && matchSearch;
  }),[orders,search,selectedPoId]);

  const stats = useMemo(()=>({
    active: orders.filter(o=>!["Received","Cancelled"].includes(o.status)).length,
    overdue: orders.filter(o=>o.expected_delivery&&isPast(new Date(o.expected_delivery))&&!["Received","Cancelled"].includes(o.status)).length,
    shortfall: orders.filter(o=>o.shortfall_meters>0).length,
    totalOrdered: orders.reduce((s,o)=>s+(o.quantity_meters||0),0),
  }),[orders]);

  if(isLoading) return <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Shirt className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Fabric Mill Orders</h1>
          <Select value={selectedPoId} onValueChange={v => setSelectedPoId(v === "__none" || v === "__all" ? "" : v)}>
            <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="Filter by PO…"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All POs</SelectItem>
              {pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={handleAutoFromYarn} disabled={generating}>
            <RefreshCw className={`h-3.5 w-3.5 ${generating?"animate-spin":""}`}/>{generating?"Generating…":"Auto from Yarn"}
          </Button>
          <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}}><Plus className="h-4 w-4 mr-1.5"/>New Fabric Order</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Active Orders" value={stats.active} icon={Clock} iconBg="bg-blue-100"/>
        <StatCard title="Overdue Delivery" value={stats.overdue} icon={AlertCircle} iconBg="bg-red-100"/>
        <StatCard title="Shortfall Alerts" value={stats.shortfall} icon={TrendingDown} iconBg="bg-amber-100"/>
        <StatCard title="Total Ordered" value={`${(stats.totalOrdered/1000).toFixed(1)}k m`} icon={Shirt} iconBg="bg-primary/10"/>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search mill, fabric type, PO…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
      </div>
      {filtered.length===0?<EmptyState icon={Shirt} title="No fabric orders" description="Track fabric orders to mills — quality spec, quantity, delivery dates, and receipt." actionLabel="Add Order" onAction={()=>setShowForm(true)}/>:(
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {["Order No","PO","Mill","Fabric Type","GSM","Color","Ordered (m)","Unit Price","Expected","Received (m)","Status",""].map(h=><TableHead key={h} className="text-xs">{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(o=>{
                  const overdue=o.expected_delivery&&isPast(new Date(o.expected_delivery))&&!["Received","Cancelled"].includes(o.status);
                  const shortfall=o.shortfall_meters>0;
                  return (
                    <TableRow key={o.id} className={cn("hover:bg-muted/30",overdue&&"bg-red-50/30",shortfall&&"bg-amber-50/30")}>
                      <TableCell className="text-xs font-mono">{o.fabric_order_number||"—"}</TableCell>
                      <TableCell className="text-xs text-primary font-medium">{o.po_number||"—"}</TableCell>
                      <TableCell className="text-xs font-medium">{o.mill_name}</TableCell>
                      <TableCell className="text-xs max-w-[120px] truncate">{o.fabric_type||"—"}</TableCell>
                      <TableCell className="text-xs">{o.gsm||"—"}</TableCell>
                      <TableCell className="text-xs">{o.color||"—"}</TableCell>
                      <TableCell className="text-xs font-semibold">{Number(o.quantity_meters).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{o.unit_price?`${o.currency} ${o.unit_price}`:"—"}</TableCell>
                      <TableCell className={cn("text-xs",overdue?"text-red-600 font-medium":"")}>{fmt(o.expected_delivery)}</TableCell>
                      <TableCell className={cn("text-xs",shortfall?"text-amber-600 font-semibold":"")}>{o.received_meters!=null?Number(o.received_meters).toLocaleString():"—"}{shortfall?` (−${o.shortfall_meters})`:""}</TableCell>
                      <TableCell><span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border",STATUS_STYLES[o.status]||"")}>{o.status}</span></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>{setEditing(o);setShowForm(true);}}><Pencil className="h-3 w-3 text-muted-foreground"/></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>handleDelete(o.id)}><Trash2 className="h-3 w-3 text-muted-foreground"/></Button>
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
      <FabricOrderForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} pos={pos}/>
    </div>
  );
}

