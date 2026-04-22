import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

const COMPONENT_TYPES = [
  "Top Fabric", "Bottom Fabric", "Skirt Fabric", "Piping", "Binding",
  "Filling / Padding", "Lamination / TPU", "Lining", "Other"
];

export default function ArticleFormDialog({ open, onOpenChange, onSave, purchaseOrders, initialData }) {
  const [form, setForm] = useState(initialData || {
    article_name: "",
    article_code: "",
    po_id: "",
    order_quantity: "",
    components: [{ component_type: "Top Fabric", fabric_type: "", gsm: "", width: "", consumption_per_unit: "", wastage_percent: "" }],
  });
  const [saving, setSaving] = useState(false);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const updateComponent = (index, key, val) => {
    const comps = [...form.components];
    comps[index] = { ...comps[index], [key]: val };
    setForm((p) => ({ ...p, components: comps }));
  };

  const addComponent = () => {
    setForm((p) => ({
      ...p,
      components: [...p.components, { component_type: "Other", fabric_type: "", gsm: "", width: "", consumption_per_unit: "", wastage_percent: "" }],
    }));
  };

  const removeComponent = (index) => {
    setForm((p) => ({ ...p, components: p.components.filter((_, i) => i !== index) }));
  };

  const handleSave = async () => {
    setSaving(true);
    const qty = Number(form.order_quantity) || 0;
    const components = form.components.map((c) => {
      const consumption = Number(c.consumption_per_unit) || 0;
      const wastage = Number(c.wastage_percent) || 0;
      const totalRequired = qty * consumption * (1 + wastage / 100);
      return {
        ...c,
        gsm: Number(c.gsm) || undefined,
        width: Number(c.width) || undefined,
        consumption_per_unit: consumption,
        wastage_percent: wastage,
        total_required: Number(totalRequired.toFixed(2)),
      };
    });
    const totalFabric = components.reduce((s, c) => s + (c.total_required || 0), 0);

    await onSave({
      ...form,
      order_quantity: qty,
      components,
      total_fabric_required: Number(totalFabric.toFixed(2)),
    });
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Edit Article" : "New Article"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Article Name *</Label>
            <Input value={form.article_name} onChange={(e) => update("article_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Article Code</Label>
            <Input value={form.article_code} onChange={(e) => update("article_code", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Order Quantity</Label>
            <Input type="number" value={form.order_quantity} onChange={(e) => update("order_quantity", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Purchase Order</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={form.po_id}
              onChange={(e) => update("po_id", e.target.value)}
            >
              <option value="">Select PO (optional)</option>
              {purchaseOrders.map((po) => (
                <option key={po.id} value={po.id}>{po.po_number} - {po.customer_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-foreground">Fabric Components</p>
            <Button size="sm" variant="outline" onClick={addComponent}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Component
            </Button>
          </div>

          <div className="space-y-3">
            {form.components.map((comp, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-7 gap-2 p-3 bg-muted/50 rounded-lg items-end">
                <div className="space-y-1">
                  <Label className="text-[10px]">Type</Label>
                  <select
                    className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={comp.component_type}
                    onChange={(e) => updateComponent(i, "component_type", e.target.value)}
                  >
                    {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Fabric</Label>
                  <Input className="h-8 text-xs" value={comp.fabric_type} onChange={(e) => updateComponent(i, "fabric_type", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">GSM</Label>
                  <Input className="h-8 text-xs" type="number" value={comp.gsm} onChange={(e) => updateComponent(i, "gsm", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Width</Label>
                  <Input className="h-8 text-xs" type="number" value={comp.width} onChange={(e) => updateComponent(i, "width", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Consumption/Unit</Label>
                  <Input className="h-8 text-xs" type="number" step="0.01" value={comp.consumption_per_unit} onChange={(e) => updateComponent(i, "consumption_per_unit", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Wastage %</Label>
                  <Input className="h-8 text-xs" type="number" value={comp.wastage_percent} onChange={(e) => updateComponent(i, "wastage_percent", e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeComponent(i)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.article_name}>
            {saving ? "Saving..." : "Save Article"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
