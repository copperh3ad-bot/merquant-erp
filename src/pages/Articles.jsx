import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db, mfg } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layers, Plus, Trash2, Pencil, Search, Upload } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import FabricEditDialog from "@/components/fabric/FabricEditDialog";
import UploadFabricSheet from "@/components/fabric/UploadFabricSheet";
import { cn } from "@/lib/utils";
import POSelector from "@/components/shared/POSelector";
import { useArticleComponentUpdate } from "@/hooks/useArticleComponentUpdate";

const COMP_COLORS = ["bg-blue-100 text-blue-700","bg-violet-100 text-violet-700","bg-amber-100 text-amber-700","bg-emerald-100 text-emerald-700","bg-pink-100 text-pink-700","bg-cyan-100 text-cyan-700","bg-orange-100 text-orange-700"];

export default function Articles() {
  const [search, setSearch] = useState("");
  const [filterPoId, setFilterPoId] = useState("all");
  const [editingArticle, setEditingArticle] = useState(null);
  const qc = useQueryClient();

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["allArticles"],
    queryFn: async () => {
      // Load articles across all POs
      const { data, error } = await (await import("@/api/supabaseClient")).supabase
        .from("articles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useArticleComponentUpdate({
    invalidateKeys: [["allArticles"]],
    onSuccess: () => {
      // Per-PO cache key needs the current editingArticle's po_id, so
      // invalidate inside the callback where state is fresh.
      if (editingArticle?.po_id) {
        qc.invalidateQueries({ queryKey: ["articles", editingArticle.po_id] });
      }
      setEditingArticle(null);
    },
  });

  const handleSave = (data) => {
    updateMutation.mutate({
      id: editingArticle.id,
      data,
      // Siblings are searched across the global articles pool so that
      // editing here propagates the same way it does on FabricWorking.
      allArticles: articles,
    });
  };

  const handleDelete = async (id, poId) => {
    if (!confirm("Delete this article? Fabric components will be lost.")) return;
    await mfg.articles.delete(id);
    qc.invalidateQueries({ queryKey: ["allArticles"] });
    qc.invalidateQueries({ queryKey: ["articles", poId] });
  };

  const filtered = useMemo(() => articles.filter(a => {
    const mp = filterPoId === "all" || a.po_id === filterPoId;
    const mq = !search ||
      a.article_code?.toLowerCase().includes(search.toLowerCase()) ||
      a.article_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.po_number?.toLowerCase().includes(search.toLowerCase());
    return mp && mq;
  }), [articles, filterPoId, search]);

  const stats = useMemo(() => ({
    total: articles.length,
    withComponents: articles.filter(a => (a.components||[]).length > 0).length,
    noComponents: articles.filter(a => (a.components||[]).length === 0).length,
    totalFabric: +articles.reduce((s, a) => s + (a.total_fabric_required||0), 0).toFixed(2),
  }), [articles]);

  if (isLoading) return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{[1,2,3,4].map(i=><Skeleton key={i} className="h-36 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Layers className="h-5 w-5 text-primary"/>
          <h1 className="text-base font-bold">Articles</h1>
          <span className="text-xs text-muted-foreground">{articles.length} total</span>
        </div>
        <UploadFabricSheet onSuccess={() => qc.invalidateQueries({ queryKey: ["allArticles"] })}/>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Total Articles",    stats.total,          "bg-primary/10 text-primary"],
          ["With Components",   stats.withComponents, "bg-emerald-50 text-emerald-700"],
          ["No Components",     stats.noComponents,   stats.noComponents > 0 ? "bg-amber-50 text-amber-700" : "bg-muted/50 text-muted-foreground"],
          ["Total Fabric (m)",  stats.totalFabric,    "bg-blue-50 text-blue-700"],
        ].map(([label, value, cls]) => (
          <div key={label} className={cn("rounded-xl p-3", cls)}>
            <p className="text-xl font-bold">{typeof value === "number" && value > 999 ? value.toLocaleString() : value}</p>
            <p className="text-xs mt-0.5 opacity-80">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search code, name, PO…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
        <Select value={filterPoId} onValueChange={setFilterPoId}>
          <SelectTrigger className="w-56 h-9 text-sm"><SelectValue placeholder="All POs"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All POs</SelectItem>
            {pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Article grid */}
      {filtered.length === 0 ? (
        <EmptyState icon={Layers} title="No articles found" description="Articles are created automatically when POs are imported. Use 'Upload Sheet' to add fabric specs in bulk."/>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(article => {
            const po = pos.find(p => p.id === article.po_id);
            const comps = article.components || [];
            const hasComps = comps.length > 0;
            return (
              <Card key={article.id} className={cn("hover:shadow-sm transition-shadow", !hasComps && "border-amber-200 bg-amber-50/20")}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-semibold truncate">{article.article_name}</CardTitle>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {article.article_code && <span className="text-[11px] font-mono text-muted-foreground">{article.article_code}</span>}
                        {article.color && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{article.color}</span>}
                        {po && <span className="text-[10px] text-primary">{po.po_number}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingArticle(article)}>
                        <Pencil className="h-3.5 w-3.5"/>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(article.id, article.po_id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground"/>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {/* Key metrics */}
                  <div className="flex items-center gap-4 text-xs">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Qty</p>
                      <p className="font-semibold">{(article.order_quantity||0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Fabric</p>
                      <p className="font-semibold">{article.total_fabric_required?.toFixed(2) || "—"} m</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Components</p>
                      <p className={cn("font-semibold", !hasComps && "text-amber-600")}>{comps.length}</p>
                    </div>
                  </div>

                  {/* Component badges */}
                  {hasComps ? (
                    <div className="flex flex-wrap gap-1.5">
                      {comps.map((c, i) => (
                        <span key={i} className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", COMP_COLORS[i % COMP_COLORS.length])}>
                          {c.component_type}: {c.total_required?.toFixed(2)||"0"} m
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <Upload className="h-3.5 w-3.5 shrink-0"/>
                      <span>No fabric specs — upload sheet or edit manually</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit dialog */}
      {editingArticle && (
        <FabricEditDialog
          open={!!editingArticle}
          onOpenChange={v => { if (!v) setEditingArticle(null); }}
          article={editingArticle}
          onSave={handleSave}
          saving={updateMutation.isPending}
        />
      )}
    </div>
  );
}

