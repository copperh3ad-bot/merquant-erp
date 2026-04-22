import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { poBatches, batchItems, splitSnapshots } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  Split, Package, AlertTriangle, Zap, ArrowRight,
  History, Calendar
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────
const SPLIT_REASONS = [
  "Customer Defined",
  "Delay – Production",
  "Delay – Fabric/Material",
  "Delay – Approval",
  "Urgency – Customer Request",
  "Urgency – LC Expiry",
  "Production Batch",
  "LC Amendment",
  "Other",
];
const REASON_ICONS = {
  "Customer Defined":          "👤",
  "Delay – Production":        "🏭",
  "Delay – Fabric/Material":   "🧵",
  "Delay – Approval":          "⏳",
  "Urgency – Customer Request":"🚨",
  "Urgency – LC Expiry":       "💳",
  "Production Batch":          "📦",
  "LC Amendment":              "📄",
  "Other":                     "📋",
};
const BATCH_STATUSES = [
  "Planned","In Production","QC Inspection",
  "Ready to Ship","Shipped","At Port","Delivered","Cancelled",
];
const STATUS_STYLES = {
  "Planned":         "bg-gray-100 text-gray-700 border-gray-200",
  "In Production":   "bg-blue-100 text-blue-700 border-blue-200",
  "QC Inspection":   "bg-violet-100 text-violet-700 border-violet-200",
  "Ready to Ship":   "bg-amber-100 text-amber-700 border-amber-200",
  "Shipped":         "bg-teal-100 text-teal-700 border-teal-200",
  "At Port":         "bg-cyan-100 text-cyan-700 border-cyan-200",
  "Delivered":       "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Cancelled":       "bg-red-100 text-red-500 border-red-200",
};
// Statuses indicating a PO is already being executed
const MID_EXEC_STATUSES = [
  "Items Entered","Price Verification","Price Approved","CBM Calculated",
  "FWS Prepared","Yarn Planned","Accessories Planned","Packaging Planned",
  "In Production","QC Inspection","Ready to Ship",
];
const fmt  = (d) => { try { return d ? format(new Date(d), "dd MMM yy")   : "—"; } catch { return "—"; } };
const fmtL = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

// ── Item Allocation Dialog ─────────────────────────────────────────────────
function BatchItemEditor({ batch, poItems, onSave, onClose }) {
  const { data: existing = [] } = useQuery({
    queryKey: ["batchItems", batch.id],
    queryFn:  () => batchItems.listByBatch(batch.id),
  });
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(poItems.map(i => [i.id, 0]))
  );
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (existing.length) {
      const q = Object.fromEntries(poItems.map(i => [i.id, 0]));
      existing.forEach(bi => { q[bi.po_item_id] = bi.batch_quantity; });
      setQuantities(q);
    }
  }, [existing]);

  const totalAllocated = Object.values(quantities).reduce((s, v) => s + (Number(v) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rows = poItems.filter(i => Number(quantities[i.id]) > 0).map(i => ({
        batch_id: batch.id, po_item_id: i.id, po_id: i.po_id,
        item_code: i.item_code, item_description: i.item_description,
        batch_quantity: Number(quantities[i.id]),
        unit_price: i.unit_price,
        total_price: Number(quantities[i.id]) * Number(i.unit_price || 0),
        cbm: i.cbm && i.quantity > 0
          ? +((i.cbm / i.quantity) * Number(quantities[i.id])).toFixed(4)
          : null,
      }));
      await batchItems.upsert(rows);
      const tQty = rows.reduce((s, r) => s + r.batch_quantity, 0);
      const tVal = rows.reduce((s, r) => s + (r.total_price || 0), 0);
      const tCbm = rows.reduce((s, r) => s + (r.cbm || 0), 0);
      await poBatches.update(batch.id, {
        total_quantity: tQty,
        total_value: +tVal.toFixed(2),
        total_cbm: tCbm > 0 ? +tCbm.toFixed(4) : null,
      });
      onSave(); onClose();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary"/>
            Allocate Items — {batch.batch_number}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          Enter how many pieces of each item go into this batch. Leave 0 to exclude.
        </p>
        <div className="space-y-1.5">
          <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-muted-foreground uppercase px-1">
            <span className="col-span-4">Item Code</span>
            <span className="col-span-4">Description</span>
            <span className="col-span-2 text-right">PO Qty</span>
            <span className="col-span-2 text-right">Batch Qty</span>
          </div>
          {poItems.map(item => (
            <div key={item.id} className="grid grid-cols-12 gap-2 items-center border border-border/50 rounded-lg px-3 py-2 hover:bg-muted/20">
              <span className="col-span-4 text-xs font-medium">{item.item_code || "—"}</span>
              <span className="col-span-4 text-xs text-muted-foreground truncate">{item.item_description || "—"}</span>
              <span className="col-span-2 text-xs text-right text-muted-foreground">{(item.quantity || 0).toLocaleString()}</span>
              <div className="col-span-2">
                <Input type="number" min="0" max={item.quantity}
                  value={quantities[item.id] || ""}
                  onChange={e => setQuantities(q => ({ ...q, [item.id]: e.target.value }))}
                  className="h-7 text-xs text-right" placeholder="0"/>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 border-t">
          <p className="text-sm font-medium">Total: <span className="font-bold text-primary">{totalAllocated.toLocaleString()} pcs</span></p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || totalAllocated === 0}>
              {saving ? "Saving…" : "Save Allocation"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Mid-Execution Split Wizard ─────────────────────────────────────────────
function MidExecutionWizard({ po, poItems, existingBatches, onComplete, onClose }) {
  const { profile } = useAuth();
  const [step, setStep] = useState(1);
  const [splitReason, setSplitReason] = useState("Delay – Production");
  const [delayNotes, setDelayNotes] = useState("");
  const [batchALabel, setBatchALabel] = useState("On Track");
  const [batchADate, setBatchADate] = useState(po.ex_factory_date || "");
  const [batchAStatus, setBatchAStatus] = useState("In Production");
  const [batchBLabel, setBatchBLabel] = useState("Delayed");
  const [batchBDate, setBatchBDate] = useState("");
  const [batchBStatus, setBatchBStatus] = useState("Planned");
  const [batchAQty, setBatchAQty] = useState(() =>
    Object.fromEntries(poItems.map(i => [i.id, i.quantity || 0]))
  );
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const nextSeq = (existingBatches.length > 0
    ? Math.max(...existingBatches.map(b => b.batch_sequence || 0))
    : 0) + 1;

  const totalPoQty     = poItems.reduce((s, i) => s + (i.quantity || 0), 0);
  const batchAQtyTotal = Object.values(batchAQty).reduce((s, v) => s + (Number(v) || 0), 0);
  const batchBQtyTotal = totalPoQty - batchAQtyTotal;
  const batchBQty = useMemo(() =>
    Object.fromEntries(poItems.map(i => [i.id, Math.max(0, (i.quantity || 0) - (Number(batchAQty[i.id]) || 0))])),
    [poItems, batchAQty]
  );

  const handleExecute = async () => {
    setSaving(true);
    try {
      const itemsSnapshot = poItems.map(i => ({
        item_code: i.item_code, description: i.item_description,
        po_qty: i.quantity,
        batch_a_qty: Number(batchAQty[i.id]) || 0,
        batch_b_qty: Math.max(0, (i.quantity || 0) - (Number(batchAQty[i.id]) || 0)),
      }));
      const basePayload = {
        po_id: po.id, po_number: po.po_number,
        split_reason: splitReason,
        is_mid_execution: true,
        split_at_status: po.status,
        split_date: new Date().toISOString(),
        split_initiated_by: profile?.full_name || "User",
        original_ex_factory_date: po.ex_factory_date || null,
      };
      const batchA = await poBatches.create({
        ...basePayload,
        batch_number: `${po.po_number}/B${nextSeq}`,
        batch_sequence: nextSeq,
        ex_factory_date: batchADate || null,
        status: batchAStatus,
        total_quantity: batchAQtyTotal,
        notes: `Batch A (${batchALabel}) — split from ${po.po_number} while "${po.status}"`,
      });
      const batchB = await poBatches.create({
        ...basePayload,
        batch_number: `${po.po_number}/B${nextSeq + 1}`,
        batch_sequence: nextSeq + 1,
        ex_factory_date: batchBDate || null,
        revised_ex_factory_date: batchBDate || null,
        status: batchBStatus,
        total_quantity: batchBQtyTotal,
        delay_reason: delayNotes || null,
        notes: `Batch B (${batchBLabel}) — split from ${po.po_number} while "${po.status}"${delayNotes ? `. ${delayNotes}` : ""}`,
      });
      const aRows = poItems.filter(i => Number(batchAQty[i.id]) > 0).map(i => ({
        batch_id: batchA.id, po_item_id: i.id, po_id: i.po_id,
        item_code: i.item_code, item_description: i.item_description,
        batch_quantity: Number(batchAQty[i.id]),
        unit_price: i.unit_price,
        total_price: Number(batchAQty[i.id]) * Number(i.unit_price || 0),
      }));
      const bRows = poItems.filter(i => batchBQty[i.id] > 0).map(i => ({
        batch_id: batchB.id, po_item_id: i.id, po_id: i.po_id,
        item_code: i.item_code, item_description: i.item_description,
        batch_quantity: batchBQty[i.id],
        unit_price: i.unit_price,
        total_price: batchBQty[i.id] * Number(i.unit_price || 0),
      }));
      if (aRows.length) await batchItems.upsert(aRows);
      if (bRows.length) await batchItems.upsert(bRows);
      await splitSnapshots.create({
        po_id: po.id, batch_id: batchA.id,
        po_status_at_split: po.status,
        items_snapshot: itemsSnapshot,
        notes: delayNotes || null,
      });
      qc.invalidateQueries({ queryKey: ["poBatches", po.id] });
      onComplete(); onClose();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500"/>
            Mid-Execution Split Wizard
            <span className="text-xs font-normal text-muted-foreground ml-1">
              PO: <span className="font-semibold text-foreground">{po.status}</span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {[1,2,3].map(s => (
            <React.Fragment key={s}>
              <div className={cn("h-7 w-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0",
                step > s ? "bg-emerald-500 text-white" : step === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>{step > s ? "✓" : s}</div>
              {s < 3 && <div className={cn("h-0.5 flex-1 rounded-full", step > s ? "bg-emerald-400" : "bg-muted")}/>}
            </React.Fragment>
          ))}
          <span className="text-xs text-muted-foreground ml-2 whitespace-nowrap">
            {step === 1 ? "Reason for split" : step === 2 ? "Configure batches" : "Allocate quantities"}
          </span>
        </div>

        {/* Step 1 — Reason */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5"/>
              <div className="text-xs text-amber-800">
                <p className="font-semibold">PO is currently "{po.status}"</p>
                <p className="mt-0.5">This will create two independent batches from today. Each batch gets its own dates, shipment, commercial invoice, and payment. A snapshot of the current state is saved for audit.</p>
              </div>
            </div>
            <Label className="text-xs font-semibold">Why is this PO being split now?</Label>
            <div className="grid grid-cols-1 gap-1.5">
              {SPLIT_REASONS.map(r => (
                <button key={r} onClick={() => setSplitReason(r)}
                  className={cn("flex items-center gap-3 px-4 py-2.5 border rounded-xl text-left transition-all",
                    splitReason === r ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                  )}>
                  <span className="text-base">{REASON_ICONS[r]}</span>
                  <span className="text-sm font-medium">{r}</span>
                </button>
              ))}
            </div>
            {splitReason.includes("Delay") && (
              <div className="space-y-1.5">
                <Label className="text-xs">Describe the delay (optional)</Label>
                <Textarea value={delayNotes} onChange={e => setDelayNotes(e.target.value)} rows={2}
                  placeholder="e.g. Fabric from mill delayed 3 weeks. Cutting not started for styles X, Y"/>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — Batch config */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Set independent dates and status for each batch.</p>
            <div className="border border-blue-200 bg-blue-50/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">A</div>
                <span className="text-sm font-semibold text-blue-800">Batch A — Ready / On Track</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Label</Label><Input value={batchALabel} onChange={e=>setBatchALabel(e.target.value)} className="h-8 text-xs"/></div>
                <div className="space-y-1.5"><Label className="text-xs">Status</Label>
                  <Select value={batchAStatus} onValueChange={setBatchAStatus}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                    <SelectContent>{BATCH_STATUSES.map(s=><SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5"><Label className="text-xs">Ex-Factory Date</Label><Input type="date" value={batchADate} onChange={e=>setBatchADate(e.target.value)} className="h-8 text-xs"/></div>
              </div>
            </div>
            <div className="border border-amber-200 bg-amber-50/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">B</div>
                <span className="text-sm font-semibold text-amber-800">Batch B — Delayed / Later</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Label</Label><Input value={batchBLabel} onChange={e=>setBatchBLabel(e.target.value)} className="h-8 text-xs"/></div>
                <div className="space-y-1.5"><Label className="text-xs">Status</Label>
                  <Select value={batchBStatus} onValueChange={setBatchBStatus}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                    <SelectContent>{BATCH_STATUSES.map(s=><SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">Revised Ex-Factory Date</Label>
                  <Input type="date" value={batchBDate} onChange={e=>setBatchBDate(e.target.value)} className="h-8 text-xs"/>
                  {po.ex_factory_date && <p className="text-[10px] text-amber-600">Original was: {fmtL(po.ex_factory_date)}</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3 — Quantities */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Set Batch A quantities — Batch B gets the remainder automatically.</p>
              <Button size="sm" variant="outline" className="text-xs h-6"
                onClick={() => setBatchAQty(Object.fromEntries(poItems.map(i => [i.id, i.quantity || 0])))}>
                All → A
              </Button>
            </div>
            <div className="bg-muted/30 rounded-xl px-4 py-2.5 space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span>PO Total: {totalPoQty.toLocaleString()}</span>
                <span>
                  <span className="text-blue-600">A: {batchAQtyTotal.toLocaleString()}</span>
                  {" · "}
                  <span className="text-amber-600">B: {batchBQtyTotal.toLocaleString()}</span>
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                <div className="h-full bg-blue-400 transition-all" style={{ width: `${totalPoQty > 0 ? (batchAQtyTotal/totalPoQty)*100 : 0}%`}}/>
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${totalPoQty > 0 ? (batchBQtyTotal/totalPoQty)*100 : 0}%`}}/>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-muted-foreground uppercase px-1">
                <span className="col-span-4">Item</span>
                <span className="col-span-3 text-right">PO Qty</span>
                <span className="col-span-2.5 text-center text-blue-600">Batch A</span>
                <span className="col-span-2.5 text-center text-amber-600">Batch B</span>
              </div>
              {poItems.map(item => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center border border-border/50 rounded-lg px-3 py-2">
                  <div className="col-span-4">
                    <p className="text-xs font-medium">{item.item_code||"—"}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.item_description||""}</p>
                  </div>
                  <span className="col-span-3 text-xs text-right text-muted-foreground">{(item.quantity||0).toLocaleString()}</span>
                  <div className="col-span-2.5 flex justify-center">
                    <Input type="number" min="0" max={item.quantity}
                      value={batchAQty[item.id]||""}
                      onChange={e => setBatchAQty(q => ({...q,[item.id]:e.target.value}))}
                      className="h-7 text-xs text-center w-20 border-blue-300"/>
                  </div>
                  <div className="col-span-2.5 flex justify-center">
                    <span className={cn("text-xs font-semibold px-2 py-1 rounded",
                      batchBQty[item.id] > 0 ? "bg-amber-100 text-amber-700" : "text-muted-foreground"
                    )}>{batchBQty[item.id]}</span>
                  </div>
                </div>
              ))}
            </div>
            {batchBQtyTotal <= 0 && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0"/>
                Batch B is empty — reduce Batch A quantities to create a meaningful split.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && <Button variant="outline" size="sm" onClick={() => setStep(s => s-1)}>Back</Button>}
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          {step < 3
            ? <Button size="sm" onClick={() => setStep(s => s+1)} className="gap-1">Next <ArrowRight className="h-3.5 w-3.5"/></Button>
            : <Button size="sm" onClick={handleExecute} disabled={saving||batchBQtyTotal<=0}
                className="bg-amber-500 hover:bg-amber-600 text-white gap-1.5">
                {saving ? "Splitting…" : <><Zap className="h-3.5 w-3.5"/>Execute Split</>}
              </Button>
          }
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Batch Form (manual add/edit) ───────────────────────────────────────────
function BatchForm({ open, onOpenChange, onSave, initialData, po, nextSequence }) {
  const empty = {
    batch_number: `${po.po_number}/B${nextSequence}`,
    batch_sequence: nextSequence,
    split_reason: "Customer Defined",
    ex_factory_date:"", etd:"", eta:"", delivery_date:"",
    total_quantity:"", total_value:"", currency: po.currency||"USD",
    status:"Planned", notes:"",
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p => ({...p,[k]:v}));
  React.useEffect(() => {
    if (open) setForm(initialData ? {...empty,...initialData} : {...empty,batch_number:`${po.po_number}/B${nextSequence}`,batch_sequence:nextSequence});
  }, [open,initialData,nextSequence]);
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({...form,po_id:po.id,po_number:po.po_number,
        batch_sequence:Number(form.batch_sequence)||nextSequence,
        total_quantity:form.total_quantity?Number(form.total_quantity):null,
        total_value:form.total_value?Number(form.total_value):null,
      });
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData?"Edit Batch":"Add Batch"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5"><Label className="text-xs">Batch Number</Label><Input value={form.batch_number} onChange={e=>u("batch_number",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Sequence #</Label><Input type="number" min="1" value={form.batch_sequence} onChange={e=>u("batch_sequence",e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Reason</Label>
            <Select value={form.split_reason} onValueChange={v=>u("split_reason",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{SPLIT_REASONS.map(r=><SelectItem key={r} value={r}>{REASON_ICONS[r]} {r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Ex-Factory</Label><Input type="date" value={form.ex_factory_date} onChange={e=>u("ex_factory_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">ETD</Label><Input type="date" value={form.etd} onChange={e=>u("etd",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">ETA</Label><Input type="date" value={form.eta} onChange={e=>u("eta",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Delivery Date</Label><Input type="date" value={form.delivery_date} onChange={e=>u("delivery_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Total Quantity</Label><Input type="number" value={form.total_quantity} onChange={e=>u("total_quantity",e.target.value)} placeholder="Auto from items"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Total Value</Label><Input type="number" step="0.01" value={form.total_value} onChange={e=>u("total_value",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{BATCH_STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Currency</Label>
            <Select value={form.currency} onValueChange={v=>u("currency",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["USD","EUR","GBP","PKR","BDT"].map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.batch_number}>{saving?"Saving…":"Save Batch"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function POBatches({ po, poItems }) {
  const [showForm, setShowForm] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [allocatingBatch, setAllocatingBatch] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const qc = useQueryClient();

  const { data: batches = [] } = useQuery({ queryKey:["poBatches",po.id], queryFn:()=>poBatches.listByPO(po.id) });
  const { data: snapshots = [] } = useQuery({ queryKey:["splitSnapshots",po.id], queryFn:()=>splitSnapshots.listByPO(po.id) });

  const isMidExec  = MID_EXEC_STATUSES.includes(po.status);
  const hasBatches = batches.length > 0;
  const nextSeq    = (hasBatches ? Math.max(...batches.map(b=>b.batch_sequence||0)) : 0) + 1;
  const totalPoQty = poItems.reduce((s,i)=>s+(i.quantity||0),0);
  const allocatedQty = batches.reduce((s,b)=>s+(b.total_quantity||0),0);
  const remainingQty = totalPoQty - allocatedQty;

  const handleSave = async (data) => {
    if (editingBatch) { await poBatches.update(editingBatch.id,data); }
    else { await poBatches.create(data); }
    qc.invalidateQueries({queryKey:["poBatches",po.id]});
    setShowForm(false); setEditingBatch(null);
  };
  const handleDelete = async (id) => {
    if (!confirm("Delete batch? All item allocations removed.")) return;
    await poBatches.delete(id);
    qc.invalidateQueries({queryKey:["poBatches",po.id]});
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <button onClick={()=>setExpanded(v=>!v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/20 transition-colors">
        <div className="flex items-center gap-2.5">
          {expanded?<ChevronDown className="h-4 w-4 text-muted-foreground"/>:<ChevronRight className="h-4 w-4 text-muted-foreground"/>}
          <Split className="h-4 w-4 text-primary"/>
          <span className="text-sm font-semibold">Shipment Batches</span>
          {hasBatches && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{batches.length} batch{batches.length!==1?"es":""}</span>}
          {isMidExec && !hasBatches && (
            <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
              <Zap className="h-2.5 w-2.5"/> Split available
            </span>
          )}
        </div>
        <div className="flex items-center gap-2" onClick={e=>e.stopPropagation()}>
          {hasBatches && totalPoQty > 0 && (
            <span className={cn("text-xs font-medium", remainingQty>0?"text-amber-600":"text-emerald-600")}>
              {remainingQty>0?`${remainingQty.toLocaleString()} unallocated`:"✓ Fully allocated"}
            </span>
          )}
          {isMidExec && (
            <Button size="sm" className="text-xs gap-1 h-7 bg-amber-500 hover:bg-amber-600 text-white"
              onClick={()=>setShowWizard(true)}>
              <Zap className="h-3 w-3"/> Split Now
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-xs gap-1 h-7"
            onClick={()=>{setEditingBatch(null);setShowForm(true);}}>
            <Plus className="h-3 w-3"/> Manual
          </Button>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {!hasBatches ? (
            <div className="px-5 py-5 space-y-3">
              <p className="text-sm text-muted-foreground">No batches — this PO ships as a single consignment.</p>
              {isMidExec && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <Zap className="h-4 w-4 text-amber-600 shrink-0 mt-0.5"/>
                  <div>
                    <p className="text-sm font-semibold text-amber-800">PO is in "{po.status}" — you can split it right now</p>
                    <p className="text-xs text-amber-700 mt-0.5">Use the wizard to create two batches mid-execution. Each gets its own timeline, CI, shipment, and payment. Current state is snapshotted for audit.</p>
                    <Button size="sm" className="mt-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs gap-1.5" onClick={()=>setShowWizard(true)}>
                      <Zap className="h-3 w-3"/> Launch Split Wizard
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Allocation bar */}
              {totalPoQty > 0 && (
                <div className="px-4 pt-3 pb-2 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Quantity allocation</span>
                    <span className="font-medium">{allocatedQty.toLocaleString()} / {totalPoQty.toLocaleString()} pcs</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                    {batches.map((b,i)=>{
                      const pct = totalPoQty>0?((b.total_quantity||0)/totalPoQty)*100:0;
                      const cols=["bg-blue-400","bg-amber-400","bg-violet-400","bg-emerald-400","bg-pink-400","bg-cyan-400"];
                      return <div key={b.id} className={cn("h-full transition-all",cols[i%cols.length])} style={{width:`${pct}%`}} title={`${b.batch_number}: ${(b.total_quantity||0).toLocaleString()}`}/>;
                    })}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {batches.map((b,i)=>{
                      const tcols=["text-blue-600","text-amber-600","text-violet-600","text-emerald-600","text-pink-600","text-cyan-600"];
                      return <span key={b.id} className={cn("text-[10px] font-medium flex items-center gap-0.5",tcols[i%tcols.length])}>
                        {b.is_mid_execution&&<Zap className="h-2.5 w-2.5"/>}{b.batch_number}: {(b.total_quantity||0).toLocaleString()}
                      </span>;
                    })}
                  </div>
                </div>
              )}

              {/* Batch rows */}
              <div className="divide-y divide-border/50">
                {batches.map(batch => (
                  <div key={batch.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-bold">{batch.batch_number}</span>
                          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border",STATUS_STYLES[batch.status]||"bg-gray-100 text-gray-600 border-gray-200")}>{batch.status}</span>
                          <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">{REASON_ICONS[batch.split_reason]} {batch.split_reason}</span>
                          {batch.is_mid_execution && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                              <Zap className="h-2.5 w-2.5"/> Split at: {batch.split_at_status}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-1">
                          {/* Show revised date with strikethrough if changed */}
                          {batch.original_ex_factory_date && batch.revised_ex_factory_date && batch.original_ex_factory_date !== batch.revised_ex_factory_date ? (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-red-400"/>
                              <span className="line-through text-red-400">{fmt(batch.original_ex_factory_date)}</span>
                              <ArrowRight className="h-2.5 w-2.5 text-amber-500"/>
                              <span className="font-medium text-amber-600">{fmt(batch.revised_ex_factory_date)}</span>
                            </span>
                          ) : batch.ex_factory_date ? (
                            <span>Ex-Factory: <span className="font-medium text-foreground">{fmt(batch.ex_factory_date)}</span></span>
                          ) : null}
                          {batch.etd&&<span>ETD: <span className="font-medium text-foreground">{fmt(batch.etd)}</span></span>}
                          {batch.eta&&<span>ETA: <span className="font-medium text-foreground">{fmt(batch.eta)}</span></span>}
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs">
                          {batch.total_quantity>0&&<span><span className="text-muted-foreground">Qty:</span> <span className="font-semibold">{batch.total_quantity.toLocaleString()} pcs</span></span>}
                          {batch.total_value>0&&<span><span className="text-muted-foreground">Value:</span> <span className="font-semibold">{batch.currency} {Number(batch.total_value).toLocaleString()}</span></span>}
                          {batch.total_cbm>0&&<span><span className="text-muted-foreground">CBM:</span> <span className="font-semibold">{Number(batch.total_cbm).toFixed(3)}</span></span>}
                          {batch.split_initiated_by&&<span className="text-muted-foreground">Split by: {batch.split_initiated_by}</span>}
                        </div>
                        {(batch.delay_reason||batch.notes)&&<p className="text-xs text-muted-foreground italic mt-1">{batch.delay_reason||batch.notes}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={()=>setAllocatingBatch(batch)}>
                          <Package className="h-3 w-3"/> Items
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>{setEditingBatch(batch);setShowForm(true);}}>
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground"/>
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>handleDelete(batch.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground"/>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Split history */}
              {snapshots.length > 0 && (
                <div className="border-t border-border/50 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <History className="h-3.5 w-3.5 text-muted-foreground"/>
                    <span className="text-xs font-semibold text-muted-foreground">Split History ({snapshots.length})</span>
                  </div>
                  {snapshots.map(s => (
                    <div key={s.id} className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 mb-1">
                      Split on {fmtL(s.snapshot_date)} — PO was <span className="font-medium text-foreground">{s.po_status_at_split}</span>
                      {s.notes&&<span className="italic"> · {s.notes}</span>}
                      <span className="ml-2 text-[10px]">({(s.items_snapshot||[]).length} items captured)</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showForm&&<BatchForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditingBatch(null);}} onSave={handleSave} initialData={editingBatch} po={po} nextSequence={nextSeq}/>}
      {allocatingBatch&&<BatchItemEditor batch={allocatingBatch} poItems={poItems} onSave={()=>qc.invalidateQueries({queryKey:["poBatches",po.id]})} onClose={()=>setAllocatingBatch(null)}/>}
      {showWizard&&<MidExecutionWizard po={po} poItems={poItems} existingBatches={batches} onComplete={()=>qc.invalidateQueries({queryKey:["poBatches",po.id]})} onClose={()=>setShowWizard(false)}/>}
    </div>
  );
}

