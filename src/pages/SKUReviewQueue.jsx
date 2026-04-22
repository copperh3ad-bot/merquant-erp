import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { mfg, skuQueue, db } from "@/api/supabaseClient";
import { applyTemplateToArticle } from "@/lib/skuMatcher";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle, CheckCircle2, SkipForward, Search,
  Sparkles, Clock, Eye, ChevronRight, Package,
  Loader2, Filter, RefreshCw, ClipboardList
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import SKUReviewDialog from "@/components/po/SKUReviewDialog";

const STATUS_STYLES = {
  pending:      { cls: "bg-amber-50 text-amber-700 border-amber-200",  label: "Pending Review" },
  ai_suggested: { cls: "bg-violet-50 text-violet-700 border-violet-200", label: "AI Suggested" },
  approved:     { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Approved" },
  skipped:      { cls: "bg-gray-50 text-gray-500 border-gray-200",     label: "Skipped" },
};

const MATCH_STYLES = {
  exact:        "bg-emerald-50 text-emerald-700",
  fuzzy:        "bg-blue-50 text-blue-700",
  ai_suggested: "bg-violet-50 text-violet-700",
  new:          "bg-red-50 text-red-700",
};

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };

function QueueCard({ item, onReview, onSkip, reviewing, canApprove }) {
  const statusCfg = STATUS_STYLES[item.status] || STATUS_STYLES.pending;
  const isPending = item.status === "pending" || item.status === "ai_suggested";

  return (
    <div className={cn(
      "border rounded-xl p-4 transition-all",
      isPending ? "border-amber-200 bg-amber-50/20 hover:bg-amber-50/40" : "border-border bg-card"
    )}>
      <div className="flex items-start gap-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
          isPending ? "bg-amber-100" : "bg-muted"
        )}>
          {isPending
            ? <AlertTriangle className="h-4 w-4 text-amber-600"/>
            : <CheckCircle2 className="h-4 w-4 text-emerald-500"/>
          }
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-bold text-foreground">{item.item_code || "(no code)"}</span>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusCfg.cls)}>
              {statusCfg.label}
            </span>
            {item.match_type && (
              <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", MATCH_STYLES[item.match_type] || "bg-gray-100 text-gray-600")}>
                {item.match_type === "new" ? "New SKU" : item.match_type === "ai_suggested" ? "AI guess" : item.match_type === "fuzzy" ? "Fuzzy match" : "Exact"}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground truncate max-w-xl mb-1">{item.item_description || "—"}</p>

          <div className="flex flex-wrap gap-4 text-xs mt-2">
            <div><span className="text-muted-foreground">PO:</span> <span className="font-medium">{item.po_number}</span></div>
            <div><span className="text-muted-foreground">Qty:</span> <span className="font-medium">{(item.order_quantity || 0).toLocaleString()} pcs</span></div>
            {item.matched_template_code && (
              <div><span className="text-muted-foreground">Template:</span> <span className="font-medium text-violet-700">{item.matched_template_code}</span></div>
            )}
            {(item.suggested_components?.length || 0) > 0 && (
              <div><span className="text-muted-foreground">Suggested comps:</span> <span className="font-medium">{item.suggested_components.length}</span></div>
            )}
            <div><span className="text-muted-foreground">Added:</span> <span className="font-medium">{fmt(item.created_at)}</span></div>
          </div>

          {item.notes && (
            <div className="mt-2 text-xs text-muted-foreground italic bg-muted/40 rounded px-2 py-1 inline-block max-w-xl">
              {item.notes}
            </div>
          )}
        </div>

        {isPending && (
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => onSkip(item)} disabled={reviewing === item.id}>
              <SkipForward className="h-3 w-3"/> Skip
            </Button>
            <Button size="sm" className="text-xs h-7 gap-1 bg-amber-500 hover:bg-amber-600 text-white" onClick={() => onReview(item)} disabled={reviewing === item.id}>
              {reviewing === item.id ? <Loader2 className="h-3 w-3 animate-spin"/> : <Eye className="h-3 w-3"/>}
              Review
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SKUReviewQueue() {
  const [filterStatus, setFilterStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState(null);    // item being reviewed
  const [reviewingId, setReviewingId] = useState(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canApprove = can("SKU_APPROVE");

  const { data: queue = [], isLoading, refetch } = useQuery({
    queryKey: ["skuQueue"],
    queryFn: () => skuQueue.list(),
    refetchInterval: 30000,
  });

  const filtered = useMemo(() => queue.filter(item => {
    const matchStatus = filterStatus === "all" || item.status === filterStatus || (filterStatus === "pending" && item.status === "ai_suggested");
    const matchSearch = !search || item.item_code?.toLowerCase().includes(search.toLowerCase()) || item.item_description?.toLowerCase().includes(search.toLowerCase()) || item.po_number?.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  }), [queue, filterStatus, search]);

  const counts = useMemo(() => ({
    pending: queue.filter(i => i.status === "pending" || i.status === "ai_suggested").length,
    approved: queue.filter(i => i.status === "approved").length,
    skipped: queue.filter(i => i.status === "skipped").length,
    total: queue.length,
  }), [queue]);

  // ── Approve: save components to article, optionally save template ──────
  const handleApprove = async (item, components, saveAsTemplate) => {
    // 1. Find or create the article record
    let articleId = item.article_id;
    if (!articleId) {
      // Check if article already exists for this PO item
      const existing = await mfg.articles.listByPO(item.po_id);
      const match = existing.find(a => a.article_code === item.item_code || a.article_name === item.item_description);
      if (match) {
        articleId = match.id;
      } else {
        // Create new article
        const newArt = await mfg.articles.create({
          po_id: item.po_id,
          po_number: item.po_number,
          article_code: item.item_code,
          article_name: item.item_description || item.item_code,
          order_quantity: item.order_quantity,
          components: [],
        });
        articleId = newArt.id;
      }
    }

    // 2. Apply components to article
    const total_fabric_required = +components.reduce((s, c) => s + (c.total_required || 0), 0).toFixed(4);
    await mfg.articles.update(articleId, { components, total_fabric_required });

    // 3. Save as fabric template if requested
    if (saveAsTemplate && item.item_code) {
      await mfg.fabricTemplates.upsert({
        article_code: item.item_code,
        article_name: item.item_description || item.item_code,
        components: components.map(({ total_required, net_total, ...rest }) => rest),
      });
    }

    // 4. Mark queue item as approved
    await skuQueue.update(item.id, {
      status: "approved",
      article_id: articleId,
      reviewed_at: new Date().toISOString(),
    });

    qc.invalidateQueries({ queryKey: ["skuQueue"] });
    qc.invalidateQueries({ queryKey: ["articles", item.po_id] });
    qc.invalidateQueries({ queryKey: ["allArticles"] });
    setReviewing(null);
  };

  const handleSkip = async (item) => {
    await skuQueue.update(item.id, { status: "skipped", reviewed_at: new Date().toISOString() });
    qc.invalidateQueries({ queryKey: ["skuQueue"] });
    if (reviewing?.id === item.id) setReviewing(null);
  };

  const handleReview = (item) => {
    setReviewingId(item.id);
    setReviewing(item);
  };

  // ── Approve all AI-suggested items that have components ─────────────────
  const handleBulkApproveAI = async () => {
    const aiItems = queue.filter(i => i.status === "ai_suggested" && (i.suggested_components || []).length > 0);
    if (!aiItems.length) return;
    if (!confirm(`Approve ${aiItems.length} AI-suggested SKU(s) using their suggested components?`)) return;
    for (const item of aiItems) {
      await handleApprove(item, item.suggested_components, true);
    }
  };

  const aiSuggestedCount = queue.filter(i => i.status === "ai_suggested" && (i.suggested_components || []).length > 0).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary"/>
            SKU Review Queue
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Unknown SKUs waiting for human approval of fabric specs before entering production
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}/> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Pending review",  value: counts.pending,  cls: "bg-amber-50 text-amber-800",   icon: AlertTriangle },
          { label: "AI suggested",    value: queue.filter(i=>i.status==="ai_suggested").length, cls: "bg-violet-50 text-violet-800", icon: Sparkles },
          { label: "Approved",        value: counts.approved, cls: "bg-emerald-50 text-emerald-800", icon: CheckCircle2 },
          { label: "Total SKUs",      value: counts.total,    cls: "bg-muted/50 text-foreground",  icon: Package },
        ].map(({ label, value, cls, icon: Icon }) => (
          <div key={label} className={cn("rounded-xl p-4", cls)}>
            <div className="flex items-center justify-between">
              <p className="text-2xl font-bold">{value}</p>
              <Icon className="h-5 w-5 opacity-50"/>
            </div>
            <p className="text-xs mt-1 opacity-80">{label}</p>
          </div>
        ))}
      </div>

      {/* Actions banner for AI suggested */}
      {aiSuggestedCount > 0 && (
        <div className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600"/>
            <p className="text-sm font-medium text-violet-800">
              {aiSuggestedCount} SKU{aiSuggestedCount !== 1 ? "s" : ""} have AI-suggested components ready to approve
            </p>
          </div>
          {canApprove && (
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white text-xs gap-1.5" onClick={handleBulkApproveAI}>
              <CheckCircle2 className="h-3.5 w-3.5"/> Approve All AI Suggestions
            </Button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search SKU code, description, PO…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            ["pending",  "Needs Review", counts.pending],
            ["approved", "Approved",     counts.approved],
            ["skipped",  "Skipped",      counts.skipped],
            ["all",      "All",          counts.total],
          ].map(([val, label, count]) => (
            <button key={val} onClick={() => setFilterStatus(val)}
              className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
                filterStatus === val
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              )}>
              {label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Queue list */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse"/>)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={filterStatus === "pending" ? AlertTriangle : ClipboardList}
          title={filterStatus === "pending" ? "No SKUs pending review" : "No items in this category"}
          description={
            filterStatus === "pending"
              ? "All SKUs have been reviewed. New unknown SKUs will appear here when POs are imported."
              : "Try a different filter."
          }
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{filtered.length} item{filtered.length !== 1 ? "s" : ""}</p>
          {filtered.map(item => (
            <QueueCard key={item.id} item={item} onReview={handleReview} onSkip={handleSkip} reviewing={reviewingId} canApprove={canApprove}/>
          ))}
        </div>
      )}

      <SKUReviewDialog
        open={!!reviewing}
        onOpenChange={v => { if (!v) { setReviewing(null); setReviewingId(null); } }}
        queueItem={reviewing}
        onApprove={async (item, comps, saveTemplate) => {
          await handleApprove(item, comps, saveTemplate);
          setReviewingId(null);
        }}
        onSkip={async (item) => {
          await handleSkip(item);
          setReviewingId(null);
        }}
      />
    </div>
  );
}

