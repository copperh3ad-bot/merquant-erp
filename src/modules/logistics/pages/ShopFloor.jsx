// src/pages/ShopFloor.jsx
//
// F1 — AI Shop Floor Monitor (MES-equivalent for MerQuant).
//
// Per the v2 brief: dashboard of active job cards through the production
// pipeline (Cutting → Stitching → Finishing → Packing → QC). Each stage
// shows piece counts; manager presses "AI Analyse" for a Claude-powered
// bottleneck summary. AI failure falls back silently to a manual notes
// textarea — the page must remain fully usable without AI.

import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Factory, Sparkles, Loader2, AlertTriangle, Save } from "lucide-react";
import { callClaude } from "@/lib/aiProxy";

const STAGES = ["Cutting", "Stitching", "Finishing", "Packing", "QC"];

export default function ShopFloor() {
  const qc = useQueryClient();
  const [selectedJcId, setSelectedJcId] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState(false);
  const [manualNotes, setManualNotes] = useState("");

  // Active job cards (anything not Completed/Cancelled).
  const { data: jobCards = [] } = useQuery({
    queryKey: ["shopFloorActiveJC"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_cards")
        .select("id, jc_number, po_number, article_code, article_name, status, order_quantity")
        .not("status", "in", "(Completed,Cancelled)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const activeJc = useMemo(
    () => selectedJcId ? jobCards.find(j => j.id === selectedJcId) : jobCards[0],
    [jobCards, selectedJcId]
  );

  // Per-stage entries for the selected JC. Group by stage and roll up
  // pieces in/out so we display a single per-stage card even when there
  // are multiple recorded events.
  const { data: entries = [] } = useQuery({
    queryKey: ["shopFloorEntries", activeJc?.id],
    queryFn: async () => {
      if (!activeJc?.id) return [];
      const { data, error } = await supabase
        .from("shop_floor_entries")
        .select("*")
        .eq("job_card_id", activeJc.id)
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeJc?.id,
  });

  const stageData = useMemo(() => {
    return STAGES.map(stage => {
      const rows = entries.filter(e => e.stage === stage);
      const pieces_in = rows.reduce((s, r) => s + (r.pieces_in || 0), 0);
      const pieces_out = rows.reduce((s, r) => s + (r.pieces_out || 0), 0);
      const operators = Math.max(0, ...rows.map(r => r.operators || 0));
      const ratio = pieces_in > 0 ? pieces_out / pieces_in : null;
      return { stage, pieces_in, pieces_out, operators, ratio };
    });
  }, [entries]);

  const recordEntry = async (stage, patch) => {
    if (!activeJc?.id) return;
    await supabase.from("shop_floor_entries").insert({
      job_card_id: activeJc.id,
      stage,
      pieces_in: Number(patch.pieces_in) || 0,
      pieces_out: Number(patch.pieces_out) || 0,
      operators: Number(patch.operators) || 0,
    });
    qc.invalidateQueries({ queryKey: ["shopFloorEntries", activeJc.id] });
  };

  const runAiAnalysis = async () => {
    if (!activeJc) return;
    setAiBusy(true);
    setAiError(false);
    setAiResult(null);
    try {
      const data = await callClaude({
        system: "You are a garment factory floor analyst. Given production stage data, identify bottlenecks, flag stages with pieces_out/pieces_in ratio below 0.8, and recommend corrective actions in 3 bullet points. Be specific and brief.",
        messages: [{ role: "user", content: JSON.stringify({ jobCard: activeJc, stages: stageData }) }],
        max_tokens: 600,
      });
      const text = data?.content?.[0]?.text || data?.text || "";
      if (!text) throw new Error("Empty AI response");
      setAiResult(text);
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
          <Factory className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold">Shop Floor Monitor</h1>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
            AI-assisted
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedJcId || activeJc?.id || ""} onValueChange={setSelectedJcId}>
            <SelectTrigger className="w-72 h-8 text-xs"><SelectValue placeholder="Select Job Card" /></SelectTrigger>
            <SelectContent>
              {jobCards.map(j => (
                <SelectItem key={j.id} value={j.id}>{j.jc_number || j.id.slice(0, 8)} — {j.po_number} · {j.article_code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={runAiAnalysis} disabled={!activeJc || aiBusy} className="gap-1.5 text-xs">
            {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            AI Analyse
          </Button>
        </div>
      </div>

      {!activeJc ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No active job cards. Create one in Job Cards to start tracking.
        </div>
      ) : (
        <>
          {/* Stage pipeline */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {stageData.map((s) => {
              const lowRatio = s.ratio !== null && s.ratio < 0.8;
              return (
                <div key={s.stage} className={`rounded border p-3 shadow-sm ${lowRatio ? "border-amber-300 bg-amber-50/40" : "border-gray-300 bg-white"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{s.stage}</span>
                    {lowRatio && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[11px] text-muted-foreground">In: <span className="font-semibold text-foreground">{s.pieces_in.toLocaleString()}</span></div>
                    <div className="text-[11px] text-muted-foreground">Out: <span className="font-semibold text-foreground">{s.pieces_out.toLocaleString()}</span></div>
                    <div className="text-[11px] text-muted-foreground">Operators: <span className="font-semibold text-foreground">{s.operators}</span></div>
                    {s.ratio !== null && (
                      <div className={`text-[10px] font-bold ${lowRatio ? "text-amber-700" : "text-emerald-700"}`}>
                        Yield: {(s.ratio * 100).toFixed(0)}%
                      </div>
                    )}
                  </div>
                  <StageEntryForm stage={s.stage} onSubmit={(p) => recordEntry(s.stage, p)} />
                </div>
              );
            })}
          </div>

          {/* AI panel */}
          <div className="rounded border border-gray-300 shadow-sm overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold text-white flex items-center gap-2" style={{ backgroundColor: "#1F3864" }}>
              <Sparkles className="h-3.5 w-3.5" /> AI Bottleneck Analysis
            </div>
            <div className="p-3 text-xs">
              {aiBusy && <div className="text-muted-foreground italic">Analysing stage data…</div>}
              {!aiBusy && aiResult && (
                <pre className="whitespace-pre-wrap font-sans text-foreground">{aiResult}</pre>
              )}
              {!aiBusy && aiError && (
                <div className="space-y-2">
                  <div className="text-amber-700">AI analysis unavailable — falling back to manual notes.</div>
                  <textarea
                    className="w-full min-h-[80px] text-xs border border-gray-300 rounded p-2"
                    placeholder="Notes about today's bottleneck or recommended actions…"
                    value={manualNotes}
                    onChange={e => setManualNotes(e.target.value)}
                  />
                </div>
              )}
              {!aiBusy && !aiResult && !aiError && (
                <div className="text-muted-foreground italic">
                  Press "AI Analyse" to get a bottleneck summary.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StageEntryForm({ stage, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pout, setPout] = useState("");
  const [ops, setOps] = useState("");
  return (
    <div className="mt-2 pt-2 border-t border-gray-200">
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-[10px] text-blue-600 hover:text-blue-800">+ Record</button>
      ) : (
        <div className="space-y-1.5">
          <input type="number" min="0" placeholder="In"  className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5" value={pin}  onChange={e => setPin(e.target.value)} />
          <input type="number" min="0" placeholder="Out" className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5" value={pout} onChange={e => setPout(e.target.value)} />
          <input type="number" min="0" placeholder="Operators" className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5" value={ops} onChange={e => setOps(e.target.value)} />
          <div className="flex gap-1">
            <button onClick={() => { onSubmit({ pieces_in: pin, pieces_out: pout, operators: ops }); setOpen(false); setPin(""); setPout(""); setOps(""); }}
              className="flex-1 text-[10px] bg-blue-600 text-white rounded px-2 py-0.5 hover:bg-blue-700 inline-flex items-center justify-center gap-1">
              <Save className="h-2.5 w-2.5" /> Save
            </button>
            <button onClick={() => setOpen(false)} className="text-[10px] text-muted-foreground hover:text-foreground px-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
