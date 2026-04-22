import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, costing, mfg } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import PermissionGate from "@/components/shared/PermissionGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Plus, Pencil, Save, TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";

function calcCosting(f) {
  const fabric = Number(f.fabric_cost)||0, trim = Number(f.trim_cost)||0, acc = Number(f.accessory_cost)||0;
  const emb = Number(f.embellishment_cost)||0, cm = Number(f.cm_cost)||0, wash = Number(f.washing_cost)||0;
  const subtotal = fabric+trim+acc+emb+cm+wash;
  const overhead = +(subtotal*(Number(f.overhead_pct)||0)/100).toFixed(4);
  const freight = Number(f.freight_cost)||0;
  const commission = +(Number(f.buyer_price||0)*(Number(f.agent_commission_pct)||0)/100).toFixed(4);
  const total_cogs = +(subtotal+overhead+freight+commission).toFixed(4);
  const buyer_price = Number(f.buyer_price)||0;
  const gross_margin = +(buyer_price - total_cogs).toFixed(4);
  const gross_margin_pct = buyer_price > 0 ? +((gross_margin/buyer_price)*100).toFixed(2) : 0;
  return { total_cogs, gross_margin, gross_margin_pct };
}

function CostingRow({ sheet, onSave }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...sheet });
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p => ({ ...p, [k]:v }));
  const computed = useMemo(() => calcCosting(form), [form]);
  const handleSave = async () => {
    setSaving(true);
    try { await onSave(sheet.id, { ...form, ...computed }); } finally { setSaving(false); }
  };

  const marginColor = computed.gross_margin_pct >= 15 ? "text-emerald-600" : computed.gross_margin_pct >= 8 ? "text-amber-600" : "text-red-600";
  const inp = "h-7 text-xs px-2";

  return (
    <div className="border border-border rounded-xl overflow-hidden mb-2">
      <button onClick={() => setOpen(v=>!v)} className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/30">
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground"/> : <ChevronRight className="h-4 w-4 text-muted-foreground"/>}
          <div className="text-left">
            <p className="text-sm font-semibold">{sheet.article_code||"—"} {sheet.article_name && `— ${sheet.article_name}`}</p>
            <p className="text-xs text-muted-foreground">PO: {sheet.po_number} · Qty: {(sheet.order_quantity||0).toLocaleString()} pcs</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div><p className="text-xs text-muted-foreground">Buyer Price</p><p className="text-sm font-semibold">{sheet.currency} {Number(sheet.buyer_price||0).toFixed(4)}</p></div>
          <div><p className="text-xs text-muted-foreground">COGS</p><p className="text-sm font-semibold">{sheet.currency} {Number(computed.total_cogs||sheet.total_cogs||0).toFixed(4)}</p></div>
          <div>
            <p className="text-xs text-muted-foreground">Margin</p>
            <p className={cn("text-sm font-bold", marginColor)}>{computed.gross_margin_pct||sheet.gross_margin_pct||0}%</p>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border p-4 bg-background/60">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              ["buyer_price","Buyer Price (per pc)"],["fabric_cost","Fabric Cost"],["trim_cost","Trim Cost"],["accessory_cost","Accessory Cost"],
              ["embellishment_cost","Embellishment"],["cm_cost","CM (Cut & Make)"],["washing_cost","Washing/Finishing"],["freight_cost","Freight (per pc)"],
              ["overhead_pct","Overhead %"],["agent_commission_pct","Agent Commission %"],
            ].map(([k,label]) => (
              <div key={k} className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</Label>
                <Input className={inp} type="number" step="any" value={form[k]||""} onChange={e=>u(k,e.target.value)}/>
              </div>
            ))}
          </div>

          {/* Cost breakdown visual */}
          <div className="bg-muted/30 rounded-xl p-4 mb-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
              {[
                ["Fabric", form.fabric_cost],["Trims", form.trim_cost],["Accessories", form.accessory_cost],
                ["CM", form.cm_cost],["Overhead", ((Number(form.fabric_cost||0)+Number(form.trim_cost||0)+Number(form.cm_cost||0))*(Number(form.overhead_pct||0)/100)).toFixed(4)],
                ["Freight", form.freight_cost],["Total COGS", computed.total_cogs],
              ].map(([label,val]) => (
                <div key={label} className={label==="Total COGS"?"bg-primary/10 rounded-lg p-2":""}>
                  <p className="text-muted-foreground">{label}</p>
                  <p className={cn("font-semibold mt-0.5", label==="Total COGS"?"text-primary text-sm":"")}>{Number(val||0).toFixed(4)}</p>
                </div>
              ))}
              <div className={cn("rounded-lg p-2", computed.gross_margin_pct>=15?"bg-emerald-50":computed.gross_margin_pct>=8?"bg-amber-50":"bg-red-50")}>
                <p className="text-muted-foreground">Margin</p>
                <p className={cn("font-bold text-sm mt-0.5", marginColor)}>{computed.gross_margin_pct}%</p>
                <p className={cn("text-xs", marginColor)}>{computed.gross_margin>=0?"+":""}{Number(computed.gross_margin).toFixed(4)}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground flex-1">
              Total order profit: <span className={cn("font-bold", marginColor)}>{sheet.currency} {((computed.gross_margin||0)*(sheet.order_quantity||0)).toLocaleString(undefined,{minimumFractionDigits:2})}</span>
            </p>
            <Button size="sm" className="gap-1.5 text-xs" onClick={handleSave} disabled={saving}>
              <Save className="h-3.5 w-3.5"/>{saving?"Saving…":"Save Costing"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CostingPage() {
  const [searchParams] = useSearchParams();
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("po_id") || "");
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState({ article_code:"", article_name:"", order_quantity:"", buyer_price:"", currency:"USD", fabric_cost:"", trim_cost:"", accessory_cost:"", embellishment_cost:"", cm_cost:"", washing_cost:"", overhead_pct:8, agent_commission_pct:5, freight_cost:"" });
  const qc = useQueryClient();

  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const activePo = useMemo(()=>selectedPoId?pos.find(p=>p.id===selectedPoId):pos[0],[pos,selectedPoId]);
  const { data: sheets=[], isLoading } = useQuery({ queryKey:["costing",activePo?.id], queryFn:()=>costing.listByPO(activePo.id), enabled:!!activePo?.id });
  const { data: articles=[] } = useQuery({ queryKey:["articles",activePo?.id], queryFn:()=>mfg.articles.listByPO(activePo.id), enabled:!!activePo?.id });

  const handleUpdate = async (id, data) => {
    await costing.update(id, data);
    qc.invalidateQueries({ queryKey:["costing",activePo?.id] });
  };

  const handleAdd = async () => {
    if (!activePo) return;
    const computed = calcCosting(newForm);
    await costing.upsert({ ...newForm, po_id:activePo.id, po_number:activePo.po_number, order_quantity:Number(newForm.order_quantity)||0, buyer_price:Number(newForm.buyer_price)||0, ...computed });
    qc.invalidateQueries({ queryKey:["costing",activePo?.id] });
    setAdding(false);
  };

  const autoPopulateFromArticles = async () => {
    if (!activePo || !articles.length) return alert("No articles found. Set up Fabric Working first.");
    const trimItems = await mfg.trims.listByPO(activePo.id);
    // Pull unit prices from PO items
    const poItemRows = await db.poItems.listByPO(activePo.id);
    const priceMap = {};
    poItemRows.forEach(i => { if (i.item_code) priceMap[i.item_code.trim().toUpperCase()] = Number(i.unit_price||0); });
    for (const art of articles) {
      const fabCostFromComponents = (art.components||[]).reduce((s,c) => s + (c.total_required||0)*(c.cost_per_meter||0), 0);
      // If cost_per_meter not set, estimate fabric cost as ~55% of buyer price (typical for MP)
      const fabCost = fabCostFromComponents > 0 ? fabCostFromComponents : buyerPrice * 0.55;
      const trimCost = trimItems
        .filter(t => t.article_code === art.article_code)
        .reduce((s,t) => s + (t.total_cost||0), 0);
      const buyerPrice = priceMap[art.article_code?.trim().toUpperCase()] || 0;
      await costing.upsert({
        po_id: activePo.id, po_number: activePo.po_number,
        article_code: art.article_code, article_name: art.article_name,
        order_quantity: art.order_quantity||0, currency: activePo.currency||"USD",
        fabric_cost: +fabCost.toFixed(4),
        trim_cost: trimCost > 0 ? +trimCost.toFixed(4) : 0,
        buyer_price: buyerPrice, overhead_pct: 8, agent_commission_pct: 5,
      });
    }
    qc.invalidateQueries({ queryKey:["costing",activePo?.id] });
    qc.invalidateQueries({ queryKey:["allCostingSheets"] });
  };

  const totals = useMemo(() => {
    const totalRevenue = sheets.reduce((s,c) => s+(Number(c.buyer_price||0)*Number(c.order_quantity||0)),0);
    const totalCOGS = sheets.reduce((s,c) => s+(Number(c.total_cogs||0)*Number(c.order_quantity||0)),0);
    const totalMargin = totalRevenue - totalCOGS;
    const avgMarginPct = totalRevenue > 0 ? +((totalMargin/totalRevenue)*100).toFixed(1) : 0;
    return { totalRevenue, totalCOGS, totalMargin, avgMarginPct };
  }, [sheets]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><DollarSign className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Costing Sheets</h1>
          <Select value={selectedPoId||activePo?.id||""} onValueChange={setSelectedPoId}>
            <SelectTrigger className="w-60 h-8 text-xs"><SelectValue placeholder="Select PO"/></SelectTrigger>
            <SelectContent>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} – {p.customer_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1" onClick={autoPopulateFromArticles}><RefreshCw className="h-3.5 w-3.5"/>Auto-populate</Button>
          <Button size="sm" onClick={()=>setAdding(v=>!v)}><Plus className="h-4 w-4 mr-1.5"/>Add Article</Button>
        </div>
      </div>

      {sheets.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard title="Total Revenue" value={`$${(totals.totalRevenue/1000).toFixed(1)}k`} icon={DollarSign} iconBg="bg-emerald-100"/>
          <StatCard title="Total COGS" value={`$${(totals.totalCOGS/1000).toFixed(1)}k`} icon={TrendingDown} iconBg="bg-red-100"/>
          <StatCard title="Total Margin" value={`$${(totals.totalMargin/1000).toFixed(1)}k`} icon={TrendingUp} iconBg={totals.totalMargin>=0?"bg-emerald-100":"bg-red-100"}/>
          <StatCard title="Avg Margin %" value={`${totals.avgMarginPct}%`} icon={TrendingUp} iconBg={totals.avgMarginPct>=15?"bg-emerald-100":totals.avgMarginPct>=8?"bg-amber-100":"bg-red-100"}/>
        </div>
      )}

      {adding && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm">New Article Cost</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {[["article_code","Article Code"],["article_name","Article Name"],["order_quantity","Order Qty"],["buyer_price","Buyer Price"],["fabric_cost","Fabric Cost"],["cm_cost","CM Cost"],["trim_cost","Trim Cost"],["freight_cost","Freight (per pc)"]].map(([k,l]) => (
                <div key={k} className="space-y-1"><Label className="text-xs">{l}</Label>
                  <Input className="h-7 text-xs" type={["article_code","article_name"].includes(k)?"text":"number"} step="any" value={newForm[k]} onChange={e=>setNewForm(p=>({...p,[k]:e.target.value}))}/>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} className="text-xs">Save</Button>
              <Button size="sm" variant="outline" onClick={()=>setAdding(false)} className="text-xs">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && sheets.length===0 ? (
        <EmptyState icon={DollarSign} title="No costing sheets" description='Add article costings manually or click "Auto-populate" to pull from Fabric Working.' actionLabel="Add Article" onAction={()=>setAdding(true)}/>
      ) : (
        <div>{sheets.map(s=><CostingRow key={s.id} sheet={s} onSave={handleUpdate}/>)}</div>
      )}
    </div>
  );
}

