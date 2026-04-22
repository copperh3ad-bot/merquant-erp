import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, mfg } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import PermissionGate from "@/components/shared/PermissionGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Scissors, Plus, Trash2, Pencil, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";

// Formula: Total Meters × GSM × Width(cm) / 39.37 / 1000  → kg
function toYarnKg(meters, gsm, width) {
  if (!meters || !gsm || !width) return 0;
  return +(meters * gsm * width / 39.37 / 1000).toFixed(2);
}

const YARN_STATUSES = ["Planned","Ordered","In Transit","Received","Rejected"];
const empty = { fabric_type:"", gsm:"", width_cm:"", total_meters:"", yarn_kg:"", yarn_type:"", yarn_count:"", supplier:"", status:"Planned", notes:"" };

function YarnFormDialog({ open, onOpenChange, onSave, initialData }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p => {
    const next = { ...p, [k]: v };
    if (["gsm","width_cm","total_meters"].includes(k)) {
      next.yarn_kg = toYarnKg(Number(next.total_meters), Number(next.gsm), Number(next.width_cm));
    }
    return next;
  });
  React.useEffect(() => { if (open) setForm(initialData ? { ...empty, ...initialData } : empty); }, [open, initialData]);
  const handleSave = async () => {
    setSaving(true);
    try { await onSave({ ...form, gsm:Number(form.gsm)||null, width_cm:Number(form.width_cm)||null, total_meters:Number(form.total_meters)||null, yarn_kg:Number(form.yarn_kg)||null }); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initialData ? "Edit Yarn Requirement" : "Add Yarn Requirement"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          {[["fabric_type","Fabric Type","text","e.g. Single Jersey"],["gsm","GSM","number","160"],["width_cm","Width (cm)","number","150"],["total_meters","Total Meters","number","500"],["yarn_type","Yarn Type","text","100% Cotton"],["yarn_count","Yarn Count","text","30/1"],["supplier","Supplier","text",""]].map(([k,label,type,ph]) => (
            <div key={k} className="space-y-1.5">
              <Label className="text-xs">{label}</Label>
              <Input type={type} value={form[k]} onChange={e => u(k, e.target.value)} placeholder={ph} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label className="text-xs">Yarn Kg (auto-calc)</Label>
            <Input value={form.yarn_kg} readOnly className="bg-muted/40 font-semibold" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v => u("status", v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{YARN_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function YarnPlanning() {
  const [searchParams] = useSearchParams();
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("po_id") || "");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [generating, setGenerating] = useState(false);
  const qc = useQueryClient();

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const activePo = useMemo(() => selectedPoId ? pos.find(p => p.id === selectedPoId) : pos[0], [pos, selectedPoId]);

  const { data: yarns = [], isLoading } = useQuery({
    queryKey: ["yarn", activePo?.id],
    queryFn: () => mfg.yarn.listByPO(activePo.id),
    enabled: !!activePo?.id,
  });

  const { data: articles = [] } = useQuery({
    queryKey: ["articles", activePo?.id],
    queryFn: () => mfg.articles.listByPO(activePo.id),
    enabled: !!activePo?.id,
  });

  const handleSave = async (data) => {
    const payload = { ...data, po_id: activePo.id, po_number: activePo.po_number };
    if (editing) { await mfg.yarn.update(editing.id, payload); }
    else { await mfg.yarn.create(payload); }
    qc.invalidateQueries({ queryKey: ["yarn", activePo?.id] });
    setShowForm(false); setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this yarn requirement?")) return;
    await mfg.yarn.delete(id);
    qc.invalidateQueries({ queryKey: ["yarn", activePo?.id] });
  };

  const handleAutoGenerate = async () => {
    if (!articles.length) return alert("No articles found for this PO. Add articles in Fabric Working first.");
    if (!confirm(`Generate yarn requirements for ${activePo.po_number}? Existing entries will be replaced.`)) return;
    setGenerating(true);
    try {
      // Delete existing yarn rows for this PO first to avoid duplicates
      const existing = yarns.filter(y => y.po_id === activePo.id);
      for (const y of existing) await mfg.yarn.delete(y.id);

      const fabricMap = {};
      articles.forEach(art => {
        (art.components || []).forEach(comp => {
          const key = `${comp.fabric_type}||${comp.gsm}||${comp.width}`;
          if (!fabricMap[key]) fabricMap[key] = { fabric_type: comp.fabric_type, gsm: comp.gsm||0, width_cm: comp.width||0, total_meters: 0 };
          fabricMap[key].total_meters += comp.total_required || 0;
        });
      });
      const rows = Object.values(fabricMap).map(f => ({
        po_id: activePo.id, po_number: activePo.po_number,
        fabric_type: f.fabric_type, gsm: f.gsm, width_cm: f.width_cm,
        total_meters: +(f.total_meters||0).toFixed(2),
        yarn_kg: toYarnKg(f.total_meters, f.gsm, f.width_cm),
        status: "Planned",
      }));
      if (rows.length) await mfg.yarn.bulkCreate(rows);
      qc.invalidateQueries({ queryKey: ["yarn", activePo?.id] });
    } finally { setGenerating(false); }
  };

  const totalKg = yarns.reduce((s,y) => s+(y.yarn_kg||0), 0);
  const planned = yarns.filter(y => y.status === "Planned").length;
  const received = yarns.filter(y => y.status === "Received").length;

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-14 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Scissors className="h-5 w-5 text-primary"/>
          <h1 className="text-base font-bold">Yarn Planning</h1>
          <Select value={selectedPoId || activePo?.id || ""} onValueChange={setSelectedPoId}>
            <SelectTrigger className="w-60 h-8 text-xs"><SelectValue placeholder="Select PO"/></SelectTrigger>
            <SelectContent>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} – {p.customer_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={handleAutoGenerate} disabled={generating}>
            <Zap className="h-3.5 w-3.5"/>{generating ? "Generating..." : "Auto from FWS"}
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-1.5"/> Add Yarn
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard title="Total Yarn Required" value={`${totalKg.toLocaleString()} kg`} icon={Scissors} iconBg="bg-purple-100"/>
        <StatCard title="Planned" value={planned} subtitle="Not yet ordered" icon={Scissors} iconBg="bg-amber-100"/>
        <StatCard title="Received" value={received} subtitle="In warehouse" icon={Scissors} iconBg="bg-green-100"/>
      </div>

      {yarns.length === 0 ? (
        <EmptyState icon={Scissors} title="No yarn requirements" description='Click "Auto from FWS" to generate from the Fabric Working Sheet, or add manually.' actionLabel="Add Yarn" onAction={() => setShowForm(true)}/>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {["Fabric Type","GSM","Width cm","Total Meters","Yarn Kg","Yarn Type","Count","Supplier","Status",""].map(h=>(
                      <TableHead key={h} className="text-xs">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {yarns.map(y => (
                    <TableRow key={y.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium">{y.fabric_type||"—"}</TableCell>
                      <TableCell className="text-xs">{y.gsm||"—"}</TableCell>
                      <TableCell className="text-xs">{y.width_cm||"—"}</TableCell>
                      <TableCell className="text-xs">{y.total_meters?.toFixed(2)||"—"}</TableCell>
                      <TableCell className="text-xs font-bold text-primary">{y.yarn_kg?.toFixed(2)||"—"}</TableCell>
                      <TableCell className="text-xs">{y.yarn_type||"—"}</TableCell>
                      <TableCell className="text-xs">{y.yarn_count||"—"}</TableCell>
                      <TableCell className="text-xs">{y.supplier||"—"}</TableCell>
                      <TableCell><StatusBadge status={y.status}/></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditing(y); setShowForm(true); }}><Pencil className="h-3 w-3 text-muted-foreground"/></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(y.id)}><Trash2 className="h-3 w-3 text-muted-foreground"/></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <YarnFormDialog open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing}/>
    </div>
  );
}

