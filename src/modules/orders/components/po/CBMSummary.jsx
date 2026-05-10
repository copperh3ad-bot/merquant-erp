import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// Standard container capacities (usable CBM — slightly less than gross)
const CONTAINERS = [
  { name: "20ft Standard",  cbm: 25.0,  teu: 1, color: "#3b82f6", bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-800"   },
  { name: "40ft Standard",  cbm: 67.0,  teu: 2, color: "#6366f1", bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-800" },
  { name: "40ft High Cube", cbm: 76.0,  teu: 2, color: "#8b5cf6", bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-800" },
  { name: "LCL (per CBM)",  cbm: null,  teu: null, color: "#10b981", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800" },
];

function FillBar({ pct, color, label }) {
  const safeP = Math.min(100, Math.max(0, pct));
  const barColor = pct > 90 ? "#ef4444" : pct > 75 ? "#f59e0b" : "#22c55e";
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] mb-0.5 text-current opacity-80">
        <span>{label}</span>
        <span className="font-bold">{safeP.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-black/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${safeP}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

function getCartons(item) {
  if (item.pieces_per_carton && item.quantity) return Math.ceil(item.quantity / item.pieces_per_carton);
  return item.num_cartons || 0;
}

export default function CBMSummary({ items }) {
  const totalCbm   = useMemo(() => items.reduce((s, i) => s + (Number(i.cbm) || 0), 0), [items]);
  const totalCtns  = useMemo(() => items.reduce((s, i) => s + getCartons(i), 0), [items]);
  const totalQty   = useMemo(() => items.reduce((s, i) => s + (Number(i.quantity) || 0), 0), [items]);

  // Best-fit container recommendation
  const recommendation = useMemo(() => {
    if (!totalCbm) return null;
    // Try each FCL option and find the one with best utilisation ≥ 60%
    const fcl = CONTAINERS.filter(c => c.cbm);
    let best = null;
    for (const c of fcl) {
      const count = Math.ceil(totalCbm / c.cbm);
      const util  = (totalCbm / (count * c.cbm)) * 100;
      if (!best || (util > best.util && util >= 40)) {
        best = { ...c, count, util };
      }
    }
    return best;
  }, [totalCbm]);

  if (!totalCbm || items.filter(i => i.cbm > 0).length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-semibold">CBM & Container Space</CardTitle>
          <span className="text-xs text-muted-foreground ml-auto">Total: <span className="font-bold text-foreground">{totalCbm.toFixed(3)} m³</span></span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Item breakdown table ── */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 font-medium">Item Code</th>
                <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Description</th>
                <th className="text-right px-3 py-2 font-medium">Qty</th>
                <th className="text-right px-3 py-2 font-medium">Pcs/Ctn</th>
                <th className="text-right px-3 py-2 font-medium">Cartons</th>
                <th className="text-right px-3 py-2 font-medium">CBM</th>
                <th className="text-right px-3 py-2 font-medium">Share</th>
                <th className="px-3 py-2 w-24">
                  <span className="sr-only">Fill</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.filter(i => i.cbm > 0).map((item, idx) => {
                const pct   = totalCbm > 0 ? (item.cbm / totalCbm) * 100 : 0;
                const ctns  = getCartons(item);
                return (
                  <tr key={item.id || idx} className={cn("border-b border-border/50 hover:bg-muted/20", idx % 2 === 0 ? "" : "bg-muted/10")}>
                    <td className="px-3 py-2 font-medium">{item.item_code || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell max-w-[140px] truncate">
                      {item.item_description || item.fabric_type || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">{Number(item.quantity).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{item.pieces_per_carton || "—"}</td>
                    <td className="px-3 py-2 text-right font-medium">{ctns || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold">{Number(item.cbm).toFixed(3)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 w-24">
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="bg-muted/60 font-semibold border-t border-border">
                <td className="px-3 py-2" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right">{totalQty.toLocaleString()}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right">{totalCtns.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-primary">{totalCbm.toFixed(3)}</td>
                <td className="px-3 py-2 text-right">100%</td>
                <td className="px-3 py-2" />
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Container cards ── */}
        <div>
          <p className="text-xs font-semibold text-foreground mb-2.5">Container Requirements</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {CONTAINERS.map((c) => {
              if (!c.cbm) {
                // LCL card
                return (
                  <div key={c.name} className={cn("rounded-xl border p-3", c.bg, c.border, c.text)}>
                    <p className="text-xs font-semibold">{c.name}</p>
                    <p className="text-[11px] mt-0.5 opacity-70">Consolidated</p>
                    <p className="text-xl font-bold mt-1.5">
                      {totalCbm.toFixed(2)} <span className="text-sm font-normal">m³</span>
                    </p>
                    <p className="text-[11px] mt-1 opacity-70">
                      {totalCtns} carton{totalCtns !== 1 ? "s" : ""}
                    </p>
                    <div className="mt-2 text-[10px] opacity-60 italic">Suitable if &lt;10 m³</div>
                  </div>
                );
              }

              const count        = Math.ceil(totalCbm / c.cbm);
              const usedCbm      = totalCbm;
              const totalCapacity = count * c.cbm;
              const utilPct      = (usedCbm / totalCapacity) * 100;
              const fullContainers = Math.floor(totalCbm / c.cbm);
              const partialCbm   = totalCbm % c.cbm;
              const isRecommended = recommendation?.name === c.name;

              return (
                <div key={c.name} className={cn("rounded-xl border p-3 relative", c.bg, c.border, c.text)}>
                  {isRecommended && (
                    <div className="absolute -top-2 left-3">
                      <span className="text-[9px] bg-amber-400 text-amber-900 font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                        Best fit
                      </span>
                    </div>
                  )}
                  <p className="text-xs font-semibold mt-0.5">{c.name}</p>
                  <p className="text-[11px] opacity-70">{c.cbm} m³ capacity</p>
                  <p className="text-xl font-bold mt-1.5">
                    {count} <span className="text-sm font-normal">container{count !== 1 ? "s" : ""}</span>
                  </p>
                  {fullContainers > 0 && partialCbm > 0.01 && (
                    <p className="text-[11px] mt-0.5 opacity-70">
                      {fullContainers} full + {partialCbm.toFixed(2)} m³ partial
                    </p>
                  )}
                  <FillBar pct={utilPct} label="Space utilisation" />
                  <p className={cn(
                    "text-[10px] mt-1.5 font-medium",
                    utilPct < 50 ? "opacity-60" : utilPct < 75 ? "opacity-80" : ""
                  )}>
                    {utilPct < 50 && "⚠ Under-utilised — consider mixing"}
                    {utilPct >= 50 && utilPct < 75 && "✓ Acceptable utilisation"}
                    {utilPct >= 75 && "✓ Good utilisation"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Mixed container suggestion ── */}
        {(() => {
          const remainder40 = totalCbm % 67;
          const remainder40hc = totalCbm % 76;
          // If there's a significant partial container, suggest mixing with a 20ft
          const mixSaves = remainder40 > 5 && remainder40 < 25;
          if (!mixSaves) return null;
          const full40 = Math.floor(totalCbm / 67);
          return (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <span className="font-semibold">Mixed loading suggestion:</span> {full40} × 40ft + 1 × 20ft container
                could consolidate the {remainder40.toFixed(2)} m³ remainder more efficiently
                than booking an additional 40ft at {((remainder40 / 67) * 100).toFixed(0)}% utilisation.
              </div>
            </div>
          );
        })()}

        {/* ── Carton summary ── */}
        {totalCtns > 0 && (
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Total Cartons", totalCtns.toLocaleString(), "text-foreground"],
              ["Total CBM", `${totalCbm.toFixed(3)} m³`, "text-primary"],
              ["Avg CBM/Carton", totalCtns > 0 ? `${(totalCbm / totalCtns).toFixed(4)} m³` : "—", "text-muted-foreground"],
            ].map(([label, value, cls]) => (
              <div key={label} className="bg-muted/30 rounded-xl p-3">
                <p className={cn("text-base font-bold", cls)}>{value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

