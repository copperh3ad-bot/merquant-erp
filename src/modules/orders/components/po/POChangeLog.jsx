import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { changeLog } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { GitCommit, Plus, CheckCircle2, Clock, XCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const CHANGE_TYPES = ["Quantity Change","Price Change","Delivery Date Extension","Spec Change","Style Addition","Style Cancellation","Payment Terms Change","Other"];
const STATUS_STYLES = {
  "Approved":  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Pending":   "bg-amber-50 text-amber-700 border-amber-200",
  "Rejected":  "bg-red-50 text-red-700 border-red-200",
};

const empty = { change_type:"Quantity Change", field_name:"", old_value:"", new_value:"", reason:"", requested_by:"", authorised_by:"", status:"Pending" };
const fmt = (d) => { try { return d?format(new Date(d),"dd MMM yyyy, HH:mm"):"—"; } catch { return "—"; } };

export default function POChangeLog({ poId, poNumber }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const u = (k,v) => setForm(p=>({...p,[k]:v}));

  const { data: log=[] } = useQuery({ queryKey:["changeLog",poId], queryFn:()=>changeLog.listByPO(poId), enabled:!!poId });

  const handleSave = async () => {
    setSaving(true);
    try {
      await changeLog.create({ ...form, po_id:poId, po_number:poNumber });
      qc.invalidateQueries({queryKey:["changeLog",poId]});
      setShowForm(false); setForm(empty);
    } finally { setSaving(false); }
  };

  const handleStatusChange = async (id, status) => {
    await changeLog.update(id, { status });
    qc.invalidateQueries({queryKey:["changeLog",poId]});
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-primary"/>
          <h3 className="text-sm font-semibold text-foreground">Change Log & Communications</h3>
          {log.filter(l=>l.status==="Pending").length > 0 && (
            <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold">
              {log.filter(l=>l.status==="Pending").length} pending
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" className="text-xs gap-1" onClick={()=>setShowForm(true)}>
          <Plus className="h-3.5 w-3.5"/> Log Change
        </Button>
      </div>

      {log.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground bg-muted/30 rounded-xl">
          No changes logged yet. Document any PO amendments, spec changes, or buyer approvals here.
        </div>
      ) : (
        <div className="space-y-2">
          {log.map(entry => (
            <div key={entry.id} className={cn("border rounded-xl p-3", entry.status==="Rejected"?"border-red-200 bg-red-50/20":entry.status==="Approved"?"border-emerald-200 bg-emerald-50/20":"border-amber-200 bg-amber-50/20")}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-foreground">{entry.change_type}</span>
                  <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border", STATUS_STYLES[entry.status]||"bg-gray-50 text-gray-600 border-gray-200")}>
                    {entry.status}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmt(entry.created_at)}</span>
              </div>
              {(entry.old_value || entry.new_value) && (
                <div className="flex items-center gap-2 text-xs mb-1">
                  {entry.old_value && <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded line-through">{entry.old_value}</span>}
                  {entry.old_value && entry.new_value && <span className="text-muted-foreground">→</span>}
                  {entry.new_value && <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">{entry.new_value}</span>}
                </div>
              )}
              {entry.reason && <p className="text-xs text-muted-foreground mb-1">{entry.reason}</p>}
              <div className="flex items-center justify-between">
                <div className="flex gap-2 text-[11px] text-muted-foreground">
                  {entry.requested_by && <span>By: {entry.requested_by}</span>}
                  {entry.authorised_by && <span>· Authorised: {entry.authorised_by}</span>}
                </div>
                {entry.status === "Pending" && (
                  <div className="flex gap-1">
                    <button onClick={()=>handleStatusChange(entry.id,"Approved")} className="text-[10px] text-emerald-600 hover:text-emerald-800 font-medium flex items-center gap-0.5">
                      <CheckCircle2 className="h-3 w-3"/> Approve
                    </button>
                    <span className="text-muted-foreground text-[10px] mx-1">·</span>
                    <button onClick={()=>handleStatusChange(entry.id,"Rejected")} className="text-[10px] text-red-600 hover:text-red-800 font-medium flex items-center gap-0.5">
                      <XCircle className="h-3 w-3"/> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setForm(empty);}}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log PO Change</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5"><Label className="text-xs">Change Type</Label>
              <Select value={form.change_type} onValueChange={v=>u("change_type",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{CHANGE_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Old Value</Label><Input value={form.old_value} onChange={e=>u("old_value",e.target.value)} placeholder="Before"/></div>
            <div className="space-y-1.5"><Label className="text-xs">New Value</Label><Input value={form.new_value} onChange={e=>u("new_value",e.target.value)} placeholder="After"/></div>
            <div className="col-span-2 space-y-1.5"><Label className="text-xs">Reason / Description</Label><Textarea value={form.reason} onChange={e=>u("reason",e.target.value)} rows={2} placeholder="What changed and why…"/></div>
            <div className="space-y-1.5"><Label className="text-xs">Requested By</Label><Input value={form.requested_by} onChange={e=>u("requested_by",e.target.value)} placeholder="Buyer / Internal"/></div>
            <div className="space-y-1.5"><Label className="text-xs">Authorised By</Label><Input value={form.authorised_by} onChange={e=>u("authorised_by",e.target.value)} placeholder="Name"/></div>
            <div className="col-span-2 space-y-1.5"><Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v=>u("status",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{["Pending","Approved","Rejected"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving?"Saving…":"Log Change"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

