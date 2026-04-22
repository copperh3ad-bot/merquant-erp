import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, CheckCircle2, Plus, Trash2, Save,
  Sparkles, ChevronRight, Info, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mfg, skuQueue } from "@/api/supabaseClient";
import { applyTemplateToArticle } from "@/lib/skuMatcher";

const COMPONENT_TYPES = ["Front","Skirt","Bottom","Flat Sheet","Fitted Sheet","Pillow Case","Piping","Binding","Filling","Lamination","Top Fabric","Window (Outside)","Window (Inside)","Fabric Bag","Quilting","Other"];
const emptyComp = () => ({ component_type:"Front", product_size:"", direction:"", fabric_type:"", gsm:0, width:0, consumption_per_unit:0, wastage_percent:6, total_required:0 });

function CompRow({ comp, idx, qty, onChange, onRemove }) {
  const net = (comp.consumption_per_unit || 0) * (qty || 0);
  const total = +(net * (1 + (comp.wastage_percent || 0) / 100)).toFixed(4);
  const inp = "w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white";

  return (
    <tr className={idx % 2 === 0 ? "bg-blue-50/20" : "bg-white"}>
      <td className="border px-1.5 py-1 min-w-[130px]">
        <select className={inp} value={comp.component_type} onChange={e => onChange(idx, "component_type", e.target.value)}>
          {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </td>
      <td className="border px-1.5 py-1"><input className={inp} value={comp.product_size || ""} onChange={e => onChange(idx, "product_size", e.target.value)} placeholder="e.g. 70×96"/></td>
      <td className="border px-1.5 py-1"><input className={inp} value={comp.fabric_type || ""} onChange={e => onChange(idx, "fabric_type", e.target.value)} placeholder="Single Jersey"/></td>
      <td className="border px-1.5 py-1 w-14"><input type="number" className={inp} value={comp.gsm || ""} onChange={e => onChange(idx, "gsm", Number(e.target.value))}/></td>
      <td className="border px-1.5 py-1 w-14"><input type="number" className={inp} value={comp.width || ""} onChange={e => onChange(idx, "width", Number(e.target.value))}/></td>
      <td className="border px-1.5 py-1 w-16"><input type="number" step="any" className={inp} value={comp.consumption_per_unit ?? ""} onChange={e => onChange(idx, "consumption_per_unit", e.target.value)}/></td>
      <td className="border px-1.5 py-1 w-14"><input type="number" className={inp} value={comp.wastage_percent ?? 6} onChange={e => onChange(idx, "wastage_percent", Number(e.target.value))}/></td>
      <td className="border px-1.5 py-1 w-16 text-center font-semibold text-blue-800 bg-yellow-50 text-xs">{total.toFixed(3)}</td>
      <td className="border px-1.5 py-1 text-center">
        <button onClick={() => onRemove(idx)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3"/></button>
      </td>
    </tr>
  );
}

export default function SKUReviewDialog({ open, onOpenChange, queueItem, onApprove, onSkip }) {
  const [components, setComponents] = useState([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(true);

  useEffect(() => {
    if (open && queueItem) {
      // Pre-fill with suggested components if any
      const suggested = queueItem.suggested_components || [];
      if (suggested.length > 0) {
        const qty = queueItem.order_quantity || 0;
        setComponents(suggested.map(c => {
          const net = (c.consumption_per_unit || 0) * qty;
          return { ...c, total_required: +(net * (1 + (c.wastage_percent || 6) / 100)).toFixed(4) };
        }));
      } else {
        setComponents([emptyComp()]);
      }
      setTemplateSearch("");
    }
  }, [open, queueItem]);

  useEffect(() => {
    if (open) {
      setLoadingTemplates(true);
      mfg.fabricTemplates.list().then(t => { setTemplates(t); setLoadingTemplates(false); });
    }
  }, [open]);

  const qty = queueItem?.order_quantity || 0;

  const updateComp = (idx, field, value) => {
    setComponents(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      const cpu = parseFloat(next[idx].consumption_per_unit) || 0;
      const net = cpu * qty;
      next[idx].total_required = +(net * (1 + (parseFloat(next[idx].wastage_percent) || 0) / 100)).toFixed(4);
      return next;
    });
  };

  const applyTemplate = (template) => {
    const comps = (template.components || []).map(c => {
      const net = (c.consumption_per_unit || 0) * qty;
      return { ...c, total_required: +(net * (1 + (c.wastage_percent || 6) / 100)).toFixed(4) };
    });
    setComponents(comps.length ? comps : [emptyComp()]);
    setTemplateSearch("");
  };

  const handleApprove = async () => {
    setSaving(true);
    try {
      await onApprove(queueItem, components, saveAsTemplate);
    } finally { setSaving(false); }
  };

  const filteredTemplates = templates.filter(t =>
    !templateSearch || t.article_code?.toLowerCase().includes(templateSearch.toLowerCase()) || t.article_name?.toLowerCase().includes(templateSearch.toLowerCase())
  );

  const totalFabric = components.reduce((s, c) => s + (c.total_required || 0), 0);

  if (!queueItem) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Review Unknown SKU — Human Approval Required
          </DialogTitle>
        </DialogHeader>

        {/* SKU info banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap gap-4 text-sm">
          <div>
            <p className="text-[10px] text-amber-600 uppercase tracking-wide font-medium">Item Code</p>
            <p className="font-bold text-amber-900">{queueItem.item_code || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] text-amber-600 uppercase tracking-wide font-medium">Description</p>
            <p className="font-semibold text-amber-900">{queueItem.item_description || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] text-amber-600 uppercase tracking-wide font-medium">Order Qty</p>
            <p className="font-bold text-amber-900">{qty.toLocaleString()} pcs</p>
          </div>
          <div>
            <p className="text-[10px] text-amber-600 uppercase tracking-wide font-medium">PO</p>
            <p className="font-semibold text-amber-900">{queueItem.po_number}</p>
          </div>
          {queueItem.match_type === "ai_suggested" && (
            <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-100 rounded-lg px-3 py-2 ml-auto">
              <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0"/>
              <span>{queueItem.notes}</span>
            </div>
          )}
          {queueItem.match_type === "new" && (
            <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-100 rounded-lg px-3 py-2 ml-auto">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0"/>
              <span>New SKU — no similar template found. Please enter fabric specs manually.</span>
            </div>
          )}
        </div>

        {/* Template picker */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">Apply from existing template</Label>
            {loadingTemplates && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground"/>}
          </div>
          <Input
            placeholder="Search templates by code or name…"
            value={templateSearch}
            onChange={e => setTemplateSearch(e.target.value)}
            className="text-sm"
          />
          {templateSearch && filteredTemplates.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden max-h-44 overflow-y-auto">
              {filteredTemplates.slice(0, 10).map(t => (
                <button key={t.id} onClick={() => applyTemplate(t)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/50 text-left border-b border-border/50 last:border-0 transition-colors">
                  <div>
                    <span className="text-xs font-semibold text-foreground">{t.article_code}</span>
                    {t.article_name && <span className="text-xs text-muted-foreground ml-2">{t.article_name}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{(t.components || []).length} components</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground"/>
                  </div>
                </button>
              ))}
              {filteredTemplates.length > 10 && (
                <p className="text-xs text-center text-muted-foreground py-2">+{filteredTemplates.length - 10} more</p>
              )}
            </div>
          )}
          {templateSearch && filteredTemplates.length === 0 && (
            <p className="text-xs text-muted-foreground">No templates match "{templateSearch}"</p>
          )}
        </div>

        {/* Components table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">Fabric components for this SKU</Label>
            <span className="text-[11px] text-muted-foreground">
              {components.length} component{components.length !== 1 ? "s" : ""} · Total: <span className="font-bold text-primary">{totalFabric.toFixed(2)} m</span>
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  {["Part","Prod. Size","Fabric Type","GSM","Width cm","Cut/Unit m","Wastage %","Total Req.",""].map(h => (
                    <th key={h} className="border px-2 py-1.5 text-left whitespace-nowrap font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {components.map((comp, idx) => (
                  <CompRow key={idx} comp={comp} idx={idx} qty={qty}
                    onChange={updateComp}
                    onRemove={i => setComponents(p => p.filter((_, x) => x !== i))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setComponents(p => [...p, emptyComp()])}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium">
            <Plus className="h-3.5 w-3.5"/> Add Component
          </button>
        </div>

        {/* Save as template */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={saveAsTemplate} onChange={e => setSaveAsTemplate(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"/>
          <span className="text-sm text-foreground">Save as fabric template for future POs with this SKU</span>
        </label>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onSkip(queueItem)} disabled={saving}>
            Skip for now
          </Button>
          <Button size="sm" onClick={handleApprove} disabled={saving || components.length === 0}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
            {saving
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin"/> Saving…</>
              : <><CheckCircle2 className="h-3.5 w-3.5"/> Approve & Apply</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

