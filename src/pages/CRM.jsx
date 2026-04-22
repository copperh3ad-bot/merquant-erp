import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { rfqs, quotations, complaints, buyerContacts, commsLog, db } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Briefcase, Plus, Pencil, Trash2, Search, ArrowRight,
  CheckCircle2, AlertTriangle, Clock, MessageSquare,
  FileText, TrendingUp, Users, X, ChevronDown, ChevronRight,
  Phone, Mail, MessageCircle, DollarSign, Package, Star
} from "lucide-react";
import { format, isPast, differenceInDays } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };
const fmtL = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

// ─── RFQ Status styles ────────────────────────────────────────────────────
const RFQ_STATUS = {
  New:         { bg:"bg-blue-100",    text:"text-blue-700",    border:"border-blue-200" },
  "In Review": { bg:"bg-violet-100",  text:"text-violet-700",  border:"border-violet-200" },
  Costing:     { bg:"bg-amber-100",   text:"text-amber-700",   border:"border-amber-200" },
  Sent:        { bg:"bg-cyan-100",    text:"text-cyan-700",    border:"border-cyan-200" },
  Won:         { bg:"bg-emerald-100", text:"text-emerald-700", border:"border-emerald-200" },
  Lost:        { bg:"bg-red-100",     text:"text-red-600",     border:"border-red-200" },
  "On Hold":   { bg:"bg-gray-100",    text:"text-gray-600",    border:"border-gray-200" },
  Cancelled:   { bg:"bg-red-100",     text:"text-red-400",     border:"border-red-200" },
};
const QUOTE_STATUS = {
  Draft:              { bg:"bg-gray-100",    text:"text-gray-600" },
  Sent:               { bg:"bg-blue-100",    text:"text-blue-700" },
  "Under Negotiation":{ bg:"bg-amber-100",   text:"text-amber-700" },
  Accepted:           { bg:"bg-emerald-100", text:"text-emerald-700" },
  Rejected:           { bg:"bg-red-100",     text:"text-red-600" },
  Revised:            { bg:"bg-violet-100",  text:"text-violet-700" },
  Expired:            { bg:"bg-gray-100",    text:"text-gray-400" },
};
const COMPLAINT_SEV = {
  Critical: "bg-red-100 text-red-700 border-red-300",
  High:     "bg-orange-100 text-orange-700 border-orange-300",
  Medium:   "bg-amber-100 text-amber-700 border-amber-300",
  Low:      "bg-blue-100 text-blue-600 border-blue-300",
};
const COMPLAINT_STATUS_COLORS = {
  Open:                 "bg-red-100 text-red-700",
  Acknowledged:         "bg-amber-100 text-amber-700",
  "Under Investigation":"bg-violet-100 text-violet-700",
  Resolved:             "bg-emerald-100 text-emerald-700",
  Closed:               "bg-gray-100 text-gray-600",
  Escalated:            "bg-red-200 text-red-800",
};
const PRODUCT_CATEGORIES = ["Knitwear","Woven","Denim","Home Textile","Activewear","Outerwear","Swimwear","Other"];
const COMPLAINT_CATEGORIES = [
  "Quality – Fabric","Quality – Stitching","Quality – Measurement","Quality – Color",
  "Quality – Finishing","Quality – Packing","Delay – Production","Delay – Shipment",
  "Delay – Documentation","Short Shipment","Wrong Style","Wrong Color",
  "Wrong Size Mix","Documentation Error","Price Discrepancy","Other",
];

function StatusPill({ status, map, className }) {
  const s = map[status] || { bg:"bg-gray-100", text:"text-gray-600", border:"" };
  return <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", s.bg, s.text, s.border||"border-transparent", className)}>{status}</span>;
}

// ─── RFQ Form ─────────────────────────────────────────────────────────────
function RFQForm({ open, onOpenChange, onSave, initialData, contacts, pos }) {
  const empty = {
    rfq_number:"", customer_name:"", contact_id:"", season:"",
    received_date: new Date().toISOString().slice(0,10), due_date:"",
    status:"New", description:"", product_category:"Knitwear",
    estimated_quantity:"", target_price:"", target_price_currency:"USD",
    delivery_date:"", destination_country:"", incoterms:"FOB",
    special_requirements:"", source:"Email", assigned_to:"", notes:"",
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p=>({...p,[k]:v}));

  React.useEffect(()=>{
    if (open) setForm(initialData ? {...empty,...initialData, contact_id:initialData.contact_id||""} : {
      ...empty,
      rfq_number: `RFQ-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`
    });
  },[open,initialData]);

  const filteredContacts = useMemo(()=>contacts.filter(c=>!form.customer_name||c.customer_name===form.customer_name),[contacts,form.customer_name]);
  const customers = useMemo(()=>[...new Set(contacts.map(c=>c.customer_name))],[contacts]);

  const handleSave = async()=>{
    setSaving(true);
    try { await onSave({...form, estimated_quantity:form.estimated_quantity?Number(form.estimated_quantity):null, target_price:form.target_price?Number(form.target_price):null, contact_id:form.contact_id||null}); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData?"Edit RFQ":"New RFQ"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="space-y-1.5"><Label className="text-xs">RFQ Number</Label><Input value={form.rfq_number} onChange={e=>u("rfq_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Source</Label>
            <Select value={form.source} onValueChange={v=>u("source",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["Email","WhatsApp","Meeting","Portal","Phone","Other"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Customer *</Label>
            <Input value={form.customer_name} onChange={e=>u("customer_name",e.target.value)} list="customers-list" placeholder="Type or select…"/>
            <datalist id="customers-list">{customers.map(c=><option key={c} value={c}/>)}</datalist>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Contact Person</Label>
            <Select value={form.contact_id} onValueChange={v=>u("contact_id",v)}>
              <SelectTrigger><SelectValue placeholder="Select contact"/></SelectTrigger>
              <SelectContent><SelectItem value="__none">None</SelectItem>{filteredContacts.map(c=><SelectItem key={c.id} value={c.id}>{c.full_name} — {c.title||c.department||"Buyer"}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Received Date</Label><Input type="date" value={form.received_date} onChange={e=>u("received_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Quote Due Date</Label><Input type="date" value={form.due_date} onChange={e=>u("due_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Product Category</Label>
            <Select value={form.product_category} onValueChange={v=>u("product_category",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{PRODUCT_CATEGORIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Season</Label><Input value={form.season} onChange={e=>u("season",e.target.value)} placeholder="SS26"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Est. Quantity</Label><Input type="number" value={form.estimated_quantity} onChange={e=>u("estimated_quantity",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Target Price (FOB)</Label>
            <div className="flex gap-2">
              <Input type="number" step="0.01" value={form.target_price} onChange={e=>u("target_price",e.target.value)} className="flex-1"/>
              <Select value={form.target_price_currency} onValueChange={v=>u("target_price_currency",v)}>
                <SelectTrigger className="w-20"><SelectValue/></SelectTrigger>
                <SelectContent>{["USD","EUR","GBP"].map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Required Delivery Date</Label><Input type="date" value={form.delivery_date} onChange={e=>u("delivery_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Destination</Label><Input value={form.destination_country} onChange={e=>u("destination_country",e.target.value)} placeholder="Germany"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Incoterms</Label>
            <Select value={form.incoterms} onValueChange={v=>u("incoterms",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["FOB","CIF","CFR","EXW","DDP","FCA"].map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{Object.keys(RFQ_STATUS).map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Assigned To</Label><Input value={form.assigned_to} onChange={e=>u("assigned_to",e.target.value)} placeholder="Merchandiser name"/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Description / RFQ Brief</Label><Textarea value={form.description} onChange={e=>u("description",e.target.value)} rows={2}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Special Requirements</Label><Textarea value={form.special_requirements} onChange={e=>u("special_requirements",e.target.value)} rows={2} placeholder="e.g. GOTS certified fabric only, lead-free accessories, specific packaging"/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.rfq_number||!form.customer_name}>{saving?"Saving…":"Save RFQ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Quotation Form ────────────────────────────────────────────────────────
function QuotationForm({ open, onOpenChange, onSave, initialData, rfqList, contacts }) {
  const empty = {
    quote_number:"", rfq_id:"", customer_name:"", contact_id:"",
    quote_date:new Date().toISOString().slice(0,10), valid_until:"",
    status:"Draft", product_description:"", article_code:"", quantity:"",
    currency:"USD", fabric_cost:0, trim_cost:0, accessory_cost:0,
    cm_cost:0, overhead_cost:0, freight_cost:0, commission_pct:5,
    quoted_price:0, lead_time_days:"", ex_factory_date:"",
    delivery_terms:"FOB", negotiation_notes:"", notes:"",
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p=>({...p,[k]:v}));

  React.useEffect(()=>{
    if (open) setForm(initialData?{...empty,...initialData,rfq_id:initialData.rfq_id||"",contact_id:initialData.contact_id||""}:{
      ...empty, quote_number:`QT-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`
    });
  },[open,initialData]);

  // Auto-fill customer when RFQ selected
  const handleRFQSelect = (id) => {
    const r = rfqList.find(r=>r.id===id);
    if (r) setForm(f=>({...f, rfq_id:id, customer_name:r.customer_name, article_code:f.article_code||""}));
    else u("rfq_id","");
  };

  const totFOB = useMemo(()=>{
    const sum = [form.fabric_cost,form.trim_cost,form.accessory_cost,form.cm_cost,form.overhead_cost,form.freight_cost].reduce((s,v)=>s+Number(v||0),0);
    const comm = sum*(Number(form.commission_pct||0)/100);
    return +(sum+comm).toFixed(4);
  },[form]);

  const margin = form.quoted_price > 0 ? +((((Number(form.quoted_price)-totFOB)/Number(form.quoted_price))*100)).toFixed(2) : 0;

  const handleSave = async()=>{
    setSaving(true);
    try { await onSave({...form, rfq_id:form.rfq_id||null, contact_id:form.contact_id||null, quantity:form.quantity?Number(form.quantity):null, total_fob:totFOB, margin_pct:margin, lead_time_days:form.lead_time_days?Number(form.lead_time_days):null, quoted_price:Number(form.quoted_price||0), fabric_cost:Number(form.fabric_cost||0), trim_cost:Number(form.trim_cost||0), accessory_cost:Number(form.accessory_cost||0), cm_cost:Number(form.cm_cost||0), overhead_cost:Number(form.overhead_cost||0), freight_cost:Number(form.freight_cost||0), commission_pct:Number(form.commission_pct||0) }); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData?"Edit Quotation":"New Quotation"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="space-y-1.5"><Label className="text-xs">Quote Number</Label><Input value={form.quote_number} onChange={e=>u("quote_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Linked RFQ</Label>
            <Select value={form.rfq_id} onValueChange={v => handleRFQSelect(v === "__none" || v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select RFQ (optional)"/></SelectTrigger>
              <SelectContent><SelectItem value="__none">No RFQ</SelectItem>{rfqList.map(r=><SelectItem key={r.id} value={r.id}>{r.rfq_number} — {r.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Customer *</Label><Input value={form.customer_name} onChange={e=>u("customer_name",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{Object.keys(QUOTE_STATUS).map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Quote Date</Label><Input type="date" value={form.quote_date} onChange={e=>u("quote_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Valid Until</Label><Input type="date" value={form.valid_until} onChange={e=>u("valid_until",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Article Code</Label><Input value={form.article_code} onChange={e=>u("article_code",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Quantity</Label><Input type="number" value={form.quantity} onChange={e=>u("quantity",e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Product Description</Label><Textarea value={form.product_description} onChange={e=>u("product_description",e.target.value)} rows={2}/></div>

          {/* Costing breakdown */}
          <div className="col-span-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cost Breakdown ({form.currency})</p>
            <div className="grid grid-cols-3 gap-2">
              {[["Fabric Cost","fabric_cost"],["Trims","trim_cost"],["Accessories","accessory_cost"],["CM Cost","cm_cost"],["Overhead","overhead_cost"],["Freight","freight_cost"]].map(([l,k])=>(
                <div key={k} className="space-y-1"><Label className="text-[10px] text-muted-foreground">{l}</Label><Input type="number" step="0.0001" value={form[k]} onChange={e=>u(k,e.target.value)} className="h-7 text-xs"/></div>
              ))}
              <div className="space-y-1"><Label className="text-[10px] text-muted-foreground">Commission %</Label><Input type="number" step="0.1" value={form.commission_pct} onChange={e=>u("commission_pct",e.target.value)} className="h-7 text-xs"/></div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Total FOB (auto)</Label>
                <div className="h-7 flex items-center px-2 bg-muted/40 rounded text-xs font-semibold">{form.currency} {totFOB}</div>
              </div>
              <div className="space-y-1"><Label className="text-[10px] text-muted-foreground">Quoted Price *</Label><Input type="number" step="0.0001" value={form.quoted_price} onChange={e=>u("quoted_price",e.target.value)} className="h-7 text-xs border-primary"/></div>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-muted-foreground">Margin:</span>
              <span className={cn("text-sm font-bold", margin >= 15?"text-emerald-600":margin >= 8?"text-amber-600":"text-red-600")}>{margin}%</span>
              {form.buyer_counter_price > 0 && <span className="text-xs text-muted-foreground">Buyer counter: {form.currency} {form.buyer_counter_price}</span>}
            </div>
          </div>

          <div className="space-y-1.5"><Label className="text-xs">Lead Time (days)</Label><Input type="number" value={form.lead_time_days} onChange={e=>u("lead_time_days",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Ex-Factory Date</Label><Input type="date" value={form.ex_factory_date} onChange={e=>u("ex_factory_date",e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Negotiation Notes</Label><Textarea value={form.negotiation_notes} onChange={e=>u("negotiation_notes",e.target.value)} rows={2}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.customer_name||!form.quote_number}>{saving?"Saving…":"Save Quotation"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Complaint Form ────────────────────────────────────────────────────────
function ComplaintForm({ open, onOpenChange, onSave, initialData, pos, contacts, suppliers }) {
  const empty = {
    complaint_number:"", customer_name:"", contact_id:"", po_id:"",
    po_number:"", shipment_ref:"", received_date:new Date().toISOString().slice(0,10),
    category:"Quality – Stitching", severity:"Medium", status:"Open",
    description:"", quantity_affected:"", value_at_risk:"", currency:"USD",
    root_cause:"", corrective_action:"", preventive_action:"",
    credit_note_amount:"", replacement_quantity:"", resolution_date:"",
    resolved_by:"", target_resolution_date:"", supplier_id:"",
    supplier_notified:false, supplier_response:"", notes:"",
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v)=>setForm(p=>({...p,[k]:v}));

  React.useEffect(()=>{
    if(open) setForm(initialData?{...empty,...initialData,contact_id:initialData.contact_id||"",po_id:initialData.po_id||"",supplier_id:initialData.supplier_id||""}:{
      ...empty, complaint_number:`CMP-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`
    });
  },[open,initialData]);

  const handlePoSelect = (id)=>{
    const po = pos.find(p=>p.id===id);
    setForm(f=>({...f, po_id:id, po_number:po?.po_number||"", customer_name:po?.customer_name||f.customer_name}));
  };

  const handleSave = async()=>{
    setSaving(true);
    try { await onSave({...form, po_id:form.po_id||null, contact_id:form.contact_id||null, supplier_id:form.supplier_id||null, quantity_affected:form.quantity_affected?Number(form.quantity_affected):null, value_at_risk:form.value_at_risk?Number(form.value_at_risk):null, credit_note_amount:form.credit_note_amount?Number(form.credit_note_amount):null, replacement_quantity:form.replacement_quantity?Number(form.replacement_quantity):null }); }
    finally { setSaving(false); }
  };

  // SLA: Critical=24h, High=72h, Medium=7d, Low=14d
  const slaMap = { Critical:1, High:3, Medium:7, Low:14 };
  const suggestSLA = () => {
    if (!form.received_date || !form.severity) return;
    const d = new Date(form.received_date);
    d.setDate(d.getDate() + (slaMap[form.severity]||7));
    u("target_resolution_date", d.toISOString().slice(0,10));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData?"Edit Complaint":"Log Complaint"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="space-y-1.5"><Label className="text-xs">Complaint Number</Label><Input value={form.complaint_number} onChange={e=>u("complaint_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Received Date</Label><Input type="date" value={form.received_date} onChange={e=>u("received_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Customer *</Label><Input value={form.customer_name} onChange={e=>u("customer_name",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Linked PO</Label>
            <Select value={form.po_id} onValueChange={v => handlePoSelect(v === "__none" || v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select PO (optional)"/></SelectTrigger>
              <SelectContent><SelectItem value="__none">None</SelectItem>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Category *</Label>
            <Select value={form.category} onValueChange={v=>u("category",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{COMPLAINT_CATEGORIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Severity</Label>
            <Select value={form.severity} onValueChange={v=>{u("severity",v);setTimeout(suggestSLA,50);}}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["Critical","High","Medium","Low"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{Object.keys(COMPLAINT_STATUS_COLORS).map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Target Resolution Date</Label>
            <div className="flex gap-2"><Input type="date" value={form.target_resolution_date} onChange={e=>u("target_resolution_date",e.target.value)} className="flex-1"/>
              <Button type="button" size="sm" variant="outline" className="text-xs h-9 shrink-0 px-2" onClick={suggestSLA}>SLA</Button>
            </div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Qty Affected</Label><Input type="number" value={form.quantity_affected} onChange={e=>u("quantity_affected",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Value at Risk ({form.currency})</Label><Input type="number" step="0.01" value={form.value_at_risk} onChange={e=>u("value_at_risk",e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Description *</Label><Textarea value={form.description} onChange={e=>u("description",e.target.value)} rows={3} placeholder="Detailed description of the issue reported by the customer…"/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Root Cause Analysis</Label><Textarea value={form.root_cause} onChange={e=>u("root_cause",e.target.value)} rows={2}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Corrective Action</Label><Textarea value={form.corrective_action} onChange={e=>u("corrective_action",e.target.value)} rows={2}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Preventive Action</Label><Textarea value={form.preventive_action} onChange={e=>u("preventive_action",e.target.value)} rows={2}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Credit Note Amount</Label><Input type="number" step="0.01" value={form.credit_note_amount} onChange={e=>u("credit_note_amount",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Replacement Qty</Label><Input type="number" value={form.replacement_quantity} onChange={e=>u("replacement_quantity",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Resolution Date</Label><Input type="date" value={form.resolution_date} onChange={e=>u("resolution_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Resolved By</Label><Input value={form.resolved_by} onChange={e=>u("resolved_by",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Linked Supplier</Label>
            <Select value={form.supplier_id} onValueChange={v=>u("supplier_id",v)}>
              <SelectTrigger><SelectValue placeholder="None"/></SelectTrigger>
              <SelectContent><SelectItem value="__none">None</SelectItem>{suppliers.map(s=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.customer_name||!form.description}>{saving?"Saving…":"Save Complaint"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main CRM Page ─────────────────────────────────────────────────────────
export default function CRM() {
  const [tab, setTab] = useState("rfq");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const qc = useQueryClient();
  const { profile } = useAuth();

  const { data: rfqList=[], isLoading:rLoading } = useQuery({ queryKey:["rfqs"], queryFn:()=>rfqs.list() });
  const { data: quoteList=[], isLoading:qLoading } = useQuery({ queryKey:["quotations"], queryFn:()=>quotations.list() });
  const { data: complaintList=[], isLoading:cLoading } = useQuery({ queryKey:["complaints"], queryFn:()=>complaints.list() });
  const { data: contactList=[] } = useQuery({ queryKey:["buyerContacts"], queryFn:()=>buyerContacts.list() });
  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: suppList=[] } = useQuery({ queryKey:["suppliers"], queryFn:()=>db.suppliers.list() });

  const handleSave = async (data) => {
    if (tab==="rfq") {
      if (editing) { await rfqs.update(editing.id, data); } else { await rfqs.create(data); }
      qc.invalidateQueries({queryKey:["rfqs"]});
    } else if (tab==="quotations") {
      if (editing) { await quotations.update(editing.id, data); } else { await quotations.create(data); }
      qc.invalidateQueries({queryKey:["quotations"]});
    } else {
      if (editing) { await complaints.update(editing.id, data); } else { await complaints.create(data); }
      qc.invalidateQueries({queryKey:["complaints"]});
    }
    setShowForm(false); setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete?")) return;
    if (tab==="rfq") { await rfqs.delete(id); qc.invalidateQueries({queryKey:["rfqs"]}); }
    else if (tab==="quotations") { await quotations.delete(id); qc.invalidateQueries({queryKey:["quotations"]}); }
    else { await complaints.delete(id); qc.invalidateQueries({queryKey:["complaints"]}); }
  };

  const handleStatusChange = async (id, status) => {
    if (tab==="rfq") { await rfqs.update(id,{status}); qc.invalidateQueries({queryKey:["rfqs"]}); }
    else if (tab==="quotations") { await quotations.update(id,{status}); qc.invalidateQueries({queryKey:["quotations"]}); }
    else { await complaints.update(id,{status}); qc.invalidateQueries({queryKey:["complaints"]}); }
  };

  const stats = useMemo(()=>({
    rfq_open: rfqList.filter(r=>["New","In Review","Costing"].includes(r.status)).length,
    rfq_won: rfqList.filter(r=>r.status==="Won").length,
    quote_sent: quoteList.filter(q=>["Sent","Under Negotiation"].includes(q.status)).length,
    complaint_open: complaintList.filter(c=>!["Resolved","Closed"].includes(c.status)).length,
    complaint_critical: complaintList.filter(c=>c.severity==="Critical"&&!["Resolved","Closed"].includes(c.status)).length,
  }),[rfqList,quoteList,complaintList]);

  // Filter current list
  const currentList = tab==="rfq"?rfqList:tab==="quotations"?quoteList:complaintList;
  const filtered = useMemo(()=>currentList.filter(item=>{
    const ms = filterStatus==="all"||(item.status||"")=== filterStatus;
    const mq = !search||Object.values(item).some(v=>typeof v==="string"&&v.toLowerCase().includes(search.toLowerCase()));
    return ms&&mq;
  }),[currentList,filterStatus,search]);

  const TABS = [
    { id:"rfq",         label:"RFQ",        badge:stats.rfq_open,              color:"blue" },
    { id:"quotations",  label:"Quotations",  badge:stats.quote_sent,            color:"violet" },
    { id:"complaints",  label:"Complaints",  badge:stats.complaint_open,        color:stats.complaint_critical>0?"red":"amber" },
  ];

  const isLoading = tab==="rfq"?rLoading:tab==="quotations"?qLoading:cLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Briefcase className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">CRM</h1></div>
        <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}} className="gap-1.5"><Plus className="h-4 w-4"/>
          New {tab==="rfq"?"RFQ":tab==="quotations"?"Quotation":"Complaint"}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard title="Open RFQs" value={stats.rfq_open} icon={FileText} iconBg="bg-blue-100"/>
        <StatCard title="RFQs Won" value={stats.rfq_won} icon={TrendingUp} iconBg="bg-emerald-100"/>
        <StatCard title="Quotes Active" value={stats.quote_sent} icon={DollarSign} iconBg="bg-violet-100"/>
        <StatCard title="Open Complaints" value={stats.complaint_open} icon={AlertTriangle} iconBg={stats.complaint_open>0?"bg-amber-100":"bg-muted/50"}/>
        <StatCard title="Critical Issues" value={stats.complaint_critical} icon={AlertTriangle} iconBg={stats.complaint_critical>0?"bg-red-100":"bg-muted/50"}/>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>{setTab(t.id);setFilterStatus("all");setSearch("");}}
            className={cn("flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab===t.id?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
            {t.badge>0&&<span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
              t.color==="red"?"bg-red-500 text-white":t.color==="amber"?"bg-amber-500 text-white":"bg-primary/10 text-primary"
            )}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
        <Select value={filterStatus} onValueChange={v => setFilterStatus(v === "__none" || v === "__all" ? "" : v)}>
          <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Statuses"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {(tab==="rfq"?Object.keys(RFQ_STATUS):tab==="quotations"?Object.keys(QUOTE_STATUS):Object.keys(COMPLAINT_STATUS_COLORS)).map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div>
      ) : filtered.length===0 ? (
        <EmptyState icon={tab==="rfq"?FileText:tab==="quotations"?DollarSign:AlertTriangle}
          title={tab==="rfq"?"No RFQs yet":tab==="quotations"?"No quotations yet":"No complaints logged"}
          description={tab==="rfq"?"Track incoming Requests for Quotation from buyers. Link them to costing sheets and convert won RFQs into purchase orders.":tab==="quotations"?"Create detailed quotations with cost breakdowns, margin calculations, and revision history.":"Log and track buyer complaints with full root cause and corrective action tracking."}
          actionLabel={`New ${tab==="rfq"?"RFQ":tab==="quotations"?"Quotation":"Complaint"}`} onAction={()=>setShowForm(true)}/>
      ) : (
        <div className="space-y-2">
          {/* ── RFQ list ── */}
          {tab==="rfq" && filtered.map(rfq=>{
            const isOverdue = rfq.due_date && isPast(new Date(rfq.due_date)) && !["Won","Lost","Cancelled"].includes(rfq.status);
            const daysLeft = rfq.due_date ? differenceInDays(new Date(rfq.due_date), new Date()) : null;
            return (
              <Card key={rfq.id} className={cn("hover:shadow-sm", isOverdue&&"border-red-200 bg-red-50/20")}>
                <CardContent className="p-4 flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{rfq.rfq_number}</span>
                      <StatusPill status={rfq.status} map={RFQ_STATUS}/>
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{rfq.product_category}</span>
                      {isOverdue&&<span className="text-[10px] text-red-600 font-semibold flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5"/>OVERDUE</span>}
                    </div>
                    <p className="text-sm font-medium">{rfq.customer_name}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Received: {fmt(rfq.received_date)}</span>
                      {rfq.due_date&&<span className={cn(isOverdue?"text-red-600 font-semibold":"",daysLeft!==null&&daysLeft<=3&&!isOverdue?"text-amber-600 font-semibold":"")}>Due: {fmt(rfq.due_date)}{daysLeft!==null&&!isOverdue?` (${daysLeft}d)`:""}</span>}
                      {rfq.estimated_quantity&&<span>{rfq.estimated_quantity.toLocaleString()} pcs</span>}
                      {rfq.target_price&&<span>Target: {rfq.target_price_currency} {rfq.target_price}</span>}
                      {rfq.assigned_to&&<span>Assigned: {rfq.assigned_to}</span>}
                    </div>
                    {rfq.description&&<p className="text-xs text-muted-foreground truncate">{rfq.description}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0 flex-wrap">
                    {rfq.status==="New"&&<Button size="sm" variant="outline" className="text-xs h-7" onClick={()=>handleStatusChange(rfq.id,"In Review")}>Start Review</Button>}
                    {rfq.status==="Costing"&&<Button size="sm" variant="outline" className="text-xs h-7" onClick={()=>handleStatusChange(rfq.id,"Sent")}>Mark Sent</Button>}
                    {rfq.status==="Sent"&&<>
                      <Button size="sm" className="text-xs h-7 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={()=>handleStatusChange(rfq.id,"Won")}>Won</Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 border-red-200 text-red-600" onClick={()=>handleStatusChange(rfq.id,"Lost")}>Lost</Button>
                    </>}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>{setEditing(rfq);setShowForm(true);}}><Pencil className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>handleDelete(rfq.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* ── Quotation list ── */}
          {tab==="quotations" && filtered.map(q=>{
            const marginClr = q.margin_pct>=15?"text-emerald-600":q.margin_pct>=8?"text-amber-600":"text-red-600";
            return (
              <Card key={q.id} className="hover:shadow-sm">
                <CardContent className="p-4 flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{q.quote_number}</span>
                      <StatusPill status={q.status} map={QUOTE_STATUS}/>
                      {q.revision_number>1&&<span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Rev {q.revision_number}</span>}
                    </div>
                    <p className="text-sm font-medium">{q.customer_name}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {q.article_code&&<span>Article: <span className="font-medium text-foreground">{q.article_code}</span></span>}
                      {q.quantity&&<span>{q.quantity.toLocaleString()} pcs</span>}
                      {q.quoted_price>0&&<span>Quoted: <span className="font-bold text-foreground">{q.currency} {Number(q.quoted_price).toFixed(4)}/pc</span></span>}
                      {q.margin_pct!=null&&<span className={cn("font-semibold",marginClr)}>Margin: {q.margin_pct}%</span>}
                      {q.valid_until&&<span>Valid: {fmt(q.valid_until)}</span>}
                      {q.lead_time_days&&<span>LT: {q.lead_time_days}d</span>}
                    </div>
                    {q.negotiation_notes&&<p className="text-xs text-muted-foreground italic truncate">{q.negotiation_notes}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0 flex-wrap">
                    {q.status==="Draft"&&<Button size="sm" variant="outline" className="text-xs h-7" onClick={()=>handleStatusChange(q.id,"Sent")}>Mark Sent</Button>}
                    {q.status==="Sent"&&<Button size="sm" variant="outline" className="text-xs h-7" onClick={()=>handleStatusChange(q.id,"Under Negotiation")}>Negotiating</Button>}
                    {q.status==="Under Negotiation"&&<Button size="sm" className="text-xs h-7 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={()=>handleStatusChange(q.id,"Accepted")}>Accepted</Button>}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>{setEditing(q);setShowForm(true);}}><Pencil className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>handleDelete(q.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* ── Complaint list ── */}
          {tab==="complaints" && filtered.map(c=>{
            const isOverdue = c.target_resolution_date && isPast(new Date(c.target_resolution_date)) && !["Resolved","Closed"].includes(c.status);
            return (
              <Card key={c.id} className={cn("hover:shadow-sm", c.severity==="Critical"&&!["Resolved","Closed"].includes(c.status)&&"border-red-300 bg-red-50/20")}>
                <CardContent className="p-4 flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{c.complaint_number}</span>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full",COMPLAINT_STATUS_COLORS[c.status]||"")}>{c.status}</span>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded border",COMPLAINT_SEV[c.severity]||"")}>{c.severity}</span>
                      {isOverdue&&<span className="text-[10px] text-red-600 font-semibold flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5"/>SLA BREACHED</span>}
                    </div>
                    <p className="text-sm font-medium">{c.customer_name}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {c.po_number&&<span>PO: <span className="text-primary font-medium">{c.po_number}</span></span>}
                      <span className="font-medium text-foreground">{c.category}</span>
                      {c.quantity_affected&&<span>{c.quantity_affected.toLocaleString()} pcs affected</span>}
                      {c.value_at_risk&&<span>Risk: {c.currency} {Number(c.value_at_risk).toLocaleString()}</span>}
                      <span>Received: {fmt(c.received_date)}</span>
                      {c.target_resolution_date&&<span className={cn(isOverdue?"text-red-600 font-semibold":"")}>Target: {fmt(c.target_resolution_date)}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{c.description}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0 flex-wrap">
                    {c.status==="Open"&&<Button size="sm" variant="outline" className="text-xs h-7" onClick={()=>handleStatusChange(c.id,"Acknowledged")}>Acknowledge</Button>}
                    {c.status==="Acknowledged"&&<Button size="sm" variant="outline" className="text-xs h-7" onClick={()=>handleStatusChange(c.id,"Under Investigation")}>Investigate</Button>}
                    {c.status==="Under Investigation"&&<Button size="sm" className="text-xs h-7 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={()=>handleStatusChange(c.id,"Resolved")}>Resolve</Button>}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>{setEditing(c);setShowForm(true);}}><Pencil className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>handleDelete(c.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Forms */}
      {showForm && tab==="rfq" && <RFQForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} contacts={contactList} pos={pos}/>}
      {showForm && tab==="quotations" && <QuotationForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} rfqList={rfqList} contacts={contactList}/>}
      {showForm && tab==="complaints" && <ComplaintForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} pos={pos} contacts={contactList} suppliers={suppList}/>}
    </div>
  );
}

