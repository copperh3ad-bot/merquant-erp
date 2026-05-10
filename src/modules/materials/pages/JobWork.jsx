// src/pages/JobWork.jsx
//
// F4 — AI Subcontractor / Job Work Manager. Track work issued to
// outside vendors (printing, embroidery, washing, etc.) with gate pass,
// issue/return dates, costs, and an AI cost estimator.
//
// Two AI integrations:
//   - "AI Estimate Cost" per row: calls Claude with work_type + quantity
//     + the user's existing job-work history to ground the estimate.
//     Saves to ai_cost_estimate JSONB.
//   - Gate pass PDF: pure jspdf — no AI. Generates a printable gate
//     pass document from the order data.
//
// Failure mode: if AI fails, the cost field stays empty and the user
// types a manual estimate.

import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, db } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Briefcase, Sparkles, Loader2, Plus, FileText } from "lucide-react";
import { jsPDF } from "jspdf";
import { callClaude } from "@/lib/aiProxy";

const STATUS_OPTIONS = ["issued", "in_progress", "received", "cancelled"];
const WORK_TYPES = ["Printing", "Embroidery", "Washing", "Dyeing", "Cutting", "Finishing", "Other"];

export default function JobWork() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [aiBusyId, setAiBusyId] = useState(null);

  const { data: orders = [] } = useQuery({
    queryKey: ["jobWorkOrders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("job_work_orders").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data || [];
    },
  });
  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list() });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliersList"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").order("name");
      if (error) return [];
      return data || [];
    },
  });

  const stats = useMemo(() => ({
    open:      orders.filter(o => o.status === "issued" || o.status === "in_progress").length,
    overdue:   orders.filter(o => o.expected_return && new Date(o.expected_return) < new Date() && o.status !== "received").length,
    totalIssued: orders.reduce((s, o) => s + (Number(o.quantity_issued) || 0), 0),
    totalReceived: orders.reduce((s, o) => s + (Number(o.quantity_received) || 0), 0),
  }), [orders]);

  const runAiEstimate = async (order) => {
    setAiBusyId(order.id);
    try {
      const history = orders.filter(o =>
        o.work_type === order.work_type && o.actual_cost && o.id !== order.id
      ).slice(0, 20).map(o => ({
        work_type: o.work_type, quantity_issued: o.quantity_issued, actual_cost: o.actual_cost,
      }));
      const data = await callClaude({
        system: "You are a garment costing specialist. Based on the work type, quantity, and historical job work data provided, estimate the cost per piece and total cost. Output JSON only: {cost_per_piece, total_cost, confidence, basis}",
        messages: [{ role: "user", content: JSON.stringify({ work_type: order.work_type, quantity: order.quantity_issued, historicalOrders: history }) }],
        max_tokens: 400,
      });
      const text = data?.content?.[0]?.text || data?.text || "";
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
      await supabase.from("job_work_orders").update({
        ai_cost_estimate: parsed,
        estimated_cost: Number(parsed.total_cost) || null,
      }).eq("id", order.id);
      qc.invalidateQueries({ queryKey: ["jobWorkOrders"] });
    } catch {
      // Silent failure — user can fill estimated_cost manually inline.
    } finally {
      setAiBusyId(null);
    }
  };

  const generateGatePass = (order) => {
    const doc = new jsPDF();
    const sub = suppliers.find(s => s.id === order.subcontractor_id)?.name || "—";
    const po = pos.find(p => p.id === order.po_id);
    let y = 18;
    doc.setFontSize(16); doc.setFont(undefined, "bold");
    doc.text("GATE PASS — JOB WORK", 105, y, { align: "center" }); y += 12;
    doc.setFontSize(10); doc.setFont(undefined, "normal");
    const row = (label, value) => { doc.text(`${label}:`, 14, y); doc.text(String(value || "—"), 70, y); y += 7; };
    row("Gate Pass #",   order.gate_pass_number || order.id.slice(0, 8).toUpperCase());
    row("Issue Date",    order.issue_date || "—");
    row("Expected Return", order.expected_return || "—");
    row("Subcontractor", sub);
    row("PO Number",     po?.po_number || "—");
    row("Customer",      po?.customer_name || "—");
    row("Work Type",     order.work_type);
    row("Quantity",      `${order.quantity_issued || 0} pcs`);
    row("Estimated Cost", order.estimated_cost ? `${order.estimated_cost}` : "—");
    if (order.notes) {
      y += 4; doc.setFont(undefined, "bold"); doc.text("Notes:", 14, y); y += 6;
      doc.setFont(undefined, "normal");
      const lines = doc.splitTextToSize(String(order.notes), 180);
      doc.text(lines, 14, y); y += lines.length * 5;
    }
    y += 14; doc.text("Issued by: ____________________", 14, y);
    doc.text("Received by: ____________________", 110, y);
    doc.save(`GatePass_${order.gate_pass_number || order.id.slice(0,8)}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Briefcase className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold">Job Work (Subcontractors)</h1>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">AI-assisted</span>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> New Job Work
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Open orders"     value={stats.open.toLocaleString()} />
        <Stat label="Overdue"         value={stats.overdue.toLocaleString()} accent={stats.overdue > 0 ? "red" : "default"} />
        <Stat label="Pieces issued"   value={stats.totalIssued.toLocaleString()} />
        <Stat label="Pieces received" value={stats.totalReceived.toLocaleString()} />
      </div>

      <div className="rounded border border-gray-300 shadow-sm overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold text-white" style={{ backgroundColor: "#1F3864" }}>
          Job Work Orders ({orders.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ backgroundColor: "#EBF0FA" }}>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Gate Pass #</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Subcontractor</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">PO</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Work Type</th>
                <th className="border border-gray-300 px-2 py-1.5 text-right">Issued</th>
                <th className="border border-gray-300 px-2 py-1.5 text-right">Received</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Issue Date</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Expected Return</th>
                <th className="border border-gray-300 px-2 py-1.5 text-right">Est. Cost</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Status</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={11} className="border border-gray-300 px-2 py-3 text-center text-muted-foreground italic">
                  No job work orders. Click New Job Work to create one.
                </td></tr>
              ) : orders.map((o, idx) => {
                const sub = suppliers.find(s => s.id === o.subcontractor_id)?.name || "—";
                const po  = pos.find(p => p.id === o.po_id)?.po_number || "—";
                const overdue = o.expected_return && new Date(o.expected_return) < new Date() && o.status !== "received";
                return (
                  <tr key={o.id} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                    <td className="border border-gray-300 px-2 py-1.5 font-medium">{o.gate_pass_number || o.id.slice(0, 8).toUpperCase()}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{sub}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{po}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{o.work_type || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{(o.quantity_issued || 0).toLocaleString()}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{(o.quantity_received || 0).toLocaleString()}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{o.issue_date || "—"}</td>
                    <td className={`border border-gray-300 px-2 py-1.5 ${overdue ? "bg-red-50 text-red-700 font-semibold" : ""}`}>{o.expected_return || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{o.estimated_cost ? Number(o.estimated_cost).toLocaleString() : "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{o.status || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5">
                      <div className="flex gap-1">
                        <button
                          onClick={() => runAiEstimate(o)}
                          disabled={aiBusyId === o.id}
                          className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                        >
                          {aiBusyId === o.id ? <Loader2 className="h-2.5 w-2.5 animate-spin"/> : <Sparkles className="h-2.5 w-2.5"/>}
                          AI Cost
                        </button>
                        <button
                          onClick={() => generateGatePass(o)}
                          className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 text-foreground hover:bg-gray-50"
                          title="Print gate pass PDF"
                        >
                          <FileText className="h-2.5 w-2.5"/> PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddJobWorkDialog
        suppliers={suppliers}
        pos={pos}
        onClose={() => setShowAdd(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["jobWorkOrders"] }); setShowAdd(false); }}
      />}
    </div>
  );
}

function Stat({ label, value, accent = "default" }) {
  const cls = accent === "red" ? "text-red-700" : "text-foreground";
  return (
    <div className="rounded border border-gray-300 shadow-sm p-3 bg-white">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${cls} mt-1`}>{value}</p>
    </div>
  );
}

function AddJobWorkDialog({ suppliers, pos, onClose, onSaved }) {
  const [form, setForm] = useState({
    po_id: "", subcontractor_id: "", work_type: "Printing",
    quantity_issued: "", issue_date: new Date().toISOString().slice(0, 10),
    expected_return: "", estimated_cost: "", gate_pass_number: "",
    status: "issued", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const payload = {
        po_id: form.po_id || null,
        subcontractor_id: form.subcontractor_id || null,
        work_type: form.work_type,
        quantity_issued: form.quantity_issued ? Number(form.quantity_issued) : null,
        issue_date: form.issue_date || null,
        expected_return: form.expected_return || null,
        estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : null,
        gate_pass_number: form.gate_pass_number || null,
        status: form.status,
        notes: form.notes || null,
      };
      const { error } = await supabase.from("job_work_orders").insert(payload);
      if (error) throw error;
      onSaved();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-lg">
        <h2 className="text-sm font-semibold mb-3">New Job Work Order</h2>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Sel label="PO"           v={form.po_id}            set={v => setForm(f => ({ ...f, po_id: v }))} options={[{value:"", label:"—"}, ...pos.map(p => ({ value: p.id, label: `${p.po_number} ${p.customer_name ? "· "+p.customer_name : ""}` }))]} />
          <Sel label="Subcontractor" v={form.subcontractor_id} set={v => setForm(f => ({ ...f, subcontractor_id: v }))} options={[{value:"", label:"—"}, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
          <Sel label="Work Type"    v={form.work_type}        set={v => setForm(f => ({ ...f, work_type: v }))} options={WORK_TYPES.map(w => ({ value: w, label: w }))} />
          <Field label="Gate Pass #" v={form.gate_pass_number} set={v => setForm(f => ({ ...f, gate_pass_number: v }))} />
          <Field label="Quantity Issued" v={form.quantity_issued} set={v => setForm(f => ({ ...f, quantity_issued: v }))} type="number" />
          <Field label="Issue Date"  v={form.issue_date}      set={v => setForm(f => ({ ...f, issue_date: v }))} type="date" />
          <Field label="Expected Return" v={form.expected_return} set={v => setForm(f => ({ ...f, expected_return: v }))} type="date" />
          <Field label="Estimated Cost" v={form.estimated_cost} set={v => setForm(f => ({ ...f, estimated_cost: v }))} type="number" />
          <Sel label="Status" v={form.status} set={v => setForm(f => ({ ...f, status: v }))} options={STATUS_OPTIONS.map(s => ({ value: s, label: s }))} />
          <div className="col-span-2">
            <label className="block text-[11px] text-muted-foreground mb-1">Notes</label>
            <textarea className="w-full border border-gray-300 rounded px-2 py-1" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50" disabled={saving}>Cancel</button>
          <button onClick={save} className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, v, set, type = "text" }) {
  return (
    <div>
      <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
      <input type={type} className="w-full border border-gray-300 rounded px-2 py-1" value={v} onChange={e => set(e.target.value)} />
    </div>
  );
}

function Sel({ label, v, set, options }) {
  return (
    <div>
      <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
      <select className="w-full border border-gray-300 rounded px-2 py-1" value={v} onChange={e => set(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
