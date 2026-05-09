import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, techPacks, discrepancies, mfg, supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FileSearch, Upload, Plus, Pencil, Trash2, Search, X,
  CheckCircle2, AlertTriangle, Clock, Loader2, Zap,
  Eye, ChevronDown, ChevronRight, Link2, RefreshCw,
  FileText, Package, Layers, Tag, Ruler, Shirt, ShieldCheck, Wrench
} from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import TryAIExtractionButton from "@/components/shared/TryAIExtractionButton";
import { cn } from "@/lib/utils";
import { callClaude } from "@/lib/aiProxy";
import POSelector from "@/components/shared/POSelector";
import { runFullAudit, applyFix, AUDIT_STEPS } from "@/lib/techPackAudit";
import { parseBobTechPack } from "@/lib/bobTechPackParser";
import { classifyArticle, componentApplies, applies as appliesToProductType } from "@/lib/articleTypes";
import { computeBarcodeUpdates } from "@/lib/barcodeOcrMerge";
import { extractImagesFromXlsx, chunkImagesForBatching } from "@/lib/xlsxChunker";
import { normalizeDim2D, normalizeDim3D } from "@/lib/dimensionNormalizer";
import { classifyComponent } from "@/lib/componentClassifier";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import SelectionCheckbox from "@/components/shared/SelectionCheckbox";
import BulkActionsBar from "@/components/techpack/BulkActionsBar";

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };

// Client-side cap on tech-pack file size. Bumped from 10 MB → 100 MB on
// 2026-05-08 to accommodate large multi-SKU BOB Excel workbooks (e.g.
// Purecare Modal Jersey Knitted Sheet Sets at ~80 MB). The XLSX path
// parses files in-browser so the bottleneck is browser memory, not an
// edge-function payload limit. If the Supabase Storage upload of the
// raw file fails (project file_size_limit defaults to 50 MB on free
// tier), the upload still succeeds — TechPacks falls back to a blob:
// URL so parse + extract still works.
const TECH_PACK_MAX_FILE_SIZE_MB    = 100;
const TECH_PACK_MAX_FILE_SIZE_BYTES = TECH_PACK_MAX_FILE_SIZE_MB * 1024 * 1024;

const EXTRACT_STATUS_STYLES = {
  pending:     "bg-gray-100 text-gray-600 border-gray-200",
  processing:  "bg-blue-100 text-blue-700 border-blue-200",
  extracted:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  partial:     "bg-amber-100 text-amber-700 border-amber-200",
  failed:      "bg-red-100 text-red-600 border-red-200",
};
const CROSSCHECK_STYLES = {
  not_run:        "bg-gray-100 text-gray-500",
  running:        "bg-blue-100 text-blue-700",
  passed:         "bg-emerald-100 text-emerald-700",
  discrepancies:  "bg-blue-100 text-blue-700",   // informational, not an error
  error:          "bg-amber-100 text-amber-700",
};
const CROSSCHECK_LABELS = {
  not_run: "Not checked",
  running: "Checking…",
  passed: "Matches",
  discrepancies: "Review differences",
  error: "Error",
};
const SEV_STYLES = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning:  "bg-amber-50 border-amber-200 text-amber-700",
  info:     "bg-blue-50 border-blue-200 text-blue-700",
};

// ── AI Extraction Engine ──────────────────────────────────────────────────
// Reads the actual file bytes and sends to Claude in the correct format
async function extractTechPack(file, articleContext) {
  const fileName = file.name;
  const ext = fileName.split('.').pop().toLowerCase();
  const isImage = /^(png|jpg|jpeg|gif|webp|bmp)$/.test(ext);
  const isPDF   = ext === 'pdf';
  const isCSV   = /^(csv|txt|tsv)$/.test(ext);
  const isXLSX  = /^(xlsx|xls)$/.test(ext);

  const SYSTEM = `You are an expert textile tech pack analyst. Extract structured data from tech packs regardless of format or terminology.
Normalise component names:
- main body / shell / outer / body / fabric 1 → "Top Fabric"
- lining / inner / inside → "Lining"
- filling / wadding / batting / padding → "Filling / Padding"
- gsm / g/m2 / gram weight → gsm (number)
- width / cuttable width / usable width → width in cm
- consumption / usage / con / con mtr → consumption_per_unit in meters
- wastage / waste% / allowance → wastage_percent
- main label / brand label / woven label → "Brand Label"
- care label / wash care → "Care Label"
- hang tag / swing tag → "Hang Tag"
- UPC / barcode / EAN → "Barcode Label"
- polybag / poly / packaging bag → "Polybag"
Return ONLY valid JSON, no markdown fences.`;

  const JSON_SCHEMA = `{
  "article_code": null,
  "article_name": null,
  "customer_name": null,
  "season": null,
  "fabric_specs": [{"component_type":"","fabric_type":"","gsm":null,"width_cm":null,"consumption_per_unit":null,"wastage_percent":null,"color":null,"finish":null,"construction":null,"notes":null}],
  "trim_specs": [{"trim_type":"","description":"","color":null,"size_spec":null,"quantity_per_unit":null,"unit":"Pcs","supplier_note":null}],
  "accessory_specs": [{"accessory_type":"","description":"","dimensions":null,"material":null,"print_method":null,"color_count":null,"placement":null,"quantity_per_unit":null}],
  "label_specs": [{"label_type":"","description":"","dimensions":null,"placement":null,"material":null,"colours":null}],
  "measurements": {"sizes":[],"size_chart":{},"fit_type":null,"stitch_density":null,"seam_allowance":null},
  "construction": {"stitch_type":null,"seam_type":null,"finishing":null,"special_processes":[]},
  "wash_care": [],
  "confidence_score": 0.5,
  "extraction_notes": ""
}`;

  const textPrompt = `Extract all specs from this tech pack for article: ${articleContext || "unknown"}.
Return JSON matching this shape exactly:
${JSON_SCHEMA}`;

  let messages;

  if (isImage) {
    // Send as image block
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file);
    });
    const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp' };
    messages = [{ role:'user', content:[
      { type:'image', source:{ type:'base64', media_type: mimeMap[ext] || 'image/jpeg', data: b64 }},
      { type:'text', text: textPrompt }
    ]}];

  } else if (isPDF) {
    // Send as document block
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file);
    });
    messages = [{ role:'user', content:[
      { type:'document', source:{ type:'base64', media_type:'application/pdf', data: b64 }},
      { type:'text', text: textPrompt }
    ]}];

  } else if (isXLSX) {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type:'array' });
    // Convert all sheets to CSV text
    const csvParts = wb.SheetNames.map(n =>
      `=== Sheet: ${n} ===\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])
    );
    const text = csvParts.join('\n\n').substring(0, 20000);
    messages = [{ role:'user', content: `${textPrompt}\n\nFile content (${fileName}):\n${text}` }];

  } else {
    // CSV / TXT / plain text
    const text = await file.text();
    messages = [{ role:'user', content: `${textPrompt}\n\nFile content (${fileName}):\n${text.substring(0, 20000)}` }];
  }

  const data = await callClaude({ system: SYSTEM, messages, max_tokens: 8000 });
  const raw  = data.content?.find(b => b.type === 'text')?.text || '{}';
  try {
    // Strip markdown fences if present
    const clean = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    // Try direct parse first
    try { return JSON.parse(clean); } catch {}
    // Try extracting first JSON object
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    // Last resort: return a minimal valid structure so the upload doesn't fail
    console.warn('TechPacks: could not parse AI response as JSON, returning empty extraction');
    return { fabric_specs: [], trim_specs: [], accessory_specs: [], label_specs: [], confidence_score: 0.1, extraction_notes: 'Partial extraction — AI response could not be fully parsed.' };
  } catch (e) {
    console.error('TechPacks extraction parse error:', e, '\nRaw:', raw.substring(0, 500));
    return { fabric_specs: [], trim_specs: [], accessory_specs: [], label_specs: [], confidence_score: 0, extraction_notes: `Parse error: ${e.message}` };
  }
}

// ── Cross-Check Engine ────────────────────────────────────────────────────
async function runCrossCheck(tp, articles, trims, accessories) {
  const results = [];
  const safeArticles = Array.isArray(articles) ? articles : [];
  const safeTrims = Array.isArray(trims) ? trims : [];
  const safeAcc = Array.isArray(accessories) ? accessories : [];

  // Fabric cross-check
  const tpFabrics = tp.extracted_fabric_specs || [];
  const workingArticle = safeArticles.find(a => a.article_code === tp.article_code || (tp.po_id && a.po_id === tp.po_id));
  const workingFabrics = workingArticle?.components || [];

  for (const tpFab of tpFabrics) {
    const match = workingFabrics.find(wf =>
      wf.component_type?.toLowerCase().includes(tpFab.component_type?.toLowerCase() || "") ||
      tpFab.component_type?.toLowerCase().includes(wf.component_type?.toLowerCase() || "")
    );
    if (!match) {
      results.push({ check_type:"fabric", field_name:"component", techpack_value: tpFab.component_type, working_value:"Not found in Fabric Working", severity:"warning", status:"open" });
      continue;
    }
    if (tpFab.gsm && match.gsm && Math.abs(Number(tpFab.gsm) - Number(match.gsm)) > 5) {
      results.push({ check_type:"fabric", field_name:`${tpFab.component_type} GSM`, techpack_value: String(tpFab.gsm), working_value: String(match.gsm), severity: Math.abs(Number(tpFab.gsm) - Number(match.gsm)) > 15 ? "critical" : "warning", status:"open" });
    }
    if (tpFab.consumption_per_unit && match.consumption_per_unit && Math.abs(Number(tpFab.consumption_per_unit) - Number(match.consumption_per_unit)) > 0.05) {
      results.push({ check_type:"fabric", field_name:`${tpFab.component_type} Consumption`, techpack_value: `${tpFab.consumption_per_unit}m`, working_value: `${match.consumption_per_unit}m`, severity:"warning", status:"open" });
    }
    if (tpFab.width_cm && match.width && Math.abs(Number(tpFab.width_cm) - Number(match.width)) > 5) {
      results.push({ check_type:"fabric", field_name:`${tpFab.component_type} Width`, techpack_value: `${tpFab.width_cm}cm`, working_value: `${match.width}cm`, severity:"info", status:"open" });
    }
  }

  // Trim cross-check
  const tpTrims = tp.extracted_trim_specs || [];
  const workingTrims = safeTrims.filter(t => (tp.po_id && t.po_id === tp.po_id) || t.article_code === tp.article_code);
  for (const tpTrim of tpTrims) {
    const match = workingTrims.find(wt => wt.trim_category?.toLowerCase().includes(tpTrim.trim_type?.toLowerCase().split(/\s/)[0] || "") || tpTrim.trim_type?.toLowerCase().includes(wt.trim_category?.toLowerCase() || ""));
    if (!match) {
      results.push({ check_type:"trim", field_name:"trim_item", techpack_value: tpTrim.trim_type, working_value:"Not found in Trims Working", severity:"info", status:"open" });
    }
  }

  // Label/accessory cross-check
  const tpLabels = tp.extracted_label_specs || [];
  const workingAcc = safeAcc.filter(a => (tp.po_id && a.po_id === tp.po_id) || a.article_code === tp.article_code);
  for (const tpLabel of tpLabels) {
    const match = workingAcc.find(a => a.category?.toLowerCase().includes("label") && a.item_description?.toLowerCase().includes(tpLabel.label_type?.toLowerCase().split(" ")[0] || ""));
    if (!match) {
      results.push({ check_type:"label", field_name:"label_type", techpack_value: tpLabel.label_type, working_value:"Not in Accessories Planning", severity:"warning", status:"open" });
    }
  }

  return results;
}

// ── Discrepancy Panel ─────────────────────────────────────────────────────
function DiscrepancyPanel({ tpId, poId }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({ queryKey:["discrepancies",tpId], queryFn:()=>discrepancies.listByTP(tpId) });

  const grouped = useMemo(() => ({
    critical: items.filter(d=>d.severity==="critical"&&d.status==="open"),
    warning:  items.filter(d=>d.severity==="warning"&&d.status==="open"),
    info:     items.filter(d=>d.severity==="info"&&d.status==="open"),
    resolved: items.filter(d=>d.status!=="open"),
  }), [items]);

  const handleResolve = async (id) => {
    const notes = prompt("Resolution notes (optional):");
    await discrepancies.resolve(id, notes||"", profile?.full_name||"User");
    qc.invalidateQueries({ queryKey:["discrepancies",tpId] });
  };

  if (!items.length) return (
    <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 flex items-center gap-2">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500"/>No discrepancies found — tech pack matches working data.
    </div>
  );

  return (
    <div className="space-y-2">
      {[["critical","Critical"],["warning","Warning"],["info","Info"]].map(([sev, label]) =>
        grouped[sev].length > 0 && (
          <div key={sev}>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">{label} ({grouped[sev].length})</p>
            {grouped[sev].map(d => (
              <div key={d.id} className={cn("border rounded-lg px-3 py-2 mb-1.5 flex items-start justify-between gap-2", SEV_STYLES[d.severity])}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold">{d.field_name} <span className="font-normal text-muted-foreground">({d.check_type})</span></p>
                  <div className="flex gap-2 text-[10px] mt-0.5 flex-wrap">
                    <span>Tech Pack: <span className="font-semibold">{d.techpack_value}</span></span>
                    <span>Working: <span className="font-semibold">{d.working_value}</span></span>
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] shrink-0" onClick={()=>handleResolve(d.id)}>Resolve</Button>
              </div>
            ))}
          </div>
        )
      )}
      {grouped.resolved.length > 0 && (
        <p className="text-xs text-muted-foreground">{grouped.resolved.length} resolved discrepancies</p>
      )}
    </div>
  );
}

// ── Audit Tab (8-step reconciliation) ─────────────────────────────────────
function AuditTab({ tp }) {
  const qc = useQueryClient();
  const [applying, setApplying] = useState({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [articleCodeInput, setArticleCodeInput] = useState("");

  // Pull everything the audit needs
  const { data: articles = [] } = useQuery({
    queryKey: ["auditArticles", tp.po_id, tp.article_code],
    queryFn: async () => {
      if (tp.po_id) return mfg.articles.listByPO(tp.po_id);
      if (tp.article_code) return mfg.articles.getByCode(tp.article_code);
      return [];
    },
    enabled: !!(tp.po_id || tp.article_code),
  });
  const { data: trims = [] } = useQuery({
    queryKey: ["auditTrims", tp.po_id],
    queryFn: () => mfg.trims.listByPO(tp.po_id),
    enabled: !!tp.po_id,
  });
  const { data: accessories = [] } = useQuery({
    queryKey: ["auditAcc", tp.po_id],
    queryFn: () => mfg.accessories.listByPO(tp.po_id),
    enabled: !!tp.po_id,
  });
  const { data: poItems = [] } = useQuery({
    queryKey: ["auditPoItems", tp.po_id],
    queryFn: () => db.poItems.listByPO(tp.po_id),
    enabled: !!tp.po_id,
  });

  const audit = useMemo(
    () => runFullAudit({ tp, articles, trims, accessories, poItems }),
    [tp, articles, trims, accessories, poItems]
  );

  const stepGroups = useMemo(() => {
    const groups = {};
    for (const f of audit.findings) {
      (groups[f.step] = groups[f.step] || []).push(f);
    }
    return groups;
  }, [audit.findings]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["auditArticles"] });
    qc.invalidateQueries({ queryKey: ["auditTrims"] });
    qc.invalidateQueries({ queryKey: ["auditAcc"] });
    qc.invalidateQueries({ queryKey: ["auditPoItems"] });
    qc.invalidateQueries({ queryKey: ["articles", tp.po_id] });
    qc.invalidateQueries({ queryKey: ["trims", tp.po_id] });
    qc.invalidateQueries({ queryKey: ["techPacks"] });
  };

  const handleApplyOne = async (finding, idx) => {
    let fix = finding.fix;
    if (fix.requires_input === "article_code") {
      if (!articleCodeInput.trim()) {
        alert("Enter an article code in the prompt above first.");
        return;
      }
      fix = { ...fix, patch: { article_code: articleCodeInput.trim() } };
    }
    setApplying((p) => ({ ...p, [idx]: true }));
    try {
      await applyFix(fix, supabase);
      invalidateAll();
    } catch (err) {
      alert(`Fix failed: ${err.message || "unknown error"}`);
    } finally {
      setApplying((p) => ({ ...p, [idx]: false }));
    }
  };

  const handleBulkFix = async () => {
    const fixables = audit.findings
      .map((f, i) => ({ f, i }))
      .filter(({ f }) =>
        f.fixable &&
        f.fix &&
        !(f.fix.requires_input && f.fix.patch == null) // skip ones needing user input
      );
    if (!fixables.length) return;
    if (!confirm(`Apply ${fixables.length} automatic fix${fixables.length > 1 ? "es" : ""}? Cost-related findings are excluded.`)) return;
    setBulkRunning(true);
    try {
      for (const { f } of fixables) {
        try { await applyFix(f.fix, supabase); }
        catch (err) { console.error("Bulk fix error:", err.message, f); }
      }
      invalidateAll();
    } finally {
      setBulkRunning(false);
    }
  };

  // Refresh this tech pack's extracted_fabric_specs from Master Data (consumption_library)
  // Useful when Master Data was updated after the tech pack was uploaded.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefreshFromMasterData = async () => {
    if (!tp.article_code) {
      alert("Tech pack has no article_code — cannot refresh from Master Data.");
      return;
    }
    setRefreshing(true);
    try {
      const { data: cl, error } = await supabase
        .from("consumption_library")
        .select("component_type, fabric_type, gsm, color, construction, treatment, width_cm, consumption_per_unit, wastage_percent")
        .eq("item_code", tp.article_code)
        .eq("kind", "fabric");
      if (error) throw error;
      if (!cl?.length) {
        alert(`No Master Data entries found for ${tp.article_code}. Add it to the Consumption Library first.`);
        return;
      }
      // Merge with existing specs (preserve fabric_type/construction/finish from BOB if available)
      const existing = tp.extracted_fabric_specs || [];
      const refreshed = cl.map(r => {
        const prev = existing.find(e =>
          (e.component_type || "").toLowerCase() === (r.component_type || "").toLowerCase()
        ) || {};
        return {
          component_type:       r.component_type,
          fabric_type:          prev.fabric_type || r.fabric_type,
          gsm:                  r.gsm ?? prev.gsm ?? null,
          color:                r.color || prev.color || null,
          construction:         prev.construction || r.construction || null,
          finish:               prev.finish || r.treatment || null,
          width_cm:             r.width_cm ?? null,
          consumption_per_unit: r.consumption_per_unit ?? null,
          wastage_percent:      r.wastage_percent ?? null,
        };
      });
      await supabase.from("tech_packs")
        .update({ extracted_fabric_specs: refreshed, extracted_at: new Date().toISOString() })
        .eq("id", tp.id);
      invalidateAll();
    } catch (e) {
      alert(`Refresh failed: ${e.message || "unknown error"}`);
    } finally {
      setRefreshing(false);
    }
  };

  const sevStyle = (s) => ({
    critical: "bg-red-50 border-red-200 text-red-800",
    warning:  "bg-amber-50 border-amber-200 text-amber-800",
    info:     "bg-blue-50 border-blue-200 text-blue-800",
  })[s] || "bg-muted/30 border-border";

  const sevIcon = (s) =>
    s === "critical" ? <AlertTriangle className="h-3.5 w-3.5 text-red-600" /> :
    s === "warning"  ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> :
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />;

  if (audit.findings.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          All 7 audit checks passed. Tech pack is consistent with working data.
        </div>
        <div className="text-xs text-muted-foreground">
          Checks run: missing record, fabric consumption, trim/accessory qty, size breakdown, required fields.
          Costing check skipped (not wired yet).
        </div>
      </div>
    );
  }

  // Whether there's at least one fix needing an article_code input
  const needsArticleCode = audit.findings.some(
    (f) => f.fix?.requires_input === "article_code"
  );

  return (
    <div className="space-y-3">
      {/* Informational-mode banner */}
      {audit.informational_mode && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <Eye className="h-4 w-4 text-blue-600 shrink-0 mt-0.5"/>
          <div className="text-xs text-blue-800">
            <b>Reference only.</b> Tech pack specs are compared against working data for review — they do not drive
            the BOM. The authoritative consumption data comes from Master Data (Consumption Library).
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-4 gap-2">
        {[
          ["Total", audit.summary.total, "bg-muted/40 text-foreground"],
          ["Critical", audit.summary.critical, "bg-red-50 text-red-700"],
          ["Warning", audit.summary.warning, "bg-amber-50 text-amber-700"],
          ["Auto-fixable", audit.summary.fixable, "bg-emerald-50 text-emerald-700"],
        ].map(([label, val, cls]) => (
          <div key={label} className={cn("rounded-lg px-3 py-2", cls)}>
            <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
            <p className="text-lg font-bold">{val}</p>
          </div>
        ))}
      </div>

      {/* Bulk action strip */}
      <div className="flex items-center justify-between gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
        <div className="text-xs flex-1">
          {audit.summary.fixable > 0 ? (
            <><b>{audit.summary.fixable}</b> fix{audit.summary.fixable !== 1 ? "es" : ""} can be applied automatically. Cost-related findings require owner approval and are excluded.</>
          ) : (
            <>Tech pack is reference-only. BOM comes from Master Data. Refresh if Master Data was updated after upload.</>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleRefreshFromMasterData} disabled={refreshing || !tp.article_code} className="gap-1.5">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh from Master Data
          </Button>
          {audit.summary.fixable > 0 && (
            <Button size="sm" onClick={handleBulkFix} disabled={bulkRunning} className="gap-1.5">
              {bulkRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              {bulkRunning ? "Applying…" : "Fix All Safe"}
            </Button>
          )}
        </div>
      </div>

      {/* Article-code input if needed by any fix */}
      {needsArticleCode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5">
          <p className="text-xs font-medium text-amber-800">This tech pack has no article_code linked.</p>
          <Input
            placeholder="e.g. GP-KIMONO-WHT-M"
            value={articleCodeInput}
            onChange={(e) => setArticleCodeInput(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      )}

      {/* Findings grouped by step */}
      {Object.entries(stepGroups)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([step, items]) => (
          <div key={step} className="border border-border rounded-lg overflow-hidden">
            <div className="bg-muted/40 px-3 py-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold">
                Step {step} — {AUDIT_STEPS[`STEP_${step}`]}
              </p>
              <span className="text-[10px] text-muted-foreground">
                {items.length} issue{items.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="divide-y divide-border">
              {items.map((f, i) => {
                const findingIdx = audit.findings.indexOf(f);
                const isApplying = applying[findingIdx];
                return (
                  <div key={i} className={cn("px-3 py-2 text-xs", sevStyle(f.severity))}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {sevIcon(f.severity)}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold">{f.field_name}</p>
                          <p className="opacity-90 mt-0.5">{f.message}</p>
                          <div className="flex gap-3 mt-1 text-[11px] opacity-80 flex-wrap">
                            <span>Tech Pack: <b>{f.techpack_value}</b></span>
                            <span>Working: <b>{f.working_value}</b></span>
                          </div>
                        </div>
                      </div>
                      {f.fixable && (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-[11px] shrink-0 bg-white"
                          disabled={isApplying}
                          onClick={() => handleApplyOne(f, findingIdx)}
                        >
                          {isApplying ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <><Wrench className="h-3 w-3 mr-1" /> Fix</>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

// ── Tech Pack Detail Panel ─────────────────────────────────────────────────
function TechPackDetail({ tp, onClose }) {
  const [tab, setTab] = useState("fabric");
  const d = tp.extracted_data || {};
  const fabrics = tp.extracted_fabric_specs || [];
  const trims   = tp.extracted_trim_specs || [];
  const labels  = tp.extracted_label_specs || [];
  const acc     = tp.extracted_accessory_specs || [];

  const tabs = [
    { id:"fabric",    label:"Fabric",   count: fabrics.length,  icon: Layers },
    { id:"trims",     label:"Trims",    count: trims.length,    icon: Tag },
    { id:"labels",    label:"Labels",   count: labels.length + acc.length, icon: Package },
    { id:"measure",   label:"Measurements", count: d.measurements?.sizes?.length||0, icon: Ruler },
    { id:"checks",    label:"Cross-Check", count: null, icon: CheckCircle2 },
    { id:"audit",     label:"Audit", count: null, icon: ShieldCheck },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileSearch className="h-4 w-4 text-primary"/>
            {tp.article_code || tp.article_name || "Tech Pack"} — {tp.file_name}
          </DialogTitle>
        </DialogHeader>

        {/* Meta strip */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          {[["Customer", tp.customer_name||"—"],["PO", tp.po_number||"—"],["Uploaded", fmt(tp.created_at)],
            ["Status", tp.extraction_status]].map(([l,v])=>(
            <div key={l} className="bg-muted/30 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground">{l}</p>
              <p className="font-semibold mt-0.5 capitalize">{v}</p>
            </div>
          ))}
        </div>

        {tp.extraction_status === 'failed' && tp.extraction_error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5"/>{tp.extraction_error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                tab===t.id?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground")}>
              <t.icon className="h-3 w-3"/>
              {t.label}
              {t.count != null && t.count > 0 && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* Fabric tab */}
        {tab==="fabric" && (
          <div className="space-y-2">
            {fabrics.length === 0 ? <p className="text-sm text-muted-foreground">No fabric specs extracted</p> : (
              fabrics.map((f, i) => (
                <div key={i} className="border border-border rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-semibold text-sm">{f.component_type}</span>
                    <span className="text-xs text-muted-foreground">{f.fabric_type}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    {[["GSM",f.gsm],["Width",f.width_cm?""+f.width_cm+"cm":null],["Consumption",f.consumption_per_unit?""+f.consumption_per_unit+"m/pc":null],["Wastage",f.wastage_percent?""+f.wastage_percent+"%":null]].map(([l,v])=>v&&(
                      <div key={l} className="bg-muted/30 rounded px-2 py-1.5">
                        <p className="text-[10px] text-muted-foreground">{l}</p>
                        <p className="font-semibold">{v}</p>
                      </div>
                    ))}
                  </div>
                  {f.notes && <p className="text-xs text-muted-foreground mt-1 italic">{f.notes}</p>}
                </div>
              ))
            )}
          </div>
        )}

        {/* Trims tab */}
        {tab==="trims" && (
          <div className="space-y-2">
            {trims.length === 0 ? <p className="text-sm text-muted-foreground">No trim specs extracted</p> : (
              <table className="w-full text-xs">
                <thead><tr className="border-b bg-muted/50">{["Type","Description","Color","Size/Spec","Qty/Pc"].map(h=><th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>{trims.map((t,i)=><tr key={i} className="border-b hover:bg-muted/20"><td className="px-3 py-2 font-medium">{t.trim_type}</td><td className="px-3 py-2">{t.description}</td><td className="px-3 py-2">{t.color||"—"}</td><td className="px-3 py-2">{t.size_spec||"—"}</td><td className="px-3 py-2">{t.quantity_per_unit||"—"}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}

        {/* Labels/Accessories tab */}
        {tab==="labels" && (
          <div className="space-y-3">
            {labels.length > 0 && <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Labels ({labels.length})</p>
              {labels.map((l,i)=>(
                <div key={i} className="border border-border rounded-xl px-3 py-2.5 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-violet-100 flex items-center justify-center shrink-0"><Tag className="h-4 w-4 text-violet-600"/></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{l.label_type}</p>
                    <p className="text-xs text-muted-foreground">{l.description}</p>
                    <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                      {l.dimensions&&<span>Size: {l.dimensions}</span>}
                      {l.placement&&<span>Placement: {l.placement}</span>}
                      {l.material&&<span>Material: {l.material}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </>}
            {acc.length > 0 && <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">Accessories & Packaging ({acc.length})</p>
              {acc.map((a,i)=>(
                <div key={i} className="border border-border rounded-xl px-3 py-2.5">
                  <p className="text-sm font-semibold">{a.accessory_type}</p>
                  <p className="text-xs text-muted-foreground">{a.description}</p>
                </div>
              ))}
            </>}
            {labels.length===0&&acc.length===0&&<p className="text-sm text-muted-foreground">No label or accessory specs extracted</p>}
          </div>
        )}

        {/* Measurements */}
        {tab==="measure" && (
          <div className="space-y-3">
            {d.measurements?.sizes?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Sizes: {d.measurements.sizes.join(", ")}</p>
                {d.measurements.fit_type && <p className="text-xs text-muted-foreground">Fit: {d.measurements.fit_type}</p>}
                {d.measurements.stitch_density && <p className="text-xs text-muted-foreground">Stitch density: {d.measurements.stitch_density}</p>}
              </div>
            )}
            {d.construction && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(d.construction).filter(([,v])=>v&&v!=="null"&&v.length>0).map(([k,v])=>(
                  <div key={k} className="bg-muted/30 rounded px-3 py-2">
                    <p className="text-[10px] text-muted-foreground capitalize">{k.replace(/_/g," ")}</p>
                    <p className="font-medium mt-0.5">{Array.isArray(v)?v.join(", "):v}</p>
                  </div>
                ))}
              </div>
            )}
            {d.wash_care?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Wash & Care</p>
                <div className="flex flex-wrap gap-1.5">{d.wash_care.map((w,i)=><span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">{w}</span>)}</div>
              </div>
            )}
            {!d.measurements?.sizes?.length && !d.construction && !d.wash_care?.length && <p className="text-sm text-muted-foreground">No measurement data extracted</p>}
          </div>
        )}

        {/* Cross-check */}
        {tab==="checks" && <DiscrepancyPanel tpId={tp.id} poId={tp.po_id}/>}

        {/* Audit */}
        {tab==="audit" && <AuditTab tp={tp}/>}
      </DialogContent>
    </Dialog>
  );
}

// ── Upload & Extract Dialog ────────────────────────────────────────────────
function UploadDialog({ open, onOpenChange, pos, onSuccess, defaultPoId }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [files, setFiles] = useState([]);
  const [poId, setPoId] = useState(defaultPoId || "");
  // When the dialog is opened from a per-row "Re-upload" button, defaultPoId
  // arrives pre-filled. Sync it whenever it changes so the user doesn't have
  // to re-pick the PO.
  useEffect(() => {
    if (defaultPoId) setPoId(defaultPoId);
  }, [defaultPoId]);
  const [articleCode, setArticleCode] = useState("");
  const [articleName, setArticleName] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState("idle"); // idle|processing|done
  const [progress, setProgress] = useState([]); // per-file status
  const inputRef = useRef();

  const reset = () => {
    setFiles([]); setPoId(""); setArticleCode(""); setArticleName(""); setNotes("");
    setStage("idle"); setProgress([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const oversized = incoming.filter(f => f.size > TECH_PACK_MAX_FILE_SIZE_BYTES);
    if (oversized.length) {
      alert(
        `Skipped ${oversized.length} file${oversized.length > 1 ? "s" : ""} larger than ${TECH_PACK_MAX_FILE_SIZE_MB} MB:\n` +
        oversized.map(f => `• ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)} MB)`).join("\n")
      );
    }
    const accepted = incoming.filter(f => f.size <= TECH_PACK_MAX_FILE_SIZE_BYTES);
    if (!accepted.length) return;
    setFiles(prev => {
      const keys = new Set(prev.map(f => `${f.name}-${f.size}`));
      return [...prev, ...accepted.filter(f => !keys.has(`${f.name}-${f.size}`))];
    });
  };

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const updateProg = (idx, patch) =>
    setProgress(prev => { const n = [...prev]; n[idx] = { ...n[idx], ...patch }; return n; });

  // Process ONE file; returns {ok, result?, error?}
  const processOne = async (file, idx, po, articlesCache, trimsCache, accCache) => {
    try {
      updateProg(idx, { status: "uploading", message: "Saving tech pack record…" });

      const fileType = file.name.split('.').pop().toLowerCase();
      const blobUrl = URL.createObjectURL(file);

      // ── BOB-format detection: if xlsx with BOB sheets, create one TP per SKU ──
      if (fileType === "xlsx" || fileType === "xls") {
        try {
          const bob = await parseBobTechPack(file);
          if (bob?.skus?.length) {
            updateProg(idx, { status: "extracting", message: `BOB file · ${bob.skus.length} SKUs…` });

            // ── Persist the original XLSX to storage ──
            // Without this, file_url is a blob: URL that dies when the browser
            // tab closes — meaning we can't re-OCR the embedded barcode images
            // later. Upload to ai-extraction-sources/tech-packs/<batch>/<name>
            // so the Re-extract barcodes button can fetch the bytes back.
            // Failure here is non-blocking — tech_packs rows are still created
            // with the legacy blob URL so the user's upload doesn't break.
            const uploadBatchId = (typeof crypto !== "undefined" && crypto.randomUUID)
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            let storagePath = null;
            try {
              const path = `tech-packs/${uploadBatchId}/${file.name}`;
              const { error: upErr } = await supabase.storage
                .from("ai-extraction-sources")
                .upload(path, file, {
                  contentType: file.type || "application/octet-stream",
                  upsert: false,
                });
              if (!upErr) storagePath = path;
              else console.warn("[tech-pack storage upload] failed (non-blocking):", upErr.message);
            } catch (storeErr) {
              console.warn("[tech-pack storage upload] threw (non-blocking):", storeErr?.message || storeErr);
            }

            // Pull per-SKU consumption from consumption_library if already imported
            const skuCodes = bob.skus.map(s => s.item_code).filter(Boolean);
            let consBySku = {};
            if (skuCodes.length) {
              const { data: cl } = await supabase.from("consumption_library")
                .select("item_code, component_type, fabric_type, gsm, color, width_cm, consumption_per_unit, wastage_percent")
                .in("item_code", skuCodes)
                .eq("kind", "fabric");
              for (const r of (cl || [])) {
                (consBySku[r.item_code] = consBySku[r.item_code] || []).push(r);
              }
            }

            // ── Duplicate-upload guard ──
            // Skip SKUs already in DB for this same file. Compare against the
            // articles in this BOB upload. We match BOTH on file_name AND on
            // article_code (case-insensitive) because filenames sometimes
            // differ only in whitespace ("BOB - X.xlsx" vs "BOB_-_X.xlsx" —
            // a real bug seen in production where two uploads of the same
            // physical file slipped past the earlier exact-match guard).
            const existingPairs = new Set();
            try {
              const skuCodesUpper = bob.skus
                .map(s => String(s.item_code || "").toUpperCase())
                .filter(Boolean);
              if (skuCodesUpper.length > 0) {
                const { data: existingTps } = await supabase
                  .from("tech_packs")
                  .select("article_code, file_name")
                  .in("article_code", skuCodesUpper);
                // Filename normalization: collapse non-alphanumeric runs to "_"
                const normFn = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
                const myFn = normFn(file.name);
                for (const t of (existingTps || [])) {
                  if (t.article_code && normFn(t.file_name) === myFn) {
                    existingPairs.add(String(t.article_code).toUpperCase());
                  }
                }
              }
              if (existingPairs.size > 0) {
                console.info(`[TechPacks] file '${file.name}' already has ${existingPairs.size} tech_pack row(s) for the same SKU(s). Skipping duplicate creates — use the ⟳ Barcodes button on existing rows to re-extract.`);
              }
            } catch (dupErr) {
              console.warn("[TechPacks duplicate-guard] check failed (non-blocking):", dupErr?.message || dupErr);
            }

            // Create one tech_packs row per SKU
            const createdTps = [];
            const skippedDuplicates = [];
            for (const sku of bob.skus) {
              // Skip SKUs whose (file_name, article_code) row already exists.
              const skuCodeUpper = String(sku.item_code || "").toUpperCase();
              if (skuCodeUpper && existingPairs.has(skuCodeUpper)) {
                skippedDuplicates.push(sku.item_code);
                continue;
              }
              // Classify this SKU (pillow protector vs mattress protector vs encasement etc.)
              const productType = classifyArticle({
                article_code: sku.item_code,
                article_name: `${bob.header.product_type || ""} — ${sku.size}`,
                product_type: bob.header.product_type || "",
              });

              // Build per-SKU fabric specs — ONLY components that apply to this product type
              const mdCons = consBySku[sku.item_code] || [];
              const skuFabricSpecs = (bob.fabric_specs || [])
                .filter(fs => componentApplies(productType, fs.component_type))
                .map(fs => {
                  const md = mdCons.find(m =>
                    (m.component_type || "").toLowerCase() === (fs.component_type || "").toLowerCase()
                  );
                  return {
                    component_type:       fs.component_type || null,
                    fabric_type:          fs.fabric_type    || md?.fabric_type || null,
                    gsm:                  fs.gsm            ?? md?.gsm ?? null,
                    color:                fs.color          || null,
                    construction:         fs.construction   || null,
                    finish:               fs.finish         || null,
                    width_cm:             md?.width_cm       ?? null,
                    consumption_per_unit: md?.consumption_per_unit ?? null,
                    wastage_percent:      md?.wastage_percent ?? null,
                  };
                });

              const tp = await techPacks.create({
                po_id:            poId || null,
                po_number:        po?.po_number || "",
                customer_name:    po?.customer_name || bob.header.brand || "",
                article_code:     sku.item_code,
                article_name:     sku.is_set
                  ? `${bob.header.product_name || bob.header.product_type || "Set"} — ${sku.size}`.trim()
                  : `${bob.header.product_type || ""} — ${sku.size}`.trim() || sku.item_code,
                file_name:        file.name,
                // storage:// scheme → "ai-extraction-sources/<path>", read by
                // the Re-extract barcodes action. blob: fallback only fires
                // when the storage upload above failed; will be skipped by
                // re-extract logic.
                file_url:         storagePath ? `storage://ai-extraction-sources/${storagePath}` : blobUrl,
                file_type:        fileType,
                file_size_kb:     Math.round(file.size / 1024),
                extraction_status: "extracted",
                crosscheck_status: "not_run",
                uploaded_by:      profile?.full_name || "User",
                extracted_fabric_specs: skuFabricSpecs,
                // Session 11 - wire through labels, packaging, accessories,
                // measurements, and construction that the parser already
                // extracts but the old fast path threw away.
                // 2026-05-02 — field-name canonicalised to match what
                // bom_explode_po SQL reads (size_spec, color,
                // quantity_per_unit, unit, supplier) so trim_items /
                // accessory_items don't end up with empty cells. Old
                // names (size, colours, dimensions) are dropped — the
                // SQL is patched in migration 0012 to fall back across
                // them so legacy rows still resolve.
                extracted_label_specs: (bob.labels || []).map(l => ({
                  label_type:        l.type,
                  description:       l.material,
                  size_spec:         l.size_spec || l.size || l.dimensions || null,
                  color:             l.color || null,
                  placement:         l.placement,
                  section:           l.section,
                  quantity_per_unit: l.quantity_per_unit ?? null,
                  unit:              l.unit || null,
                  supplier:          l.supplier || null,
                  // Aliases retained ONE more cycle so descriptionResolver +
                  // techPackAudit don't lose data on freshly-extracted rows
                  // while their reads are tightened — drop after S13.
                  dimensions:        l.size_spec || l.size || l.dimensions || null,
                  colours:           l.color || null,
                })),
                // Re-classify each accessory through componentClassifier so
                // the BOB-parser-supplied accessory_type (often verbatim from
                // the spreadsheet's free-form category column) gets corrected
                // when needed (e.g. small "Polybag" → "Accessory Bag").
                //
                // Per-SKU applicability filter (2026-05-02): BOB tech packs
                // emit accessories at the WHOLE-tech-pack level (parsed from
                // a single Size & Workmanship sheet), so without this filter
                // every SKU in the pack would inherit every accessory —
                // putting fitted-sheet elastic on Pillow Case SKUs, etc.
                // appliesToProductType() checks both the components and
                // accessories lists for tolerance to historical taxonomy
                // muddles (Elastic appears in BED_SHEET_SET.accessories now,
                // not components — see articleTypes.js).
                extracted_accessory_specs: (bob.accessories || [])
                  .map(a => {
                    const r = classifyComponent({
                      raw_category: a.accessory_type,
                      material: a.material || a.description,
                      description: a.description,
                      placement: a.placement,
                    });
                    const finalType = (r.component_type && r.confidence >= 0.85) ? r.component_type : a.accessory_type;
                    return {
                      accessory_type:    finalType,
                      description:       a.description,
                      material:          a.material,
                      color:             a.color || null,
                      size_spec:         a.size_spec || a.size || null,
                      placement:         a.placement,
                      quantity_per_unit: a.quantity_per_unit ?? null,
                      unit:              a.unit || null,
                      supplier:          a.supplier || null,
                      source_label:      a.source_label,
                    };
                  })
                  .filter(a => appliesToProductType(productType, a.accessory_type)),
                // extracted_trim_specs now sources from BOTH bob.trims
                // (when the AI extracted a dedicated trims section under
                // prompt v2) AND bob.packaging (legacy fallback — the
                // pre-v2 schema had no trims bucket so packaging rows
                // were routed here). Both are classified through
                // componentClassifier so the per-tab routing in
                // PackagingPlanning + Trims keeps working.
                // Same per-SKU applicability filter as accessories above.
                // bob.trims (AI prompt v2) and bob.packaging (legacy
                // routing) are both whole-tech-pack lists; without the
                // filter, packing-list zippers from a sheet-set tech pack
                // would land on Pillow Case SKUs etc.
                extracted_trim_specs: [
                  ...(bob.trims || []).map(t => {
                    const r = classifyComponent({
                      raw_category: t.trim_type,
                      material: t.description,
                      description: t.description,
                      placement: t.placement,
                    });
                    const finalType = (r.component_type && r.confidence >= 0.85) ? r.component_type : t.trim_type;
                    return {
                      trim_type:         finalType,
                      description:       t.description,
                      color:             t.color || null,
                      size_spec:         t.size_spec || null,
                      placement:         t.placement || null,
                      quantity_per_unit: t.quantity_per_unit ?? null,
                      unit:              t.unit || null,
                      wastage_percent:   t.wastage_percent ?? null,
                      supplier:          t.supplier || null,
                      source: "trims",
                    };
                  }),
                  ...(bob.packaging || []).map(p => {
                    const r = classifyComponent({
                      raw_category: p.category,
                      material: p.value,
                      description: p.value,
                    });
                    const finalType = (r.component_type && r.confidence >= 0.85) ? r.component_type : p.category;
                    return {
                      trim_type:         finalType,
                      description:       p.value,
                      color:             p.color || null,
                      size_spec:         p.size_spec || null,
                      quantity_per_unit: p.quantity_per_unit ?? null,
                      unit:              p.unit || null,
                      supplier:          p.supplier || null,
                      variant:           p.variant,
                      source_label:      p.label,
                      source: "packaging",
                    };
                  }),
                ].filter(t => appliesToProductType(productType, t.trim_type)),
                extracted_measurements: {
                  sizes: (bob.skus || []).map(s => s.size).filter(Boolean),
                  size_chart: Object.fromEntries(
                    (bob.skus || []).map(s => [s.size, {
                      item_code: s.item_code,
                      color: s.color,
                      product_dimensions: s.product_dimensions,
                      part_dimensions: s.part_dimensions || null,
                      insert_dimensions: s.insert_dimensions,
                      pvc_bag_dimensions: s.pvc_bag_dimensions,
                      stiffener_size: s.stiffener_size,
                      zipper_length: s.zipper_length,
                      units_per_carton: s.units_per_carton,
                      carton_size_cm: s.carton_size_cm,
                    }])
                  ),
                  this_sku: {
                    size: sku.size,
                    item_code: sku.item_code,
                    product_dimensions: sku.product_dimensions,
                    insert_dimensions: sku.insert_dimensions,
                    pvc_bag_dimensions: sku.pvc_bag_dimensions,
                    stiffener_size: sku.stiffener_size,
                    zipper_length: sku.zipper_length,
                  },
                },
                extracted_construction: {
                  zipper: bob.zipper || {},
                  sewing_details: (bob.accessories || [])
                    .filter(a => /sewing|overlock|stitch|needle/i.test(a.accessory_type))
                    .map(a => a.accessory_type + ": " + a.description)
                    .join(" | "),
                },
                extracted_data: {
                  source: "BOB Tech Pack",
                  program: bob.header.product_no,
                  product_type: productType.key,
                  product_type_label: productType.label,
                  size: sku.size,
                  product_dimensions: sku.product_dimensions,
                  insert_dimensions: sku.insert_dimensions,
                  pvc_bag_dimensions: sku.pvc_bag_dimensions,
                  stiffener_size: sku.stiffener_size,
                  zipper_length: sku.zipper_length,
                  units_per_carton: sku.units_per_carton,
                  carton_size_cm: sku.carton_size_cm,
                  // Side-channel for fields that do not fit the standard schema.
                  bob_extras: {
                    labels_count: (bob.labels || []).length,
                    packaging_count: (bob.packaging || []).length,
                    accessories_count: (bob.accessories || []).length,
                    total_skus_in_pack: (bob.skus || []).length,
                  },
                },
                extracted_at: new Date().toISOString(),
                notes: notes || `Auto-extracted from BOB tech pack (${bob.header.product_no}). ${productType.label}. ${skuFabricSpecs.length} fabric component(s) apply to this SKU.`,
              });
              createdTps.push(tp);
            }

            if (skippedDuplicates.length > 0) {
              console.info(`[TechPacks] skipped ${skippedDuplicates.length} duplicate SKU(s) already on file '${file.name}': ${skippedDuplicates.join(", ")}`);
            }

            // ── Article dimension sync ──
            // The BOB tech pack carries rich per-SKU dimensions in each
            // tp.extracted_measurements.this_sku that the articles table
            // doesn't get from PO upload alone. Backfill them onto matching
            // articles rows so the Articles UI, Packaging Planning's
            // article-fallback, and any downstream consumer see populated
            // dimensions without requiring the user to re-enter them via
            // the master Articles sheet. Only fills columns that are
            // currently NULL — never clobbers user edits or master-data values.
            try {
              for (const tp of createdTps) {
                if (!tp.article_code) continue;
                const sku = tp.extracted_measurements?.this_sku;
                if (!sku) continue;

                // Look up the article row by article_code (typically created
                // by a prior PO upload). If no article exists, skip — the
                // article will be created by future PO upload, at which
                // point this sync wouldn't run anyway.
                //
                // IMPORTANT: do NOT write articles.product_dimensions here.
                // That field is FabricWorking's manual-override slot (Layer 1
                // of its 3-tier resolver). FabricWorking already reads
                // tech_packs.extracted_measurements.size_chart for per-part
                // sheet-set dimensions (byItemPart / byCodeSizePart). If we
                // populate articles.product_dimensions with the whole-SKU
                // value here, Layer 1 wins and clobbers the per-component
                // resolution (Flat Sheet vs Fitted Sheet vs Pillow Case).
                // ilike() instead of eq() so case-mismatched article_codes
                // ("GPFRIOPPk" tech pack vs "GPFRIOPPK" article) still match.
                // Without this, articles whose source XLSX used mixed case in
                // the SKU column don't get their dimensions backfilled.
                const { data: existingArt } = await supabase
                  .from("articles")
                  .select("id, pvc_bag_dimensions, stiffener_size, insert_dimensions, zipper_length_cm, carton_size_cm")
                  .ilike("article_code", tp.article_code)
                  .maybeSingle();
                if (!existingArt) continue;

                const onlyIfBlank = (currentVal, newVal) =>
                  (currentVal == null || String(currentVal).trim() === "") && newVal ? newVal : null;

                // sku.zipper_length → articles.zipper_length_cm (column rename).
                // Each value is normalized to a canonical form so cross-source
                // audits (W×L vs L×W from different sources) compare cleanly.
                const patch = {
                  pvc_bag_dimensions: onlyIfBlank(existingArt.pvc_bag_dimensions, normalizeDim2D(sku.pvc_bag_dimensions)),
                  stiffener_size:     onlyIfBlank(existingArt.stiffener_size,     normalizeDim2D(sku.stiffener_size)),
                  insert_dimensions:  onlyIfBlank(existingArt.insert_dimensions,  normalizeDim2D(sku.insert_dimensions)),
                  zipper_length_cm:   onlyIfBlank(existingArt.zipper_length_cm,   normalizeDim3D(sku.zipper_length)),
                  carton_size_cm:     onlyIfBlank(existingArt.carton_size_cm,     normalizeDim3D(sku.carton_size_cm)),
                };
                const filtered = Object.fromEntries(
                  Object.entries(patch).filter(([_, v]) => v != null)
                );
                if (Object.keys(filtered).length > 0) {
                  await supabase.from("articles").update(filtered).eq("id", existingArt.id);
                }
              }
            } catch (artSyncErr) {
              // Non-blocking: tech_packs rows are saved, this is just a
              // convenience backfill. Log and move on.
              console.warn("[article dim sync] failed (non-blocking):", artSyncErr?.message || artSyncErr);
            }

            // ── Barcode OCR enrichment ──
            // BOB tech packs render the UPC table as a barcode IMAGE, not as
            // text cells, so the BOB parser can't read the digits. Extract
            // the embedded images client-side (XLSX is a zip), batch them
            // under the Supabase 6 MB edge-fn payload cap, and send each
            // batch to extract-barcodes (Claude vision). Results are merged
            // into each tech_packs row's extracted_data.upc array.
            //
            // Why client-side image extraction (vs. shipping the whole .xlsx
            // to the server like before): Supabase edge functions reject
            // payloads >6 MB. An 81.5 MB Purecare-style tech pack with 90
            // embedded images base64-encodes to ~109 MB and gets dropped at
            // the gateway. Pulling images out in the browser and sending
            // only the images keeps each call under the cap regardless of
            // workbook size. Whole-file mode is still supported by the
            // edge fn for backward compatibility.
            //
            // Non-blocking: if any batch fails, the tech_packs rows are
            // already saved — they just won't have UPC data on the failed
            // images. Re-extraction button on the row covers retry.
            try {
              updateProg(idx, { status: "extracting", message: "Pulling embedded images…" });
              const allImages = await extractImagesFromXlsx(file);
              if (allImages.length === 0) {
                console.info("[barcode OCR] no embedded images found, skipping");
              } else {
                const batches = chunkImagesForBatching(allImages);
                console.info(
                  `[barcode OCR] ${allImages.length} images → ${batches.length} batch${batches.length > 1 ? "es" : ""}`
                );
                const allResults = [];
                for (let b = 0; b < batches.length; b++) {
                  const batch = batches[b];
                  updateProg(idx, {
                    status:  "extracting",
                    message: `Reading barcodes — batch ${b + 1}/${batches.length} (${batch.length} images)…`,
                  });
                  const { data: ocrData, error: ocrErr } = await supabase.functions.invoke(
                    "extract-barcodes",
                    {
                      body: {
                        file_name: file.name,
                        images: batch.map((img) => ({
                          media_type: img.mediaType,
                          base64:     img.base64,
                          path:       img.path,
                        })),
                      },
                    }
                  );
                  if (ocrErr) {
                    console.warn(`[barcode OCR] batch ${b + 1} failed:`, ocrErr?.message || ocrErr);
                    continue;
                  }
                  if (ocrData?.ok && Array.isArray(ocrData.results)) {
                    allResults.push(...ocrData.results);
                  }
                }
                if (allResults.length > 0) {
                  const updates = computeBarcodeUpdates(allResults, createdTps);
                  for (const u of updates) {
                    await supabase.from("tech_packs").update({ extracted_data: u.extracted_data }).eq("id", u.id);
                    // Mutate the in-memory copy too so downstream cross-check uses fresh data
                    const tp = createdTps.find((t) => t.id === u.id);
                    if (tp) tp.extracted_data = u.extracted_data;
                  }
                }
              }
            } catch (ocrErr) {
              console.warn("[barcode OCR] failed (non-blocking):", ocrErr?.message || ocrErr);
            }

            // Run cross-check on the first SKU's tech pack as a representative sample
            // (audit runs per-SKU when user opens that tech pack)
            updateProg(idx, { status: "done", result: {
              tp: createdTps[0],
              checks: [],
              extracted: { bob_program: bob.header.product_no, skus_created: createdTps.length },
              bob_multi: true,
              createdCount: createdTps.length,
            }});
            return { ok: true, result: { createdCount: createdTps.length, bob: true } };
          }
        } catch (bobErr) {
          // Not a BOB file or parse failed — fall through to AI extraction
          console.log("Not a BOB file, using AI extraction:", bobErr.message);
        }
      }
      // ── End BOB branch ────────────────────────────────────────────────────

      const tp = await techPacks.create({
        po_id:            poId || null,
        po_number:        po?.po_number      || "",
        customer_name:    po?.customer_name  || "",
        article_code:     articleCode        || null,
        article_name:     articleName        || null,
        file_name:        file.name,
        file_url:         blobUrl,
        file_type:        fileType,
        file_size_kb:     Math.round(file.size / 1024),
        extraction_status: "processing",
        crosscheck_status: "not_run",
        uploaded_by:      profile?.full_name || "User",
        notes,
      });

      updateProg(idx, { status: "extracting", message: "AI is reading the file…" });
      const articleCtx = [articleCode, articleName, po?.customer_name].filter(Boolean).join(" ");
      const extracted = await extractTechPack(file, articleCtx);

      if (!extracted) {
        await techPacks.update(tp.id, {
          extraction_status: "failed",
          extraction_error: "AI could not parse this file.",
        });
        updateProg(idx, { status: "error", message: "Extraction failed — AI could not read this file." });
        return { ok: false };
      }

      await techPacks.update(tp.id, {
        extraction_status:    (extracted.confidence_score || 0) > 0.3 ? "extracted" : "partial",
        extracted_data:       extracted,
        extracted_fabric_specs:    extracted.fabric_specs    || [],
        extracted_trim_specs:      extracted.trim_specs      || [],
        extracted_accessory_specs: extracted.accessory_specs || [],
        extracted_label_specs:     extracted.label_specs     || [],
        extracted_measurements:    extracted.measurements    || {},
        extracted_construction:    extracted.construction    || {},
        extracted_wash_care:       extracted.wash_care       || [],
        article_code:   extracted.article_code  || articleCode  || null,
        article_name:   extracted.article_name  || articleName  || null,
        customer_name:  extracted.customer_name || po?.customer_name || null,
        extracted_at:   new Date().toISOString(),
      });

      updateProg(idx, { status: "crosschecking", message: "Cross-checking against working data…" });

      const finalTp = {
        ...tp,
        extracted_fabric_specs: extracted.fabric_specs || [],
        extracted_trim_specs:   extracted.trim_specs   || [],
        extracted_label_specs:  extracted.label_specs  || [],
        article_code: extracted.article_code || articleCode || null,
      };
      const checks = await runCrossCheck(finalTp, articlesCache, trimsCache, accCache);

      if (checks.length > 0) {
        await discrepancies.upsertBatch(
          checks.map(c => ({
            ...c,
            tech_pack_id: tp.id,
            po_id:         poId      || null,
            article_code:  extracted.article_code || articleCode || null,
          }))
        );
        await techPacks.update(tp.id, {
          crosscheck_status: "discrepancies",
          crosscheck_results: checks,
          crosscheck_run_at: new Date().toISOString(),
        });
      } else {
        await techPacks.update(tp.id, {
          crosscheck_status: "passed",
          crosscheck_run_at: new Date().toISOString(),
        });
      }

      const result = { tp, checks, extracted };
      updateProg(idx, { status: "done", result });
      return { ok: true, result };
    } catch (err) {
      console.error("TechPack upload error:", err);
      updateProg(idx, { status: "error", message: err.message || "Unknown error" });
      return { ok: false, error: err };
    }
  };

  const handleProcessAll = async () => {
    if (!files.length) return;
    setStage("processing");
    setProgress(files.map(f => ({ name: f.name, status: "pending" })));

    const po = pos.find(p => p.id === poId);

    // Fetch working data ONCE for all files — skip entirely when no PO linked
    let articles = [], trims = [], accessories = [];
    if (poId) {
      const [a, t, ac] = await Promise.all([
        supabase.from("articles").select("*").eq("po_id", poId),
        supabase.from("trim_items").select("*").eq("po_id", poId),
        supabase.from("accessory_items").select("*").eq("po_id", poId),
      ]);
      articles    = a.data || [];
      trims       = t.data || [];
      accessories = ac.data || [];
    }

    // Sequential to avoid hammering the AI endpoint
    for (let i = 0; i < files.length; i++) {
      await processOne(files[i], i, po, articles, trims, accessories);
    }

    qc.invalidateQueries({ queryKey: ["techPacks"] });
    if (onSuccess) onSuccess();
    setStage("done");
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSearch className="h-4 w-4 text-primary"/>Upload Tech Pack{files.length > 1 ? "s" : ""}</DialogTitle></DialogHeader>

        {stage === "idle" && (
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Link to PO (optional)</Label>
              <Select value={poId || "__none"} onValueChange={v => setPoId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select PO…"/></SelectTrigger>
                <SelectContent><SelectItem value="__none">No PO link</SelectItem>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Article Code</Label><Input value={articleCode} onChange={e=>setArticleCode(e.target.value)} placeholder="e.g. PCSJMO-T"/></div>
              <div className="space-y-1.5"><Label className="text-xs">Article Name</Label><Input value={articleName} onChange={e=>setArticleName(e.target.value)} placeholder="e.g. Men Round Neck Tee"/></div>
            </div>

            <div onClick={()=>inputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors">
              <Upload className="h-7 w-7 mx-auto mb-2 text-muted-foreground"/>
              <p className="text-sm font-medium">
                {files.length === 0 ? "Click to select tech pack(s)" : `${files.length} file${files.length>1?"s":""} selected — click to add more`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">PDF, Excel, Word, CSV, Images — any format accepted</p>
              <input ref={inputRef} type="file" multiple className="hidden"
                accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.txt"
                onChange={e=>{ addFiles(e.target.files); e.target.value = ""; }}/>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-dashed">
              <div className="text-xs text-muted-foreground">
                Or send a single file through the AI extraction review queue (lets you preview rows before they are saved):
              </div>
              <TryAIExtractionButton kind="tech_pack" size="sm" label="Try AI Extraction" />
            </div>

            {files.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto border rounded-lg p-2 bg-muted/20">
                {files.map((f, i) => (
                  <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-xs">
                    <FileSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-muted-foreground tabular-nums">{Math.round(f.size/1024)} KB</span>
                    <button onClick={()=>removeFile(i)} className="text-red-600 hover:text-red-800 px-1" aria-label={`Remove ${f.name}`}>×</button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="e.g. SS26 initial tech pack, may have pending approvals"/></div>
            {files.length > 1 && (articleCode || articleName) && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠ Article Code / Name will be applied to ALL {files.length} files. Leave blank to let AI extract per file.
              </p>
            )}
          </div>
        )}

        {(stage === "processing" || stage === "done") && (
          <div className="py-2 space-y-2">
            {progress.map((p, i) => (
              <FileProgressRow key={i} p={p}/>
            ))}
            {stage === "done" && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
                {progress.filter(p => p.status === "done").length} of {progress.length} tech pack{progress.length>1?"s":""} processed successfully.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={()=>{reset();onOpenChange(false);}}>
            {stage==="done"?"Close":"Cancel"}
          </Button>
          {stage==="idle" && <Button size="sm" onClick={handleProcessAll} disabled={!files.length}>Process {files.length > 0 ? `${files.length} File${files.length>1?"s":""}` : "Tech Pack"}</Button>}
          {stage==="done" && <Button size="sm" onClick={reset}>Upload More</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileProgressRow({ p }) {
  const icon = p.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-600"/>
            : p.status === "error" ? <AlertTriangle className="h-4 w-4 text-red-600"/>
            : p.status === "pending" ? <div className="h-4 w-4 rounded-full border border-muted-foreground"/>
            : <Loader2 className="h-4 w-4 text-blue-600 animate-spin"/>;
  const label = p.status === "done" ? "Done"
              : p.status === "error" ? "Failed"
              : p.status === "pending" ? "Waiting"
              : p.status === "uploading" ? "Uploading"
              : p.status === "extracting" ? "Extracting"
              : p.status === "crosschecking" ? "Cross-checking"
              : p.status;
  return (
    <div className="flex items-start gap-2 p-2 border rounded-lg">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{p.name}</p>
        <p className="text-xs text-muted-foreground">{label}{p.message ? ` — ${p.message}` : ""}</p>
        {p.result && (
          <p className="text-xs text-emerald-700 mt-0.5">
            {p.result.extracted.fabric_specs?.length||0} fabrics · {p.result.extracted.trim_specs?.length||0} trims · {p.result.extracted.label_specs?.length||0} labels · {p.result.checks.length} discrepancies
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function TechPacks() {
  const [searchParams] = useSearchParams();
  const [showUpload, setShowUpload] = useState(false);
  // Pre-fills the upload dialog's PO when triggered from a per-row Re-upload
  // button on a legacy `blob:` tech pack. After upload completes, any blob:
  // row whose SKU now has a storage:// sibling is auto-deleted.
  const [reuploadDefaultPoId, setReuploadDefaultPoId] = useState("");
  const [viewing, setViewing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPoId, setFilterPoId] = useState(searchParams.get("po_id") || "__all");
  // Track which tech-pack rows are currently re-extracting barcodes so the
  // button can show a spinner and we can disable double-clicks.
  const [reextractingByUrl, setReextractingByUrl] = useState({}); // { [storageUrl]: true }
  const qc = useQueryClient();

  const { data: pos = [] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: tps = [], isLoading } = useQuery({ queryKey:["techPacks"], queryFn:()=>techPacks.list() });

  const filtered = useMemo(()=>tps.filter(tp=>{
    const mpo = filterPoId==="__all" || tp.po_id === filterPoId;
    const ms = filterStatus==="all"||tp.extraction_status===filterStatus;
    const mq = !search||tp.article_code?.toLowerCase().includes(search.toLowerCase())||tp.article_name?.toLowerCase().includes(search.toLowerCase())||tp.po_number?.toLowerCase().includes(search.toLowerCase())||tp.file_name?.toLowerCase().includes(search.toLowerCase());
    return mpo&&ms&&mq;
  }),[tps,search,filterStatus,filterPoId]);

  // Session 12 - bulk selection of tech packs in the filtered list
  const selection = useBulkSelection(filtered);

  const stats = useMemo(()=>({
    total: tps.length,
    extracted: tps.filter(t=>t.extraction_status==="extracted").length,
    discrepancies: tps.filter(t=>t.crosscheck_status==="discrepancies").length,
    pending: tps.filter(t=>["pending","processing"].includes(t.extraction_status)).length,
  }),[tps]);

  // ── Re-extract barcodes from a previously-uploaded XLSX ────────────────
  // Re-runs extract-barcodes against the original file we persisted to the
  // ai-extraction-sources bucket on upload. Updates extracted_data.upc on
  // every sibling tech_packs row that shares the same file_url (i.e. came
  // from the same multi-SKU upload). Surfaces a single toast at the end
  // showing how many rows got new EAN data.
  const handleReextractBarcodes = async (tp) => {
    const fileUrl = tp.file_url || "";
    if (!fileUrl.startsWith("storage://")) {
      alert("This tech pack was uploaded before barcode persistence was enabled. Please re-upload it to read embedded barcodes.");
      return;
    }
    if (reextractingByUrl[fileUrl]) return;
    setReextractingByUrl((prev) => ({ ...prev, [fileUrl]: true }));
    try {
      // file_url shape: storage://<bucket>/<path>
      const withoutScheme = fileUrl.slice("storage://".length); // "<bucket>/<path>"
      const slash = withoutScheme.indexOf("/");
      const bucket = withoutScheme.slice(0, slash);
      const objectPath = withoutScheme.slice(slash + 1);

      // Download file bytes from storage
      const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(objectPath);
      if (dlErr || !blob) throw new Error(dlErr?.message || "Could not download tech-pack file from storage");

      // Encode to base64 for the edge function (chunked to avoid stack overflow on large files)
      const arrayBuf = await blob.arrayBuffer();
      const fileBytes = new Uint8Array(arrayBuf);
      const CHUNK = 0x8000;
      let binary = "";
      for (let i = 0; i < fileBytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(fileBytes.subarray(i, i + CHUNK)));
      }
      const fileBase64 = btoa(binary);

      const fileName = objectPath.split("/").pop() || tp.file_name || "tech-pack.xlsx";
      const { data: ocrData, error: ocrErr } = await supabase.functions.invoke(
        "extract-barcodes",
        { body: { file_base64: fileBase64, file_name: fileName } }
      );
      if (ocrErr) throw new Error(ocrErr.message || "extract-barcodes call failed");
      if (!ocrData?.ok || !Array.isArray(ocrData.results) || ocrData.results.length === 0) {
        alert("No barcode images were found in this tech pack.");
        return;
      }

      // Find all sibling rows from the same upload — same file_url means
      // same XLSX, which means the OCR results apply to all of them.
      const siblings = (tps || []).filter((row) => row.file_url === fileUrl);
      const updates = computeBarcodeUpdates(ocrData.results, siblings);
      let updatedCount = 0;
      for (const u of updates) {
        const { error: updErr } = await supabase
          .from("tech_packs")
          .update({ extracted_data: u.extracted_data })
          .eq("id", u.id);
        if (!updErr) updatedCount += 1;
      }

      qc.invalidateQueries({ queryKey: ["techPacks"] });
      alert(
        updatedCount > 0
          ? `Re-extracted ${ocrData.results.length} barcode image(s); updated EAN on ${updatedCount} tech-pack row(s).`
          : `Read ${ocrData.results.length} barcode image(s), but none matched any SKU sizes on these tech packs. (Manual entry still possible.)`
      );
    } catch (err) {
      console.error("[re-extract barcodes]", err);
      alert(`Could not re-extract barcodes: ${err?.message || err}`);
    } finally {
      setReextractingByUrl((prev) => {
        const n = { ...prev };
        delete n[fileUrl];
        return n;
      });
    }
  };

  // ── Cleanup: delete legacy `blob:` rows that have been superseded ──
  // After a successful upload, find any tech_pack rows with file_url like
  // `blob:` whose article_code now also has a sibling row with file_url
  // like `storage://`. The blob: rows are stale (the file isn't reachable
  // and OCR can't run on them), so we delete them so the UI shows the new
  // storage-persisted row instead. Triggered by UploadDialog's onSuccess.
  const handlePostUploadCleanup = async () => {
    try {
      const { data: allTps } = await supabase
        .from("tech_packs")
        .select("id, article_code, file_url");
      if (!Array.isArray(allTps)) return;
      // SKUs that have at least one storage:// row
      const skusWithStorage = new Set(
        allTps
          .filter((t) => (t.file_url || "").startsWith("storage://"))
          .map((t) => String(t.article_code || "").toUpperCase())
      );
      // SKUs to clean: blob: rows whose SKU now has a storage:// sibling
      const stale = allTps.filter(
        (t) =>
          (t.file_url || "").startsWith("blob:") &&
          skusWithStorage.has(String(t.article_code || "").toUpperCase())
      );
      if (stale.length === 0) return;
      const ids = stale.map((t) => t.id);
      const { error } = await supabase.from("tech_packs").delete().in("id", ids);
      if (!error) {
        console.info(`[TechPacks cleanup] removed ${stale.length} legacy blob: row(s) superseded by storage:// uploads`);
        qc.invalidateQueries({ queryKey: ["techPacks"] });
      } else {
        console.warn("[TechPacks cleanup] delete failed:", error.message);
      }
    } catch (e) {
      console.warn("[TechPacks cleanup] threw (non-blocking):", e?.message || e);
    }
  };

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><FileSearch className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Tech Packs</h1></div>
        <Button size="sm" onClick={()=>setShowUpload(true)} className="gap-1.5"><Upload className="h-4 w-4"/>Upload Tech Pack</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Total" value={stats.total} icon={FileSearch} iconBg="bg-primary/10"/>
        <StatCard title="Extracted" value={stats.extracted} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Discrepancies" value={stats.discrepancies} icon={AlertTriangle} iconBg={stats.discrepancies>0?"bg-red-100":"bg-muted/50"}/>
        <StatCard title="Pending" value={stats.pending} icon={Clock} iconBg="bg-amber-100"/>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        {/* Session 12 - select all visible. Tri-state: empty when none,
            indeterminate when some, checked when all. Click toggles. */}
        {filtered.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <SelectionCheckbox
              checked={selection.allVisible}
              indeterminate={selection.size > 0 && !selection.allVisible}
              onChange={() => selection.size > 0 ? selection.clear() : selection.selectAll()}
              title={selection.size > 0 ? "Clear selection" : "Select all visible"}
            />
            <span>{selection.size > 0 ? `${selection.size} of ${filtered.length}` : `Select all (${filtered.length})`}</span>
          </label>
        )}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search article, PO, file name…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[["all","All"],["pending","Pending"],["extracted","Extracted"],["partial","Partial"],["failed","Failed"]].map(([v,l])=>(
            <button key={v} onClick={()=>setFilterStatus(v)}
              className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
                filterStatus===v?"bg-primary text-primary-foreground border-primary":"border-border text-muted-foreground hover:bg-muted")}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {filtered.length===0 ? (
        <EmptyState icon={FileSearch} title="No tech packs yet"
          description="Upload customer tech packs in any format. Claude will intelligently extract fabric specs, trims, labels, and accessories — normalising all terminology automatically."
          actionLabel="Upload Tech Pack" onAction={()=>setShowUpload(true)}/>
      ) : (
        <div className="space-y-2">
          {filtered.map(tp => (
            <Card key={tp.id} className={cn("relative hover:shadow-sm transition-shadow", tp.crosscheck_status==="discrepancies"&&"border-amber-200", selection.isSelected(tp.id)&&"ring-2 ring-primary/40")}>
              <SelectionCheckbox
                corner
                checked={selection.isSelected(tp.id)}
                onChange={() => selection.toggle(tp.id)}
              />
              <CardContent className="p-4 pl-12 flex items-center gap-4 flex-wrap">
                <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <FileSearch className="h-4.5 w-4.5 text-primary"/>
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{tp.article_code||tp.article_name||tp.file_name}</span>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize", EXTRACT_STATUS_STYLES[tp.extraction_status]||"")}>{tp.extraction_status}</span>
                    {tp.crosscheck_status!=="not_run" && (
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize", CROSSCHECK_STYLES[tp.crosscheck_status]||"")}>
                        {tp.crosscheck_status==="discrepancies"?"⚠ "+((tp.crosscheck_results||[]).length)+" discrepancies":tp.crosscheck_status}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                    {tp.po_number&&<span>PO: <span className="text-primary font-medium">{tp.po_number}</span></span>}
                    {tp.customer_name&&<span>{tp.customer_name}</span>}
                    <span>{tp.file_name}</span>
                    <span>{fmt(tp.created_at)}</span>
                  </div>
                  {tp.extraction_status==="extracted" && (
                    <div className="flex gap-2 text-[10px] text-muted-foreground flex-wrap">
                      {(tp.extracted_fabric_specs||[]).length>0&&<span className="flex items-center gap-0.5"><Layers className="h-3 w-3"/>{(tp.extracted_fabric_specs||[]).length} fabrics</span>}
                      {(tp.extracted_trim_specs||[]).length>0&&<span className="flex items-center gap-0.5"><Tag className="h-3 w-3"/>{(tp.extracted_trim_specs||[]).length} trims</span>}
                      {(tp.extracted_label_specs||[]).length>0&&<span className="flex items-center gap-0.5"><Package className="h-3 w-3"/>{(tp.extracted_label_specs||[]).length} labels</span>}
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {/* Re-read barcodes from the persisted XLSX. Only shown
                      when we have a storage:// file_url (i.e. uploaded
                      after barcode persistence shipped). */}
                  {tp.extraction_status==="extracted" && (tp.file_url||"").startsWith("storage://") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs gap-1 h-7"
                      title="Re-read barcode images from this tech pack"
                      disabled={!!reextractingByUrl[tp.file_url]}
                      onClick={() => handleReextractBarcodes(tp)}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", reextractingByUrl[tp.file_url] && "animate-spin")} />
                      Barcodes
                    </Button>
                  )}
                  {/* Re-upload button — shown only when:
                      (a) the row's file_url is a blob: URL (browser-memory
                          only, doesn't survive refresh), AND
                      (b) the row has NO barcodes extracted yet.
                      Condition (b) avoids nagging the user on rows where the
                      OCR pipeline already ran successfully — the source file
                      is only needed for FUTURE re-extraction. Common cause of
                      blob: URLs: source XLSX exceeded the Supabase Storage
                      project file_size_limit (50 MB on free tier) so the
                      storage upload silently fell back to URL.createObjectURL.
                      Fix: bump the storage cap in Project Settings → Storage. */}
                  {tp.extraction_status === "extracted"
                   && (tp.file_url || "").startsWith("blob:")
                   && !(tp.extracted_data?.upc?.length > 0) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs gap-1 h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
                      title="Source file is browser-memory only (Storage upload was too large). Re-upload to persist it so 'Re-extract Barcodes' works later."
                      onClick={() => { setReuploadDefaultPoId(tp.po_id || ""); setShowUpload(true); }}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Re-upload
                    </Button>
                  )}
                  {tp.extraction_status==="extracted"&&<Button size="sm" variant="outline" className="text-xs gap-1 h-7" onClick={()=>setViewing(tp)}><Eye className="h-3.5 w-3.5"/>View</Button>}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={async()=>{if(!confirm("Delete?"))return;await techPacks.delete(tp.id);qc.invalidateQueries({queryKey:["techPacks"]});}}><Trash2 className="h-3.5 w-3.5 text-muted-foreground"/></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showUpload && (
        <UploadDialog
          open={showUpload}
          onOpenChange={(v) => {
            setShowUpload(v);
            if (!v) setReuploadDefaultPoId("");
          }}
          pos={pos}
          defaultPoId={reuploadDefaultPoId}
          onSuccess={() => {
            setShowUpload(false);
            setReuploadDefaultPoId("");
            // Sweep stale blob: rows that the new upload superseded.
            handlePostUploadCleanup();
          }}
        />
      )}
      {viewing&&<TechPackDetail tp={viewing} onClose={()=>setViewing(null)}/>}

      <BulkActionsBar selection={selection} allItems={filtered} />
    </div>
  );
}

