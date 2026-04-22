import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Search, RefreshCcw, Plus, AlertTriangle, CheckCircle2, Warehouse, TrendingDown } from "lucide-react";
import StatCard from "@/components/shared/StatCard";

const CATEGORIES = ["yarn", "fabric", "trim", "accessory", "packaging"];

const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

function StatusBadge({ status }) {
  const map = {
    green: { cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2, label: "Covered" },
    yellow: { cls: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle, label: "Tight" },
    red: { cls: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle, label: "Short" },
  };
  const m = map[status] || map.red;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${m.cls}`}>
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

export default function RMCoverage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all");
  const [statusFilter, setStatusFilter] = useState("__all");
  const [editingItem, setEditingItem] = useState(null);
  const [stockForm, setStockForm] = useState({
    item_category: "fabric",
    item_code: "",
    item_description: "",
    unit: "meters",
    on_hand_qty: 0,
    in_transit_qty: 0,
    reorder_level: 0,
    unit_cost: 0,
    warehouse_location: "",
    notes: "",
  });

  const { data: coverage = [], isLoading, refetch } = useQuery({
    queryKey: ["rmCoverage"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_rm_coverage").select("*")
        .order("coverage_status", { ascending: true })
        .order("item_category");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: stockRows = [] } = useQuery({
    queryKey: ["rmStock"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rm_stock").select("*").order("item_category").order("item_code");
      if (error) throw error;
      return data || [];
    },
  });

  const saveStock = useMutation({
    mutationFn: async (payload) => {
      if (payload.id) {
        const { data, error } = await supabase.from("rm_stock").update(payload).eq("id", payload.id).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from("rm_stock").upsert(payload, {
        onConflict: "item_category,item_code",
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rmCoverage"] });
      qc.invalidateQueries({ queryKey: ["rmStock"] });
      setEditingItem(null);
      resetForm();
    },
  });

  const resetForm = () => setStockForm({
    item_category: "fabric", item_code: "", item_description: "", unit: "meters",
    on_hand_qty: 0, in_transit_qty: 0, reorder_level: 0, unit_cost: 0, warehouse_location: "", notes: "",
  });

  const openEditFromCoverage = (row) => {
    const existing = stockRows.find(s => 
      s.item_category === row.item_category && 
      s.item_code.toLowerCase().trim() === (row.item_code || "").toLowerCase().trim()
    );
    if (existing) {
      setStockForm({ ...existing });
      setEditingItem(existing.id);
    } else {
      setStockForm({
        ...stockForm,
        item_category: row.item_category,
        item_code: row.item_code || "",
        item_description: row.item_description || "",
        unit: row.unit || "pcs",
      });
      setEditingItem("new");
    }
  };

  const filtered = coverage.filter(r => {
    if (categoryFilter !== "__all" && r.item_category !== categoryFilter) return false;
    if (statusFilter !== "__all" && r.coverage_status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.item_code || "").toLowerCase().includes(q) ||
           (r.item_description || "").toLowerCase().includes(q);
  });

  const totals = coverage.reduce((acc, r) => {
    acc[r.coverage_status] = (acc[r.coverage_status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-bold text-foreground flex items-center gap-2">
            <Warehouse className="h-5 w-5 text-primary" /> Raw Material Coverage
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            12-week horizon · requirements from open POs vs stock on hand + in-transit
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { resetForm(); setEditingItem("new"); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Add Stock
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Items" value={coverage.length} icon={Package} />
        <StatCard label="Covered" value={totals.green || 0} icon={CheckCircle2} accent="green" />
        <StatCard label="Tight (<70%)" value={totals.yellow || 0} icon={AlertTriangle} accent="yellow" />
        <StatCard label="Short" value={totals.red || 0} icon={TrendingDown} accent="red" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-sm mr-auto">Coverage ({filtered.length})</CardTitle>
            <div className="relative max-w-xs">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item..." className="h-8 pl-7 text-xs w-48" />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All status</SelectItem>
                <SelectItem value="green">Covered</SelectItem>
                <SelectItem value="yellow">Tight</SelectItem>
                <SelectItem value="red">Short</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No requirements match filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-medium">Category</th>
                    <th className="text-left p-2 font-medium">Item</th>
                    <th className="text-right p-2 font-medium">Required</th>
                    <th className="text-right p-2 font-medium">On Hand</th>
                    <th className="text-right p-2 font-medium">In Transit</th>
                    <th className="text-right p-2 font-medium">Surplus/Short</th>
                    <th className="text-center p-2 font-medium">Status</th>
                    <th className="text-right p-2 font-medium">POs</th>
                    <th className="text-left p-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(r => {
                    const surplus = Number(r.coverage_surplus || 0);
                    return (
                      <tr key={`${r.item_category}-${r.item_code}`} className="hover:bg-muted/30">
                        <td className="p-2"><Badge variant="secondary" className="text-[10px] capitalize">{r.item_category}</Badge></td>
                        <td className="p-2">
                          <div className="font-medium">{r.item_description || r.item_code}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{r.item_code}</div>
                        </td>
                        <td className="p-2 text-right">{fmtNum(r.total_required)} <span className="text-muted-foreground">{r.unit}</span></td>
                        <td className="p-2 text-right">{fmtNum(r.on_hand_qty)}</td>
                        <td className="p-2 text-right text-muted-foreground">{fmtNum(r.in_transit_qty)}</td>
                        <td className={`p-2 text-right font-medium ${surplus < 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {surplus > 0 ? "+" : ""}{fmtNum(surplus)}
                        </td>
                        <td className="p-2 text-center"><StatusBadge status={r.coverage_status} /></td>
                        <td className="p-2 text-right text-muted-foreground">{r.linked_pos}</td>
                        <td className="p-2">
                          <button
                            onClick={() => openEditFromCoverage(r)}
                            className="text-xs text-primary hover:underline"
                          >
                            Edit stock
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingItem} onOpenChange={(o) => { if (!o) { setEditingItem(null); resetForm(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem === "new" ? "Add Stock Item" : "Edit Stock"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <Select value={stockForm.item_category} onValueChange={v => setStockForm(f => ({ ...f, item_category: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit</label>
                <Input value={stockForm.unit} onChange={e => setStockForm(f => ({ ...f, unit: e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Item Code</label>
              <Input value={stockForm.item_code} onChange={e => setStockForm(f => ({ ...f, item_code: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Description</label>
              <Input value={stockForm.item_description} onChange={e => setStockForm(f => ({ ...f, item_description: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">On Hand</label>
                <Input type="number" value={stockForm.on_hand_qty} onChange={e => setStockForm(f => ({ ...f, on_hand_qty: Number(e.target.value) }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">In Transit</label>
                <Input type="number" value={stockForm.in_transit_qty} onChange={e => setStockForm(f => ({ ...f, in_transit_qty: Number(e.target.value) }))} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Reorder Level</label>
                <Input type="number" value={stockForm.reorder_level} onChange={e => setStockForm(f => ({ ...f, reorder_level: Number(e.target.value) }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit Cost</label>
                <Input type="number" step="0.01" value={stockForm.unit_cost} onChange={e => setStockForm(f => ({ ...f, unit_cost: Number(e.target.value) }))} className="h-8 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Warehouse</label>
              <Input value={stockForm.warehouse_location || ""} onChange={e => setStockForm(f => ({ ...f, warehouse_location: e.target.value }))} className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => { setEditingItem(null); resetForm(); }}
              className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md"
            >Cancel</button>
            <button
              onClick={() => saveStock.mutate(stockForm)}
              disabled={!stockForm.item_code || saveStock.isLoading}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50"
            >
              {saveStock.isLoading ? "Saving…" : "Save"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
