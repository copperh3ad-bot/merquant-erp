import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const empty = { name:"", contact_person:"", email:"", phone:"", country:"Pakistan", city:"", address:"", payment_terms:"", status:"Active", notes:"" };

export default function SupplierFormDialog({ open, onOpenChange, onSave, initialData }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => { if (open) setForm(initialData ? { ...empty, ...initialData } : empty); }, [open, initialData]);

  const handleSave = async () => {
    if (!form.name) return alert("Supplier name is required.");
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData ? "Edit Supplier" : "New Supplier"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs">Supplier Name *</Label>
            <Input value={form.name} onChange={e => update("name", e.target.value)} placeholder="Karachi Textile Mills" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Contact Person</Label>
            <Input value={form.contact_person} onChange={e => update("contact_person", e.target.value)} placeholder="Ahmed Raza" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input type="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="contact@supplier.com" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Phone</Label>
            <Input value={form.phone} onChange={e => update("phone", e.target.value)} placeholder="+92-21-1234567" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Country</Label>
            <Input value={form.country} onChange={e => update("country", e.target.value)} placeholder="Pakistan" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">City</Label>
            <Input value={form.city} onChange={e => update("city", e.target.value)} placeholder="Karachi" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Payment Terms</Label>
            <Input value={form.payment_terms} onChange={e => update("payment_terms", e.target.value)} placeholder="Net 60" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v => update("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs">Address</Label>
            <Textarea value={form.address} onChange={e => update("address", e.target.value)} placeholder="Full address..." rows={2} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={e => update("notes", e.target.value)} placeholder="Additional notes..." rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Supplier"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

