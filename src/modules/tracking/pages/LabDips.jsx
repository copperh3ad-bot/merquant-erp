import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, labDips } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Droplets, Plus, Pencil, Trash2, Search, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { cn } from "@/lib/utils";
import POSelector from "@/components/shared/POSelector";

const TYPES = ["Lab Dip","Strike-off","Embroidery","Print","Woven Label","Other"];
const STATUSES = ["Not Submitted","Submitted","Approved","Rejected","Resubmit","On Hold"];
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };

const STATUS_STYLES = {
  "Approved":       "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Submitted":      "bg-blue-50 text-blue-700 border-blue-200",
  "Rejected":       "bg-red-50 text-red-700 border-red-200",
  "Resubmit":       "bg-amber-50 text-amber-700 border-amber-200",
  "Not Submitted":  "bg-gray-50 text-gray-600 border-gray-200",
  "On Hold":        "bg-orange-50 text-orange-700 border-orange-200",
};

const empty = { po_id:"", type:"Lab Dip", shade_name:"", shade_number:"", round_number:1, submission_date:"", expected_response_date:"", buyer_response_date:"", status:"Not Submitted", buyer_comments:"", internal_notes:"", article_name:"", article_code:"" };

function LabDipForm({ open, onOpenChange, onSave, initialData, pos }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p => ({ ...p, [k]: v }));
  React.useEffect(() => { if (open) setForm(initialData ? { ...empty, ...initialData } : empty); }, [open, initialData]);
  const handleSave = async () => {
    setSaving(true);
    try { await onSave({ ...form, round_number: Number(form.round_number) || 1 }); } finally { setSaving(false); }
  };
  const po = pos.find(p => p.id === form.po_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData ? "Edit Lab Dip / Approval" : "New Lab Dip / Approval"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">PO</Label>
            <Select value={form.po_id} onValueChange={v => u("po_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select PO" /></SelectTrigger>
              <SelectContent>{pos.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={form.type} onValueChange={v => u("type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Round #</Label>
            <Input type="number" min="1" value={form.round_number} onChange={e => u("round_number", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Article Name</Label>
            <Input value={form.article_name} onChange={e => u("article_name", e.target.value)} placeholder="e.g. Men Round Neck Tee" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Article Code</Label>
            <Input value={form.article_code} onChange={e => u("article_code", e.target.value)} placeholder="KTM-100" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Shade Name</Label>
            <Input value={form.shade_name} onChange={e => u("shade_name", e.target.value)} placeholder="Navy Blue" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Shade Number</Label>
            <Input value={form.shade_number} onChange={e => u("shade_number", e.target.value)} placeholder="PMS 289C" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Submission Date</Label>
            <Input type="date" value={form.submission_date} onChange={e => u("submission_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Expected Response</Label>
            <Input type="date" value={form.expected_response_date} onChange={e => u("expected_response_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Buyer Response Date</Label>
            <Input type="date" value={form.buyer_response_date} onChange={e => u("buyer_response_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v => u("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Buyer Comments</Label>
            <Textarea value={form.buyer_comments} onChange={e => u("buyer_comments", e.target.value)} rows={2} placeholder="Buyer feedback…" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Internal Notes</Label>
            <Textarea value={form.internal_notes} onChange={e => u("internal_notes", e.target.value)} rows={2} placeholder="Internal notes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LabDipsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "__all");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const qc = useQueryClient();

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const { data: dips = [], isLoading } = useQuery({ queryKey: ["labDips"], queryFn: () => labDips.list() });

  const handleSave = async (data) => {
    const po = pos.find(p => p.id === data.po_id);
    const payload = { ...data, po_number: po?.po_number || "" };
    if (editing) { await labDips.update(editing.id, payload); } else { await labDips.create(payload); }
    qc.invalidateQueries({ queryKey: ["labDips"] });
    setShowForm(false); setEditing(null);
  };
  const handleDelete = async (id) => { if (!confirm("Delete?")) return; await labDips.delete(id); qc.invalidateQueries({ queryKey: ["labDips"] }); };

  const filtered = useMemo(() => dips.filter(d => {
    const mpo = poFilter==="__all" || d.po_id === poFilter;
    const ms = filterStatus === "All" || d.status === filterStatus;
    const mt = filterType === "All" || d.type === filterType;
    const mq = !search || d.shade_name?.toLowerCase().includes(search.toLowerCase()) || d.article_name?.toLowerCase().includes(search.toLowerCase()) || d.po_number?.toLowerCase().includes(search.toLowerCase());
    return mpo && ms && mt && mq;
  }), [dips, filterStatus, filterType, search, poFilter]);

  const stats = useMemo(() => ({
    waiting: dips.filter(d => ["Submitted","Resubmit"].includes(d.status)).length,
    overdue: dips.filter(d => d.expected_response_date && new Date(d.expected_response_date) < new Date() && !["Approved","Rejected"].includes(d.status)).length,
    approved: dips.filter(d => d.status === "Approved").length,
    total: dips.length,
  }), [dips]);

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Droplets className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold">Lab Dips & Approvals</h1>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-1.5" /> Add
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Awaiting Response" value={stats.waiting} icon={Clock} iconBg="bg-blue-100" />
        <StatCard title="Overdue" value={stats.overdue} icon={AlertCircle} iconBg="bg-red-100" />
        <StatCard title="Approved" value={stats.approved} icon={CheckCircle2} iconBg="bg-emerald-100" />
        <StatCard title="Total" value={stats.total} icon={Droplets} iconBg="bg-primary/10" />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search shade, article, PO…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-36 text-sm h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="All">All Types</SelectItem>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 text-sm h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="All">All Statuses</SelectItem>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Droplets} title="No lab dips yet" description="Track colour approvals, strike-offs, and embroidery approvals here." actionLabel="Add First" onAction={() => setShowForm(true)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {["PO","Type","Article","Shade","Round","Submitted","Expected","Response","Status","Waiting",""].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(d => {
                    const waiting = d.submission_date && !["Approved","Rejected"].includes(d.status) ? differenceInDays(new Date(), new Date(d.submission_date)) : null;
                    const overdue = d.expected_response_date && new Date(d.expected_response_date) < new Date() && !["Approved","Rejected"].includes(d.status);
                    return (
                      <TableRow key={d.id} className="hover:bg-muted/30">
                        <TableCell className="text-xs font-medium text-primary">{d.po_number}</TableCell>
                        <TableCell className="text-xs">{d.type}</TableCell>
                        <TableCell className="text-xs max-w-[120px] truncate">{d.article_name || "—"}</TableCell>
                        <TableCell className="text-xs">{d.shade_name || "—"}<br /><span className="text-muted-foreground">{d.shade_number || ""}</span></TableCell>
                        <TableCell className="text-xs text-center">R{d.round_number}</TableCell>
                        <TableCell className="text-xs">{fmt(d.submission_date)}</TableCell>
                        <TableCell className={cn("text-xs", overdue ? "text-red-600 font-medium" : "")}>{fmt(d.expected_response_date)}</TableCell>
                        <TableCell className="text-xs">{fmt(d.buyer_response_date)}</TableCell>
                        <TableCell>
                          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border", STATUS_STYLES[d.status] || "bg-gray-50 text-gray-600 border-gray-200")}>
                            {d.status}
                          </span>
                        </TableCell>
                        <TableCell className={cn("text-xs", waiting > 5 ? "text-red-600 font-semibold" : "text-muted-foreground")}>
                          {waiting !== null ? `${waiting}d` : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditing(d); setShowForm(true); }}><Pencil className="h-3 w-3 text-muted-foreground" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(d.id)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <LabDipForm open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditing(null); }} onSave={handleSave} initialData={editing} pos={pos} />
    </div>
  );
}

