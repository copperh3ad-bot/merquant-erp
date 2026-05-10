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
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Clock, FileText, FileImage, FileSpreadsheet, Sparkles, Trash2, ChevronRight, ChevronDown, Layers, Pencil, Save, X as XIcon, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { validateExtraction } from "@/lib/validators/extractionValidator";

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
  const { isOwner } = useAuth();
  const [selected, setSelected] = useState(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Owner-only: hard-delete extractions from ai_extractions. Backed by
  // RLS policy ai_extractions_delete which restricts DELETE to the
  // Owner role at the database level — non-Owners would silently get
  // 0 rows deleted even if they bypassed the UI guard.
  async function bulkDelete() {
    if (!isOwner || selected.size === 0) return;
    const ids = [...selected];
    if (!confirm(`Permanently delete ${ids.length} extraction${ids.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("ai_extractions").delete().in("id", ids);
      if (error) throw error;
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["ai_extractions"] });
    } catch (e) {
      alert(`Delete failed: ${e.message || String(e)}`);
    } finally {
      setDeleting(false);
    }
  }

  const { data: rows, isLoading } = useQuery({
    queryKey: ["ai_extractions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_extractions")
        .select("id, kind, file_name, file_mime, model, validation_status, review_status, applied_at, rejected_at, created_at, validation_issues, extracted_data, batch_id")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Auto-split batches keep rows together visually. NULL batch_id =
  // standalone single-shot extraction. Non-null batch_id = sibling
  // of an auto-split upload from FileFeeder. We render standalones
  // and batches in a single time-ordered stream.
  const [expandedBatches, setExpandedBatches] = useState(() => new Set());
  const toggleBatch = (b) => setExpandedBatches(s => {
    const n = new Set(s);
    if (n.has(b)) n.delete(b); else n.add(b);
    return n;
  });

  // Build the render plan: an array of items, each either
  //   { kind: 'single', row }  or
  //   { kind: 'group', batch_id, rows, parentLabel, applied, pending, rejected, failed, warned }
  // Sorted by the most-recent created_at within each item so the
  // newest upload sits on top regardless of group/single status.
  const renderPlan = useMemo(() => {
    const all = rows ?? [];
    const groupsByBatch = new Map();
    const singles = [];
    for (const r of all) {
      if (r.batch_id) {
        if (!groupsByBatch.has(r.batch_id)) groupsByBatch.set(r.batch_id, []);
        groupsByBatch.get(r.batch_id).push(r);
      } else {
        singles.push(r);
      }
    }
    const items = [];
    for (const r of singles) items.push({ kind: "single", row: r, sortAt: r.created_at });
    for (const [batchId, brows] of groupsByBatch) {
      const sortAt = brows.reduce((m, r) => r.created_at > m ? r.created_at : m, "");
      // Derive a clean parent label from the synthetic file names —
      // strip "__<sheet_slug>" + ".xlsx" → leaves the original base
      // name shared across siblings.
      const stripped = brows.map(r => (r.file_name || "")
        .replace(/__[a-z0-9_]+\.xlsx?$/i, "")
        .replace(/\.xlsx?$/i, ""));
      const parentLabel = stripped.length > 0 ? (stripped[0] || "Batch") : "Batch";
      const applied  = brows.filter(r => r.review_status === "approved" || r.review_status === "partially_approved").length;
      const pending  = brows.filter(r => r.review_status === "pending_review").length;
      const rejected = brows.filter(r => r.review_status === "rejected").length;
      const failed   = brows.filter(r => r.validation_status === "failed").length;
      const warned   = brows.filter(r => r.validation_status === "warned").length;
      items.push({
        kind: "group", batch_id: batchId, rows: brows, parentLabel,
        applied, pending, rejected, failed, warned, sortAt,
      });
    }
    items.sort((a, b) => b.sortAt.localeCompare(a.sortAt));
    return items;
  }, [rows]);

  const toggle = (id) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelectable = useMemo(() =>
    (rows ?? []).filter(r => r.review_status === "pending_review" && r.validation_status !== "failed").map(r => r.id),
  [rows]);
  const allChecked = allSelectable.length > 0 && allSelectable.every(id => selected.has(id));

  // Quick-select pools used by the bulk-selection toolbar.
  // - allRowIds:       every row in the queue (caller may want to delete all)
  // - pendingIds:      pending_review only (the default "ready to apply" set)
  // - withWarningsIds: pending_review + validation has warnings or errors
  // - rejectedIds:     review_status = rejected
  // - conflictIds:     IDs that came back as APPLY_TARGET_CONFLICT on the
  //                    most recent bulk apply (sourced from bulkResult,
  //                    so this is empty until you've applied at least once)
  const allRowIds       = useMemo(() => (rows ?? []).map(r => r.id), [rows]);
  const pendingIds      = useMemo(() => (rows ?? []).filter(r => r.review_status === "pending_review").map(r => r.id), [rows]);
  const withWarningsIds = useMemo(() => (rows ?? []).filter(r => r.review_status === "pending_review" && (r.validation_status === "warned" || r.validation_status === "failed")).map(r => r.id), [rows]);
  const rejectedIds     = useMemo(() => (rows ?? []).filter(r => r.review_status === "rejected").map(r => r.id), [rows]);
  const conflictIds     = useMemo(() => (bulkResult?.conflict ?? []).map(c => c.id), [bulkResult]);

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
          <Button onClick={bulkApply} disabled={selected.size === 0 || bulkRunning || deleting}>
            {bulkRunning ? "Applying…" : `Apply ${selected.size} selected`}
          </Button>
          {isOwner && (
            <Button
              variant="outline"
              onClick={bulkDelete}
              disabled={selected.size === 0 || bulkRunning || deleting}
              className="text-rose-700 border-rose-300 hover:bg-rose-50 hover:text-rose-800 gap-1"
              title="Permanently delete the selected extractions (Owner only)"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting…" : `Delete ${selected.size}`}
            </Button>
          )}
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
        <>
          {/* Bulk-selection quick filters. Each button replaces the
              current selection with the named pool. "Add" combines.
              "Clear" wipes. The header checkbox still does the
              classic "all selectable" toggle. */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground mr-1">Select:</span>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setSelected(new Set(allRowIds))}
              disabled={allRowIds.length === 0}
              title="Select every row in the queue">
              All ({allRowIds.length})
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setSelected(new Set(pendingIds))}
              disabled={pendingIds.length === 0}
              title="Only rows still pending review">
              Pending ({pendingIds.length})
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setSelected(new Set(withWarningsIds))}
              disabled={withWarningsIds.length === 0}
              title="Pending rows that have validation warnings or errors">
              With warnings ({withWarningsIds.length})
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setSelected(new Set(conflictIds))}
              disabled={conflictIds.length === 0}
              title={conflictIds.length === 0
                ? "No conflicts from a recent bulk apply — run Apply first"
                : "Rows that came back as APPLY_TARGET_CONFLICT on the last bulk apply"}>
              Conflicted ({conflictIds.length})
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setSelected(new Set(rejectedIds))}
              disabled={rejectedIds.length === 0}
              title="Rows that have been rejected">
              Rejected ({rejectedIds.length})
            </Button>
            <span className="mx-1 text-muted-foreground">·</span>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}>
              Clear
            </Button>
            <span className="ml-auto text-muted-foreground">
              {selected.size} of {allRowIds.length} selected
            </span>
          </div>

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
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {renderPlan.map(item => {
                  if (item.kind === "single") {
                    const r = item.row;
                    return <ExtractionRow key={r.id} r={r} selected={selected} toggle={toggle} indent={false} />;
                  }
                  // Group row + (optionally) its children
                  const expanded = expandedBatches.has(item.batch_id);
                  const groupSelectableIds = item.rows
                    .filter(r => r.review_status === "pending_review" && r.validation_status !== "failed")
                    .map(r => r.id);
                  const allInGroupSelected = groupSelectableIds.length > 0 && groupSelectableIds.every(id => selected.has(id));
                  const someInGroupSelected = groupSelectableIds.some(id => selected.has(id));
                  return (
                    <React.Fragment key={item.batch_id}>
                      <tr className="border-b bg-blue-50/40 hover:bg-blue-50/60">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            disabled={groupSelectableIds.length === 0}
                            ref={el => { if (el) el.indeterminate = !allInGroupSelected && someInGroupSelected; }}
                            checked={allInGroupSelected}
                            onChange={(e) => setSelected(s => {
                              const n = new Set(s);
                              if (e.target.checked) groupSelectableIds.forEach(id => n.add(id));
                              else groupSelectableIds.forEach(id => n.delete(id));
                              return n;
                            })}
                            title={`Select all ${groupSelectableIds.length} pending row(s) in this batch`}
                          />
                        </td>
                        <td className="p-2" colSpan={7}>
                          <button
                            type="button"
                            onClick={() => toggleBatch(item.batch_id)}
                            className="flex items-center gap-2 text-left w-full hover:opacity-80"
                          >
                            {expanded
                              ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                            <Layers className="w-4 h-4 text-blue-600" />
                            <span className="font-medium text-xs">{item.parentLabel}</span>
                            <span className="text-[11px] text-muted-foreground">
                              · {item.rows.length} part{item.rows.length === 1 ? "" : "s"}
                              {item.applied  > 0 && <> · <span className="text-emerald-700">{item.applied} applied</span></>}
                              {item.pending  > 0 && <> · <span className="text-amber-700">{item.pending} pending</span></>}
                              {item.rejected > 0 && <> · <span className="text-rose-700">{item.rejected} rejected</span></>}
                              {item.failed   > 0 && <> · <span className="text-rose-700">{item.failed} failed validation</span></>}
                              {item.warned   > 0 && <> · <span className="text-amber-700">{item.warned} warned</span></>}
                            </span>
                            <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(item.sortAt)}</span>
                          </button>
                        </td>
                      </tr>
                      {expanded && item.rows.map(r => (
                        <ExtractionRow key={r.id} r={r} selected={selected} toggle={toggle} indent={true} />
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
        </>
      )}
    </div>
  );
}

// Single-row renderer used by both standalones and group children.
// indent=true adds left padding so children visually nest under their
// group header.
function ExtractionRow({ r, selected, toggle, indent }) {
  const errCount = (r.validation_issues ?? []).filter(i => i.severity === "error").length;
  const warnCount = (r.validation_issues ?? []).filter(i => i.severity === "warn").length;
  const canSelect = r.review_status === "pending_review" && r.validation_status !== "failed";
  // "editable" = the extraction's row data can still be modified.
  // Rejected extractions stay locked. Applied extractions are technically
  // editable (audit-only — see DetailView), so they show an Edit button
  // too but with a muted label.
  const editable = r.review_status !== "rejected";
  const isAppliedRow = !!r.applied_at;
  const hasIssues = errCount > 0 || warnCount > 0;
  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="p-2">
        <input type="checkbox" disabled={!canSelect} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
      </td>
      <td className={"p-2" + (indent ? " pl-8" : "")}>
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
      <td className="p-2 text-right">
        <Link to={`/AIExtractionReview?id=${r.id}`}>
          <Button
            size="sm"
            variant={editable && hasIssues && !isAppliedRow ? "default" : "outline"}
            className={`h-7 gap-1 text-[11px] ${editable && !isAppliedRow && errCount > 0 ? "bg-rose-600 hover:bg-rose-700 text-white" : ""}`}
            title={
              !editable
                ? "Open (rejected — read-only)"
                : isAppliedRow
                  ? "Open. Already applied — edits clear warnings on the audit record but do not change live tables."
                  : errCount > 0
                    ? "Open detail view to fix errors. Click any cell to edit; Enter saves, Esc cancels."
                    : warnCount > 0
                      ? "Open detail view to review warnings. Click any cell to edit."
                      : "Open detail view. Click any cell to edit."
            }
          >
            <Pencil className="w-3 h-3" />
            {!editable
              ? "View"
              : isAppliedRow
                ? (hasIssues ? "Edit (applied)" : "View")
                : (errCount > 0 ? "Fix errors" : warnCount > 0 ? "Edit warnings" : "Edit")}
          </Button>
        </Link>
      </td>
    </tr>
  );
}

/**
 * Compute the canonical selection-set key for a row in a given section.
 * Must match the rowKey functions inside MasterDataTables / TechPackTables /
 * the selection-init code in DetailView. If you add a section here, update
 * those callsites too.
 */
function computeRowKey(kind, section, row) {
  if (!row) return "";
  if (kind === "tech_pack") {
    if (section === "skus") return row.item_code ?? "";
    return ""; // other tech_pack sections aren't selectable
  }
  switch (section) {
    case "articles":
    case "carton_master":
    case "price_list":
      return row.item_code ?? "";
    case "fabric_consumption":
      return JSON.stringify({ item_code: row.item_code, component_type: row.component_type, color: row.color ?? "" });
    case "accessory_consumption":
      return JSON.stringify({ item_code: row.item_code, category: row.category, material: row.material ?? "", item_name: row.item_name ?? "" });
    case "suppliers":
    case "seasons":
    case "production_lines":
      return row.name ?? "";
    default:
      return "";
  }
}

function buildAllRowsFilter(extracted) {
  const f = {};
  if (Array.isArray(extracted?.articles) && extracted.articles.length)
    f.articles = extracted.articles.map(r => r.item_code).filter(Boolean);
  if (Array.isArray(extracted?.fabric_consumption) && extracted.fabric_consumption.length)
    f.fabric_consumption = extracted.fabric_consumption.map(r => ({ item_code: r.item_code, component_type: r.component_type, color: r.color ?? "" }));
  if (Array.isArray(extracted?.accessory_consumption) && extracted.accessory_consumption.length)
    f.accessory_consumption = extracted.accessory_consumption.map(r => ({ item_code: r.item_code, category: r.category, material: r.material ?? "", item_name: r.item_name ?? "" }));
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
      if (Array.isArray(ed.accessory_consumption)) next.accessory_consumption = new Set(ed.accessory_consumption.map(r => JSON.stringify({ item_code: r.item_code, category: r.category, material: r.material ?? "", item_name: r.item_name ?? "" })));
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

  /**
   * Propagate a single-row change in extracted_data to the live destination
   * table(s). Called from handleCellEdit / handleRowDelete after the audit
   * record (ai_extractions.extracted_data) is updated, but only when the
   * extraction has already been applied — otherwise there is no live row
   * to update.
   *
   * Returns { ok, err? }. Errors are surfaced via setApplyResult so the
   * operator sees them as a banner; we never silently fail.
   */
  async function propagateToLive({ section, oldRow, newRow, deleted }) {
    if (!ext.applied_at) return { ok: true }; // nothing live yet
    const kind = ext.kind;

    // Build the live UPDATE payload from a row mapping spec.
    const apply = async (table, matchClause, payload) => {
      let q = supabase.from(table).update(payload);
      for (const [k, v] of Object.entries(matchClause)) q = q.eq(k, v);
      const { error } = await q;
      if (error) throw error;
    };
    const remove = async (table, matchClause) => {
      let q = supabase.from(table).delete();
      for (const [k, v] of Object.entries(matchClause)) q = q.eq(k, v);
      const { error } = await q;
      if (error) throw error;
    };

    try {
      if (kind === "master_data") {
        if (section === "articles") {
          if (deleted) {
            await remove("articles", { article_code: oldRow.item_code });
            return { ok: true };
          }
          // Map every extraction field to its live column.
          const blob = (s) => null; // placeholder; SQL fn_is_multi_size_blob runs DB-side on apply, not here.
          const payload = {
            article_code:        newRow.item_code,
            article_name:        [newRow.brand, newRow.product_type, newRow.size].filter(Boolean).join(" - ") || newRow.item_code,
            size:                newRow.size ?? null,
            product_category:    newRow.product_type ?? null,
            pieces_per_carton:   newRow.units_per_carton == null || newRow.units_per_carton === "" ? null : Number(newRow.units_per_carton),
            carton_length:       newRow.carton_length_cm == null || newRow.carton_length_cm === "" ? null : Number(newRow.carton_length_cm),
            carton_width:        newRow.carton_width_cm  == null || newRow.carton_width_cm  === "" ? null : Number(newRow.carton_width_cm),
            carton_height:       newRow.carton_height_cm == null || newRow.carton_height_cm === "" ? null : Number(newRow.carton_height_cm),
            net_weight_per_pc:   newRow.net_weight_per_pc == null || newRow.net_weight_per_pc === "" ? null : Number(newRow.net_weight_per_pc),
            gross_weight_per_pc: newRow.gross_weight_per_pc == null || newRow.gross_weight_per_pc === "" ? null : Number(newRow.gross_weight_per_pc),
            product_dimensions:  newRow.product_dimensions ?? null,
            carton_size_cm:      newRow.carton_size_cm ?? null,
            stiffener_size:      newRow.stiffener_size ?? null,
            pvc_bag_dimensions:  newRow.pvc_bag_dimensions ?? null,
            insert_dimensions:   newRow.insert_dimensions ?? null,
            zipper_length_cm:    newRow.zipper_length_cm ?? null,
          };
          await apply("articles", { article_code: oldRow.item_code }, payload);
        } else if (section === "fabric_consumption") {
          const matchOld = { item_code: oldRow.item_code, kind: "fabric", component_type: oldRow.component_type, color: oldRow.color ?? "", material: "" };
          if (deleted) { await remove("consumption_library", matchOld); return { ok: true }; }
          const payload = {
            item_code:            newRow.item_code,
            component_type:       newRow.component_type,
            color:                newRow.color ?? "",
            fabric_type:          newRow.fabric_type ?? null,
            gsm:                  newRow.gsm == null || newRow.gsm === "" ? null : Number(newRow.gsm),
            width_cm:             newRow.width_cm == null || newRow.width_cm === "" ? null : Number(newRow.width_cm),
            consumption_per_unit: newRow.consumption_per_unit == null || newRow.consumption_per_unit === "" ? null : Number(newRow.consumption_per_unit),
            wastage_percent:      newRow.wastage_percent == null || newRow.wastage_percent === "" ? null : Number(newRow.wastage_percent),
          };
          await apply("consumption_library", matchOld, payload);
        } else if (section === "accessory_consumption") {
          const matchOld = {
            item_code: oldRow.item_code, kind: "accessory",
            component_type: oldRow.category, color: "",
            material: oldRow.material ?? "", item_name: oldRow.item_name ?? "",
          };
          if (deleted) { await remove("consumption_library", matchOld); return { ok: true }; }
          const payload = {
            item_code:            newRow.item_code,
            component_type:       newRow.category,
            material:             newRow.material ?? "",
            item_name:            newRow.item_name ?? "",
            size_spec:            newRow.size_spec ?? null,
            placement:            newRow.placement ?? null,
            supplier:             newRow.supplier ?? null,
            consumption_per_unit: newRow.consumption_per_unit == null || newRow.consumption_per_unit === "" ? null : Number(newRow.consumption_per_unit),
          };
          await apply("consumption_library", matchOld, payload);
        } else if (section === "carton_master") {
          if (deleted) { /* leave price_list row alone — no clean carton-only delete */ return { ok: true }; }
          const lwh = (k) => newRow[k] == null || newRow[k] === "" ? null : Number(newRow[k]);
          const payload = {
            item_code:      newRow.item_code,
            qty_per_carton: lwh("units_per_carton"),
            carton_length:  lwh("carton_length_cm"),
            carton_width:   lwh("carton_width_cm"),
            carton_height:  lwh("carton_height_cm"),
          };
          if (payload.carton_length != null && payload.carton_width != null && payload.carton_height != null) {
            payload.cbm_per_carton = +(payload.carton_length * payload.carton_width * payload.carton_height / 1_000_000).toFixed(4);
          }
          await apply("price_list", { item_code: oldRow.item_code }, payload);
        } else if (section === "price_list") {
          if (deleted) { return { ok: true }; }
          const payload = {
            item_code: newRow.item_code,
            price_usd: newRow.price_usd == null || newRow.price_usd === "" ? null : Number(newRow.price_usd),
            effective_from: newRow.effective_from || null,
          };
          await apply("price_list", { item_code: oldRow.item_code }, payload);
        } else if (section === "suppliers") {
          if (deleted) { await remove("suppliers", { name: oldRow.name }); return { ok: true }; }
          await apply("suppliers", { name: oldRow.name }, {
            name: newRow.name, email: newRow.contact_email ?? null, phone: newRow.contact_phone ?? null,
          });
        } else if (section === "seasons") {
          if (deleted) { await remove("seasons", { name: oldRow.name }); return { ok: true }; }
          await apply("seasons", { name: oldRow.name }, {
            name: newRow.name, start_date: newRow.start_date || null, end_date: newRow.end_date || null,
          });
        } else if (section === "production_lines") {
          if (deleted) { await remove("production_lines", { name: oldRow.name }); return { ok: true }; }
          await apply("production_lines", { name: oldRow.name }, {
            name: newRow.name,
            line_type: newRow.line_type || "stitching",
            daily_capacity: newRow.daily_capacity == null || newRow.daily_capacity === "" ? 0 : Number(newRow.daily_capacity),
          });
        }
      } else if (kind === "tech_pack") {
        const tpIds = Array.isArray(ext.applied_target_ids?.tech_packs) ? ext.applied_target_ids.tech_packs : [];

        if (section === "skus") {
          // Each sku ↔ one tech_packs row. Match by old article_code (most
          // reliable when a row was reordered or applied_target_ids ordering
          // can't be trusted). Fall back to the applied_target_ids[index].
          const oldCode = oldRow.item_code;
          let q = supabase.from("tech_packs").select("id").eq("article_code", oldCode);
          if (tpIds.length) q = q.in("id", tpIds);
          const { data: matches, error: selErr } = await q;
          if (selErr) throw selErr;
          if (deleted) {
            if (matches && matches.length) {
              const ids = matches.map(m => m.id);
              const { error } = await supabase.from("tech_packs").delete().in("id", ids);
              if (error) throw error;
            }
            return { ok: true };
          }
          if (!matches || matches.length === 0) {
            // No live row matched — likely the user edited a sku that wasn't
            // selected on apply. No-op.
            return { ok: true };
          }
          const newName = [ext.extracted_data?.header?.product_type, newRow.size, newRow.color].filter(Boolean).join(" - ") || newRow.item_code;
          const ids = matches.map(m => m.id);
          const { error: updErr } = await supabase
            .from("tech_packs")
            .update({
              article_code: newRow.item_code,
              article_name: newName,
              extracted_measurements: { this_sku: newRow },
            })
            .in("id", ids);
          if (updErr) throw updErr;
        } else if (["fabric_specs", "labels", "accessories", "packaging", "trims"].includes(section)) {
          // These are stored as section-wide jsonb on every tech_packs row
          // from this extraction. Update them all in one shot.
          if (tpIds.length === 0) return { ok: true };
          const colMap = {
            fabric_specs: "extracted_fabric_specs",
            labels:       "extracted_label_specs",
            accessories:  "extracted_accessory_specs",
            packaging:    "extracted_accessory_specs",   // merged with accessories at apply time
            trims:        "extracted_trim_specs",
          };
          const col = colMap[section];
          if (!col) return { ok: true };
          // For accessories/packaging, recompute the merged jsonb (accessories || packaging)
          let payloadValue;
          const ed = ext.extracted_data || {};
          if (col === "extracted_accessory_specs") {
            payloadValue = [...(ed.accessories ?? []), ...(ed.packaging ?? [])];
          } else {
            payloadValue = ed[section] ?? [];
          }
          const { error } = await supabase.from("tech_packs").update({ [col]: payloadValue }).in("id", tpIds);
          if (error) throw error;
        }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e };
    }
  }

  /**
   * Persist a patched extracted_data, re-validate it client-side, and update
   * the row in ai_extractions. Used by every cell-edit and row-delete.
   *
   * @param {(currentData: object) => object} patcher  function returning the next extracted_data
   * @param {string?} note                             short audit-log line appended to review_notes
   */
  async function persistExtractedDataChange(patcher, note) {
    const current = ext?.extracted_data ?? {};
    const next = patcher(current);
    if (next === current) return; // no-op

    // Re-run validator against the patched data so issues / status reflect reality.
    let validation;
    try {
      validation = validateExtraction(ext.kind, next);
    } catch (e) {
      console.warn("[edit] re-validation crashed; persisting without status update:", e);
      validation = null;
    }
    const patch = { extracted_data: next };
    if (validation) {
      patch.validation_issues = validation.issues;
      patch.validation_status = validation.status;
    }
    if (note) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      patch.review_notes = `${ext.review_notes ? ext.review_notes + "\n" : ""}[edit ${stamp}] ${note}`;
    }
    const { error } = await supabase
      .from("ai_extractions")
      .update(patch)
      .eq("id", extractionId);
    if (error) throw error;
    // Refresh detail view + queue list.
    qc.invalidateQueries({ queryKey: ["ai_extraction", extractionId] });
    qc.invalidateQueries({ queryKey: ["ai_extractions"] });
    return next;
  }

  /**
   * Edit a single cell (row[fieldKey] = newValue).
   * Section path can be a single key like "articles" or a tech_pack section
   * like "skus" / "fabric_specs" / "labels" / "accessories" / "packaging".
   * After save we also resync the corresponding selection set if the edit
   * touched a row-key field (so unticked rows don't suddenly become selected).
   */
  async function handleCellEdit(section, rowIndex, fieldKey, newValue) {
    const oldRow = ext?.extracted_data?.[section]?.[rowIndex];
    if (!oldRow) return;
    const oldKey = computeRowKey(ext.kind, section, oldRow);
    const newRow = { ...oldRow, [fieldKey]: newValue };
    await persistExtractedDataChange((d) => {
      const arr = Array.isArray(d[section]) ? d[section].slice() : [];
      if (rowIndex < 0 || rowIndex >= arr.length) return d;
      arr[rowIndex] = { ...arr[rowIndex], [fieldKey]: newValue };
      return { ...d, [section]: arr };
    }, `${section}[${rowIndex}].${fieldKey} = ${JSON.stringify(newValue)}`);

    // If the extraction has been applied, also push the change to live tables.
    if (ext.applied_at) {
      const res = await propagateToLive({ section, oldRow, newRow });
      if (!res.ok) {
        setApplyResult({ ok: false, code: "LIVE_SYNC_FAILED",
          user_message: `Edit saved on the extraction record but failed to propagate to live tables: ${res.err?.message ?? res.err}`,
        });
      } else {
        setApplyResult({ ok: true, code: "LIVE_SYNC_OK",
          user_message: `Edit saved and synced to live tables.`,
        });
      }
    }

    // If the edited field is part of the row key, the selection set entry
    // needs to be replaced with the new key so the row stays selected.
    const newKey = computeRowKey(ext.kind, section, newRow);
    if (oldKey !== newKey) {
      if (ext.kind === "tech_pack" && section === "skus") {
        setSelectedSkus((s) => {
          if (!s.has(oldKey)) return s;
          const n = new Set(s); n.delete(oldKey); n.add(newKey); return n;
        });
      } else if (ext.kind === "master_data") {
        setSelectedMaster((m) => {
          const set = m[section];
          if (!set || !set.has(oldKey)) return m;
          const n = new Set(set); n.delete(oldKey); n.add(newKey);
          return { ...m, [section]: n };
        });
      }
    }
  }

  /**
   * Delete a row from extracted_data[section] entirely. Re-derives the
   * selection set so trailing rows stay matched to their checkboxes.
   */
  async function handleRowDelete(section, rowIndex) {
    const oldRow = ext?.extracted_data?.[section]?.[rowIndex];
    if (!oldRow) return;
    const liveWarning = ext.applied_at ? "\n\nThe matching row in live tables will also be removed." : "";
    if (!confirm(`Delete this row from the extraction?${liveWarning}\n\nThe source file is unchanged. You can always re-extract.`)) return;
    const oldKey = computeRowKey(ext.kind, section, oldRow);
    await persistExtractedDataChange((d) => {
      const arr = Array.isArray(d[section]) ? d[section].slice() : [];
      if (rowIndex < 0 || rowIndex >= arr.length) return d;
      arr.splice(rowIndex, 1);
      return { ...d, [section]: arr };
    }, `${section}[${rowIndex}] deleted`);

    if (ext.applied_at) {
      const res = await propagateToLive({ section, oldRow, newRow: oldRow, deleted: true });
      if (!res.ok) {
        setApplyResult({ ok: false, code: "LIVE_SYNC_FAILED",
          user_message: `Row removed from extraction but failed to delete from live tables: ${res.err?.message ?? res.err}`,
        });
      } else {
        setApplyResult({ ok: true, code: "LIVE_SYNC_OK",
          user_message: `Row removed from extraction and live tables.`,
        });
      }
    }

    // Drop the deleted row's key from any active selection.
    if (ext.kind === "tech_pack" && section === "skus") {
      setSelectedSkus((s) => {
        if (!s.has(oldKey)) return s;
        const n = new Set(s); n.delete(oldKey); return n;
      });
    } else if (ext.kind === "master_data") {
      setSelectedMaster((m) => {
        const set = m[section];
        if (!set || !set.has(oldKey)) return m;
        const n = new Set(set); n.delete(oldKey);
        return { ...m, [section]: n };
      });
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
  // Editing stays available even after Apply so users can clear lingering
  // warnings from the audit record (e.g. "duplicate item_code" flagged on a
  // bob-parsed tech-pack where the same SKU appears under multiple sizes).
  // Edits to an applied extraction do NOT propagate back to live tables —
  // they only change the saved extraction record. We surface that caveat
  // in a banner so the operator knows the limitation.
  // Rejected extractions stay fully locked.
  const canEdit  = !isRejected;
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
        {/* Top-of-page action bar — mirrors the sticky bottom one so
            the user doesn't have to scroll past every section to find
            Apply / Reject. */}
        {canApply && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={() => setShowRejectDialog(true)}>
                Reject extraction
              </Button>
              {ext.kind === "tech_pack" && (
                <Button size="sm" onClick={() => handleApply()} disabled={selectedSkus.size === 0 || applying}>
                  {applying ? "Applying…" : `Apply ${selectedSkus.size} SKU${selectedSkus.size === 1 ? "" : "s"}`}
                </Button>
              )}
              {ext.kind === "master_data" && (
                <Button size="sm" onClick={() => handleApply()} disabled={applying || Object.values(selectedMaster).every(s => s.size === 0)}>
                  {applying ? "Applying…" : "Apply selected"}
                </Button>
              )}
            </div>
          </CardContent>
        )}
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

      {canEdit && !isApplied && (
        <div className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <Pencil className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div>
            <strong>Editing tips:</strong> click any cell to fix its value — <kbd className="px-1 bg-white border rounded text-[10px]">Enter</kbd> saves,
            <kbd className="px-1 bg-white border rounded text-[10px]"> Esc</kbd> cancels. Use the trash icon at the end of a row to drop it from the extraction.
            Edits re-validate automatically; once errors are gone the Apply button enables itself.
          </div>
        </div>
      )}
      {canEdit && isApplied && (
        <div className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div>
            <strong>Already applied — live edits enabled.</strong> Cell edits and row deletions on this extraction
            now sync directly to the matching live row in {ext.kind === "tech_pack" ? "Tech Packs" : "Articles / Consumption Library / Price List / Suppliers / Seasons / Production Lines"}.
            Each save shows a confirmation; if the live update fails, you'll see an error banner with details.
          </div>
        </div>
      )}

      {ext.kind === "tech_pack" && (
        <TechPackTables ext={ext} selectedSkus={selectedSkus} setSelectedSkus={setSelectedSkus} issuesByPath={issuesByPath}
          onCellEdit={canEdit ? handleCellEdit : null}
          onRowDelete={canEdit ? handleRowDelete : null} />
      )}
      {ext.kind === "master_data" && (
        <MasterDataTables ext={ext} selectedMaster={selectedMaster} setSelectedMaster={setSelectedMaster} issuesByPath={issuesByPath} conflictKeysBySection={conflictKeysBySection}
          onCellEdit={canEdit ? handleCellEdit : null}
          onRowDelete={canEdit ? handleRowDelete : null} />
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
                  if (Array.isArray(ed.accessory_consumption)) next.accessory_consumption = new Set(ed.accessory_consumption.map(r => JSON.stringify({ item_code: r.item_code, category: r.category, material: r.material ?? "", item_name: r.item_name ?? "" })));
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

function TechPackTables({ ext, selectedSkus, setSelectedSkus, issuesByPath, onCellEdit, onRowDelete }) {
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
  const sectionEdit   = (section) => onCellEdit   ? (i, k, v) => onCellEdit(section, i, k, v) : null;
  const sectionDelete = (section) => onRowDelete ? (i)        => onRowDelete(section, i)      : null;

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
          { key: "units_per_carton",   label: "Units/Carton", type: "number" },
          { key: "carton_size_cm",     label: "Carton (cm)" },
        ]}
        rowKey={(r) => r.item_code}
        pathPrefix="skus"
        issuesByPath={issuesByPath}
        selected={selectedSkus}
        onToggle={toggleSku}
        onCellEdit={sectionEdit("skus")}
        onRowDelete={sectionDelete("skus")}
      />
      {fabric.length > 0 && <SectionTable title="Fabric specs" rows={fabric} columns={fabricCols()} rowKey={(r, i) => `f${i}`} pathPrefix="fabric_specs" issuesByPath={issuesByPath}
        onCellEdit={sectionEdit("fabric_specs")} onRowDelete={sectionDelete("fabric_specs")} />}
      {labels.length > 0 && <SectionTable title="Labels" rows={labels} columns={labelCols()} rowKey={(r, i) => `l${i}`} pathPrefix="labels" issuesByPath={issuesByPath}
        onCellEdit={sectionEdit("labels")} onRowDelete={sectionDelete("labels")} />}
      {accessories.length > 0 && <SectionTable title="Accessories" rows={accessories} columns={accCols()} rowKey={(r, i) => `a${i}`} pathPrefix="accessories" issuesByPath={issuesByPath}
        onCellEdit={sectionEdit("accessories")} onRowDelete={sectionDelete("accessories")} />}
      {packaging.length > 0 && <SectionTable title="Packaging" rows={packaging} columns={pkgCols()} rowKey={(r, i) => `p${i}`} pathPrefix="packaging" issuesByPath={issuesByPath}
        onCellEdit={sectionEdit("packaging")} onRowDelete={sectionDelete("packaging")} />}
    </div>
  );
}

function MasterDataTables({ ext, selectedMaster, setSelectedMaster, issuesByPath, conflictKeysBySection, onCellEdit, onRowDelete }) {
  const ed = ext.extracted_data ?? {};

  const toggle = (section, key) => setSelectedMaster(m => {
    const next = { ...m };
    const set = new Set(next[section] ?? []);
    if (set.has(key)) set.delete(key); else set.add(key);
    next[section] = set;
    return next;
  });

  // Replace the entire selection set for one section. Used by the
  // SectionTable's quick-select toolbar (All / Clean / Warnings /
  // Conflicts / Clear).
  const replaceSection = (section, keys) => setSelectedMaster(m => ({
    ...m,
    [section]: new Set(keys),
  }));

  const sectionDef = [
    { name: "articles",              title: "Articles",                rows: ed.articles,              cols: articlesCols(),            keyFn: r => r.item_code },
    { name: "fabric_consumption",    title: "Fabric consumption",      rows: ed.fabric_consumption,    cols: fabricConsCols(),          keyFn: r => JSON.stringify({ item_code: r.item_code, component_type: r.component_type, color: r.color ?? "" }) },
    { name: "accessory_consumption", title: "Accessory consumption",   rows: ed.accessory_consumption, cols: accConsCols(),             keyFn: r => JSON.stringify({ item_code: r.item_code, category: r.category, material: r.material ?? "", item_name: r.item_name ?? "" }) },
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
          onReplaceSelection={(keys) => replaceSection(s.name, keys)}
          conflictKeys={conflictKeysBySection.get(s.name) ?? new Set()}
          onCellEdit={onCellEdit ? (i, k, v) => onCellEdit(s.name, i, k, v) : null}
          onRowDelete={onRowDelete ? (i) => onRowDelete(s.name, i) : null}
        />
      ))}
    </div>
  );
}

function SectionTable({ title, rows, columns, rowKey, pathPrefix, issuesByPath, selected, onToggle, onReplaceSelection, conflictKeys, readOnly, onCellEdit, onRowDelete }) {
  // The selection column (checkboxes + Quick-select toolbar) only appears
  // when the caller passes both `selected` and `onToggle`. The readOnly flag
  // is kept for backward compatibility with older calls but is no longer
  // required to hide the checkbox UI.
  const hasSelection = selected != null && onToggle != null && !readOnly;
  // Pre-compute the per-row severity + conflict-membership so the
  // toolbar buttons can derive their pools without a second pass.
  // Disabled rows (validation errors) are excluded from "All" /
  // "Clean" pools to match the row-level checkbox guard.
  const allKeys     = [];
  const cleanKeys   = []; // no errors AND no warnings
  const warnKeys    = []; // warning-only (no errors)
  const conflictRowKeys = [];
  for (let i = 0; i < rows.length; i++) {
    const k = rowKey(rows[i], i);
    const path = `${pathPrefix}[${i}]`;
    let hasErr = false, hasWarn = false;
    for (const [p, list] of issuesByPath.entries()) {
      if (p === path || p.startsWith(`${path}.`)) {
        for (const x of list) {
          if (x.severity === "error") hasErr = true;
          else if (x.severity === "warn") hasWarn = true;
        }
      }
    }
    if (!hasErr) allKeys.push(k);
    if (!hasErr && !hasWarn) cleanKeys.push(k);
    if (!hasErr && hasWarn) warnKeys.push(k);
    if (conflictKeys?.has(k) && !hasErr) conflictRowKeys.push(k);
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">
            {title} <span className="text-xs text-muted-foreground font-normal">({rows.length})</span>
          </CardTitle>
          {hasSelection && (
            <span className="text-xs text-muted-foreground font-normal">{selected.size} selected</span>
          )}
        </div>
        {hasSelection && onReplaceSelection && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs pt-2">
            <span className="text-muted-foreground mr-0.5">Quick-select:</span>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2"
              onClick={() => onReplaceSelection(allKeys)}
              disabled={allKeys.length === 0}>
              All ({allKeys.length})
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2"
              onClick={() => onReplaceSelection(cleanKeys)}
              disabled={cleanKeys.length === 0}
              title="Rows with no validation warnings or errors">
              Clean ({cleanKeys.length})
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2"
              onClick={() => onReplaceSelection(warnKeys)}
              disabled={warnKeys.length === 0}
              title="Rows with validation warnings (no errors)">
              Warnings ({warnKeys.length})
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2"
              onClick={() => onReplaceSelection(conflictRowKeys)}
              disabled={conflictRowKeys.length === 0}
              title="Rows that already exist in the live tables (will overwrite if applied with force)">
              Conflicts ({conflictRowKeys.length})
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-muted-foreground"
              onClick={() => onReplaceSelection([])}
              disabled={selected.size === 0}>
              Clear
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="border-b">
              {hasSelection && <th className="p-2 w-8"></th>}
              <th className="p-2 w-8"></th>
              {columns.map(c => <th key={c.key} className="p-2 text-left text-xs font-medium text-muted-foreground">{c.label}</th>)}
              {onRowDelete && <th className="p-2 w-8"></th>}
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
                  {hasSelection && (
                    <td className="p-2">
                      <input type="checkbox" disabled={hasError} checked={selected.has(k)} onChange={() => onToggle(k)} />
                    </td>
                  )}
                  <td className="p-2">
                    {hasError ? <XCircle className="w-4 h-4 text-rose-600" />
                     : hasWarn ? <AlertTriangle className="w-4 h-4 text-amber-600" />
                     : <CheckCircle2 className="w-4 h-4 text-green-600" />}
                    {isConflict && <span className="ml-1 inline-block text-[10px] font-bold text-amber-900">⚠ exists</span>}
                  </td>
                  {columns.map(c => (
                    <td key={c.key} className={`p-2 ${c.className ?? ""}`}>
                      {onCellEdit ? (
                        <EditableCell
                          value={r[c.key]}
                          type={c.type ?? "text"}
                          onSave={(v) => onCellEdit(i, c.key, v)}
                        />
                      ) : (
                        renderCell(r[c.key])
                      )}
                    </td>
                  ))}
                  {onRowDelete && (
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        onClick={() => onRowDelete(i)}
                        className="text-muted-foreground hover:text-rose-600 p-1"
                        title="Delete this row from the extraction"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
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

/**
 * Inline-editable cell. Click to edit, Enter or blur to save, Esc to cancel.
 *
 * `type` controls the input element:
 *   - "number"  → numeric input, coerces empty → null, "12.34" → 12.34
 *   - "text"    → string input
 *
 * Object-typed values (rare) and very long values fall back to a textarea.
 * Saves are async via onSave(newValue); the caller persists to DB and
 * re-validates. While saving the cell shows a small spinner.
 */
function EditableCell({ value, type = "text", onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState("");
  const [saving, setSaving]   = useState(false);

  const display = renderCell(value);
  const isObject = value != null && typeof value === "object";

  const startEdit = () => {
    if (disabled) return;
    setDraft(value == null ? "" : (isObject ? JSON.stringify(value) : String(value)));
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    let next = draft.trim();
    if (next === "") {
      next = null;
    } else if (type === "number") {
      const n = Number(next);
      if (!Number.isFinite(n)) {
        // Invalid number — bail without saving.
        setEditing(false);
        return;
      }
      next = n;
    }
    // No-op if unchanged
    const original = value == null ? null : (typeof value === "number" ? value : String(value));
    if (next === original) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } catch (e) {
      console.warn("[EditableCell] save failed:", e);
      // Leave the input open so the user can retry.
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(false);
  };

  const cancel = () => { setEditing(false); setDraft(""); };

  if (editing) {
    const isLong = typeof draft === "string" && draft.length > 60;
    const InputEl = isLong ? "textarea" : "input";
    return (
      <div className="flex items-center gap-1">
        <InputEl
          type={type === "number" ? "text" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          autoFocus
          disabled={saving}
          rows={isLong ? 3 : undefined}
          className={`w-full min-w-[80px] px-1.5 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary ${isLong ? "" : ""}`}
        />
        {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />}
      </div>
    );
  }

  return (
    <span
      onClick={startEdit}
      title={disabled ? "" : "Click to edit"}
      className={`inline-block min-w-[40px] ${disabled ? "" : "cursor-pointer hover:bg-amber-50 hover:ring-1 hover:ring-amber-300 rounded px-1 -mx-1"}`}
    >
      {display}
    </span>
  );
}

const fabricCols     = () => [
  { key: "component_type", label: "Component" },
  { key: "fabric_type",    label: "Fabric" },
  { key: "gsm",            label: "GSM",  type: "number" },
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
  { key: "gsm",                  label: "GSM",         type: "number" },
  { key: "width_cm",             label: "Width (cm)",  type: "number" },
  { key: "consumption_per_unit", label: "Cons/unit",   type: "number" },
  { key: "wastage_percent",      label: "Wastage",     type: "number" },
];
const accConsCols    = () => [
  { key: "item_code",            label: "Item Code", className: "font-mono text-xs" },
  { key: "category",             label: "Category" },
  { key: "material",             label: "Material" },
  { key: "size_spec",            label: "Size spec" },
  { key: "placement",            label: "Placement" },
  { key: "consumption_per_unit", label: "Cons/unit", type: "number" },
];
const cartonCols     = () => [
  { key: "item_code",        label: "Item Code", className: "font-mono text-xs" },
  { key: "units_per_carton", label: "Units/Carton", type: "number" },
  { key: "carton_length_cm", label: "L (cm)",       type: "number" },
  { key: "carton_width_cm",  label: "W (cm)",       type: "number" },
  { key: "carton_height_cm", label: "H (cm)",       type: "number" },
];
const priceCols      = () => [
  { key: "item_code",      label: "Item Code", className: "font-mono text-xs" },
  { key: "price_usd",      label: "Price (USD)", type: "number" },
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
  { key: "daily_capacity", label: "Capacity", type: "number" },
];
