import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const currencies = ["USD","EUR","GBP","INR","CNY","PKR","BDT"];
const sources = ["Email","WhatsApp","PDF","Manual","Portal","Phone","Other"];
const statuses = ["PO Received","Items Entered","Price Verification","Price Approved","CBM Calculated","FWS Prepared","Yarn Planned","Accessories Planned","Packaging Planned","In Production","QC Inspection","Ready to Ship","Shipped","At Port","Delivered","Cancelled"];

const empty = {
  po_number: "",
  customer_name: "",
  buyer_address: "",
  buyer_contact: "",
  ship_to_name: "",
  ship_to_address: "",
  consignee_contact: "",
  consignee_country: "",
  pi_number: "", pi_date: "", order_date: "", delivery_date: "",
  ex_factory_date: "", etd: "", eta: "",
  currency: "USD", total_po_value: "", total_quantity: "", total_cbm: "",
  season: "", port_of_loading: "", port_of_destination: "",
  country_of_origin: "Pakistan", ship_via: "Container Direct",
  payment_terms: "", sales_order_number: "",
  source: "Manual", status: "PO Received", notes: "",
};

export default function POFormDialog({ open, onOpenChange, onSave, initialData }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [sameAsBuyer, setSameAsBuyer] = useState(false);

  useEffect(() => {
    if (open) {
      const data = initialData ? { ...empty, ...initialData } : empty;
      setForm(data);
      if (initialData) {
        const isSame =
          data.ship_to_name === data.customer_name &&
          data.ship_to_address === data.buyer_address &&
          !!data.customer_name;
        setSameAsBuyer(isSame);
      } else {
        setSameAsBuyer(false);
      }
    }
  }, [open, initialData]);

  const update = (k, v) => {
    setForm(p => {
      const next = { ...p, [k]: v };
      if (sameAsBuyer) {
        if (k === "customer_name") next.ship_to_name = v;
        if (k === "buyer_address") next.ship_to_address = v;
        if (k === "buyer_contact") next.consignee_contact = v;
      }
      return next;
    });
  };

  const toggleSameAsBuyer = (checked) => {
    setSameAsBuyer(checked);
    if (checked) {
      setForm(p => ({
        ...p,
        ship_to_name: p.customer_name,
        ship_to_address: p.buyer_address,
        consignee_contact: p.buyer_contact,
      }));
    }
  };

  const handleSave = async () => {
    if (!form.po_number || !form.customer_name) return alert("PO Number and Buyer (Customer) are required.");
    const requiredDates = [
      ["pi_date", "PI Date"],
      ["order_date", "Order Date"],
      ["delivery_date", "Delivery Date"],
      ["ex_factory_date", "Ex-Factory Date"],
      ["etd", "ETD"],
      ["eta", "ETA"],
    ];
    const missing = requiredDates.filter(([k]) => !form[k]).map(([, label]) => label);
    if (missing.length) return alert(`Please fill in: ${missing.join(", ")}`);
    setSaving(true);
    try {
      await onSave({
        ...form,
        total_po_value: form.total_po_value ? Number(form.total_po_value) : null,
        total_quantity: form.total_quantity ? Number(form.total_quantity) : null,
        total_cbm: form.total_cbm ? Number(form.total_cbm) : null,
      });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Edit Purchase Order" : "New Purchase Order"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">PO Number *</Label>
            <Input value={form.po_number} onChange={e => update("po_number", e.target.value)} placeholder="PO-2025-001" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">PI Number</Label>
            <Input value={form.pi_number} onChange={e => update("pi_number", e.target.value)} placeholder="PI-2026-001" />
          </div>
        </div>

        <div className="border rounded-md p-3 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Buyer <span className="text-xs font-normal text-muted-foreground">(party issuing the PO)</span></h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Buyer Name / Brand *</Label>
              <Input value={form.customer_name} onChange={e => update("customer_name", e.target.value)} placeholder="e.g. Bob's Discount Furniture" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Buyer Contact</Label>
              <Input value={form.buyer_contact} onChange={e => update("buyer_contact", e.target.value)} placeholder="Person / email / phone" />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label className="text-xs">Buyer Address</Label>
              <Input value={form.buyer_address} onChange={e => update("buyer_address", e.target.value)} placeholder="Full billing / HQ address" />
            </div>
          </div>
        </div>

        <div className="border rounded-md p-3 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Consignee <span className="text-xs font-normal text-muted-foreground">(party receiving the goods)</span></h3>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={sameAsBuyer}
                onChange={e => toggleSameAsBuyer(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Same as buyer
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Consignee Name</Label>
              <Input value={form.ship_to_name} onChange={e => update("ship_to_name", e.target.value)} placeholder="e.g. Bob's DC, NJ or 3PL warehouse" disabled={sameAsBuyer} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Consignee Contact</Label>
              <Input value={form.consignee_contact} onChange={e => update("consignee_contact", e.target.value)} placeholder="Warehouse manager / email" disabled={sameAsBuyer} />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label className="text-xs">Consignee Address</Label>
              <Input value={form.ship_to_address} onChange={e => update("ship_to_address", e.target.value)} placeholder="Full delivery / DC address" disabled={sameAsBuyer} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Consignee Country</Label>
              <Input value={form.consignee_country} onChange={e => update("consignee_country", e.target.value)} placeholder="e.g. USA" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">PI Date *</Label>
            <Input type="date" value={form.pi_date} onChange={e => update("pi_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Order Date *</Label>
            <Input type="date" value={form.order_date} onChange={e => update("order_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Delivery Date *</Label>
            <Input type="date" value={form.delivery_date} onChange={e => update("delivery_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ex-Factory Date *</Label>
            <Input type="date" value={form.ex_factory_date} onChange={e => update("ex_factory_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ETD *</Label>
            <Input type="date" value={form.etd} onChange={e => update("etd", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ETA *</Label>
            <Input type="date" value={form.eta} onChange={e => update("eta", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Season</Label>
            <Input value={form.season} onChange={e => update("season", e.target.value)} placeholder="SS25" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Currency</Label>
            <Select value={form.currency} onValueChange={v => update("currency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{currencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v => update("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Source</Label>
            <Select value={form.source} onValueChange={v => update("source", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{sources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Total PO Value</Label>
            <Input type="number" value={form.total_po_value} onChange={e => update("total_po_value", e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Total Quantity</Label>
            <Input type="number" value={form.total_quantity} onChange={e => update("total_quantity", e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Total CBM</Label>
            <Input type="number" step="0.01" value={form.total_cbm} onChange={e => update("total_cbm", e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Payment Terms</Label>
            <Input value={form.payment_terms} onChange={e => update("payment_terms", e.target.value)} placeholder="LC 60 days" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ship Via</Label>
            <Input value={form.ship_via} onChange={e => update("ship_via", e.target.value)} placeholder="Container Direct" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Port of Loading</Label>
            <Input value={form.port_of_loading} onChange={e => update("port_of_loading", e.target.value)} placeholder="Karachi" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Port of Destination</Label>
            <Input value={form.port_of_destination} onChange={e => update("port_of_destination", e.target.value)} placeholder="Hamburg" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Country of Origin</Label>
            <Input value={form.country_of_origin} onChange={e => update("country_of_origin", e.target.value)} placeholder="Pakistan" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sales Order #</Label>
            <Input value={form.sales_order_number} onChange={e => update("sales_order_number", e.target.value)} placeholder="—" />
          </div>
        </div>

        <div className="md:col-span-2 space-y-1.5 pt-1">
          <Label className="text-xs">Notes</Label>
          <Textarea value={form.notes} onChange={e => update("notes", e.target.value)} placeholder="Additional notes..." rows={2} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save PO"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

