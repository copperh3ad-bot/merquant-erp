import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, shippingDocs } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Ship, Plus, Pencil, Trash2, Search, Download, FileText, ExternalLink, Printer } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";

const DOC_TYPES = ["Bill of Lading","Commercial Invoice","Packing List","Certificate of Origin","Inspection Certificate","Insurance Certificate","Phytosanitary Certificate","GOTS Certificate","Test Report","Letter of Credit","Other"];
const PHASES = ["Before Shipment","After Shipment"];
const PHASE_STYLES = { "Before Shipment": "bg-amber-50 text-amber-700 border-amber-200", "After Shipment": "bg-emerald-50 text-emerald-700 border-emerald-200" };
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };
const empty = { po_id:"", po_number:"", customer_name:"", document_type:"Commercial Invoice", document_number:"", document_date:"", phase:"Before Shipment", file_url:"", file_name:"", notes:"" };

function DocForm({ open, onOpenChange, onSave, initialData, pos }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k, v) => setForm(p => ({ ...p, [k]: v }));
  React.useEffect(() => { if (open) setForm(initialData ? { ...empty, ...initialData } : empty); }, [open, initialData]);
  const handlePoSelect = (id) => {
    const po = pos.find(p => p.id === id);
    setForm(f => ({ ...f, po_id: id, po_number: po?.po_number || "", customer_name: po?.customer_name || "" }));
  };
  const handleSave = async () => { setSaving(true); try { await onSave(form); } finally { setSaving(false); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData ? "Edit Document" : "Add Shipping Document"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Linked PO</Label>
            <Select value={form.po_id || "__none"} onValueChange={v => handlePoSelect(v === "__none" || v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select PO (optional)"/></SelectTrigger>
              <SelectContent><SelectItem value="__none">Not linked</SelectItem>{pos.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Document Type</Label>
            <Select value={form.document_type} onValueChange={v => u("document_type", v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Phase</Label>
            <Select value={form.phase} onValueChange={v => u("phase", v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{PHASES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Document Number</Label><Input value={form.document_number} onChange={e => u("document_number", e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Document Date</Label><Input type="date" value={form.document_date} onChange={e => u("document_date", e.target.value)}/></div>
          {!form.po_id && <>
            <div className="space-y-1.5"><Label className="text-xs">PO Number (manual)</Label><Input value={form.po_number} onChange={e => u("po_number", e.target.value)}/></div>
            <div className="space-y-1.5"><Label className="text-xs">Customer Name</Label><Input value={form.customer_name} onChange={e => u("customer_name", e.target.value)}/></div>
          </>}
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">File URL (Google Drive, Dropbox, etc.)</Label><Input value={form.file_url} onChange={e => u("file_url", e.target.value)} placeholder="https://…"/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">File Name</Label><Input value={form.file_name} onChange={e => u("file_name", e.target.value)} placeholder="BL_PO-2025-001.pdf"/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={e => u("notes", e.target.value)}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ShippingDocuments() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "");
  const [filterPhase, setFilterPhase] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const qc = useQueryClient();

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const { data: docs = [], isLoading } = useQuery({ queryKey: ["shippingDocs"], queryFn: () => shippingDocs.list() });

  const handleSave = async (data) => {
    if (editing) { await shippingDocs.update(editing.id, data); }
    else { await shippingDocs.create(data); }
    qc.invalidateQueries({ queryKey: ["shippingDocs"] });
    setShowForm(false); setEditing(null);
  };
  const handleDelete = async (id) => { if (!confirm("Delete?")) return; await shippingDocs.delete(id); qc.invalidateQueries({ queryKey: ["shippingDocs"] }); };

  const filtered = useMemo(() => docs.filter(d => {
    const mpo = !poFilter || d.po_id === poFilter;
    const mp = filterPhase === "All" || d.phase === filterPhase;
    const mt = filterType === "All" || d.document_type === filterType;
    const mq = !search || d.po_number?.toLowerCase().includes(search.toLowerCase()) || d.customer_name?.toLowerCase().includes(search.toLowerCase()) || d.document_type?.toLowerCase().includes(search.toLowerCase()) || d.document_number?.toLowerCase().includes(search.toLowerCase());
    return mpo && mp && mt && mq;
  }), [docs, filterPhase, filterType, search, poFilter]);

  const stats = useMemo(() => ({
    before: docs.filter(d => d.phase === "Before Shipment").length,
    after: docs.filter(d => d.phase === "After Shipment").length,
    total: docs.length,
  }), [docs]);

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Ship className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Shipping Documents</h1></div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => window.print()}><Printer className="h-3.5 w-3.5"/>Print</Button>
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="h-4 w-4 mr-1.5"/>Add Document</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard title="Total Documents" value={stats.total} icon={FileText} iconBg="bg-primary/10"/>
        <StatCard title="Before Shipment" value={stats.before} icon={FileText} iconBg="bg-amber-100"/>
        <StatCard title="After Shipment" value={stats.after} icon={Ship} iconBg="bg-emerald-100"/>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search PO, type, doc number…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
        <div className="flex gap-2 flex-wrap">
          {["All","Before Shipment","After Shipment"].map(p => (
            <button key={p} onClick={() => setFilterPhase(p)}
              className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
                filterPhase === p ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
              {p}
            </button>
          ))}
        </div>
        <Select value={filterType} onValueChange={v => setFilterType(v === "__none" || v === "__all" ? "" : v)}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="All types"/></SelectTrigger>
          <SelectContent><SelectItem value="All">All Types</SelectItem>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Ship} title="No shipping documents" description="Upload BL, commercial invoice, packing list, COO, and other documents here." actionLabel="Add Document" onAction={() => setShowForm(true)}/>
      ) : (
        <div className="space-y-2">
          {filtered.map(doc => (
            <Card key={doc.id}>
              <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-primary"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{doc.document_type}</span>
                    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", PHASE_STYLES[doc.phase] || "bg-gray-50 text-gray-600 border-gray-200")}>{doc.phase}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                    {doc.po_number && <span>PO: <span className="text-primary font-medium">{doc.po_number}</span></span>}
                    {doc.customer_name && <span>{doc.customer_name}</span>}
                    {doc.document_number && <span>#{doc.document_number}</span>}
                    {doc.document_date && <span>{fmt(doc.document_date)}</span>}
                    {doc.file_name && <span className="text-primary flex items-center gap-0.5">📎 {doc.file_name}</span>}
                  </div>
                  {doc.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{doc.notes}</p>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {doc.file_url && <a href={doc.file_url} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" className="text-xs gap-1"><Download className="h-3.5 w-3.5"/>Download</Button></a>}
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => { setEditing(doc); setShowForm(true); }}><Pencil className="h-3.5 w-3.5"/></Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(doc.id)}><Trash2 className="h-3.5 w-3.5 text-destructive"/></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <DocForm open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditing(null); }} onSave={handleSave} initialData={editing} pos={pos}/>
    </div>
  );
}

