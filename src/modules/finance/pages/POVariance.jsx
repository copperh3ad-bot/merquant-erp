import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, AlertTriangle, DollarSign, Search, RefreshCcw } from "lucide-react";
import StatCard from "@/components/shared/StatCard";

const fmtMoney = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const fmtPct = (n) => `${Number(n || 0).toFixed(1)}%`;

function VarianceChip({ value, invertColor = false }) {
  const v = Number(value || 0);
  if (Math.abs(v) < 0.5) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  // Invert means positive variance is BAD (costs over quoted)
  const isBad = invertColor ? v > 0 : v < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isBad ? "text-red-600" : "text-emerald-600"}`}>
      {v > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {fmtMoney(Math.abs(v))}
    </span>
  );
}

export default function POVariance() {
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["poCostVariance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_po_cost_variance").select("*").order("po_number");
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = rows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.po_number || "").toLowerCase().includes(q) ||
           (r.customer_name || "").toLowerCase().includes(q);
  });

  const totals = filtered.reduce((acc, r) => {
    acc.quoted_revenue += Number(r.quoted_revenue || 0);
    acc.actual_material += Number(r.actual_material_cost || 0);
    acc.projected_margin += Number(r.projected_gross_margin || 0);
    acc.fabric_variance += Number(r.fabric_variance || 0);
    return acc;
  }, { quoted_revenue: 0, actual_material: 0, projected_margin: 0, fabric_variance: 0 });

  const marginPct = totals.quoted_revenue > 0
    ? (totals.projected_margin / totals.quoted_revenue * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" /> PO Cost Variance
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Quoted (costing sheet) vs actual (fabric/trim/accessory orders) — physical consumption basis
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md"
        >
          <RefreshCcw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Quoted Revenue" value={fmtMoney(totals.quoted_revenue)} icon={DollarSign} />
        <StatCard label="Actual Material Cost" value={fmtMoney(totals.actual_material)} icon={TrendingDown} />
        <StatCard label="Projected GM" value={fmtMoney(totals.projected_margin)} sub={fmtPct(marginPct)} icon={TrendingUp} accent={marginPct < 15 ? "red" : "green"} />
        <StatCard label="Fabric Variance" value={fmtMoney(totals.fabric_variance)} icon={AlertTriangle} accent={totals.fabric_variance > 0 ? "red" : "green"} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">Variance by PO ({filtered.length})</CardTitle>
            <div className="relative max-w-xs">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search PO/customer..."
                className="h-8 pl-7 text-xs w-48"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No POs found. Variance appears once fabric/trim/accessory orders are raised.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-medium">PO</th>
                    <th className="text-left p-2 font-medium">Customer</th>
                    <th className="text-right p-2 font-medium">Revenue</th>
                    <th className="text-right p-2 font-medium">Fabric Q</th>
                    <th className="text-right p-2 font-medium">Fabric A</th>
                    <th className="text-right p-2 font-medium">Δ Fabric</th>
                    <th className="text-right p-2 font-medium">Trim Q</th>
                    <th className="text-right p-2 font-medium">Trim A</th>
                    <th className="text-right p-2 font-medium">Δ Trim</th>
                    <th className="text-right p-2 font-medium">Accy Q</th>
                    <th className="text-right p-2 font-medium">Accy A</th>
                    <th className="text-right p-2 font-medium">Δ Accy</th>
                    <th className="text-right p-2 font-medium">Proj GM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(r => {
                    const gm = Number(r.projected_gross_margin || 0);
                    const rev = Number(r.quoted_revenue || 0);
                    const gmPct = rev > 0 ? (gm / rev * 100) : 0;
                    return (
                      <tr key={r.po_id} className="hover:bg-muted/30">
                        <td className="p-2 font-medium">{r.po_number}</td>
                        <td className="p-2">{r.customer_name}</td>
                        <td className="p-2 text-right">{fmtMoney(r.quoted_revenue)}</td>
                        <td className="p-2 text-right text-muted-foreground">{fmtMoney(r.quoted_fabric_cost)}</td>
                        <td className="p-2 text-right">{fmtMoney(r.actual_fabric_cost)}</td>
                        <td className="p-2 text-right"><VarianceChip value={r.fabric_variance} invertColor /></td>
                        <td className="p-2 text-right text-muted-foreground">{fmtMoney(r.quoted_trim_cost)}</td>
                        <td className="p-2 text-right">{fmtMoney(r.actual_trim_cost)}</td>
                        <td className="p-2 text-right"><VarianceChip value={r.trim_variance} invertColor /></td>
                        <td className="p-2 text-right text-muted-foreground">{fmtMoney(r.quoted_accessory_cost)}</td>
                        <td className="p-2 text-right">{fmtMoney(r.actual_accessory_cost)}</td>
                        <td className="p-2 text-right"><VarianceChip value={r.accessory_variance} invertColor /></td>
                        <td className="p-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={gm < 0 ? "text-red-600 font-medium" : ""}>{fmtMoney(gm)}</span>
                            <Badge variant={gmPct < 10 ? "destructive" : gmPct < 20 ? "secondary" : "default"} className="text-[10px]">
                              {fmtPct(gmPct)}
                            </Badge>
                          </div>
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

      <div className="text-xs text-muted-foreground px-1">
        <strong>Q</strong> = Quoted (costing sheet) · <strong>A</strong> = Actual (fabric/trim/accessory orders raised). Green Δ = under quote, Red Δ = over quote.
      </div>
    </div>
  );
}
