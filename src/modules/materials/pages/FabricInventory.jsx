// src/pages/FabricInventory.jsx
//
// F3 — AI Fabric Roll Tracker. Tracks physical fabric rolls by lot,
// shade, GSM, width, with received/consumed/available meters.
//
// available_meters is a GENERATED ALWAYS column — never include it in
// INSERT/UPDATE payloads (will throw). Use only in SELECT.
//
// Two AI buttons:
//   - "AI Shade Grouping" — groups rolls by shade similarity, flags
//     rolls that should be isolated. Posts the rolls in scope to
//     Claude, parses JSON response.
//   - Page-load consumption alert — silently runs an AI check for
//     low-availability rolls, displays banner if the model identifies
//     a real shortage. Failure is silent.

import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Layers, Sparkles, Loader2, AlertTriangle, Plus } from "lucide-react";
import { callClaude } from "@/lib/aiProxy";

const STATUS_OPTIONS = ["available", "in_use", "exhausted", "quarantine"];

export default function FabricInventory() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [shadeGroups, setShadeGroups] = useState(null);
  const [shortageAlert, setShortageAlert] = useState(null);

  const { data: rolls = [] } = useQuery({
    queryKey: ["fabricRolls"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fabric_rolls").select("*").order("received_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const totals = useMemo(() => ({
    received: rolls.reduce((s, r) => s + (Number(r.received_meters) || 0), 0),
    consumed: rolls.reduce((s, r) => s + (Number(r.consumed_meters) || 0), 0),
    available: rolls.reduce((s, r) => s + (Number(r.available_meters) || 0), 0),
    lowCount: rolls.filter(r => (Number(r.received_meters) || 0) > 0 && (Number(r.available_meters) || 0) < (Number(r.received_meters) || 0) * 0.10).length,
  }), [rolls]);

  // Silent on-load AI shortage alert. Errors are swallowed — banner just
  // doesn't appear if Claude is unavailable.
  useEffect(() => {
    if (rolls.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const lowRolls = rolls.filter(r =>
          (Number(r.received_meters) || 0) > 0 &&
          (Number(r.available_meters) || 0) < (Number(r.received_meters) || 0) * 0.15,
        ).slice(0, 30);
        if (lowRolls.length === 0) return;
        const data = await callClaude({
          system: "You are a textile inventory analyst. Given a list of low-availability fabric rolls, return ONLY a JSON object {alert: string|null, severity: 'info'|'warn'|'critical'}. Set alert to a single sentence (under 30 words) summarising the shortage if real, or null if not material.",
          messages: [{ role: "user", content: JSON.stringify({ lowRolls }) }],
          max_tokens: 200,
        });
        const text = data?.content?.[0]?.text || data?.text || "";
        const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
        if (!cancelled && parsed?.alert) setShortageAlert(parsed);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [rolls]);

  const runShadeGrouping = async () => {
    setAiBusy(true); setAiError(false); setShadeGroups(null);
    try {
      const sample = rolls.slice(0, 80).map(r => ({
        id: r.id, roll_number: r.roll_number, lot_number: r.lot_number,
        shade_number: r.shade_number, gsm: r.gsm, width_inches: r.width_inches,
      }));
      const data = await callClaude({
        system: "You are a textile quality analyst. Group these fabric rolls by shade similarity. Flag any shade that should be isolated to avoid shade variation in a single garment. Output JSON only: [{group_name, roll_ids:[], risk_level:'low'|'medium'|'high', recommendation}]",
        messages: [{ role: "user", content: JSON.stringify({ rolls: sample }) }],
        max_tokens: 1500,
      });
      const text = data?.content?.[0]?.text || data?.text || "";
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
      if (!Array.isArray(parsed)) throw new Error("Expected array");
      setShadeGroups(parsed);
    } catch {
      setAiError(true);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold">Fabric Inventory</h1>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
            AI-assisted
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={runShadeGrouping} disabled={aiBusy || rolls.length === 0} className="gap-1.5 text-xs">
            {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            AI Shade Grouping
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add Roll
          </Button>
        </div>
      </div>

      {/* Shortage banner (silent failure mode) */}
      {shortageAlert?.alert && (
        <div className={`rounded border p-3 text-xs flex items-center gap-2 ${
          shortageAlert.severity === "critical" ? "bg-red-50 border-red-200 text-red-800" :
          shortageAlert.severity === "warn" ? "bg-amber-50 border-amber-200 text-amber-800" :
          "bg-blue-50 border-blue-200 text-blue-800"
        }`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {shortageAlert.alert}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total received" value={`${totals.received.toLocaleString()} m`} />
        <Stat label="Total consumed" value={`${totals.consumed.toLocaleString()} m`} />
        <Stat label="Total available" value={`${totals.available.toLocaleString()} m`} accent="emerald" />
        <Stat label="Rolls < 10% left" value={totals.lowCount.toLocaleString()} accent={totals.lowCount > 0 ? "amber" : "default"} />
      </div>

      {/* Shade groups (if AI ran) */}
      {shadeGroups && shadeGroups.length > 0 && (
        <div className="rounded border border-gray-300 shadow-sm overflow-hidden">
          <div className="px-3 py-2 text-xs font-bold text-white flex items-center gap-2" style={{ backgroundColor: "#1F3864" }}>
            <Sparkles className="h-3.5 w-3.5" /> AI Shade Groups
          </div>
          <div className="divide-y divide-gray-200">
            {shadeGroups.map((g, i) => (
              <div key={i} className="px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{g.group_name || `Group ${i + 1}`}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                    g.risk_level === "high" ? "bg-red-100 text-red-700" :
                    g.risk_level === "medium" ? "bg-amber-100 text-amber-700" :
                    "bg-emerald-100 text-emerald-700"
                  }`}>{g.risk_level}</span>
                  <span className="text-muted-foreground">{(g.roll_ids || []).length} rolls</span>
                </div>
                {g.recommendation && <p className="mt-1 text-muted-foreground italic">{g.recommendation}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {aiError && (
        <div className="text-xs text-amber-700 italic">AI shade grouping unavailable — try again later.</div>
      )}

      {/* Roll table */}
      <div className="rounded border border-gray-300 shadow-sm overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold text-white" style={{ backgroundColor: "#1F3864" }}>
          Rolls ({rolls.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ backgroundColor: "#EBF0FA" }}>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Roll #</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Lot</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Shade</th>
                <th className="border border-gray-300 px-2 py-1.5 text-right">GSM</th>
                <th className="border border-gray-300 px-2 py-1.5 text-right">Width (in)</th>
                <th className="border border-gray-300 px-2 py-1.5 text-right">Received (m)</th>
                <th className="border border-gray-300 px-2 py-1.5 text-right">Consumed (m)</th>
                <th className="border border-gray-300 px-2 py-1.5 text-right">Available (m)</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Status</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">Location</th>
              </tr>
            </thead>
            <tbody>
              {rolls.length === 0 ? (
                <tr><td colSpan={10} className="border border-gray-300 px-2 py-3 text-center text-muted-foreground italic">
                  No rolls yet. Click Add Roll to start tracking.
                </td></tr>
              ) : rolls.map((r, idx) => {
                const lowAvailable = (Number(r.received_meters) || 0) > 0 &&
                                     (Number(r.available_meters) || 0) < (Number(r.received_meters) || 0) * 0.10;
                return (
                  <tr key={r.id} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                    <td className="border border-gray-300 px-2 py-1.5 font-medium">{r.roll_number || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{r.lot_number || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{r.shade_number || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{r.gsm ?? "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{r.width_inches ?? "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{Number(r.received_meters || 0).toLocaleString()}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{Number(r.consumed_meters || 0).toLocaleString()}</td>
                    <td className={`border border-gray-300 px-2 py-1.5 text-right font-bold ${lowAvailable ? "bg-amber-100 text-amber-800" : ""}`}>
                      {Number(r.available_meters || 0).toLocaleString()}
                    </td>
                    <td className="border border-gray-300 px-2 py-1.5">{r.status || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{r.location || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddRollDialog onClose={() => setShowAdd(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ["fabricRolls"] }); setShowAdd(false); }} />}
    </div>
  );
}

function Stat({ label, value, accent = "default" }) {
  const accentCls = accent === "emerald" ? "text-emerald-700" :
                    accent === "amber"  ? "text-amber-700"   :
                    "text-foreground";
  return (
    <div className="rounded border border-gray-300 shadow-sm p-3 bg-white">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${accentCls} mt-1`}>{value}</p>
    </div>
  );
}

function AddRollDialog({ onClose, onSaved }) {
  const [form, setForm] = useState({
    roll_number: "", lot_number: "", shade_number: "",
    gsm: "", width_inches: "", received_meters: "",
    location: "", status: "available",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      // NEVER include available_meters — it's GENERATED ALWAYS in the schema.
      // Only the columns the user fills go into the insert payload.
      const payload = {
        roll_number: form.roll_number || null,
        lot_number: form.lot_number || null,
        shade_number: form.shade_number || null,
        gsm: form.gsm ? Number(form.gsm) : null,
        width_inches: form.width_inches ? Number(form.width_inches) : null,
        received_meters: form.received_meters ? Number(form.received_meters) : null,
        location: form.location || null,
        status: form.status || "available",
      };
      const { error } = await supabase.from("fabric_rolls").insert(payload);
      if (error) throw error;
      onSaved();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-md">
        <h2 className="text-sm font-semibold mb-3">Add Fabric Roll</h2>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="Roll #"      v={form.roll_number}      set={v => setForm(f => ({ ...f, roll_number: v }))} />
          <Field label="Lot #"       v={form.lot_number}       set={v => setForm(f => ({ ...f, lot_number: v }))} />
          <Field label="Shade #"     v={form.shade_number}     set={v => setForm(f => ({ ...f, shade_number: v }))} />
          <Field label="GSM"         v={form.gsm}              set={v => setForm(f => ({ ...f, gsm: v }))} type="number" />
          <Field label="Width (in)"  v={form.width_inches}     set={v => setForm(f => ({ ...f, width_inches: v }))} type="number" />
          <Field label="Received (m)" v={form.received_meters} set={v => setForm(f => ({ ...f, received_meters: v }))} type="number" />
          <Field label="Location"    v={form.location}         set={v => setForm(f => ({ ...f, location: v }))} />
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Status</label>
            <select className="w-full border border-gray-300 rounded px-2 py-1" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
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
