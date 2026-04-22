import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db, seasons } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Sun, Plus, Pencil, Trash2, TrendingUp, Package, DollarSign, Ship, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";

const STATUSES = ["Planning","Active","Completed","Cancelled"];
const STATUS_STYLES = {
  "Active":    "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Planning":  "bg-blue-50 text-blue-700 border-blue-200",
  "Completed": "bg-gray-50 text-gray-600 border-gray-200",
  "Cancelled": "bg-red-50 text-red-500 border-red-200",
};
const empty = { name:"", start_date:"", end_date:"", target_value:"", target_quantity:"", status:"Planning", notes:"" };

function SeasonForm({ open, onOpenChange, onSave, initialData }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u=(k,v)=>setForm(p=>({...p,[k]:v}));
  React.useEffect(()=>{ if(open) setForm(initialData?{...empty,...initialData}:empty); },[open,initialData]);
  const handleSave=async()=>{ setSaving(true); try { await onSave({...form,target_value:form.target_value?Number(form.target_value):null,target_quantity:form.target_quantity?Number(form.target_quantity):null}); } finally { setSaving(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{initialData?"Edit Season":"Add Season"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5"><Label className="text-xs">Season Name *</Label><Input value={form.name} onChange={e=>u("name",e.target.value)} placeholder="SS26"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>u("status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{STATUSES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Start Date</Label><Input type="date" value={form.start_date} onChange={e=>u("start_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">End Date</Label><Input type="date" value={form.end_date} onChange={e=>u("end_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Target Value ($)</Label><Input type="number" value={form.target_value} onChange={e=>u("target_value",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Target Qty (pcs)</Label><Input type="number" value={form.target_quantity} onChange={e=>u("target_quantity",e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.name}>{saving?"Saving…":"Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBar({ value, max, color="bg-primary" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full"><div className={cn("h-full rounded-full transition-all", color)} style={{width:`${pct}%`}}/></div>
      <span className="text-[11px] text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function SeasonPlanningPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const qc = useQueryClient();

  const { data: seasonList=[], isLoading } = useQuery({ queryKey:["seasons"], queryFn:()=>seasons.list() });
  const { data: purchaseOrders=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });

  const handleSave=async(data)=>{ if(editing){await seasons.update(editing.id,data);}else{await seasons.create(data);} qc.invalidateQueries({queryKey:["seasons"]}); setShowForm(false); setEditing(null); };
  const handleDelete=async(id)=>{ if(!confirm("Delete season?"))return; await seasons.delete(id); qc.invalidateQueries({queryKey:["seasons"]}); };

  // Aggregate PO data per season
  const seasonData = useMemo(()=>seasonList.map(s=>{
    const pos = purchaseOrders.filter(p=>p.season===s.name);
    const totalValue = pos.reduce((a,p)=>a+(p.total_po_value||0),0);
    const totalQty = pos.reduce((a,p)=>a+(p.total_quantity||0),0);
    const confirmed = pos.filter(p=>!["PO Received"].includes(p.status)).length;
    const inProd = pos.filter(p=>["In Production","QC Inspection","Ready to Ship"].includes(p.status)).length;
    const shipped = pos.filter(p=>["Shipped","At Port","Delivered"].includes(p.status)).length;
    const buyers = [...new Set(pos.map(p=>p.customer_name))];
    return { ...s, pos, totalValue, totalQty, confirmed, inProd, shipped, buyers };
  }),[seasonList,purchaseOrders]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Sun className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Season Planning</h1></div>
        <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}}><Plus className="h-4 w-4 mr-1.5"/>Add Season</Button>
      </div>

      {isLoading?<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{[1,2,3].map(i=><div key={i} className="h-48 rounded-xl bg-muted/40 animate-pulse"/>)}</div>:
       seasonData.length===0?<EmptyState icon={Sun} title="No seasons" description="Add seasons to track buyer commitments, targets, and progress." actionLabel="Add Season" onAction={()=>setShowForm(true)}/>:(
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {seasonData.map(s=>(
            <Card key={s.id} className={cn("overflow-hidden",s.status==="Active"&&"border-primary/30")}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold">{s.name}</CardTitle>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded border",STATUS_STYLES[s.status]||"")}>{s.status}</span>
                  </div>
                  {s.buyers.length>0&&<p className="text-xs text-muted-foreground mt-1">{s.buyers.slice(0,3).join(" · ")}{s.buyers.length>3?` +${s.buyers.length-3}`:""}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>{setEditing(s);setShowForm(true);}}><Pencil className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>handleDelete(s.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                {/* KPIs */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    [s.pos.length,"POs",Package],
                    [s.confirmed,"Confirmed",CheckCircle2],
                    [s.inProd,"In Production",TrendingUp],
                    [s.shipped,"Shipped",Ship],
                  ].map(([val,lbl,Icon])=>(
                    <div key={lbl} className="bg-muted/40 rounded-lg p-2">
                      <p className="text-lg font-bold text-foreground">{val}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{lbl}</p>
                    </div>
                  ))}
                </div>

                {/* Progress bars */}
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3"/>Value</span>
                      <span className="text-xs font-semibold">${(s.totalValue/1000).toFixed(0)}k{s.target_value?` / $${(s.target_value/1000).toFixed(0)}k`:""}</span>
                    </div>
                    <ProgressBar value={s.totalValue} max={s.target_value||s.totalValue||1} color="bg-emerald-500"/>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3"/>Quantity</span>
                      <span className="text-xs font-semibold">{(s.totalQty/1000).toFixed(0)}k{s.target_quantity?` / ${(s.target_quantity/1000).toFixed(0)}k pcs`:""}</span>
                    </div>
                    <ProgressBar value={s.totalQty} max={s.target_quantity||s.totalQty||1} color="bg-primary"/>
                  </div>
                  {s.pos.length>0&&(
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><Ship className="h-3 w-3"/>Shipped</span>
                        <span className="text-xs font-semibold">{s.shipped} of {s.pos.length} POs</span>
                      </div>
                      <ProgressBar value={s.shipped} max={s.pos.length} color="bg-teal-500"/>
                    </div>
                  )}
                </div>

                {/* Buyer breakdown */}
                {s.buyers.length>0&&(
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">By Buyer</p>
                    <div className="space-y-1">
                      {s.buyers.map(buyer=>{
                        const bpos = s.pos.filter(p=>p.customer_name===buyer);
                        const bval = bpos.reduce((a,p)=>a+(p.total_po_value||0),0);
                        return (
                          <div key={buyer} className="flex items-center justify-between text-xs">
                            <span className="text-foreground font-medium truncate max-w-[160px]">{buyer}</span>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span>{bpos.length} PO{bpos.length!==1?"s":""}</span>
                              <span className="font-semibold text-foreground">${(bval/1000).toFixed(0)}k</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <SeasonForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing}/>
    </div>
  );
}

