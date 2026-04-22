import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const statuses = ["Planned","Booked","Booking Confirmed","Loaded","In Transit","At Port","Customs Clearance","Delivered","Cancelled"];
const incoterms = ["FOB","CIF","CFR","EXW","DDP","FCA","CPT"];
const empty = { shipment_number:"", po_number:"", carrier:"", vessel_name:"", voyage_number:"", bl_number:"", container_number:"", container_type:"20GP", port_of_loading:"Karachi", port_of_destination:"", etd:"", eta:"", total_cbm:"", total_cartons:"", freight_cost:"", currency:"USD", status:"Planned", incoterms:"FOB", notes:"" };

export default function ShipmentFormDialog({ open, onOpenChange, onSave, initialData }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => { if (open) setForm(initialData ? { ...empty, ...initialData } : empty); }, [open, initialData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, total_cbm: form.total_cbm ? Number(form.total_cbm) : null, total_cartons: form.total_cartons ? Number(form.total_cartons) : null, freight_cost: form.freight_cost ? Number(form.freight_cost) : null });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData ? "Edit Shipment" : "New Shipment"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Shipment Number</Label>
            <Input value={form.shipment_number} onChange={e => update("shipment_number", e.target.value)} placeholder="SHP-2025-001" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">PO Number</Label>
            <Input value={form.po_number} onChange={e => update("po_number", e.target.value)} placeholder="PO-2025-001" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Carrier</Label>
            <Input value={form.carrier} onChange={e => update("carrier", e.target.value)} placeholder="Maersk" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Vessel Name</Label>
            <Input value={form.vessel_name} onChange={e => update("vessel_name", e.target.value)} placeholder="MSC DIANA" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">BL Number</Label>
            <Input value={form.bl_number} onChange={e => update("bl_number", e.target.value)} placeholder="MSCUXXXX123" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Container Number</Label>
            <Input value={form.container_number} onChange={e => update("container_number", e.target.value)} placeholder="MSCU1234567" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Container Type</Label>
            <Select value={form.container_type} onValueChange={v => update("container_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["20GP","40GP","40HC","45HC","LCL"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Incoterms</Label>
            <Select value={form.incoterms} onValueChange={v => update("incoterms", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{incoterms.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Port of Loading</Label>
            <Input value={form.port_of_loading} onChange={e => update("port_of_loading", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Port of Destination</Label>
            <Input value={form.port_of_destination} onChange={e => update("port_of_destination", e.target.value)} placeholder="Hamburg" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ETD</Label>
            <Input type="date" value={form.etd} onChange={e => update("etd", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ETA</Label>
            <Input type="date" value={form.eta} onChange={e => update("eta", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Total CBM</Label>
            <Input type="number" step="0.01" value={form.total_cbm} onChange={e => update("total_cbm", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Total Cartons</Label>
            <Input type="number" value={form.total_cartons} onChange={e => update("total_cartons", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Freight Cost</Label>
            <Input type="number" value={form.freight_cost} onChange={e => update("freight_cost", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v => update("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={e => update("notes", e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Shipment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

