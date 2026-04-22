import React, { useState, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db, production } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Factory, Upload, Download, TrendingUp, Calendar, AlertCircle, Loader2 } from "lucide-react";
import { format, subDays } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const parseRow = (row) => {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '"') { q = !q; continue; }
      if (c === "," && !q) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return lines.slice(1).map(l => {
    const cols = parseRow(l);
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ""; });
    return row;
  });
}

function UploadDialog({ open, onOpenChange, pos, lines, stages }) {
  const qc = useQueryClient();
  const [stage, setStage] = useState("idle");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState([]);
  const fileRef = useRef();

  const reset = () => { setStage("idle"); setMessage(""); setPreview([]); if (fileRef.current) fileRef.current.value = ""; };

  const handleFile = async (file) => {
    if (!file) return;
    setStage("parsing"); setMessage("Reading file…");
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) { setStage("error"); setMessage("No data rows found"); return; }

      const lineByName  = new Map(lines.map(l => [l.name.toLowerCase(), l]));
      const stageByName = new Map(stages.map(s => [s.name.toLowerCase(), s]));
      const poByNumber  = new Map(pos.map(p => [p.po_number?.toLowerCase(), p]));

      const mapped = rows.map((r, idx) => {
        const line = lineByName.get((r.line_name || r.line || "").toLowerCase());
        const stg  = stageByName.get((r.stage_name || r.stage || "").toLowerCase());
        const po   = poByNumber.get((r.po_number || r.po || "").toLowerCase());
        const errors = [];
        if (!r.output_date) errors.push("date");
        if (!line) errors.push("line");
        if (!stg)  errors.push("stage");
        if (!r.qty_produced) errors.push("qty");
        return {
          rowNum: idx + 2, raw: r, errors,
          payload: errors.length ? null : {
            output_date:       r.output_date,
            po_id:             po?.id || null,
            po_number:         po?.po_number || r.po_number || null,
            article_code:      r.article_code || null,
            line_id:           line.id,
            line_name:         line.name,
            stage_id:          stg.id,
            stage_name:        stg.name,
            qty_produced:      Number(r.qty_produced) || 0,
            qty_rejected:      Number(r.qty_rejected) || 0,
            operators_present: Number(r.operators_present) || 0,
            hours_worked:      Number(r.hours_worked) || 0,
            notes:             r.notes || "",
          },
        };
      });
      setPreview(mapped);
      setStage("preview");
      setMessage(`${mapped.filter(m => !m.errors.length).length} of ${mapped.length} rows valid`);
    } catch (e) {
      setStage("error"); setMessage(e.message || "Parse error");
    }
  };

  const handleUpload = async () => {
    const valid = preview.filter(m => !m.errors.length).map(m => m.payload);
    if (!valid.length) { alert("No valid rows to upload"); return; }
    setStage("uploading"); setMessage(`Uploading ${valid.length} rows…`);
    try {
      for (let i = 0; i < valid.length; i += 50) {
        await production.output.bulkCreate(valid.slice(i, i + 50));
      }
      qc.invalidateQueries({ queryKey: ["prodOutput"] });
      qc.invalidateQueries({ queryKey: ["dailyCapacity"] });
      qc.invalidateQueries({ queryKey: ["wipStatus"] });
      setStage("done"); setMessage(`Uploaded ${valid.length} rows`);
    } catch (e) {
      setStage("error"); setMessage(e.message || "Upload failed");
    }
  };

  const downloadTemplate = () => {
    const csv = "output_date,po_number,article_code,line_name,stage_name,qty_produced,qty_rejected,operators_present,hours_worked,notes\n2026-04-20,IMP-123,PCSJMO-K,Line 1,Stitching,250,3,12,8,\n";
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "production_output_template.csv" });
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Upload Daily Production Output</DialogTitle></DialogHeader>

        {stage === "idle" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Upload a CSV with daily output. Unknown PO/line/stage are flagged.</p>
              <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={downloadTemplate}><Download className="h-3 w-3"/>Template</button>
            </div>
            <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30">
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground"/>
              <p className="text-sm font-medium">Click to choose CSV</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])}/>
            </div>
          </div>
        )}

        {(stage === "parsing" || stage === "uploading") && (
          <div className="flex items-center gap-3 py-6"><Loader2 className="h-5 w-5 text-primary animate-spin"/><p className="text-sm">{message}</p></div>
        )}

        {stage === "preview" && (
          <div className="space-y-3">
            <p className="text-xs">{message}</p>
            <div className="max-h-80 overflow-y-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0"><tr>{["#","Date","PO","Line","Stage","Qty","Status"].map(h => <th key={h} className="text-left px-2 py-1.5">{h}</th>)}</tr></thead>
                <tbody>
                  {preview.slice(0, 100).map(r => (
                    <tr key={r.rowNum} className={cn("border-t", r.errors.length > 0 && "bg-red-50")}>
                      <td className="px-2 py-1">{r.rowNum}</td>
                      <td className="px-2 py-1">{r.raw.output_date}</td>
                      <td className="px-2 py-1">{r.raw.po_number}</td>
                      <td className="px-2 py-1">{r.raw.line_name || r.raw.line}</td>
                      <td className="px-2 py-1">{r.raw.stage_name || r.raw.stage}</td>
                      <td className="px-2 py-1 tabular-nums">{r.raw.qty_produced}</td>
                      <td className="px-2 py-1">{r.errors.length > 0 ? <span className="text-red-700">Missing: {r.errors.join(", ")}</span> : <span className="text-emerald-700">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stage === "done" && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4"><p className="text-sm font-semibold text-emerald-800">{message}</p></div>}
        {stage === "error" && <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg p-4"><AlertCircle className="h-5 w-5 text-red-600"/><p className="text-sm text-red-800">{message}</p></div>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onOpenChange(false); }}>{stage === "done" ? "Close" : "Cancel"}</Button>
          {stage === "preview" && <Button size="sm" onClick={handleUpload} disabled={!preview.some(p => !p.errors.length)}>Upload {preview.filter(p => !p.errors.length).length} rows</Button>}
          {(stage === "done" || stage === "error") && <Button size="sm" onClick={reset}>Upload Another</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductionDashboard() {
  const [showUpload, setShowUpload] = useState(false);
  const [daysBack, setDaysBack] = useState("30");

  const { data: output = [], isLoading } = useQuery({ queryKey: ["prodOutput", daysBack], queryFn: () => production.output.list({ date_from: format(subDays(new Date(), Number(daysBack)), "yyyy-MM-dd") }) });
  const { data: dailyCap = [] } = useQuery({ queryKey: ["dailyCapacity", daysBack], queryFn: () => production.dailyCapacity.list(Number(daysBack)) });
  const { data: lines = [] } = useQuery({ queryKey: ["prodLines"], queryFn: () => production.lines.list() });
  const { data: stages = [] } = useQuery({ queryKey: ["prodStages"], queryFn: () => production.stages.list() });
  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list() });

  const summary = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    const todayRows = output.filter(o => o.output_date === today);
    const todayProduced = todayRows.reduce((s, o) => s + (o.qty_produced || 0), 0);
    const todayRejected = todayRows.reduce((s, o) => s + (o.qty_rejected || 0), 0);
    const totalProduced = output.reduce((s, o) => s + (o.qty_produced || 0), 0);
    const totalRejected = output.reduce((s, o) => s + (o.qty_rejected || 0), 0);
    const rejectionPct  = totalProduced > 0 ? (totalRejected / totalProduced) * 100 : 0;
    return { todayProduced, todayRejected, totalProduced, totalRejected, rejectionPct };
  }, [output]);

  const lineUtil = useMemo(() => {
    const m = {};
    for (const l of lines) m[l.id] = { line: l, produced: 0, days: 0, capacity_sum: 0 };
    for (const r of dailyCap) {
      if (!m[r.line_id]) continue;
      m[r.line_id].produced += r.total_produced || 0;
      m[r.line_id].capacity_sum += r.daily_capacity || 0;
      m[r.line_id].days += 1;
    }
    return Object.values(m).map(x => ({
      ...x,
      avg_daily: x.days > 0 ? Math.round(x.produced / x.days) : 0,
      utilization: x.capacity_sum > 0 ? (x.produced / x.capacity_sum) * 100 : 0,
    }));
  }, [dailyCap, lines]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Factory className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Production Dashboard</h1></div>
        <div className="flex gap-2">
          <Select value={daysBack} onValueChange={setDaysBack}>
            <SelectTrigger className="w-32 text-xs"><SelectValue/></SelectTrigger>
            <SelectContent>{["7","14","30","60","90"].map(d => <SelectItem key={d} value={d}>Last {d} days</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" onClick={() => setShowUpload(true)}><Upload className="h-4 w-4 mr-1.5"/>Upload CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Produced Today",   summary.todayProduced.toLocaleString(),  "bg-emerald-50 text-emerald-700"],
          ["Rejected Today",   summary.todayRejected.toLocaleString(),  summary.todayRejected > 0 ? "bg-red-50 text-red-700" : "bg-muted/40"],
          [`Produced (${daysBack}d)`, summary.totalProduced.toLocaleString(), "bg-primary/10 text-primary"],
          ["Rejection Rate",   `${summary.rejectionPct.toFixed(1)}%`,   summary.rejectionPct > 3 ? "bg-amber-50 text-amber-700" : "bg-muted/40"],
        ].map(([label, val, cls]) => (
          <div key={label} className={cn("rounded-xl p-4", cls)}>
            <p className="text-2xl font-bold tabular-nums">{val}</p>
            <p className="text-xs uppercase tracking-wide opacity-80 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <Card><CardContent className="p-0">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary"/><p className="text-sm font-semibold">Line Utilization ({daysBack}d avg)</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#1F3864] text-white"><tr>{["Line","Type","Capacity/day","Avg Daily Output","Utilization","Days Active"].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {lineUtil.map((x, i) => (
                <tr key={x.line.id} className={cn("border-b", i % 2 === 0 && "bg-[#EBF0FA]")}>
                  <td className="px-3 py-2 font-medium">{x.line.name}</td>
                  <td className="px-3 py-2 capitalize">{x.line.line_type}</td>
                  <td className="px-3 py-2 tabular-nums">{x.line.daily_capacity}</td>
                  <td className="px-3 py-2 tabular-nums">{x.avg_daily.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", x.utilization > 100 ? "bg-red-500" : x.utilization > 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, x.utilization)}%` }}/>
                      </div>
                      <span className="tabular-nums">{x.utilization.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{x.days}</td>
                </tr>
              ))}
              {lineUtil.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No production lines configured.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2"><Calendar className="h-4 w-4 text-primary"/><p className="text-sm font-semibold">Recent Output ({output.length} entries)</p></div>
        {isLoading ? <div className="p-4"><Skeleton className="h-20"/></div> : output.length === 0 ? (
          <EmptyState icon={Upload} title="No production data yet" description="Upload a CSV to start tracking daily output." actionLabel="Upload CSV" onAction={() => setShowUpload(true)}/>
        ) : (
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0"><tr>{["Date","PO","Article","Line","Stage","Produced","Rejected","Hours","Ops"].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {output.slice(0, 200).map((o, i) => (
                  <tr key={o.id} className={cn("border-b", i % 2 === 0 && "bg-[#EBF0FA]/50")}>
                    <td className="px-3 py-1.5">{format(new Date(o.output_date), "dd MMM")}</td>
                    <td className="px-3 py-1.5 font-medium">{o.po_number || "—"}</td>
                    <td className="px-3 py-1.5">{o.article_code || "—"}</td>
                    <td className="px-3 py-1.5">{o.line_name || "—"}</td>
                    <td className="px-3 py-1.5">{o.stage_name || "—"}</td>
                    <td className="px-3 py-1.5 tabular-nums">{o.qty_produced?.toLocaleString()}</td>
                    <td className="px-3 py-1.5 tabular-nums text-red-600">{o.qty_rejected || "—"}</td>
                    <td className="px-3 py-1.5 tabular-nums">{o.hours_worked || "—"}</td>
                    <td className="px-3 py-1.5 tabular-nums">{o.operators_present || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent></Card>

      <UploadDialog open={showUpload} onOpenChange={setShowUpload} pos={pos} lines={lines} stages={stages}/>
    </div>
  );
}
