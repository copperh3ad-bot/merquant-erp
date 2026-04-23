import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Save } from "lucide-react";

const COMPONENT_TYPES = ["Flat Sheet","Fitted Sheet","Pillow Case","Front","Skirt","Bottom","Piping","Binding","Filling","Lamination","Top Fabric","Window (Outside)","Window (Inside)","Fabric Bag","Quilting","Pillow Compression","Other"];

const emptyComp = () => ({ component_type:"Front", product_size:"", direction:"", fabric_type:"", gsm:0, width:0, consumption_per_unit:0, wastage_percent:6, total_required:0 });

export default function FabricEditDialog({ open, onOpenChange, article, onSave, saving }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (article) setForm({ ...article, components: JSON.parse(JSON.stringify(article.components || [])) });
  }, [article, open]);

  if (!form) return null;

  const recalc = (comps, qty) => comps.map(c => {
    const cpu = parseFloat(c.consumption_per_unit) || 0;
    const net = cpu * (qty || 0);
    return { ...c, total_required: +(net * (1 + (parseFloat(c.wastage_percent) || 0) / 100)).toFixed(4) };
  });

  const updateComp = (idx, field, value) => {
    setForm(f => {
      const comps = [...f.components];
      comps[idx] = { ...comps[idx], [field]: value };
      return { ...f, components: recalc(comps, f.order_quantity) };
    });
  };

  const addComp = () => setForm(f => ({ ...f, components: [...f.components, emptyComp()] }));
  const removeComp = (idx) => setForm(f => ({ ...f, components: f.components.filter((_, i) => i !== idx) }));

  const inp = "w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Edit Fabric Specs — <span className="text-blue-700">{article?.article_name}</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Changes saved as master data and applied to future POs for this article.</p>
        </DialogHeader>

        {/* Article-level fields. Product Dimensions lives here (not on components)
            because it's a property of the finished article, not of each cut piece.
            If present, it overrides any value resolved from tech_packs. */}
        <div className="bg-slate-50 border border-slate-200 rounded p-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Product Dimensions
              <span className="ml-1 font-normal text-slate-400">(manual override — leave blank to use tech pack)</span>
            </label>
            <input
              className={inp}
              placeholder='e.g. 20x26" or 60x80x13.5cm'
              value={form.product_dimensions || ""}
              onChange={e => setForm(f => ({ ...f, product_dimensions: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Article Code</label>
            <div className="text-xs px-1.5 py-1 font-mono text-slate-700">{article?.article_code || "—"}</div>
          </div>
        </div>

        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                {["Part","Prod. Size","Direction","Fabric Type","GSM","Width (cm)","Cut/Unit (m)","Wastage %","Total Req. (m)",""].map(h => (
                  <th key={h} className="border px-2 py-1.5 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.components.map((comp, idx) => {
                const net = (comp.consumption_per_unit || 0) * (form.order_quantity || 0);
                const total = +(net * (1 + (comp.wastage_percent || 0) / 100)).toFixed(4);
                return (
                  <tr key={idx} className={idx % 2 === 0 ? "bg-blue-50/30" : "bg-white"}>
                    <td className="border px-1.5 py-1">
                      <select className={inp} value={comp.component_type || ""} onChange={e => updateComp(idx, "component_type", e.target.value)}>
                        {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="border px-1.5 py-1"><input className={inp} placeholder="e.g. 70x96" value={comp.product_size || ""} onChange={e => updateComp(idx, "product_size", e.target.value)} /></td>
                    <td className="border px-1.5 py-1"><input className={inp} placeholder="WXL" value={comp.direction || ""} onChange={e => updateComp(idx, "direction", e.target.value)} /></td>
                    <td className="border px-1.5 py-1"><input className={inp} value={comp.fabric_type || ""} onChange={e => updateComp(idx, "fabric_type", e.target.value)} /></td>
                    <td className="border px-1.5 py-1"><input type="number" className={inp} value={comp.gsm || ""} onChange={e => updateComp(idx, "gsm", Number(e.target.value))} /></td>
                    <td className="border px-1.5 py-1"><input type="number" className={inp} value={comp.width || ""} onChange={e => updateComp(idx, "width", Number(e.target.value))} /></td>
                    <td className="border px-1.5 py-1"><input type="number" step="any" min="0" className={inp} value={comp.consumption_per_unit ?? ""} onChange={e => updateComp(idx, "consumption_per_unit", e.target.value)} /></td>
                    <td className="border px-1.5 py-1"><input type="number" className={inp} value={comp.wastage_percent ?? 6} onChange={e => updateComp(idx, "wastage_percent", Number(e.target.value))} /></td>
                    <td className="border px-1.5 py-1 text-center font-semibold text-blue-800 bg-yellow-50">{total.toFixed(4)}</td>
                    <td className="border px-1.5 py-1 text-center">
                      <button onClick={() => removeComp(idx)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button onClick={addComp} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium mt-2">
          <Plus className="h-3.5 w-3.5" /> Add Component
        </button>

        <div className="mt-3 bg-muted/40 rounded p-3 grid grid-cols-3 gap-3 text-xs">
          <div><span className="text-muted-foreground">Order Qty:</span> <span className="font-semibold">{(form.order_quantity || 0).toLocaleString()} pcs</span></div>
          <div><span className="text-muted-foreground">Total Net Mtrs:</span> <span className="font-semibold">{form.components.reduce((s,c) => s + (c.consumption_per_unit||0)*(form.order_quantity||0), 0).toFixed(2)}</span></div>
          <div><span className="text-muted-foreground">Total w/ Wastage:</span> <span className="font-bold text-primary">{form.components.reduce((s,c) => s + (c.total_required||0), 0).toFixed(2)} m</span></div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={saving} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving..." : "Save & Update Master"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
