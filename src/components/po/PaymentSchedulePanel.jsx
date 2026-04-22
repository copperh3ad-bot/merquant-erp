import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CreditCard, Plus, Edit2, Trash2, CheckCircle2, Clock, AlertCircle, Landmark } from "lucide-react";

const TRIGGER_EVENTS = [
  "On PO Confirmation", "Before Production", "After Inspection",
  "At Shipment", "BL Date", "Against BL Copy", "Usance Due Date",
  "Documents Negotiation", "Custom Date"
];
const LC_TYPES = ["Sight LC", "Usance LC", "Standby LC", "Transferable LC", "Back-to-Back LC"];
const PAYMENT_STATUSES = ["Planned", "Triggered", "In Process", "Received", "Paid", "Overdue", "Cancelled"];
const PAYMENT_STRUCTURES = ["TT 100% Advance", "TT 30/70", "TT 50/50", "Sight LC", "Usance LC 30", "Usance LC 60", "Usance LC 90", "Usance LC 120", "DP", "DA", "Open Account", "Mixed"];

const fmtMoney = (n, curr = "USD") => {
  const v = Number(n || 0);
  return `${curr} ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

function StatusBadge({ status }) {
  const map = {
    Planned: { cls: "bg-slate-100 text-slate-700", icon: Clock },
    Triggered: { cls: "bg-blue-100 text-blue-700", icon: AlertCircle },
    "In Process": { cls: "bg-amber-100 text-amber-700", icon: Clock },
    Received: { cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
    Paid: { cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
    Overdue: { cls: "bg-red-100 text-red-700", icon: AlertCircle },
    Cancelled: { cls: "bg-gray-100 text-gray-500", icon: AlertCircle },
  };
  const m = map[status] || map.Planned;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${m.cls}`}>
      <Icon className="h-3 w-3" /> {status || "Planned"}
    </span>
  );
}

export default function PaymentSchedulePanel({ po, onPoUpdate }) {
  const qc = useQueryClient();
  const [editingMilestone, setEditingMilestone] = useState(null);
  const [milestoneForm, setMilestoneForm] = useState({
    milestone: "", percent: 0, amount: 0, trigger_event: "On PO Confirmation",
    trigger_date: "", expected_date: "", actual_date: "", status: "Planned",
    payment_type: "TT", lc_type: "", lc_tenor_days: 0, notes: "",
  });
  const [showLcEditor, setShowLcEditor] = useState(false);
  const [lcForm, setLcForm] = useState({
    payment_structure: po?.payment_structure || "",
    lc_type: po?.lc_type || "",
    lc_number: po?.lc_number || "",
    lc_bank: po?.lc_bank || "",
    lc_tenor_days: po?.lc_tenor_days || 0,
    lc_expiry: po?.lc_expiry || "",
    lc_latest_shipment_date: po?.lc_latest_shipment_date || "",
    lc_presentation_days: po?.lc_presentation_days || 21,
    tt_terms: po?.tt_terms || "",
  });

  const { data: milestones = [], refetch } = useQuery({
    queryKey: ["paymentSchedule", po?.id],
    queryFn: async () => {
      if (!po?.id) return [];
      const { data, error } = await supabase.from("payments")
        .select("*").eq("po_id", po.id)
        .order("expected_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!po?.id,
  });

  const { data: summary } = useQuery({
    queryKey: ["paymentSummary", po?.id],
    queryFn: async () => {
      if (!po?.id) return null;
      const { data, error } = await supabase.from("v_po_payment_summary").select("*").eq("po_id", po.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!po?.id,
  });

  const saveMilestone = useMutation({
    mutationFn: async (payload) => {
      const row = { ...payload, po_id: po.id, po_number: po.po_number };
      if (row.id) {
        const { data, error } = await supabase.from("payments").update(row).eq("id", row.id).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from("payments").insert(row).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paymentSchedule", po.id] });
      qc.invalidateQueries({ queryKey: ["paymentSummary", po.id] });
      setEditingMilestone(null);
      resetMilestoneForm();
    },
  });

  const delMilestone = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("payments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paymentSchedule", po.id] });
      qc.invalidateQueries({ queryKey: ["paymentSummary", po.id] });
    },
  });

  const saveLc = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.from("purchase_orders").update(payload).eq("id", po.id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["paymentSummary", po.id] });
      setShowLcEditor(false);
      onPoUpdate?.(data);
    },
  });

  const resetMilestoneForm = () => setMilestoneForm({
    milestone: "", percent: 0, amount: 0, trigger_event: "On PO Confirmation",
    trigger_date: "", expected_date: "", actual_date: "", status: "Planned",
    payment_type: "TT", lc_type: "", lc_tenor_days: 0, notes: "",
  });

  const openEditMilestone = (row) => {
    setMilestoneForm({
      ...row,
      trigger_date: row.trigger_date || "",
      expected_date: row.expected_date || "",
      actual_date: row.actual_date || "",
      lc_type: row.lc_type || "",
      lc_tenor_days: row.lc_tenor_days || 0,
    });
    setEditingMilestone(row.id);
  };

  const handlePercentChange = (pct) => {
    const amt = po?.total_po_value ? (po.total_po_value * pct / 100) : 0;
    setMilestoneForm(f => ({ ...f, percent: pct, amount: amt }));
  };

  const quickTemplate = (template) => {
    if (!confirm(`Generate ${template} milestones? This adds rows to the schedule.`)) return;
    const total = Number(po?.total_po_value || 0);
    let rows = [];
    if (template === "TT 30/70") {
      rows = [
        { milestone: "TT Advance 30%", percent: 30, amount: total * 0.3, trigger_event: "On PO Confirmation", status: "Planned", payment_type: "TT" },
        { milestone: "TT Balance 70%", percent: 70, amount: total * 0.7, trigger_event: "Against BL Copy", status: "Planned", payment_type: "TT" },
      ];
    } else if (template === "Sight LC 100%") {
      rows = [
        { milestone: "Sight LC", percent: 100, amount: total, trigger_event: "Documents Negotiation", status: "Planned", payment_type: "LC", lc_type: "Sight LC" },
      ];
    } else if (template === "Usance LC 60") {
      rows = [
        { milestone: "Usance LC 60 Days", percent: 100, amount: total, trigger_event: "Usance Due Date", status: "Planned", payment_type: "LC", lc_type: "Usance LC", lc_tenor_days: 60 },
      ];
    } else if (template === "Usance LC 90") {
      rows = [
        { milestone: "Usance LC 90 Days", percent: 100, amount: total, trigger_event: "Usance Due Date", status: "Planned", payment_type: "LC", lc_type: "Usance LC", lc_tenor_days: 90 },
      ];
    }
    Promise.all(rows.map(r => saveMilestone.mutateAsync(r))).then(() => refetch());
  };

  if (!po) return null;

  const pctReceived = summary?.pct_received || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" /> Payment Schedule
          </CardTitle>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowLcEditor(true)} className="flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded-md">
              <Landmark className="h-3 w-3" /> {po.payment_structure || "Set Payment Terms"}
            </button>
            <button onClick={() => { resetMilestoneForm(); setEditingMilestone("new"); }} className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md">
              <Plus className="h-3 w-3" /> Milestone
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md bg-muted/40 p-2">
              <div className="text-[10px] text-muted-foreground uppercase">Received</div>
              <div className="text-sm font-semibold text-emerald-600">{fmtMoney(summary.amount_received, po.currency)}</div>
            </div>
            <div className="rounded-md bg-muted/40 p-2">
              <div className="text-[10px] text-muted-foreground uppercase">Pending</div>
              <div className="text-sm font-semibold text-amber-600">{fmtMoney(summary.amount_pending, po.currency)}</div>
            </div>
            <div className="rounded-md bg-muted/40 p-2">
              <div className="text-[10px] text-muted-foreground uppercase">% Complete</div>
              <div className="text-sm font-semibold">{Number(pctReceived).toFixed(1)}%</div>
              <div className="h-1 bg-muted rounded-full mt-1 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(pctReceived, 100)}%` }} />
              </div>
            </div>
          </div>
        )}

        {milestones.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <p className="mb-2">No milestones yet. Quick start:</p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {["TT 30/70", "Sight LC 100%", "Usance LC 60", "Usance LC 90"].map(t => (
                <button key={t} onClick={() => quickTemplate(t)} className="px-2 py-1 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded-md">{t}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left p-1.5 font-medium">Milestone</th>
                  <th className="text-right p-1.5 font-medium">%</th>
                  <th className="text-right p-1.5 font-medium">Amount</th>
                  <th className="text-left p-1.5 font-medium">Trigger</th>
                  <th className="text-left p-1.5 font-medium">Expected</th>
                  <th className="text-left p-1.5 font-medium">Actual</th>
                  <th className="text-left p-1.5 font-medium">Type</th>
                  <th className="text-center p-1.5 font-medium">Status</th>
                  <th className="text-right p-1.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {milestones.map(m => (
                  <tr key={m.id} className="hover:bg-muted/30">
                    <td className="p-1.5 font-medium">{m.milestone || "—"}</td>
                    <td className="p-1.5 text-right">{m.percent ? `${m.percent}%` : "—"}</td>
                    <td className="p-1.5 text-right">{fmtMoney(m.amount, m.currency || po.currency)}</td>
                    <td className="p-1.5 text-muted-foreground text-[11px]">{m.trigger_event || "—"}</td>
                    <td className="p-1.5">{m.expected_date || "—"}</td>
                    <td className="p-1.5">{m.actual_date || "—"}</td>
                    <td className="p-1.5">
                      {m.payment_type === "LC" ? (
                        <span className="text-[10px]">{m.lc_type}{m.lc_tenor_days ? ` · ${m.lc_tenor_days}d` : ""}</span>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">{m.payment_type || "TT"}</Badge>
                      )}
                    </td>
                    <td className="p-1.5 text-center"><StatusBadge status={m.status} /></td>
                    <td className="p-1.5 text-right">
                      <button onClick={() => openEditMilestone(m)} className="text-primary hover:underline mr-2"><Edit2 className="h-3 w-3 inline" /></button>
                      <button onClick={() => { if (confirm("Delete milestone?")) delMilestone.mutate(m.id); }} className="text-red-600 hover:underline"><Trash2 className="h-3 w-3 inline" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(po.lc_number || po.lc_type) && (
          <div className="mt-3 p-2 bg-muted/30 rounded-md text-xs">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Landmark className="h-3 w-3" /> LC Details
            </div>
            <div className="grid grid-cols-4 gap-2">
              {po.lc_type && <div><span className="text-muted-foreground">Type:</span> {po.lc_type}</div>}
              {po.lc_number && <div><span className="text-muted-foreground">Number:</span> {po.lc_number}</div>}
              {po.lc_bank && <div><span className="text-muted-foreground">Bank:</span> {po.lc_bank}</div>}
              {po.lc_tenor_days ? <div><span className="text-muted-foreground">Tenor:</span> {po.lc_tenor_days} days</div> : null}
              {po.lc_expiry && <div><span className="text-muted-foreground">Expiry:</span> {po.lc_expiry}</div>}
              {po.lc_latest_shipment_date && <div><span className="text-muted-foreground">Latest Shipment:</span> {po.lc_latest_shipment_date}</div>}
              {po.lc_presentation_days ? <div><span className="text-muted-foreground">Presentation:</span> {po.lc_presentation_days} days</div> : null}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={!!editingMilestone} onOpenChange={(o) => { if (!o) { setEditingMilestone(null); resetMilestoneForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingMilestone === "new" ? "Add Milestone" : "Edit Milestone"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Milestone Name</label>
              <Input value={milestoneForm.milestone} onChange={e => setMilestoneForm(f => ({ ...f, milestone: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Percent</label>
                <Input type="number" step="0.01" value={milestoneForm.percent} onChange={e => handlePercentChange(Number(e.target.value))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Amount</label>
                <Input type="number" step="0.01" value={milestoneForm.amount} onChange={e => setMilestoneForm(f => ({ ...f, amount: Number(e.target.value) }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Payment Type</label>
                <Select value={milestoneForm.payment_type} onValueChange={v => setMilestoneForm(f => ({ ...f, payment_type: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TT">TT</SelectItem>
                    <SelectItem value="LC">LC</SelectItem>
                    <SelectItem value="DP">DP</SelectItem>
                    <SelectItem value="DA">DA</SelectItem>
                    <SelectItem value="Open Account">Open Account</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {milestoneForm.payment_type === "LC" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">LC Type</label>
                  <Select value={milestoneForm.lc_type || "__none"} onValueChange={v => setMilestoneForm(f => ({ ...f, lc_type: v === "__none" ? "" : v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      {LC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">LC Tenor (days)</label>
                  <Input type="number" value={milestoneForm.lc_tenor_days || 0} onChange={e => setMilestoneForm(f => ({ ...f, lc_tenor_days: Number(e.target.value) }))} className="h-8 text-xs" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Trigger Event</label>
                <Select value={milestoneForm.trigger_event} onValueChange={v => setMilestoneForm(f => ({ ...f, trigger_event: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRIGGER_EVENTS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Trigger Date</label>
                <Input type="date" value={milestoneForm.trigger_date || ""} onChange={e => setMilestoneForm(f => ({ ...f, trigger_date: e.target.value || null }))} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Expected Date</label>
                <Input type="date" value={milestoneForm.expected_date || ""} onChange={e => setMilestoneForm(f => ({ ...f, expected_date: e.target.value || null }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Actual Date</label>
                <Input type="date" value={milestoneForm.actual_date || ""} onChange={e => setMilestoneForm(f => ({ ...f, actual_date: e.target.value || null }))} className="h-8 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={milestoneForm.status} onValueChange={v => setMilestoneForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Input value={milestoneForm.notes || ""} onChange={e => setMilestoneForm(f => ({ ...f, notes: e.target.value }))} className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => { setEditingMilestone(null); resetMilestoneForm(); }} className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">Cancel</button>
            <button onClick={() => saveMilestone.mutate(milestoneForm)} disabled={!milestoneForm.milestone || saveMilestone.isLoading} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50">
              {saveMilestone.isLoading ? "Saving…" : "Save"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLcEditor} onOpenChange={setShowLcEditor}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment Terms & LC Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Payment Structure</label>
              <Select value={lcForm.payment_structure || "__none"} onValueChange={v => setLcForm(f => ({ ...f, payment_structure: v === "__none" ? "" : v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {PAYMENT_STRUCTURES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">LC Type</label>
                <Select value={lcForm.lc_type || "__none"} onValueChange={v => setLcForm(f => ({ ...f, lc_type: v === "__none" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {LC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">LC Tenor (days)</label>
                <Input type="number" value={lcForm.lc_tenor_days || 0} onChange={e => setLcForm(f => ({ ...f, lc_tenor_days: Number(e.target.value) }))} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">LC Number</label>
                <Input value={lcForm.lc_number || ""} onChange={e => setLcForm(f => ({ ...f, lc_number: e.target.value }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Bank</label>
                <Input value={lcForm.lc_bank || ""} onChange={e => setLcForm(f => ({ ...f, lc_bank: e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">LC Expiry</label>
                <Input type="date" value={lcForm.lc_expiry || ""} onChange={e => setLcForm(f => ({ ...f, lc_expiry: e.target.value || null }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Latest Shipment Date</label>
                <Input type="date" value={lcForm.lc_latest_shipment_date || ""} onChange={e => setLcForm(f => ({ ...f, lc_latest_shipment_date: e.target.value || null }))} className="h-8 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Presentation Days (post-shipment)</label>
              <Input type="number" value={lcForm.lc_presentation_days || 21} onChange={e => setLcForm(f => ({ ...f, lc_presentation_days: Number(e.target.value) }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">TT Terms / Other Notes</label>
              <Input value={lcForm.tt_terms || ""} onChange={e => setLcForm(f => ({ ...f, tt_terms: e.target.value }))} className="h-8 text-xs" placeholder="e.g. 30% advance on order, 70% on BL copy" />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setShowLcEditor(false)} className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">Cancel</button>
            <button onClick={() => saveLc.mutate(lcForm)} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md">Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
