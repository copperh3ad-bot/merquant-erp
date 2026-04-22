import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, commercialInvoices, poBatches, batchItems, supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileText, Plus, Pencil, Trash2, Search, Printer,
  Download, Eye, X, CheckCircle2, Clock, AlertCircle, Split
} from "lucide-react";
import { format } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  Draft:    "bg-gray-100 text-gray-700 border-gray-200",
  Issued:   "bg-blue-100 text-blue-700 border-blue-200",
  Accepted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Disputed: "bg-red-100 text-red-700 border-red-200",
  Paid:     "bg-teal-100 text-teal-700 border-teal-200",
};
const CI_STATUSES = ["Draft","Issued","Accepted","Disputed","Paid"];
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

// ── Generate CI from batch/PO items ───────────────────────────────────────
async function buildLineItems(poId, batchId, poItems) {
  if (batchId) {
    const items = await batchItems.listByBatch(batchId);
    return items.map(bi => ({
      item_code:   bi.item_code,
      description: bi.item_description,
      quantity:    bi.batch_quantity,
      unit_price:  bi.unit_price || 0,
      total:       bi.total_price || 0,
      cbm:         bi.cbm,
      cartons:     bi.cartons,
    }));
  }
  return poItems.map(i => ({
    item_code:   i.item_code,
    description: i.item_description,
    quantity:    i.quantity,
    unit_price:  i.unit_price || 0,
    total:       i.total_price || 0,
    cbm:         i.cbm,
    cartons:     i.num_cartons,
  }));
}

// ── CI Form ────────────────────────────────────────────────────────────────
function CIForm({ open, onOpenChange, onSave, initialData, pos, allBatches }) {
  const empty = {
    po_id:"", batch_id:"", ci_number:"", ci_date: new Date().toISOString().split("T")[0],
    customer_name:"", consignee_name:"", consignee_address:"", notify_party:"",
    bl_number:"", vessel_name:"", port_of_loading:"", port_of_destination:"",
    etd:"", eta:"", currency:"USD", payment_terms:"", incoterms:"FOB",
    freight_charge:0, insurance_charge:0, other_charges:0,
    status:"Draft", notes:"",
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const u = (k,v) => setForm(p => ({ ...p, [k]:v }));

  React.useEffect(() => {
    if (open) setForm(initialData ? { ...empty, ...initialData, batch_id: initialData.batch_id || "" } : empty);
  }, [open, initialData]);

  const selectedPo = useMemo(() => pos.find(p => p.id === form.po_id), [pos, form.po_id]);
  const poBatchOptions = useMemo(() => allBatches.filter(b => b.po_id === form.po_id), [allBatches, form.po_id]);

  const handlePoSelect = (id) => {
    const po = pos.find(p => p.id === id);
    if (!po) return;
    const seqNum = String(Date.now()).slice(-4);
    setForm(f => ({
      ...f, po_id: id, batch_id: "",
      customer_name: po.customer_name || "",
      port_of_loading: po.port_of_loading || "",
      port_of_destination: po.port_of_destination || "",
      payment_terms: po.payment_terms || "",
      currency: po.currency || "USD",
      ci_number: `CI-${po.po_number}-${seqNum}`,
    }));
  };

  const handleBatchSelect = (batchId) => {
    const batch = allBatches.find(b => b.id === batchId);
    if (!batch) { u("batch_id",""); return; }
    setForm(f => ({
      ...f, batch_id: batchId,
      etd: batch.etd || f.etd,
      eta: batch.eta || f.eta,
      ci_number: `CI-${batch.batch_number}`,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: poItems = [] } = await supabase
        .from("po_items").select("*").eq("po_id", form.po_id);
      const lineItems = await buildLineItems(form.po_id, form.batch_id || null, poItems || []);
      const subtotal = lineItems.reduce((s, i) => s + (i.total || 0), 0);
      const total = subtotal + Number(form.freight_charge||0) + Number(form.insurance_charge||0) + Number(form.other_charges||0);
      const totalQty = lineItems.reduce((s, i) => s + (i.quantity || 0), 0);
      await onSave({
        ...form,
        batch_id: form.batch_id || null,
        line_items: lineItems,
        subtotal: +subtotal.toFixed(2),
        total_amount: +total.toFixed(2),
        total_quantity: totalQty,
        freight_charge: Number(form.freight_charge||0),
        insurance_charge: Number(form.insurance_charge||0),
        other_charges: Number(form.other_charges||0),
      });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData ? "Edit Commercial Invoice" : "New Commercial Invoice"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Production PO *</Label>
            <Select value={form.po_id} onValueChange={v => handlePoSelect(v === "__none" || v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select PO"/></SelectTrigger>
              <SelectContent>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {poBatchOptions.length > 0 && (
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Shipment Batch <span className="text-muted-foreground font-normal">(leave blank for whole PO)</span></Label>
              <Select value={form.batch_id || "__none"} onValueChange={v => handleBatchSelect(v === "__none" || v === "__all" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Whole PO (no batch split)"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Whole PO</SelectItem>
                  {poBatchOptions.map(b=><SelectItem key={b.id} value={b.id}>{b.batch_number} — {(b.total_quantity||0).toLocaleString()} pcs</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5"><Label className="text-xs">CI Number *</Label><Input value={form.ci_number} onChange={e=>u("ci_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">CI Date</Label><Input type="date" value={form.ci_date} onChange={e=>u("ci_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Customer / Buyer</Label><Input value={form.customer_name} onChange={e=>u("customer_name",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Consignee</Label><Input value={form.consignee_name} onChange={e=>u("consignee_name",e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Consignee Address</Label><Textarea value={form.consignee_address} onChange={e=>u("consignee_address",e.target.value)} rows={2}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notify Party</Label><Input value={form.notify_party} onChange={e=>u("notify_party",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">BL Number</Label><Input value={form.bl_number} onChange={e=>u("bl_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Vessel Name</Label><Input value={form.vessel_name} onChange={e=>u("vessel_name",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Port of Loading</Label><Input value={form.port_of_loading} onChange={e=>u("port_of_loading",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Port of Destination</Label><Input value={form.port_of_destination} onChange={e=>u("port_of_destination",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">ETD</Label><Input type="date" value={form.etd} onChange={e=>u("etd",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">ETA</Label><Input type="date" value={form.eta} onChange={e=>u("eta",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Currency</Label>
            <Select value={form.currency} onValueChange={v=>u("currency",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["USD","EUR","GBP","PKR","BDT"].map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Incoterms</Label>
            <Select value={form.incoterms||"FOB"} onValueChange={v=>u("incoterms",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["FOB","CIF","CFR","EXW","DDP","FCA"].map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Payment Terms</Label><Input value={form.payment_terms} onChange={e=>u("payment_terms",e.target.value)} placeholder="LC 90 days"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Freight Charge</Label><Input type="number" step="0.01" value={form.freight_charge||""} onChange={e=>u("freight_charge",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Insurance</Label><Input type="number" step="0.01" value={form.insurance_charge||""} onChange={e=>u("insurance_charge",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Other Charges</Label><Input type="number" step="0.01" value={form.other_charges||""} onChange={e=>u("other_charges",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{CI_STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes||""} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.po_id||!form.ci_number}>{saving?"Generating…":"Save & Generate CI"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Print View ─────────────────────────────────────────────────────────────
function CIPrintView({ ci, onClose }) {
  const po = ci;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl">
        <div className="flex items-center justify-between p-4 border-b no-print">
          <h2 className="font-bold text-base">Commercial Invoice — {ci.ci_number}</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => window.print()}><Printer className="h-3.5 w-3.5"/>Print</Button>
            <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4"/></Button>
          </div>
        </div>

        <div className="p-8 font-sans text-sm" id="ci-print">
          <style>{`@media print { .no-print{display:none!important;} #ci-print{padding:20px;} @page{margin:1cm;size:A4;} }`}</style>

          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#1F3864]">COMMERCIAL INVOICE</h1>
              <p className="text-sm mt-1 text-gray-500">No: <span className="font-semibold text-gray-800">{ci.ci_number}</span></p>
              <p className="text-sm text-gray-500">Date: <span className="font-semibold text-gray-800">{fmt(ci.ci_date)}</span></p>
              {ci.batch_id && <p className="text-xs mt-1 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded inline-block">Partial Shipment / Batch Invoice</p>}
            </div>
            <div className="text-right">
              <p className="font-bold text-[#1F3864] text-lg">MerQuant</p>
              <p className="text-xs text-gray-500 mt-1">Exporter</p>
            </div>
          </div>

          {/* Party details */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Buyer</p>
              <p className="font-semibold text-gray-900">{ci.customer_name || "—"}</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Consignee</p>
              <p className="font-semibold text-gray-900">{ci.consignee_name || "—"}</p>
              <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{ci.consignee_address || ""}</p>
            </div>
          </div>

          {/* Shipment info */}
          <div className="grid grid-cols-4 gap-3 mb-5 text-xs">
            {[["PO Number", ci.po_number],["BL Number",ci.bl_number||"—"],["Vessel",ci.vessel_name||"—"],["ETD",fmt(ci.etd)],["Port of Loading",ci.port_of_loading||"—"],["Port of Destination",ci.port_of_destination||"—"],["Payment Terms",ci.payment_terms||"—"],["Incoterms",ci.incoterms||"—"]].map(([l,v])=>(
              <div key={l} className="border border-gray-200 rounded p-2">
                <p className="text-[10px] text-gray-400 uppercase">{l}</p>
                <p className="font-medium text-gray-900 mt-0.5">{v}</p>
              </div>
            ))}
          </div>

          {/* Line items */}
          <table className="w-full text-xs border-collapse mb-4">
            <thead>
              <tr style={{backgroundColor:"#1F3864",color:"white"}}>
                {["#","Item Code","Description","Qty","Unit Price","Amount"].map(h=>(
                  <th key={h} className="border border-gray-400 px-2 py-2 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(ci.line_items||[]).map((item,i)=>(
                <tr key={i} style={{backgroundColor:i%2===0?"#fff":"#F9FAFB"}}>
                  <td className="border border-gray-200 px-2 py-1.5">{i+1}</td>
                  <td className="border border-gray-200 px-2 py-1.5 font-medium">{item.item_code||"—"}</td>
                  <td className="border border-gray-200 px-2 py-1.5">{item.description||"—"}</td>
                  <td className="border border-gray-200 px-2 py-1.5 text-right font-semibold" style={{backgroundColor:"#FFF2CC"}}>{(item.quantity||0).toLocaleString()}</td>
                  <td className="border border-gray-200 px-2 py-1.5 text-right">{ci.currency} {Number(item.unit_price||0).toFixed(4)}</td>
                  <td className="border border-gray-200 px-2 py-1.5 text-right font-semibold">{ci.currency} {Number(item.total||0).toFixed(2)}</td>
                </tr>
              ))}
              {/* Subtotals */}
              {[["Subtotal", ci.subtotal],ci.freight_charge>0&&["Freight",ci.freight_charge],ci.insurance_charge>0&&["Insurance",ci.insurance_charge],ci.other_charges>0&&["Other Charges",ci.other_charges]].filter(Boolean).map(([l,v])=>(
                <tr key={l} style={{backgroundColor:"#EBF0FA"}}>
                  <td className="border border-gray-300 px-2 py-1.5 text-right font-medium" colSpan={5}>{l}</td>
                  <td className="border border-gray-300 px-2 py-1.5 text-right font-semibold">{ci.currency} {Number(v||0).toFixed(2)}</td>
                </tr>
              ))}
              <tr style={{backgroundColor:"#1F3864",color:"white",fontWeight:"bold"}}>
                <td className="border border-gray-400 px-2 py-2 text-right" colSpan={5}>TOTAL AMOUNT</td>
                <td className="border border-gray-400 px-2 py-2 text-right text-base">{ci.currency} {Number(ci.total_amount||0).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {/* Totals summary */}
          <div className="grid grid-cols-4 gap-3 text-xs mb-5">
            {[["Total Quantity",(ci.total_quantity||0).toLocaleString()+" pcs"],["Total Cartons",(ci.total_cartons||0)+" ctns"],["Net Weight",(ci.total_net_weight||0)+" kg"],["Total CBM",(ci.total_cbm||0)+" m³"]].map(([l,v])=>(
              <div key={l} className="border border-gray-200 rounded p-2 text-center">
                <p className="text-[10px] text-gray-400 uppercase">{l}</p>
                <p className="font-bold mt-0.5">{v}</p>
              </div>
            ))}
          </div>

          {ci.notes && <p className="text-xs text-gray-500 italic mt-2">Notes: {ci.notes}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function CommercialInvoicesPage() {
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [search, setSearch] = useState("");
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "");
  const qc = useQueryClient();

  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: cis=[], isLoading } = useQuery({ queryKey:["commercialInvoices"], queryFn:()=>commercialInvoices.list() });
  const { data: batches=[] } = useQuery({ queryKey:["allBatches"], queryFn:()=>poBatches.list() });

  const handleSave = async (data) => {
    if (editing) { await commercialInvoices.update(editing.id, data); }
    else { await commercialInvoices.create(data); }
    qc.invalidateQueries({ queryKey:["commercialInvoices"] });
    setShowForm(false); setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this CI?")) return;
    await commercialInvoices.delete(id);
    qc.invalidateQueries({ queryKey:["commercialInvoices"] });
  };

  const handleStatus = async (id, status) => {
    await commercialInvoices.update(id, { status });
    qc.invalidateQueries({ queryKey:["commercialInvoices"] });
  };

  const filtered = useMemo(()=>cis.filter(c=>
    (!poFilter||c.po_id===poFilter)&&
    (!search||c.ci_number?.toLowerCase().includes(search.toLowerCase())||c.po_number?.toLowerCase().includes(search.toLowerCase())||c.customer_name?.toLowerCase().includes(search.toLowerCase()))
  ),[cis,search,poFilter]);

  const stats = useMemo(()=>({
    total: cis.length,
    issued: cis.filter(c=>c.status==="Issued"||c.status==="Accepted").length,
    paid: cis.filter(c=>c.status==="Paid").length,
    totalValue: cis.reduce((s,c)=>s+(c.total_amount||0),0),
  }),[cis]);

  return (
    <div className="space-y-4">
      <style>{`@media print { .no-print{display:none!important;} }`}</style>
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <div className="flex items-center gap-3"><FileText className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Commercial Invoices</h1></div>
        <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}}><Plus className="h-4 w-4 mr-1.5"/>New CI</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
        <StatCard title="Total CIs" value={stats.total} icon={FileText} iconBg="bg-primary/10"/>
        <StatCard title="Issued/Accepted" value={stats.issued} icon={CheckCircle2} iconBg="bg-blue-100"/>
        <StatCard title="Paid" value={stats.paid} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Total Value" value={`$${(stats.totalValue/1000).toFixed(0)}k`} icon={FileText} iconBg="bg-amber-100"/>
      </div>

      <div className="relative max-w-sm no-print">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search CI number, PO, customer…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
      </div>

      {filtered.length===0 ? (
        <EmptyState icon={FileText} title="No commercial invoices" description="Create commercial invoices for each shipment batch. One PO can have multiple CIs for split shipments." actionLabel="Create CI" onAction={()=>setShowForm(true)}/>
      ) : (
        <div className="space-y-2">
          {filtered.map(ci=>{
            const batch = batches.find(b=>b.id===ci.batch_id);
            return (
              <Card key={ci.id}>
                <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{ci.ci_number}</span>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded border",STATUS_STYLES[ci.status]||"")}>{ci.status}</span>
                      {batch && (
                        <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded flex items-center gap-0.5">
                          <Split className="h-2.5 w-2.5"/>{batch.batch_number}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      PO: <span className="font-medium text-primary">{ci.po_number}</span> · {ci.customer_name} · {fmt(ci.ci_date)}
                    </p>
                    <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                      {ci.total_quantity>0&&<span>Qty: <span className="font-semibold text-foreground">{ci.total_quantity.toLocaleString()} pcs</span></span>}
                      {ci.total_amount>0&&<span>Amount: <span className="font-bold text-foreground">{ci.currency} {Number(ci.total_amount).toLocaleString()}</span></span>}
                      {ci.bl_number&&<span>BL: {ci.bl_number}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0 flex-wrap">
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={()=>setViewing(ci)}><Eye className="h-3.5 w-3.5"/>View</Button>
                    {ci.status==="Draft"&&<Button size="sm" variant="outline" className="text-xs" onClick={()=>handleStatus(ci.id,"Issued")}>Issue</Button>}
                    {ci.status==="Issued"&&<Button size="sm" variant="outline" className="text-xs" onClick={()=>handleStatus(ci.id,"Accepted")}>Accept</Button>}
                    {ci.status==="Accepted"&&<Button size="sm" variant="outline" className="text-xs" onClick={()=>handleStatus(ci.id,"Paid")}>Mark Paid</Button>}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={()=>{setEditing(ci);setShowForm(true);}}><Pencil className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={()=>handleDelete(ci.id)}><Trash2 className="h-3.5 w-3.5 text-destructive"/></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {showForm&&<CIForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} pos={pos} allBatches={batches}/>}
      {viewing&&<CIPrintView ci={viewing} onClose={()=>setViewing(null)}/>}
    </div>
  );
}

