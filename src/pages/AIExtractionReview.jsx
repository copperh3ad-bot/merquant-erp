import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import EmptyState from "@/components/shared/EmptyState";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Clock, FileText, FileImage, FileSpreadsheet, Sparkles } from "lucide-react";

/* =========================================================================
 * AI Extraction Review
 * Queue view (no ?id) and detail view (?id=<extraction_id>) in one page,
 * matching the codebase's flat-routing convention.
 * ========================================================================= */

export default function AIExtractionReview() {
  const [params] = useSearchParams();
  const id = params.get("id");
  return id ? <DetailView extractionId={id} /> : <QueueView />;
}

/* ----- shared helpers ----- */

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function StatusBadge({ value, kind = "review" }) {
  const map = kind === "review" ? {
    pending_review:      { label: "Pending review",      cls: "bg-amber-100 text-amber-900" },
    approved:            { label: "Approved",            cls: "bg-green-100 text-green-900" },
    partially_approved:  { label: "Partially approved",  cls: "bg-blue-100 text-blue-900" },
    rejected:            { label: "Rejected",            cls: "bg-rose-100 text-rose-900" },
    superseded:          { label: "Superseded",          cls: "bg-slate-100 text-slate-700" },
  } : {
    pending: { label: "Pending",  cls: "bg-slate-100 text-slate-700" },
    passed:  { label: "Clean",    cls: "bg-green-100 text-green-900" },
    warned:  { label: "Warnings", cls: "bg-amber-100 text-amber-900" },
    failed:  { label: "Errors",   cls: "bg-rose-100 text-rose-900" },
    skipped: { label: "Skipped",  cls: "bg-slate-100 text-slate-700" },
  };
  const m = map[value] ?? { label: value, cls: "bg-slate-100 text-slate-700" };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

function MimeIcon({ mime }) {
  if (!mime) return <FileText className="w-4 h-4 text-muted-foreground" />;
  if (mime.startsWith("image/")) return <FileImage className="w-4 h-4 text-muted-foreground" />;
  if (mime.includes("pdf")) return <FileText className="w-4 h-4 text-muted-foreground" />;
  if (mime.includes("spreadsheet") || mime.includes("excel")) return <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />;
  return <FileText className="w-4 h-4 text-muted-foreground" />;
}

/* =========================================================================
 * QUEUE VIEW
 * Bulk select + apply across multiple extractions (P4=C).
 * ========================================================================= */

function QueueView() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["ai_extractions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_extractions")
        .select("id, kind, file_name, file_mime, model, validation_status, review_status, applied_at, rejected_at, created_at, validation_issues, extracted_data")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggle = (id) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelectable = useMemo(() =>
    (rows ?? []).filter(r => r.review_status === "pending_review" && r.validation_status !== "failed").map(r => r.id),
  [rows]);
  const allChecked = allSelectable.length > 0 && allSelectable.every(id => selected.has(id));

  async function bulkApply() {
    if (selected.size === 0) return;
    setBulkRunning(true);
    setBulkResult(null);
    const out = { ok: [], failed: [], conflict: [] };
    for (const id of selected) {
      const row = rows.find(r => r.id === id);
      if (!row) continue;
      try {
        if (row.kind === "tech_pack") {
          const skuCodes = (row.extracted_data?.skus ?? []).map(s => s.item_code).filter(Boolean);
          const { data, error } = await supabase.rpc("fn_apply_tech_pack_extraction", {
            p_extraction_id: id, p_sku_codes: skuCodes,
          });
          if (error) throw error;
          if (!data?.ok) { out.failed.push({ id, reason: data?.user_message || data?.code }); continue; }
          out.ok.push(id);
        } else {
          const filter = buildAllRowsFilter(row.extracted_data);
          const { data, error } = await supabase.rpc("fn_apply_master_data_extraction", {
            p_extraction_id: id, p_row_filter: filter, p_force: false, p_dry_run: false,
          });
          if (error) throw error;
          if (data?.code === "APPLY_TARGET_CONFLICT") { out.conflict.push({ id, count: data?.dev_detail?.conflict_count ?? 0 }); continue; }
          if (!data?.ok) { out.failed.push({ id, reason: data?.user_message || data?.code }); continue; }
          out.ok.push(id);
        }
      } catch (e) {
        out.failed.push({ id, reason: e.message });
      }
    }
    setBulkResult(out);
    setBulkRunning(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["ai_extractions"] });
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" /> AI Extraction Review
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review extractions from the AI pipeline before they land in the live tables. Tick rows to apply or reject in bulk.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={bulkApply} disabled={selected.size === 0 || bulkRunning}>
            {bulkRunning ? "Applying…" : `Apply ${selected.size} selected`}
          </Button>
        </div>
      </div>

      {bulkResult && (
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-4 text-sm space-y-1">
            <div><span className="font-semibold text-green-700">{bulkResult.ok.length}</span> applied successfully.</div>
            {bulkResult.conflict.length > 0 && (
              <div><span className="font-semibold text-amber-700">{bulkResult.conflict.length}</span> had conflicts (open each to resolve).</div>
            )}
            {bulkResult.failed.length > 0 && (
              <div><span className="font-semibold text-rose-700">{bulkResult.failed.length}</span> failed:
                <ul className="list-disc ml-6 text-xs mt-1">{bulkResult.failed.map(f => <li key={f.id}>{f.id.slice(0, 8)}: {f.reason}</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(rows?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No extractions yet"
          description="Upload a tech pack or master data file via the Try AI Extraction button on the Tech Packs or Master Data Import pages."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="p-2 w-8">
                    <input type="checkbox" checked={allChecked} onChange={(e) => {
                      setSelected(e.target.checked ? new Set(allSelectable) : new Set());
                    }} />
                  </th>
                  <th className="p-2 text-left">File</th>
                  <th className="p-2 text-left">Kind</th>
                  <th className="p-2 text-left">Model</th>
                  <th className="p-2 text-left">Validation</th>
                  <th className="p-2 text-left">Review</th>
                  <th className="p-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const errCount = (r.validation_issues ?? []).filter(i => i.severity === "error").length;
                  const warnCount = (r.validation_issues ?? []).filter(i => i.severity === "warn").length;
                  const canSelect = r.review_status === "pending_review" && r.validation_status !== "failed";
                  return (
                    <tr key={r.id} className="border-b hover:bg-muted/30">
                      <td className="p-2">
                        <input type="checkbox" disabled={!canSelect} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                      <td className="p-2">
                        <Link to={`/AIExtractionReview?id=${r.id}`} className="flex items-center gap-2 hover:underline">
                          <MimeIcon mime={r.file_mime} />
                          <span className="font-mono text-xs">{r.file_name}</span>
                        </Link>
                      </td>
                      <td className="p-2 text-muted-foreground">{r.kind}</td>
                      <td className="p-2 text-xs text-muted-foreground">{r.model ?? "—"}</td>
                      <td className="p-2"><StatusBadge value={r.validation_status} kind="validation" />
                        {(errCount + warnCount) > 0 && (
                          <span className="ml-2 text-xs text-muted-foreground">({errCount} err, {warnCount} warn)</span>
                        )}
                      </td>
                      <td className="p-2"><StatusBadge value={r.review_status} kind="review" /></td>
                      <td className="p-2 text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function buildAllRowsFilter(extracted) {
  const f = {};
  if (Array.isArray(extracted?.articles) && extracted.articles.length)
    f.articles = extracted.articles.map(r => r.item_code).filter(Boolean);
  if (Array.isArray(extracted?.fabric_consumption) && extracted.fabric_consumption.length)
    f.fabric_consumption = extracted.fabric_consumption.map(r => ({ item_code: r.item_code, component_type: r.component_type, color: r.color ?? "" }));
  if (Array.isArray(extracted?.accessory_consumption) && extracted.accessory_consumption.length)
    f.accessory_consumption = extracted.accessory_consumption.map(r => ({ item_code: r.item_code, category: r.category, material: r.material ?? "" }));
  if (Array.isArray(extracted?.carton_master) && extracted.carton_master.length)
    f.carton_master = extracted.carton_master.map(r => r.item_code).filter(Boolean);
  if (Array.isArray(extracted?.price_list) && extracted.price_list.length)
    f.price_list = extracted.price_list.map(r => r.item_code).filter(Boolean);
  if (Array.isArray(extracted?.suppliers) && extracted.suppliers.length)
    f.suppliers = extracted.suppliers.map(r => r.name).filter(Boolean);
  if (Array.isArray(extracted?.seasons) && extracted.seasons.length)
    f.seasons = extracted.seasons.map(r => r.name).filter(Boolean);
  if (Array.isArray(extracted?.production_lines) && extracted.production_lines.length)
    f.production_lines = extracted.production_lines.map(r => r.name).filter(Boolean);
  return f;
}

/* =========================================================================
 * DETAIL VIEW
 * Pre-checks conflicts on load (P3=B). Per-section tables with row checkboxes.
 * ========================================================================= */

function DetailView({ extractionId }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedSkus, setSelectedSkus] = useState(new Set());
  const [selectedMaster, setSelectedMaster] = useState({}); // section → Set of keys (string for single-key, JSON.stringify for composite)
  const [conflicts, setConflicts] = useState([]);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { data: ext, isLoading } = useQuery({
    queryKey: ["ai_extraction", extractionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_extractions")
        .select("*")
        .eq("id", extractionId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Initialise selection: every clean row preselected by default
  useEffect(() => {
    if (!ext) return;
    if (ext.kind === "tech_pack") {
      const codes = (ext.extracted_data?.skus ?? []).map(s => s.item_code).filter(Boolean);
      setSelectedSkus(new Set(codes));
    } else if (ext.kind === "master_data") {
      const next = {};
      const ed = ext.extracted_data ?? {};
      if (Array.isArray(ed.articles))              next.articles              = new Set(ed.articles.map(r => r.item_code).filter(Boolean));
      if (Array.isArray(ed.fabric_consumption))    next.fabric_consumption    = new Set(ed.fabric_consumption.map(r => JSON.stringify({ item_code: r.item_code, component_type: r.component_type, color: r.color ?? "" })));
      if (Array.isArray(ed.accessory_consumption)) next.accessory_consumption = new Set(ed.accessory_consumption.map(r => JSON.stringify({ item_code: r.item_code, category: r.category, material: r.material ?? "" })));
      if (Array.isArray(ed.carton_master))         next.carton_master         = new Set(ed.carton_master.map(r => r.item_code).filter(Boolean));
      if (Array.isArray(ed.price_list))            next.price_list            = new Set(ed.price_list.map(r => r.item_code).filter(Boolean));
      if (Array.isArray(ed.suppliers))             next.suppliers             = new Set(ed.suppliers.map(r => r.name).filter(Boolean));
      if (Array.isArray(ed.seasons))               next.seasons               = new Set(ed.seasons.map(r => r.name).filter(Boolean));
      if (Array.isArray(ed.production_lines))      next.production_lines      = new Set(ed.production_lines.map(r => r.name).filter(Boolean));
      setSelectedMaster(next);
    }
  }, [ext]);

  // Pre-check conflicts (master_data only — tech_pack has no conflict surface)
  useEffect(() => {
    if (!ext || ext.kind !== "master_data") return;
    const filter = buildAllRowsFilter(ext.extracted_data);
    if (Object.keys(filter).length === 0) return;
    (async () => {
      const { data, error } = await supabase.rpc("fn_apply_master_data_extraction", {
        p_extraction_id: extractionId, p_row_filter: filter, p_force: false, p_dry_run: true,
      });
      if (!error && data?.code === "DRY_RUN_PREVIEW") {
        setConflicts(data.conflicts ?? []);
      }
    })();
  }, [ext, extractionId]);

  // Hooks must run in the same order every render — keep useMemo before any early return.
  const issues = ext?.validation_issues ?? [];
  const issuesByPath = useMemo(() => {
    const m = new Map();
    for (const i of issues) {
      const arr = m.get(i.path) ?? [];
      arr.push(i);
      m.set(i.path, arr);
    }
    return m;
  }, [issues]);

  const conflictKeysBySection = useMemo(() => {
    const m = new Map();
    for (const c of conflicts) {
      const set = m.get(c.section) ?? new Set();
      set.add(typeof c.key === "string" ? c.key : JSON.stringify(c.key));
      m.set(c.section, set);
    }
    return m;
  }, [conflicts]);

  if (isLoading || !ext) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Skeleton className="h-10 w-72 mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const errCount = issues.filter(i => i.severity === "error").length;
  const warnCount = issues.filter(i => i.severity === "warn").length;

  async function handleApply({ overwriteConflicts = false } = {}) {
    setApplying(true);
    setApplyResult(null);
    try {
      let res;
      if (ext.kind === "tech_pack") {
        const { data, error } = await supabase.rpc("fn_apply_tech_pack_extraction", {
          p_extraction_id: extractionId, p_sku_codes: Array.from(selectedSkus),
        });
        if (error) throw error;
        res = data;
      } else {
        const filter = {};
        for (const [section, set] of Object.entries(selectedMaster)) {
          if (set.size === 0) continue;
          if (["articles","carton_master","price_list","suppliers","seasons","production_lines"].includes(section)) {
            filter[section] = Array.from(set);
          } else {
            filter[section] = Array.from(set).map(s => JSON.parse(s));
          }
        }
        const { data, error } = await supabase.rpc("fn_apply_master_data_extraction", {
          p_extraction_id: extractionId, p_row_filter: filter, p_force: overwriteConflicts, p_dry_run: false,
        });
        if (error) throw error;
        res = data;
      }
      setApplyResult(res);
      qc.invalidateQueries({ queryKey: ["ai_extraction", extractionId] });
      qc.invalidateQueries({ queryKey: ["ai_extractions"] });
    } catch (e) {
      setApplyResult({ ok: false, code: "UNCAUGHT", user_message: e.message });
    } finally {
      setApplying(false);
    }
  }

  async function handleReject() {
    const { data, error } = await supabase.rpc("fn_reject_extraction", {
      p_extraction_id: extractionId, p_reason: rejectReason || "(no reason given)",
    });
    if (!error && data?.ok) {
      setShowRejectDialog(false);
      qc.invalidateQueries({ queryKey: ["ai_extraction", extractionId] });
      qc.invalidateQueries({ queryKey: ["ai_extractions"] });
    } else {
      alert(data?.user_message || error?.message || "Reject failed");
    }
  }

  const isApplied = !!ext.applied_at;
  const isRejected = ext.review_status === "rejected";
  const canApply = !isApplied && !isRejected && ext.validation_status !== "failed";
  const canApproveAll = canApply && errCount === 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start gap-4">
        <Link to="/AIExtractionReview"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> All extractions</Button></Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2"><MimeIcon mime={ext.file_mime} /> {ext.file_name}</CardTitle>
              <div className="text-sm text-muted-foreground mt-1">
                Kind: <span className="font-medium">{ext.kind}</span> · Model: <span className="font-mono text-xs">{ext.model}</span> · Cost: ${(ext.cost_usd ?? 0).toFixed(4)} · Created {fmtDate(ext.created_at)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <StatusBadge value={ext.validation_status} kind="validation" />
                <StatusBadge value={ext.review_status} kind="review" />
              </div>
              {(errCount + warnCount) > 0 && (
                <div className="text-xs text-muted-foreground">{errCount} errors · {warnCount} warnings</div>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {ext.error_code && (
        <Card className="border-l-4 border-l-rose-500">
          <CardContent className="pt-4 text-sm">
            <div className="font-medium text-rose-900">Extraction error: {ext.error_code}</div>
            <div className="text-muted-foreground mt-1">{ext.error_message}</div>
          </CardContent>
        </Card>
      )}

      {applyResult && (
        <Card className={`border-l-4 ${applyResult.ok ? "border-l-green-500" : "border-l-rose-500"}`}>
          <CardContent className="pt-4 text-sm">
            <div className="font-medium">{applyResult.ok ? "Applied successfully." : (applyResult.user_message || applyResult.code)}</div>
            {applyResult.conflicts && applyResult.conflicts.length > 0 && !applyResult.ok && (
              <div className="mt-2">
                <div className="text-xs text-muted-foreground mb-1">{applyResult.conflicts.length} conflicting row(s):</div>
                <ul className="list-disc ml-6 text-xs">
                  {applyResult.conflicts.slice(0, 10).map((c, i) => (
                    <li key={i}><span className="font-mono">{c.section}</span>: {typeof c.key === "string" ? c.key : JSON.stringify(c.key)}</li>
                  ))}
                </ul>
                <div className="mt-2"><Button size="sm" variant="outline" onClick={() => handleApply({ overwriteConflicts: true })}>Overwrite all conflicts</Button></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {ext.kind === "tech_pack" && (
        <TechPackTables ext={ext} selectedSkus={selectedSkus} setSelectedSkus={setSelectedSkus} issuesByPath={issuesByPath} />
      )}
      {ext.kind === "master_data" && (
        <MasterDataTables ext={ext} selectedMaster={selectedMaster} setSelectedMaster={setSelectedMaster} issuesByPath={issuesByPath} conflictKeysBySection={conflictKeysBySection} />
      )}

      {canApply && (
        <div className="flex items-center justify-end gap-2 sticky bottom-4 bg-background/80 backdrop-blur p-3 rounded-lg shadow border">
          <Button variant="outline" onClick={() => setShowRejectDialog(true)}>Reject extraction</Button>
          {ext.kind === "tech_pack" && (
            <Button onClick={() => handleApply()} disabled={selectedSkus.size === 0 || applying}>
              {applying ? "Applying…" : `Apply ${selectedSkus.size} SKU${selectedSkus.size === 1 ? "" : "s"}`}
            </Button>
          )}
          {ext.kind === "master_data" && (
            <>
              <Button onClick={() => handleApply()} disabled={applying || Object.values(selectedMaster).every(s => s.size === 0)}>
                {applying ? "Applying…" : "Apply selected"}
              </Button>
              {canApproveAll && (
                <Button variant="default" onClick={() => {
                  // Re-select everything before apply
                  const ed = ext.extracted_data ?? {};
                  const next = {};
                  if (Array.isArray(ed.articles))              next.articles              = new Set(ed.articles.map(r => r.item_code).filter(Boolean));
                  if (Array.isArray(ed.fabric_consumption))    next.fabric_consumption    = new Set(ed.fabric_consumption.map(r => JSON.stringify({ item_code: r.item_code, component_type: r.component_type, color: r.color ?? "" })));
                  if (Array.isArray(ed.accessory_consumption)) next.accessory_consumption = new Set(ed.accessory_consumption.map(r => JSON.stringify({ item_code: r.item_code, category: r.category, material: r.material ?? "" })));
                  if (Array.isArray(ed.carton_master))         next.carton_master         = new Set(ed.carton_master.map(r => r.item_code).filter(Boolean));
                  if (Array.isArray(ed.price_list))            next.price_list            = new Set(ed.price_list.map(r => r.item_code).filter(Boolean));
                  if (Array.isArray(ed.suppliers))             next.suppliers             = new Set(ed.suppliers.map(r => r.name).filter(Boolean));
                  if (Array.isArray(ed.seasons))               next.seasons               = new Set(ed.seasons.map(r => r.name).filter(Boolean));
                  if (Array.isArray(ed.production_lines))      next.production_lines      = new Set(ed.production_lines.map(r => r.name).filter(Boolean));
                  setSelectedMaster(next);
                  setTimeout(() => handleApply(), 0);
                }}>Apply all</Button>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject this extraction?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Rejected extractions cannot be applied later. The source file and extracted data are kept for audit.</p>
          <Textarea placeholder="Optional: reason for rejection" value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* =========================================================================
 * Section tables
 * ========================================================================= */

function TechPackTables({ ext, selectedSkus, setSelectedSkus, issuesByPath }) {
  const skus = ext.extracted_data?.skus ?? [];
  const fabric = ext.extracted_data?.fabric_specs ?? [];
  const labels = ext.extracted_data?.labels ?? [];
  const accessories = ext.extracted_data?.accessories ?? [];
  const packaging = ext.extracted_data?.packaging ?? [];

  const toggleSku = (code) => setSelectedSkus(s => {
    const n = new Set(s);
    if (n.has(code)) n.delete(code); else n.add(code);
    return n;
  });

  return (
    <div className="space-y-4">
      <SectionTable
        title="SKUs"
        rows={skus}
        columns={[
          { key: "item_code", label: "Item Code", className: "font-mono text-xs" },
          { key: "size",      label: "Size" },
          { key: "color",     label: "Color" },
          { key: "product_dimensions", label: "Dimensions" },
          { key: "units_per_carton",   label: "Units/Carton" },
          { key: "carton_size_cm",     label: "Carton (cm)" },
        ]}
        rowKey={(r) => r.item_code}
        pathPrefix="skus"
        issuesByPath={issuesByPath}
        selected={selectedSkus}
        onToggle={toggleSku}
      />
      {fabric.length > 0 && <SectionTable title="Fabric specs" rows={fabric} columns={fabricCols()} rowKey={(r, i) => `f${i}`} pathPrefix="fabric_specs" issuesByPath={issuesByPath} readOnly />}
      {labels.length > 0 && <SectionTable title="Labels" rows={labels} columns={labelCols()} rowKey={(r, i) => `l${i}`} pathPrefix="labels" issuesByPath={issuesByPath} readOnly />}
      {accessories.length > 0 && <SectionTable title="Accessories" rows={accessories} columns={accCols()} rowKey={(r, i) => `a${i}`} pathPrefix="accessories" issuesByPath={issuesByPath} readOnly />}
      {packaging.length > 0 && <SectionTable title="Packaging" rows={packaging} columns={pkgCols()} rowKey={(r, i) => `p${i}`} pathPrefix="packaging" issuesByPath={issuesByPath} readOnly />}
    </div>
  );
}

function MasterDataTables({ ext, selectedMaster, setSelectedMaster, issuesByPath, conflictKeysBySection }) {
  const ed = ext.extracted_data ?? {};

  const toggle = (section, key) => setSelectedMaster(m => {
    const next = { ...m };
    const set = new Set(next[section] ?? []);
    if (set.has(key)) set.delete(key); else set.add(key);
    next[section] = set;
    return next;
  });

  const sectionDef = [
    { name: "articles",              title: "Articles",                rows: ed.articles,              cols: articlesCols(),            keyFn: r => r.item_code },
    { name: "fabric_consumption",    title: "Fabric consumption",      rows: ed.fabric_consumption,    cols: fabricConsCols(),          keyFn: r => JSON.stringify({ item_code: r.item_code, component_type: r.component_type, color: r.color ?? "" }) },
    { name: "accessory_consumption", title: "Accessory consumption",   rows: ed.accessory_consumption, cols: accConsCols(),             keyFn: r => JSON.stringify({ item_code: r.item_code, category: r.category, material: r.material ?? "" }) },
    { name: "carton_master",         title: "Carton master",           rows: ed.carton_master,         cols: cartonCols(),              keyFn: r => r.item_code },
    { name: "price_list",            title: "Price list",              rows: ed.price_list,            cols: priceCols(),               keyFn: r => r.item_code },
    { name: "suppliers",             title: "Suppliers",               rows: ed.suppliers,             cols: suppliersCols(),           keyFn: r => r.name },
    { name: "seasons",               title: "Seasons",                 rows: ed.seasons,               cols: seasonsCols(),             keyFn: r => r.name },
    { name: "production_lines",      title: "Production lines",        rows: ed.production_lines,      cols: prodLinesCols(),           keyFn: r => r.name },
  ];

  return (
    <div className="space-y-4">
      {sectionDef.filter(s => Array.isArray(s.rows) && s.rows.length > 0).map(s => (
        <SectionTable
          key={s.name}
          title={s.title}
          rows={s.rows}
          columns={s.cols}
          rowKey={s.keyFn}
          pathPrefix={s.name}
          issuesByPath={issuesByPath}
          selected={selectedMaster[s.name] ?? new Set()}
          onToggle={(key) => toggle(s.name, key)}
          conflictKeys={conflictKeysBySection.get(s.name) ?? new Set()}
        />
      ))}
    </div>
  );
}

function SectionTable({ title, rows, columns, rowKey, pathPrefix, issuesByPath, selected, onToggle, conflictKeys, readOnly }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span>{title} <span className="text-xs text-muted-foreground font-normal">({rows.length})</span></span>
          {!readOnly && selected && <span className="text-xs text-muted-foreground font-normal">{selected.size} selected</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="border-b">
              {!readOnly && <th className="p-2 w-8"></th>}
              <th className="p-2 w-8"></th>
              {columns.map(c => <th key={c.key} className="p-2 text-left text-xs font-medium text-muted-foreground">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const k = rowKey(r, i);
              const path = `${pathPrefix}[${i}]`;
              const fieldIssues = [];
              for (const [p, list] of issuesByPath.entries()) {
                if (p === path || p.startsWith(`${path}.`)) fieldIssues.push(...list);
              }
              const hasError = fieldIssues.some(x => x.severity === "error");
              const hasWarn  = fieldIssues.some(x => x.severity === "warn");
              const isConflict = conflictKeys?.has(k);
              return (
                <tr key={k} className={`border-b hover:bg-muted/20 ${isConflict ? "bg-amber-50/50" : ""}`}>
                  {!readOnly && (
                    <td className="p-2">
                      <input type="checkbox" disabled={hasError} checked={selected?.has(k) ?? false} onChange={() => onToggle(k)} />
                    </td>
                  )}
                  <td className="p-2">
                    {hasError ? <XCircle className="w-4 h-4 text-rose-600" />
                     : hasWarn ? <AlertTriangle className="w-4 h-4 text-amber-600" />
                     : <CheckCircle2 className="w-4 h-4 text-green-600" />}
                    {isConflict && <span className="ml-1 inline-block text-[10px] font-bold text-amber-900">⚠ exists</span>}
                  </td>
                  {columns.map(c => (
                    <td key={c.key} className={`p-2 ${c.className ?? ""}`}>{renderCell(r[c.key])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.some((r, i) => {
          const path = `${pathPrefix}[${i}]`;
          for (const [p] of issuesByPath.entries()) if (p === path || p.startsWith(`${path}.`)) return true;
          return false;
        }) && (
          <details className="p-2 border-t bg-muted/10">
            <summary className="text-xs cursor-pointer text-muted-foreground">Show {[...issuesByPath.keys()].filter(p => p.startsWith(pathPrefix)).length} validation issue(s)</summary>
            <ul className="text-xs mt-2 space-y-1">
              {[...issuesByPath.entries()].filter(([p]) => p.startsWith(pathPrefix)).flatMap(([p, list]) =>
                list.map((i, idx) => (
                  <li key={`${p}-${idx}`} className={i.severity === "error" ? "text-rose-700" : "text-amber-700"}>
                    <span className="font-mono">{p}</span>: {i.message}
                  </li>
                ))
              )}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function renderCell(v) {
  if (v == null || v === "") return <span className="text-muted-foreground">—</span>;
  if (typeof v === "object") return <span className="font-mono text-xs">{JSON.stringify(v)}</span>;
  return String(v);
}

const fabricCols     = () => [
  { key: "component_type", label: "Component" },
  { key: "fabric_type",    label: "Fabric" },
  { key: "gsm",            label: "GSM" },
  { key: "color",          label: "Color" },
  { key: "construction",   label: "Construction" },
  { key: "finish",         label: "Finish" },
];
const labelCols      = () => [
  { key: "section",   label: "Section" },
  { key: "type",      label: "Type" },
  { key: "material",  label: "Material" },
  { key: "size",      label: "Size" },
  { key: "color",     label: "Color" },
  { key: "placement", label: "Placement" },
];
const accCols        = () => [
  { key: "accessory_type", label: "Type" },
  { key: "description",    label: "Description" },
  { key: "material",       label: "Material" },
  { key: "placement",      label: "Placement" },
];
const pkgCols        = () => [
  { key: "variant",  label: "Variant" },
  { key: "category", label: "Category" },
  { key: "label",    label: "Label" },
  { key: "value",    label: "Value" },
];
const articlesCols   = () => [
  { key: "item_code",    label: "Item Code", className: "font-mono text-xs" },
  { key: "brand",        label: "Brand" },
  { key: "product_type", label: "Product Type" },
  { key: "size",         label: "Size" },
];
const fabricConsCols = () => [
  { key: "item_code",            label: "Item Code", className: "font-mono text-xs" },
  { key: "component_type",       label: "Component" },
  { key: "color",                label: "Color" },
  { key: "fabric_type",          label: "Fabric" },
  { key: "gsm",                  label: "GSM" },
  { key: "width_cm",             label: "Width (cm)" },
  { key: "consumption_per_unit", label: "Cons/unit" },
  { key: "wastage_percent",      label: "Wastage" },
];
const accConsCols    = () => [
  { key: "item_code",            label: "Item Code", className: "font-mono text-xs" },
  { key: "category",             label: "Category" },
  { key: "material",             label: "Material" },
  { key: "size_spec",            label: "Size spec" },
  { key: "placement",            label: "Placement" },
  { key: "consumption_per_unit", label: "Cons/unit" },
];
const cartonCols     = () => [
  { key: "item_code",        label: "Item Code", className: "font-mono text-xs" },
  { key: "units_per_carton", label: "Units/Carton" },
  { key: "carton_length_cm", label: "L (cm)" },
  { key: "carton_width_cm",  label: "W (cm)" },
  { key: "carton_height_cm", label: "H (cm)" },
];
const priceCols      = () => [
  { key: "item_code",      label: "Item Code", className: "font-mono text-xs" },
  { key: "price_usd",      label: "Price (USD)" },
  { key: "effective_from", label: "Effective From" },
];
const suppliersCols  = () => [
  { key: "name",          label: "Name" },
  { key: "contact_email", label: "Email" },
  { key: "contact_phone", label: "Phone" },
];
const seasonsCols    = () => [
  { key: "name",       label: "Name" },
  { key: "start_date", label: "Start" },
  { key: "end_date",   label: "End" },
];
const prodLinesCols  = () => [
  { key: "name",           label: "Name" },
  { key: "line_type",      label: "Type" },
  { key: "daily_capacity", label: "Capacity" },
];
