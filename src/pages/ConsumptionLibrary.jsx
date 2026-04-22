import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Save, X, Plus, Trash2, Loader2, Search, Filter, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const FIELDS = [
  { key: "item_code", label: "Item Code", width: "w-24", type: "text", readonly: true },
  { key: "size", label: "Size", width: "w-16", type: "text" },
  { key: "kind", label: "Kind", width: "w-20", type: "select", options: ["fabric", "accessory"] },
  { key: "component_type", label: "Component", width: "w-24", type: "text" },
  { key: "fabric_type", label: "Fabric / Material", width: "w-64", type: "text" },
  { key: "color", label: "Color", width: "w-20", type: "text" },
  { key: "gsm", label: "GSM", width: "w-16", type: "number" },
  { key: "width_cm", label: "Width cm", width: "w-20", type: "number" },
  { key: "consumption_per_unit", label: "Cons/Unit", width: "w-24", type: "number", step: "0.0001" },
  { key: "wastage_percent", label: "Wastage %", width: "w-20", type: "number", step: "0.1" },
  { key: "supplier", label: "Supplier", width: "w-32", type: "text" },
];

export default function ConsumptionLibrary() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ search: "", kind: "all", item_code: "" });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [bulkEdit, setBulkEdit] = useState(false);
  const [bulkChanges, setBulkChanges] = useState({}); // { id: {field: value} }
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(null);
  const [newRowOpen, setNewRowOpen] = useState(false);
  const [newRow, setNewRow] = useState({ kind: "fabric", wastage_percent: 6 });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["consumptionLibrary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("consumption_library")
        .select("*").order("item_code").order("kind").order("component_type");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: tpCodes = new Set() } = useQuery({
    queryKey: ["techPackCodes"],
    queryFn: async () => {
      const { data } = await supabase.from("tech_packs").select("article_code");
      return new Set((data || []).map(t => t.article_code));
    },
  });

  const filtered = useMemo(() => {
    const s = filters.search.toLowerCase().trim();
    return rows.filter(r => {
      if (filters.kind !== "all" && r.kind !== filters.kind) return false;
      if (filters.item_code && !r.item_code?.toLowerCase().includes(filters.item_code.toLowerCase())) return false;
      if (!s) return true;
      return (
        r.item_code?.toLowerCase().includes(s) ||
        r.component_type?.toLowerCase().includes(s) ||
        r.fabric_type?.toLowerCase().includes(s) ||
        r.material?.toLowerCase().includes(s) ||
        r.color?.toLowerCase().includes(s)
      );
    });
  }, [rows, filters]);

  const uniqueItemCodes = useMemo(
    () => Array.from(new Set(rows.map(r => r.item_code).filter(Boolean))).sort(),
    [rows]
  );

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditDraft({ ...row });
  };

  const cancelEdit = () => {
    setEditingId(null); setEditDraft({});
  };

  const saveEdit = async () => {
    setSaving(true);
    const toNum = (v) => v === "" || v == null ? null : Number(v);
    const payload = {
      size: editDraft.size || null,
      kind: editDraft.kind,
      component_type: editDraft.component_type || null,
      fabric_type: editDraft.fabric_type || null,
      color: editDraft.color || null,
      gsm: toNum(editDraft.gsm),
      width_cm: toNum(editDraft.width_cm),
      consumption_per_unit: toNum(editDraft.consumption_per_unit),
      wastage_percent: toNum(editDraft.wastage_percent),
      supplier: editDraft.supplier || null,
    };
    const { error } = await supabase.from("consumption_library").update(payload).eq("id", editingId);
    setSaving(false);
    if (error) { alert("Save failed: " + error.message); return; }
    await denormalizeArticle(editDraft.item_code);
    qc.invalidateQueries({ queryKey: ["consumptionLibrary"] });
    qc.invalidateQueries({ queryKey: ["allArticles"] });
    setSavedBanner({ msg: "Row updated", ts: Date.now() });
    setEditingId(null); setEditDraft({});
  };

  const deleteRow = async (row) => {
    if (!confirm(`Delete ${row.item_code} / ${row.component_type}?`)) return;
    setSaving(true);
    const { error } = await supabase.from("consumption_library").delete().eq("id", row.id);
    setSaving(false);
    if (error) { alert("Delete failed: " + error.message); return; }
    await denormalizeArticle(row.item_code);
    qc.invalidateQueries({ queryKey: ["consumptionLibrary"] });
    qc.invalidateQueries({ queryKey: ["allArticles"] });
    setSavedBanner({ msg: "Row deleted", ts: Date.now() });
  };

  const updateBulk = (id, field, value) => {
    setBulkChanges(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value === "" ? null : (["gsm","width_cm","consumption_per_unit","wastage_percent"].includes(field) ? Number(value) : value) }
    }));
  };

  const saveBulk = async () => {
    setSaving(true);
    const entries = Object.entries(bulkChanges);
    let failed = 0;
    const affected = new Set();
    for (const [id, changes] of entries) {
      const { error } = await supabase.from("consumption_library").update(changes).eq("id", id);
      if (error) { failed++; console.error(`Bulk update ${id}:`, error); }
      const orig = rows.find(r => r.id === id);
      if (orig) affected.add(orig.item_code);
    }
    // Denormalize affected articles
    for (const code of affected) await denormalizeArticle(code);
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["consumptionLibrary"] });
    qc.invalidateQueries({ queryKey: ["allArticles"] });
    setBulkChanges({}); setBulkEdit(false);
    setSavedBanner({ msg: `${entries.length - failed} rows updated${failed ? ` · ${failed} failed` : ""}`, ts: Date.now() });
  };

  const createRow = async () => {
    if (!newRow.item_code || !newRow.kind || !newRow.component_type) {
      alert("item_code, kind, component_type required");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("consumption_library").insert(newRow);
    setSaving(false);
    if (error) { alert("Create failed: " + error.message); return; }
    await denormalizeArticle(newRow.item_code);
    qc.invalidateQueries({ queryKey: ["consumptionLibrary"] });
    qc.invalidateQueries({ queryKey: ["allArticles"] });
    setSavedBanner({ msg: "Row created", ts: Date.now() });
    setNewRowOpen(false);
    setNewRow({ kind: "fabric", wastage_percent: 6 });
  };

  const denormalizeArticle = async (itemCode) => {
    if (!itemCode) return;

    // Pull the article's finish dimensions for product_size mapping
    const { data: art } = await supabase.from("articles")
      .select("size, finish_dimensions").eq("article_code", itemCode).maybeSingle();
    const productSize = art?.finish_dimensions || art?.size || null;

    const { data: cl } = await supabase.from("consumption_library")
      .select("*").eq("item_code", itemCode);

    const directionFor = (component_type, kind) => {
      if (kind !== "fabric") return null;
      const t = (component_type || "").toLowerCase();
      if (t === "skirt") return "LXW";
      if (t === "piping" || t === "binding") return "WXL";
      if (/platform|bottom|sleeper|evalon|sheet|front|back|top fabric|pillow case/.test(t)) return "WXL";
      return null;
    };

    const components = (cl || []).map(c => ({
      component_type: c.component_type,
      kind: c.kind,
      fabric_type: c.fabric_type,
      material: c.material,
      gsm: c.gsm,
      width: c.width_cm,
      color: c.color,
      construction: c.construction,
      finish: c.treatment,
      placement: c.placement,
      size_spec: c.size_spec,
      product_size: productSize,
      direction: directionFor(c.component_type, c.kind),
      consumption_per_unit: c.consumption_per_unit || 0,
      wastage_percent: c.wastage_percent || 0,
      supplier: c.supplier || null,
    })).sort((a, b) => {
      const rank = k => k === "fabric" ? 1 : k === "accessory" ? 2 : 3;
      return rank(a.kind) - rank(b.kind) ||
             (a.component_type || "").localeCompare(b.component_type || "");
    });

    await supabase.from("articles").update({ components }).eq("article_code", itemCode);
  };

  // Auto-dismiss saved banner after 3 seconds
  useEffect(() => {
    if (!savedBanner) return;
    const t = setTimeout(() => setSavedBanner(null), 3000);
    return () => clearTimeout(t);
  }, [savedBanner]);

  const renderCell = (row, field) => {
    const inline = editingId === row.id;
    const bulk = bulkEdit;
    const val = inline ? editDraft[field.key] : (bulkChanges[row.id]?.[field.key] ?? row[field.key]);

    if (!inline && !bulk) return <span className="text-xs">{row[field.key] ?? "—"}</span>;
    if (inline && field.readonly) return <span className="text-xs text-muted-foreground">{val ?? "—"}</span>;

    const setter = inline
      ? (v) => setEditDraft({ ...editDraft, [field.key]: v })
      : (v) => updateBulk(row.id, field.key, v);

    if (field.type === "select") {
      return (
        <Select value={val || ""} onValueChange={setter}>
          <SelectTrigger className="h-6 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent>
            {field.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }

    return (
      <Input
        type={field.type === "number" ? "number" : "text"}
        step={field.step}
        value={val ?? ""}
        onChange={(e) => setter(e.target.value)}
        className={cn("h-6 text-xs px-1.5", bulk && bulkChanges[row.id]?.[field.key] !== undefined && "bg-amber-50 border-amber-400")}
      />
    );
  };

  const pendingBulkCount = Object.keys(bulkChanges).length;

  return (
    <div className="space-y-4">
      {savedBanner && (
        <div className="fixed top-20 right-4 z-50 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 shadow-lg flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600"/>
          <span className="text-xs font-medium text-emerald-800">{savedBanner.msg}</span>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Pencil className="h-5 w-5 text-primary"/>
          <h1 className="text-base font-bold">Consumption Library · Edit Online</h1>
          <span className="text-xs text-muted-foreground">
            {filtered.length} / {rows.length} rows
          </span>
        </div>

        <div className="flex gap-2">
          {bulkEdit ? (
            <>
              <Button size="sm" variant="outline" onClick={() => { setBulkEdit(false); setBulkChanges({}); }}>
                <X className="h-3.5 w-3.5 mr-1.5"/>Cancel
              </Button>
              <Button size="sm" onClick={saveBulk} disabled={pendingBulkCount === 0 || saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin"/> : <Save className="h-3.5 w-3.5 mr-1.5"/>}
                Save {pendingBulkCount > 0 ? `(${pendingBulkCount})` : ""}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setNewRowOpen(!newRowOpen)}>
                <Plus className="h-3.5 w-3.5 mr-1.5"/>New Row
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkEdit(true)} disabled={filtered.length === 0}>
                <Pencil className="h-3.5 w-3.5 mr-1.5"/>Bulk Edit
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card><CardContent className="p-3 flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <Input placeholder="Search item / fabric / color…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="h-8 pl-7 text-xs"/>
        </div>
        <Select value={filters.kind} onValueChange={(v) => setFilters({ ...filters, kind: v })}>
          <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Kind"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="fabric">Fabric</SelectItem>
            <SelectItem value="accessory">Accessory</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.item_code || "all"} onValueChange={(v) => setFilters({ ...filters, item_code: v === "all" ? "" : v })}>
          <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="Item code"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            {uniqueItemCodes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardContent></Card>

      {/* New row panel */}
      {newRowOpen && (
        <Card className="border-primary/30"><CardContent className="p-3">
          <p className="text-xs font-semibold mb-2">New consumption row</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Input placeholder="item_code *" value={newRow.item_code || ""} onChange={e => setNewRow({ ...newRow, item_code: e.target.value })} className="h-8 text-xs"/>
            <Select value={newRow.kind} onValueChange={v => setNewRow({ ...newRow, kind: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="fabric">fabric</SelectItem>
                <SelectItem value="accessory">accessory</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="component_type *" value={newRow.component_type || ""} onChange={e => setNewRow({ ...newRow, component_type: e.target.value })} className="h-8 text-xs"/>
            <Input placeholder="fabric_type / material" value={newRow.fabric_type || ""} onChange={e => setNewRow({ ...newRow, fabric_type: e.target.value })} className="h-8 text-xs"/>
            <Input placeholder="size" value={newRow.size || ""} onChange={e => setNewRow({ ...newRow, size: e.target.value })} className="h-8 text-xs"/>
            <Input placeholder="color" value={newRow.color || ""} onChange={e => setNewRow({ ...newRow, color: e.target.value })} className="h-8 text-xs"/>
            <Input placeholder="gsm" type="number" value={newRow.gsm || ""} onChange={e => setNewRow({ ...newRow, gsm: Number(e.target.value) })} className="h-8 text-xs"/>
            <Input placeholder="width_cm" type="number" value={newRow.width_cm || ""} onChange={e => setNewRow({ ...newRow, width_cm: Number(e.target.value) })} className="h-8 text-xs"/>
            <Input placeholder="consumption/unit" type="number" step="0.0001" value={newRow.consumption_per_unit || ""} onChange={e => setNewRow({ ...newRow, consumption_per_unit: Number(e.target.value) })} className="h-8 text-xs"/>
            <Input placeholder="wastage %" type="number" step="0.1" value={newRow.wastage_percent || ""} onChange={e => setNewRow({ ...newRow, wastage_percent: Number(e.target.value) })} className="h-8 text-xs"/>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={() => { setNewRowOpen(false); setNewRow({ kind: "fabric", wastage_percent: 6 }); }}>Cancel</Button>
            <Button size="sm" onClick={createRow} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin"/>}
              Create
            </Button>
          </div>
        </CardContent></Card>
      )}

      {/* Data grid */}
      <Card><CardContent className="p-0">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2"/>Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No rows match the current filters.
          </div>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-xs">
              <thead className="bg-[#1F3864] text-white sticky top-0 z-10">
                <tr>
                  {FIELDS.map(f => <th key={f.key} className={cn("text-left px-2 py-1.5 font-medium whitespace-nowrap", f.width)}>{f.label}</th>)}
                  <th className="px-2 py-1.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const hasTP = tpCodes.has(row.item_code);
                  return (
                    <tr key={row.id} className={cn(
                      "border-b",
                      i % 2 === 0 && "bg-[#EBF0FA]/50",
                      hasTP && "bg-emerald-50/30",
                      editingId === row.id && "bg-amber-50/60 ring-1 ring-amber-300"
                    )}>
                      {FIELDS.map(f => (
                        <td key={f.key} className="px-2 py-1">{renderCell(row, f)}</td>
                      ))}
                      <td className="px-2 py-1">
                        {editingId === row.id ? (
                          <div className="flex gap-1">
                            <button onClick={saveEdit} className="p-1 rounded hover:bg-emerald-100" title="Save">
                              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Save className="h-3.5 w-3.5 text-emerald-700"/>}
                            </button>
                            <button onClick={cancelEdit} className="p-1 rounded hover:bg-muted" title="Cancel">
                              <X className="h-3.5 w-3.5 text-muted-foreground"/>
                            </button>
                          </div>
                        ) : !bulkEdit ? (
                          <div className="flex gap-1">
                            <button onClick={() => startEdit(row)} className="p-1 rounded hover:bg-blue-100" title="Edit">
                              <Pencil className="h-3.5 w-3.5 text-blue-600"/>
                            </button>
                            <button onClick={() => deleteRow(row)} className="p-1 rounded hover:bg-red-100" title="Delete">
                              <Trash2 className="h-3.5 w-3.5 text-red-500"/>
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
