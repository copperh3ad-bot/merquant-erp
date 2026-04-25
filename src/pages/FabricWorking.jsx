import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, mfg, supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import PermissionGate from "@/components/shared/PermissionGate";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers, Grid, List, Pencil, Plus, Download, FileText, Printer, Trash2, RefreshCw, Lock } from "lucide-react";
import { jsPDF } from "jspdf";
import FabricEditDialog from "@/components/fabric/FabricEditDialog";
import ArticleFabricSetup from "@/components/fabric/ArticleFabricSetup";
import EmptyState from "@/components/shared/EmptyState";
import { getColorLabel, getBaseCode } from "@/lib/articleUtils";
import { useArticleComponentUpdate } from "@/hooks/useArticleComponentUpdate";
import { isFabricComponentWithWarn } from "@/lib/fabricClassifier";

// Session 10 — Fabric Working is the source of the printout handed to Union
// Fabrics central-ERP data-entry operators. It must show fabric components
// ONLY. Accessories, trims, and packaging are rendered on the Accessories and
// Trims pages. The classifier lives in @/lib/fabricClassifier.js and is
// fail-closed: if a component cannot be positively identified as fabric, it
// is excluded from this sheet (and a console.warn flags it for review).
const isFabricComponent = isFabricComponentWithWarn;

// ─────────────────────────────────────────────────────────────────────────────
// Dimensions feature (2026-04) — garment/article size dimensions such as
// "FULL = 54x75x11\"" are surfaced from three sources in priority order:
//
//   1. articles.product_dimensions        — direct manual override
//   2. tech_packs.size_chart by item_code — covers family tech packs where a
//      single tech pack row contains dimensions for many sibling SKUs keyed
//      by their item_code (the common BOB pattern)
//   3. tech_packs.size_chart by article_code + product_size — legacy path for
//      tech packs that were stored under the article's own code and keyed by
//      human-readable size
//
// This layered approach means we don't lose coverage when a tech pack is stored
// under one article_code but contains dimensions for its entire family.
// ─────────────────────────────────────────────────────────────────────────────

const normalizeSizeKey = (s) => String(s == null ? "" : s).trim().toUpperCase();

export default function FabricWorking() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("po_id") || "");
  const [viewMode, setViewMode] = useState("combined");
  const [editingArticle, setEditingArticle] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [showAddArticle, setShowAddArticle] = useState(false);

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const activePo = useMemo(() => selectedPoId ? pos.find(p => p.id === selectedPoId) : pos[0], [pos, selectedPoId]);

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["articles", activePo?.id],
    queryFn: () => mfg.articles.listByPO(activePo.id),
    enabled: !!activePo?.id,
  });

  // Load every tech pack that could contain dimensions for articles in this
  // PO. We cannot filter by article_code alone — a family tech pack stored
  // under GPMP50 contains dimensions for GPMP33, GPMP38, etc. — so we fetch
  // all tech packs and build two indexes: one by item_code inside size_chart,
  // and one by (tech_pack.article_code, size).
  const { data: dimsIndex } = useQuery({
    queryKey: ["dimsIndex", activePo?.id],
    enabled: !!activePo?.id && (articles?.length || 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tech_packs")
        .select("article_code, extracted_measurements, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // byItemCode:    Map<ITEM_CODE, product_dimensions string>
      // byCodeSize:    Map<ARTICLE_CODE, Map<SIZE, product_dimensions string>>
      // byItemPart:    Map<ITEM_CODE, Map<PART_NAME, product_dimensions string>>
      // byCodeSizePart: Map<ARTICLE_CODE, Map<SIZE, Map<PART_NAME, product_dimensions string>>>
      // The "Part" indexes are populated when size_chart entries include
      // `part_dimensions` (sheet-set tech packs where each part — Flat Sheet,
      // Fitted Sheet, Pillow Case — has its own dimension).
      const byItemCode = new Map();
      const byCodeSize = new Map();
      const byItemPart = new Map();
      const byCodeSizePart = new Map();

      for (const tp of data || []) {
        const chart = tp?.extracted_measurements?.size_chart;
        if (!chart || typeof chart !== "object") continue;

        if (!byCodeSize.has(tp.article_code)) byCodeSize.set(tp.article_code, new Map());
        if (!byCodeSizePart.has(tp.article_code)) byCodeSizePart.set(tp.article_code, new Map());
        const sizeMap = byCodeSize.get(tp.article_code);
        const sizePartMap = byCodeSizePart.get(tp.article_code);

        for (const [sizeRaw, row] of Object.entries(chart)) {
          const dim = row?.product_dimensions;
          const parts = row?.part_dimensions;
          const sizeKey = normalizeSizeKey(sizeRaw);
          const itemCode = row?.item_code;

          if (dim) {
            // First-seen wins (results are ordered by created_at DESC so most
            // recent tech pack is authoritative).
            if (!sizeMap.has(sizeKey)) sizeMap.set(sizeKey, String(dim));
            if (itemCode && !byItemCode.has(itemCode)) byItemCode.set(itemCode, String(dim));
          }

          if (parts && typeof parts === "object") {
            if (!sizePartMap.has(sizeKey)) sizePartMap.set(sizeKey, new Map());
            const partMap = sizePartMap.get(sizeKey);
            for (const [partName, partDim] of Object.entries(parts)) {
              if (!partDim) continue;
              const partKey = normalizeSizeKey(partName);
              if (!partMap.has(partKey)) partMap.set(partKey, String(partDim));
              if (itemCode) {
                if (!byItemPart.has(itemCode)) byItemPart.set(itemCode, new Map());
                const ipm = byItemPart.get(itemCode);
                if (!ipm.has(partKey)) ipm.set(partKey, String(partDim));
              }
            }
          }
        }

        // Fallback: some older tech packs only populate a single this_sku row.
        const only = tp?.extracted_measurements?.this_sku;
        if (only?.product_dimensions) {
          if (only.item_code && !byItemCode.has(only.item_code)) {
            byItemCode.set(only.item_code, String(only.product_dimensions));
          }
          if (only.size) {
            const k = normalizeSizeKey(only.size);
            if (!sizeMap.has(k)) sizeMap.set(k, String(only.product_dimensions));
          }
        }
      }
      return { byItemCode, byCodeSize, byItemPart, byCodeSizePart };
    },
  });

  // Resolve product_dimensions for an article/component pair using the layered
  // priority described at the top of the file. Returns "" if nothing is known,
  // which renders as a dash in the UI. The optional `part` argument (e.g.
  // "Flat Sheet", "Fitted Sheet", "Pillow Case") narrows the lookup to that
  // specific component for sheet-set tech packs that store per-part dimensions.
  const resolveDims = (article, productSize, part) => {
    // Layer 1: direct manual override on the article row.
    if (article?.product_dimensions) return String(article.product_dimensions);
    if (!dimsIndex) return "";

    const partKey = part ? normalizeSizeKey(part) : null;

    // Layer 2a: per-part item_code match (sheet-set tech packs).
    if (partKey && article?.article_code && dimsIndex.byItemPart?.has(article.article_code)) {
      const partMap = dimsIndex.byItemPart.get(article.article_code);
      const hit = partMap.get(partKey);
      if (hit) return hit;
    }

    // Layer 2b: item_code match (whole-SKU dimension, family tech packs).
    if (article?.article_code && dimsIndex.byItemCode.has(article.article_code)) {
      return dimsIndex.byItemCode.get(article.article_code);
    }

    // Layer 3a: per-part (article_code, size) match.
    if (partKey && article?.article_code && productSize) {
      const sizePartMap = dimsIndex.byCodeSizePart?.get(article.article_code);
      if (sizePartMap) {
        const partMap = sizePartMap.get(normalizeSizeKey(productSize));
        if (partMap) {
          const hit = partMap.get(partKey);
          if (hit) return hit;
        }
      }
    }

    // Layer 3b: legacy (article_code, size) match.
    if (article?.article_code && productSize) {
      const sizeMap = dimsIndex.byCodeSize.get(article.article_code);
      if (sizeMap) {
        const hit = sizeMap.get(normalizeSizeKey(productSize));
        if (hit) return hit;
      }
    }
    return "";
  };

  // Annotate components with their article_code so the classifier's
  // fail-closed console warning can identify WHICH article has a row with an
  // unknown component_type. Small helper used everywhere we filter.
  const fabricComponentsOf = (art) =>
    (art?.components || [])
      .map(c => ({ ...c, __article_code: art?.article_code || null }))
      .filter(isFabricComponent);

  const combinedGroups = useMemo(() => {
    const groups = {};
    articles.forEach(art => {
      const key = getBaseCode(art);
      if (!groups[key]) groups[key] = { key, articles: [], totalQty: 0, template: art };
      groups[key].articles.push(art);
      groups[key].totalQty += (art.order_quantity || 0);
    });
    return Object.values(groups).map(g => ({
      ...g,
      displayName: g.key || g.template.article_name,
      colors: g.articles.map(a => getColorLabel(a)).join(", "),
      components: fabricComponentsOf(g.template).map(c => ({
        ...c,
        net_total: +((c.consumption_per_unit || 0) * g.totalQty).toFixed(4),
        total_required: +((c.consumption_per_unit || 0) * g.totalQty * (1 + (c.wastage_percent || 6) / 100)).toFixed(4),
      })),
    }));
  }, [articles]);

  const colorGroups = useMemo(() => {
    const groups = {};
    articles.forEach(art => {
      const color = getColorLabel(art);
      if (!groups[color]) groups[color] = [];
      groups[color].push(art);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [articles]);

  const fabricSummary = useMemo(() => {
    const map = {};
    articles.forEach(art => {
      fabricComponentsOf(art).forEach(comp => {
        const key = `${comp.fabric_type}||${comp.width}`;
        if (!map[key]) map[key] = { fabric_type: comp.fabric_type, width: comp.width, net_total: 0, total_with_wastage: 0 };
        const net = (comp.consumption_per_unit || 0) * (art.order_quantity || 0);
        const total = comp.total_required || net * (1 + (comp.wastage_percent || 0) / 100);
        map[key].net_total += net;
        map[key].total_with_wastage += total;
      });
    });
    return Object.values(map);
  }, [articles]);

  const colorFabricSummary = useMemo(() => colorGroups.map(([color, arts]) => {
    const map = {};
    arts.forEach(art => {
      fabricComponentsOf(art).forEach(comp => {
        const key = `${comp.fabric_type}||${comp.width}`;
        if (!map[key]) map[key] = { fabric_type: comp.fabric_type, width: comp.width, net_total: 0, total_with_wastage: 0 };
        const net = (comp.consumption_per_unit || 0) * (art.order_quantity || 0);
        const total = comp.total_required || net * (1 + (comp.wastage_percent || 0) / 100);
        map[key].net_total += net;
        map[key].total_with_wastage += total;
      });
    });
    return { color, items: Object.values(map) };
  }).filter(g => g.items.length > 0), [colorGroups]);

  const updateMutation = useArticleComponentUpdate({
    invalidateKeys: [["articles", activePo?.id], ["allArticles"]],
    onSuccess: () => setEditingArticle(null),
  });

  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshFromTechPacks = async () => {
    if (!activePo) return;
    if (!confirm("Refresh fabric components for all articles in this PO from their tech packs?\n\nAccessory / trim / packaging rows on each article will be PRESERVED.")) return;
    setRefreshing(true);
    try {
      const codes = articles.map(a => a.article_code).filter(Boolean);
      if (!codes.length) { alert("No article codes to match."); return; }
      const { data: tps } = await supabase
        .from("tech_packs")
        .select("article_code, fabric_specs")
        .in("article_code", codes)
        .order("created_at", { ascending: false });
      const tpByCode = new Map();
      for (const tp of tps || []) {
        if (!tpByCode.has(tp.article_code)) tpByCode.set(tp.article_code, tp);
      }
      let updated = 0, skipped = 0, preservedAccessoryRows = 0;
      for (const art of articles) {
        const tp = tpByCode.get(art.article_code);
        if (!tp?.fabric_specs?.length) { skipped++; continue; }
        const qty = art.order_quantity || 0;
        const freshFabric = tp.fabric_specs
          .filter(fs => fs.component_type)
          .map(fs => {
            const consumption = Number(fs.consumption_per_unit) || 0;
            const wastage = Number(fs.wastage_percent) || 6;
            const net = consumption * qty;
            return {
              kind: "fabric",
              component_type: fs.component_type,
              fabric_type: fs.fabric_type || null,
              gsm: Number(fs.gsm) || null,
              width: Number(fs.width_cm) || null,
              consumption_per_unit: consumption,
              wastage_percent: wastage,
              color: fs.color || null,
              finish: fs.finish || null,
              construction: fs.construction || null,
              net_total: +net.toFixed(4),
              total_required: +(net * (1 + wastage / 100)).toFixed(4),
            };
          });
        if (!freshFabric.length) { skipped++; continue; }

        const existingNonFabric = (art.components || []).filter(c => !isFabricComponent({ ...c, __article_code: art.article_code }));
        preservedAccessoryRows += existingNonFabric.length;
        const components = [...existingNonFabric, ...freshFabric];

        const total_fabric_required = +freshFabric.reduce((s, c) => s + (c.total_required || 0), 0).toFixed(4);
        await mfg.articles.update(art.id, { components, total_fabric_required });
        updated++;
      }
      qc.invalidateQueries({ queryKey: ["articles", activePo.id] });
      qc.invalidateQueries({ queryKey: ["allArticles"] });
      qc.invalidateQueries({ queryKey: ["dimsIndex", activePo.id] });
      alert(`${updated} article${updated !== 1 ? "s" : ""} updated · ${skipped} skipped (no tech pack) · ${preservedAccessoryRows} accessory/trim row${preservedAccessoryRows !== 1 ? "s" : ""} preserved`);
    } catch (e) {
      alert("Failed: " + e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteArticle = async (id) => {
    if (!confirm("Delete this article?")) return;
    await mfg.articles.delete(id);
    qc.invalidateQueries({ queryKey: ["articles", activePo?.id] });
    qc.invalidateQueries({ queryKey: ["allArticles"] });
  };

  const handleDownloadCSV = () => {
    const rows = [["PO", activePo?.po_number, "Customer", activePo?.customer_name], []];
    rows.push(["Article", "Colors", "Total Qty", "Part", "Prod Size", "Dimensions", "Direction", "Fabrication", "Width cm", "Cut/Unit m", "Net Mtrs", "Wastage%", "Total Mtrs"]);
    combinedGroups.forEach(g => {
      g.components.forEach((comp, i) => {
        const dims = resolveDims(g.template, comp.product_size, comp.component_type);
        rows.push([
          i===0?g.displayName:"",
          i===0?g.colors:"",
          i===0?g.totalQty:"",
          comp.component_type,
          comp.product_size||"",
          dims,
          comp.direction||"",
          comp.fabric_type,
          comp.width||"",
          (comp.consumption_per_unit||0).toFixed(4),
          (comp.net_total||0).toFixed(2),
          (comp.wastage_percent||6)+"%",
          (comp.total_required||0).toFixed(2),
        ]);
      });
    });
    rows.push([], ["FABRIC SUMMARY"], ["Fabric Type","Width","Net Mtrs","Total Mtrs (w/ wastage)"]);
    fabricSummary.forEach(f => rows.push([f.fabric_type, f.width?f.width+"cm":"", (f.net_total||0).toFixed(2), (f.total_with_wastage||0).toFixed(2)]));
    rows.push([], ["Fabric components only. Trims, accessories & packaging are printed from a separate sheet."]);
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], {type:"text/csv"})), download: `FWS_${activePo?.po_number||"PO"}.csv` });
    a.click();
  };

  // ------------------------------------------------------------------
  // Session 10 — PDF export rewrite.
  //
  // A4 landscape, fabric-only, line-wrap on long fabric_type values.
  // Self-describing per-view column budgets (width, align, clip|wrap) replace
  // the old hardcoded absolute-X drawing that caused the "180cm14-4102TC"
  // collision in the summary.
  //
  // Key design choices and a few quirks worth preserving:
  //   - Text state (fill color, text color, font, font size) is re-set INSIDE
  //     each header cell loop. jsPDF 4.x doesn't reliably persist that state
  //     across consecutive rect/text calls; setting it once before the loop
  //     leaves only the first cell rendered. (Verified empirically — first
  //     revision shipped only the first column header.)
  //   - The color banner in separate view uses a small white rect() as a
  //     bullet instead of the Unicode character U+25CF. The default jsPDF
  //     helvetica uses WinAnsi encoding, which does not include U+25CF; it
  //     renders as a garbled "%İ" on Windows.
  //   - Row height is computed in a probe pass so pagination works with
  //     variable-height rows (wrapped fabric types).
  //   - 2026-04: added "Dimensions" column between Prod. Size and Direction.
  //     Column widths rebalanced: Fabrication trimmed ~12mm in both layouts
  //     to free room for the new column without overflowing A4 landscape.
  const handleDownloadPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", format: "a4" });

    const PAGE_W = 297;
    const PAGE_H = 210;
    const MARGIN_L = 14;
    const MARGIN_R = 10;
    const USABLE_W = PAGE_W - MARGIN_L - MARGIN_R;
    const PAGE_BOTTOM = PAGE_H - 10;

    const FONT = "helvetica";
    const FONT_SIZE = 6;
    const HEADER_FONT_SIZE = 6.5;
    const LINE_H = 2.8;
    const CELL_PAD_X = 1.0;
    const CELL_PAD_Y = 1.6;
    const BASE_ROW_H = 5.0;
    const HEADER_ROW_H = 6.0;

    const clipText = (s, maxWidth, fontSize) => {
      const text = String(s == null ? "" : s);
      if (!text) return "";
      doc.setFontSize(fontSize);
      if (doc.getTextWidth(text) <= maxWidth) return text;
      const ell = "\u2026";
      let lo = 0, hi = text.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const candidate = text.slice(0, mid) + ell;
        if (doc.getTextWidth(candidate) <= maxWidth) lo = mid + 1; else hi = mid;
      }
      const n = Math.max(1, lo - 1);
      return text.slice(0, n) + ell;
    };

    const wrapText = (s, maxWidth, fontSize) => {
      const text = String(s == null ? "" : s);
      if (!text) return [""];
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(text, maxWidth);
      return Array.isArray(lines) ? lines : [String(lines)];
    };

    const drawHeader = (cols, yPos) => {
      // See top-of-handler comment re: re-setting state inside the loop.
      let x = MARGIN_L;
      cols.forEach((c) => {
        doc.setFillColor(31, 56, 100);
        doc.rect(x, yPos, c.width, HEADER_ROW_H, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont(FONT, "bold");
        doc.setFontSize(HEADER_FONT_SIZE);
        const inner = c.width - CELL_PAD_X * 2;
        const label = clipText(c.label, inner, HEADER_FONT_SIZE);
        doc.text(label, x + CELL_PAD_X, yPos + HEADER_ROW_H - 1.8);
        x += c.width;
      });
      doc.setTextColor(0, 0, 0);
      doc.setFont(FONT, "normal");
      return yPos + HEADER_ROW_H;
    };

    const drawRow = (cols, values, yPos, opts) => {
      const zebra = opts && opts.zebra;
      doc.setFontSize(FONT_SIZE);
      const cells = cols.map((c, i) => {
        const inner = c.width - CELL_PAD_X * 2;
        const raw = values[i];
        if (c.mode === "wrap") {
          return { lines: wrapText(raw, inner, FONT_SIZE), align: c.align || "left" };
        }
        return { lines: [clipText(raw, inner, FONT_SIZE)], align: c.align || "left" };
      });
      const maxLines = Math.max(1, ...cells.map((c) => c.lines.length));
      const rowH = Math.max(BASE_ROW_H, maxLines * LINE_H + CELL_PAD_Y);
      if (zebra) {
        doc.setFillColor(235, 240, 250);
        doc.rect(MARGIN_L, yPos, USABLE_W, rowH, "F");
      }
      doc.setTextColor(0, 0, 0);
      doc.setFont(FONT, "normal");
      doc.setFontSize(FONT_SIZE);
      let x = MARGIN_L;
      cols.forEach((c, i) => {
        const { lines, align } = cells[i];
        lines.forEach((line, li) => {
          const ty = yPos + CELL_PAD_Y + (li + 1) * LINE_H - 0.6;
          let tx = x + CELL_PAD_X;
          if (align === "right")  tx = x + c.width - CELL_PAD_X - doc.getTextWidth(line);
          if (align === "center") tx = x + (c.width - doc.getTextWidth(line)) / 2;
          doc.text(line, tx, ty);
        });
        x += c.width;
      });
      return rowH;
    };

    // Header block
    const title = viewMode === "combined"
      ? "Fabric Working \u2014 Combined (All Colors/Sizes)"
      : "Fabric Working \u2014 Separate (By Color)";
    doc.setFontSize(11); doc.setFont(FONT, "bold");
    doc.text(`${title} \u2014 ${activePo?.po_number || ""}`, MARGIN_L, 12);
    doc.setFontSize(7.5); doc.setFont(FONT, "normal");
    const subLine = `Customer: ${activePo?.customer_name || ""}  |  PI: ${activePo?.pi_number || "\u2014"}  |  ETD: ${activePo?.etd || "\u2014"}`;
    doc.text(clipText(subLine, USABLE_W, 7.5), MARGIN_L, 17);
    let y = 22;

    // Column widths adjusted to fit the new "Dimensions" column within the A4
    // landscape usable width. Fabrication was the widest wrappable column, so
    // it absorbs most of the trim.
    const COMBINED_COLS = [
      { label: "Article (Base)", width: 30,  align: "left",   mode: "clip" },
      { label: "Colors",         width: 20,  align: "left",   mode: "clip" },
      { label: "Total Qty",      width: 12,  align: "right",  mode: "clip" },
      { label: "Part",           width: 18,  align: "left",   mode: "clip" },
      { label: "Prod. Size",     width: 22,  align: "left",   mode: "clip" },
      { label: "Dimensions",     width: 20,  align: "center", mode: "clip" },
      { label: "Dir",            width: 10,  align: "center", mode: "clip" },
      { label: "Fabrication",    width: 55,  align: "left",   mode: "wrap" },
      { label: "Width",          width: 12,  align: "center", mode: "clip" },
      { label: "Cut/Unit",       width: 14,  align: "right",  mode: "clip" },
      { label: "Net Mtrs",       width: 14,  align: "right",  mode: "clip" },
      { label: "Wastage",        width: 11,  align: "right",  mode: "clip" },
      { label: "Total Mtrs",     width: 15,  align: "right",  mode: "clip" },
    ];
    const SEPARATE_COLS = [
      { label: "Article",     width: 28,  align: "left",   mode: "clip" },
      { label: "Code",        width: 20,  align: "left",   mode: "clip" },
      { label: "Qty",         width: 12,  align: "right",  mode: "clip" },
      { label: "Part",        width: 18,  align: "left",   mode: "clip" },
      { label: "Prod. Size",  width: 22,  align: "left",   mode: "clip" },
      { label: "Dimensions",  width: 20,  align: "center", mode: "clip" },
      { label: "Dir",         width: 10,  align: "center", mode: "clip" },
      { label: "Fabrication", width: 55,  align: "left",   mode: "wrap" },
      { label: "Width",       width: 12,  align: "center", mode: "clip" },
      { label: "Cut/Unit",    width: 14,  align: "right",  mode: "clip" },
      { label: "Net Mtrs",    width: 14,  align: "right",  mode: "clip" },
      { label: "Wastage",     width: 11,  align: "right",  mode: "clip" },
      { label: "Total Mtrs",  width: 15,  align: "right",  mode: "clip" },
    ];
    const SUMMARY_COLS = [
      { label: "Fabric Type", width: 170, align: "left",   mode: "wrap" },
      { label: "Width",       width: 20,  align: "center", mode: "clip" },
      { label: "Net Mtrs",    width: 38,  align: "right",  mode: "clip" },
      { label: "Total Mtrs",  width: 45,  align: "right",  mode: "clip" },
    ];

    const ensureRoom = (cols, needed) => {
      if (y + needed > PAGE_BOTTOM) {
        doc.addPage();
        y = 14;
        y = drawHeader(cols, y);
      }
    };

    if (viewMode === "combined") {
      y = drawHeader(COMBINED_COLS, y);
      combinedGroups.forEach((g, gi) => {
        g.components.forEach((comp, ci) => {
          const isFirst = ci === 0;
          const dims = resolveDims(g.template, comp.product_size, comp.component_type);
          const values = [
            isFirst ? g.displayName : "",
            isFirst ? g.colors : "",
            isFirst ? String(g.totalQty == null ? "" : g.totalQty) : "",
            comp.component_type || "",
            comp.product_size || "",
            dims || "",
            comp.direction || "",
            comp.fabric_type || "",
            comp.width ? `${comp.width}cm` : "",
            (comp.consumption_per_unit || 0).toFixed(4),
            (comp.net_total || 0).toFixed(2),
            `${comp.wastage_percent == null ? 6 : comp.wastage_percent}%`,
            (comp.total_required || 0).toFixed(2),
          ];
          // Fabrication is now at index 7 (was 6) after inserting Dimensions.
          const inner = COMBINED_COLS[7].width - CELL_PAD_X * 2;
          const probeLines = wrapText(values[7], inner, FONT_SIZE).length;
          const probeH = Math.max(BASE_ROW_H, probeLines * LINE_H + CELL_PAD_Y);
          ensureRoom(COMBINED_COLS, probeH);
          drawRow(COMBINED_COLS, values, y, { zebra: gi % 2 === 0 });
          y += probeH;
        });
        y += 1.5;
      });
    }

    if (viewMode === "separate") {
      colorGroups.forEach(([color, arts]) => {
        if (y + 9 > PAGE_BOTTOM) { doc.addPage(); y = 14; }
        // Color banner with small white-square bullet (see top-of-handler
        // comment re: Unicode bullet rendering).
        doc.setFillColor(31, 107, 63);
        doc.rect(MARGIN_L, y, USABLE_W, 7, "F");
        doc.setFillColor(255, 255, 255);
        doc.rect(MARGIN_L + 2, y + 2, 3, 3, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont(FONT, "bold");
        const totalPcs = arts.reduce((s, a) => s + (a.order_quantity || 0), 0);
        doc.text(`${String(color).toUpperCase()} \u2014 ${totalPcs.toLocaleString()} pcs`, MARGIN_L + 7, y + 5);
        doc.setFont(FONT, "normal"); doc.setTextColor(0, 0, 0);
        y += 7;
        y = drawHeader(SEPARATE_COLS, y);

        arts.forEach((art, artIdx) => {
          fabricComponentsOf(art).forEach((comp, ci) => {
            const isFirst = ci === 0;
            const net = (comp.consumption_per_unit || 0) * (art.order_quantity || 0);
            const total = comp.total_required || net * (1 + (comp.wastage_percent || 0) / 100);
            const dims = resolveDims(art, comp.product_size, comp.component_type);
            const values = [
              isFirst ? (art.article_name || "") : "",
              isFirst ? (art.article_code || "") : "",
              isFirst ? String(art.order_quantity || "") : "",
              comp.component_type || "",
              comp.product_size || "",
              dims || "",
              comp.direction || "",
              comp.fabric_type || "",
              comp.width ? `${comp.width}cm` : "",
              (comp.consumption_per_unit || 0).toFixed(4),
              net.toFixed(2),
              `${comp.wastage_percent == null ? 6 : comp.wastage_percent}%`,
              total.toFixed(2),
            ];
            // Fabrication is now at index 7 (was 6) after inserting Dimensions.
            const inner = SEPARATE_COLS[7].width - CELL_PAD_X * 2;
            const probeLines = wrapText(values[7], inner, FONT_SIZE).length;
            const probeH = Math.max(BASE_ROW_H, probeLines * LINE_H + CELL_PAD_Y);
            ensureRoom(SEPARATE_COLS, probeH);
            drawRow(SEPARATE_COLS, values, y, { zebra: artIdx % 2 === 0 });
            y += probeH;
          });
          y += 1.0;
        });
        y += 3.0;
      });
    }

    // Summary block
    y += 3;
    if (y + 16 > PAGE_BOTTOM) { doc.addPage(); y = 14; }
    doc.setFillColor(31, 56, 100); doc.setTextColor(255, 255, 255);
    doc.rect(MARGIN_L, y, USABLE_W, 7, "F");
    doc.setFont(FONT, "bold"); doc.setFontSize(8);
    doc.text(`FABRIC REQUIREMENT SUMMARY \u2014 ${activePo?.po_number || ""}`, MARGIN_L + 2, y + 5);
    doc.setTextColor(0, 0, 0); doc.setFont(FONT, "normal");
    y += 7;
    y = drawHeader(SUMMARY_COLS, y);

    fabricSummary.forEach((f, idx) => {
      const values = [
        f.fabric_type || "",
        f.width ? `${f.width}cm` : "",
        (f.net_total || 0).toFixed(2),
        (f.total_with_wastage || 0).toFixed(2),
      ];
      const inner = SUMMARY_COLS[0].width - CELL_PAD_X * 2;
      const probeLines = wrapText(values[0], inner, FONT_SIZE).length;
      const probeH = Math.max(BASE_ROW_H, probeLines * LINE_H + CELL_PAD_Y);
      ensureRoom(SUMMARY_COLS, probeH);
      drawRow(SUMMARY_COLS, values, y, { zebra: idx % 2 === 0 });
      y += probeH;
    });

    // Grand total row
    const grandNet = fabricSummary.reduce((s, f) => s + (f.net_total || 0), 0);
    const grandTot = fabricSummary.reduce((s, f) => s + (f.total_with_wastage || 0), 0);
    if (y + BASE_ROW_H > PAGE_BOTTOM) { doc.addPage(); y = 14; }
    doc.setFillColor(31, 56, 100); doc.setTextColor(255, 255, 255);
    doc.rect(MARGIN_L, y, USABLE_W, 6, "F");
    doc.setFont(FONT, "bold"); doc.setFontSize(7);
    doc.text("GRAND TOTAL", MARGIN_L + 2, y + 4);
    const widths = SUMMARY_COLS.map((c) => c.width);
    const xNet = MARGIN_L + widths[0] + widths[1];
    const xTot = xNet + widths[2];
    const fmtNet = grandNet.toFixed(2);
    const fmtTot = grandTot.toFixed(2);
    doc.text(fmtNet, xNet + widths[2] - CELL_PAD_X - doc.getTextWidth(fmtNet), y + 4);
    doc.text(fmtTot, xTot + widths[3] - CELL_PAD_X - doc.getTextWidth(fmtTot), y + 4);
    doc.setTextColor(0, 0, 0); doc.setFont(FONT, "normal");
    y += 7;

    // Scope footer
    y += 3;
    if (y + 5 > PAGE_BOTTOM) { doc.addPage(); y = 14; }
    doc.setFontSize(6.5); doc.setFont(FONT, "italic"); doc.setTextColor(90, 90, 90);
    doc.text(
      "Fabric components only. Trims, accessories and packaging are printed from a separate sheet.",
      MARGIN_L, y,
    );
    doc.setTextColor(0, 0, 0); doc.setFont(FONT, "normal");

    doc.save(`FabricWorking_${viewMode}_${activePo?.po_number || "PO"}.pdf`);
  };

  const thStyle = { backgroundColor:"#1F3864", color:"white" };
  const thCls = "border border-gray-400 px-2 py-2 text-left whitespace-nowrap text-xs";
  const tdCls = "border border-gray-300 px-2 py-1.5 text-xs";
  const highlightTd = "border border-gray-300 px-2 py-1.5 text-center font-bold text-xs";

  return (
    <div className="space-y-3">
      <style>{`@media print { .no-print { display:none!important; } @page { margin:0.8cm; size:A3 landscape; } }`}</style>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <div className="flex items-center gap-3">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold text-foreground">Fabric Working Sheet</h1>
          {/* Session 10 — visible scope indicator for the merchandiser. */}
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
            Fabric only
          </span>
          <Select value={selectedPoId || activePo?.id || ""} onValueChange={setSelectedPoId}>
            <SelectTrigger className="w-60 h-8 text-xs"><SelectValue placeholder="Select PO" /></SelectTrigger>
            <SelectContent>{pos.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} – {p.customer_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={() => setReadOnly(!readOnly)}
            className={`px-3 py-1.5 text-xs rounded border gap-1.5 flex items-center ${readOnly ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
            <Lock className="h-3 w-3"/>{readOnly ? "Read-only ON" : "Read-only OFF"}
          </button>
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {["combined","separate"].map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 flex items-center gap-1 transition-colors ${viewMode===mode ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                {mode === "combined" ? <><Grid className="h-3 w-3"/>Combined</> : <><List className="h-3 w-3"/>Separate</>}
              </button>
            ))}
          </div>
          {!readOnly && (
            <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={handleRefreshFromTechPacks} disabled={!activePo || refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}/>
              {refreshing ? "Pulling…" : "Pull from Tech Packs"}
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={handleDownloadCSV}><Download className="h-3.5 w-3.5"/>CSV</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={handleDownloadPDF}><FileText className="h-3.5 w-3.5"/>PDF</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => window.print()}><Printer className="h-3.5 w-3.5"/>Print</Button>
        </div>
      </div>

      {/* PO Info banner */}
      {activePo && (
        <div className="text-xs bg-blue-50 border border-blue-200 rounded px-3 py-1.5 text-blue-800 font-medium flex flex-wrap gap-4">
          <span>PO: <strong>{activePo.po_number}</strong></span>
          {activePo.pi_number && <span>PI: <strong>{activePo.pi_number}</strong></span>}
          <span>Customer: {activePo.customer_name}</span>
          <span>ETD: {activePo.etd || "—"}</span>
          <span>Ex-Factory: {activePo.ex_factory_date || "—"}</span>
          <span className={`ml-2 px-2 py-0.5 rounded font-semibold ${viewMode==="combined" ? "bg-blue-200 text-blue-900" : "bg-green-200 text-green-900"}`}>
            {viewMode === "combined" ? "COMBINED — All Colors" : "SEPARATE — By Color"}
          </span>
        </div>
      )}

      {!activePo || (!isLoading && articles.length === 0) ? (
        <EmptyState icon={Layers} title="No articles for this PO"
          description="Create articles from the PO Detail page, or import line items first."
        />
      ) : (
        <div className="space-y-4">
          {/* ── COMBINED VIEW ───────────────────────────────────────────── */}
          {viewMode === "combined" && (
            <div className="overflow-x-auto rounded border border-gray-300 shadow-sm">
              <table className="w-full text-xs border-collapse" style={{ fontFamily:"Arial,sans-serif" }}>
                <thead>
                  <tr style={thStyle}>
                    {["Article (Base)","Colors","Total Qty","Part","Prod. Size","Dimensions","Direction","Fabrication","Width cm","Cut/Unit m","Net Mtrs","Wastage %","Total Mtrs", ...(readOnly ? [] : [""])].map(col => (
                      <th key={col} className={thCls}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {combinedGroups.map((g, gi) => (
                    <React.Fragment key={g.key}>
                      {g.components.length === 0 ? (
                        <tr style={{ backgroundColor: gi%2===0?"#EBF0FA":"#fff" }}>
                          <td className={`${tdCls} font-semibold text-blue-900`}>{g.displayName}</td>
                          <td className={`${tdCls} text-gray-500`}>{g.colors}</td>
                          <td className={`${tdCls} text-center font-semibold`}>{g.totalQty}</td>
                          <td colSpan={10} className={`${tdCls} text-muted-foreground italic`}>No components — click edit to add fabric specs</td>
                          {!readOnly && <td className={`${tdCls} text-center no-print`}>
                            <button onClick={() => setEditingArticle(g.template)} className="text-blue-600 hover:text-blue-800"><Pencil className="h-3.5 w-3.5"/></button>
                          </td>}
                        </tr>
                      ) : g.components.map((comp, ci) => {
                        const dims = resolveDims(g.template, comp.product_size, comp.component_type);
                        return (
                        <tr key={ci} style={{ backgroundColor: gi%2===0?"#EBF0FA":"#fff" }}>
                          {ci===0 && <>
                            <td rowSpan={g.components.length} className={`${tdCls} font-semibold text-blue-900 align-top`}>{g.displayName}</td>
                            <td rowSpan={g.components.length} className={`${tdCls} text-gray-500 align-top`}>{g.colors}</td>
                            <td rowSpan={g.components.length} className={`${tdCls} text-center font-bold align-top`}>{g.totalQty}</td>
                          </>}
                          <td className={`${tdCls} font-medium`}>{comp.component_type}</td>
                          <td className={`${tdCls} text-center`}>{comp.product_size||"—"}</td>
                          <td className={`${tdCls} text-center font-mono`}>{dims||"—"}</td>
                          <td className={`${tdCls} text-center`}>{comp.direction||"—"}</td>
                          <td className={tdCls}>{comp.fabric_type}</td>
                          <td className={`${tdCls} text-center`}>{comp.width?`${comp.width}cm`:"—"}</td>
                          <td className={`${tdCls} text-center`}>{(comp.consumption_per_unit||0).toFixed(4)}</td>
                          <td className={`${tdCls} text-center`}>{(comp.net_total||0).toFixed(2)}</td>
                          <td className={`${tdCls} text-center`}>{comp.wastage_percent??6}%</td>
                          <td className={highlightTd} style={{ backgroundColor:"#FFF2CC" }}>{(comp.total_required||0).toFixed(2)}</td>
                          {ci===0 && !readOnly && <td rowSpan={g.components.length} className={`${tdCls} text-center align-top no-print`}>
                            <button onClick={() => setEditingArticle(g.template)} className="text-blue-600 hover:text-blue-800"><Pencil className="h-3.5 w-3.5"/></button>
                          </td>}
                        </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── SEPARATE VIEW (BY COLOR) ─────────────────────────────── */}
          {viewMode === "separate" && (
            <div className="space-y-4">
              {colorGroups.map(([color, colorArticles]) => (
                <div key={color} className="rounded border border-gray-300 shadow-sm overflow-hidden">
                  <div className="px-3 py-2 text-sm font-bold text-white" style={{ backgroundColor:"#1F6B3F" }}>
                    ● {color.toUpperCase()} — {colorArticles.reduce((s,a) => s+(a.order_quantity||0),0).toLocaleString()} pcs
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse" style={{ fontFamily:"Arial,sans-serif" }}>
                      <thead>
                        <tr style={thStyle}>
                          {["Article","Code","Qty","Part","Prod. Size","Dimensions","Direction","Fabrication","Width cm","Cut/Unit m","Net Mtrs","Wastage %","Total Mtrs", ...(readOnly ? [] : [""])].map(col => (
                            <th key={col} className={thCls}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {colorArticles.map((article, artIdx) => {
                          // Session 10 — filter at render time too.
                          const comps = fabricComponentsOf(article);
                          const artBg = artIdx%2===0?"#EBF0FA":"#fff";
                          return (
                            <React.Fragment key={article.id}>
                              {comps.length === 0 ? (
                                <tr style={{ backgroundColor:artBg }}>
                                  <td className={`${tdCls} font-semibold text-blue-900`}>{article.article_name}</td>
                                  <td className={`${tdCls} text-gray-500`}>{article.article_code}</td>
                                  <td className={`${tdCls} text-center`}>{article.order_quantity?.toLocaleString()}</td>
                                  <ArticleFabricSetup
                                    article={article}
                                    onEdit={() => setEditingArticle(article)}
                                    onSetup={async (components) => {
                                      const total_fabric_required = +components.reduce((s, c) => s + (c.total_required || 0), 0).toFixed(4);
                                      await mfg.articles.update(article.id, { components, total_fabric_required });
                                      qc.invalidateQueries({ queryKey: ["articles", activePo?.id] });
                                      qc.invalidateQueries({ queryKey: ["allArticles"] });
                                    }}
                                  />
                                  <td className={`${tdCls} no-print`}>
                                    {!readOnly && <button onClick={() => setEditingArticle(article)} className="text-blue-600 hover:text-blue-800"><Pencil className="h-3.5 w-3.5"/></button>}
                                  </td>
                                </tr>
                              ) : comps.map((comp, idx) => {
                                const net = (comp.consumption_per_unit||0)*(article.order_quantity||0);
                                const total = comp.total_required || net*(1+(comp.wastage_percent||0)/100);
                                const dims = resolveDims(article, comp.product_size, comp.component_type);
                                return (
                                  <tr key={idx} style={{ backgroundColor:artBg }}>
                                    {idx===0 && <>
                                      <td rowSpan={comps.length} className={`${tdCls} font-semibold text-blue-900 align-top`}>{article.article_name}</td>
                                      <td rowSpan={comps.length} className={`${tdCls} text-gray-600 align-top`}>{article.article_code}</td>
                                      <td rowSpan={comps.length} className={`${tdCls} text-center font-semibold align-top`}>{article.order_quantity?.toLocaleString()}</td>
                                    </>}
                                    <td className={`${tdCls} font-medium`}>{comp.component_type}</td>
                                    <td className={`${tdCls} text-center`}>{comp.product_size||"—"}</td>
                                    <td className={`${tdCls} text-center font-mono`}>{dims||"—"}</td>
                                    <td className={`${tdCls} text-center`}>{comp.direction||"—"}</td>
                                    <td className={tdCls}>{comp.fabric_type}</td>
                                    <td className={`${tdCls} text-center`}>{comp.width?`${comp.width}cm`:"—"}</td>
                                    <td className={`${tdCls} text-center`}>{(comp.consumption_per_unit||0).toFixed(4)}</td>
                                    <td className={`${tdCls} text-center`}>{net.toFixed(2)}</td>
                                    <td className={`${tdCls} text-center`}>{comp.wastage_percent??6}%</td>
                                    <td className={highlightTd} style={{ backgroundColor:"#FFF2CC" }}>{total.toFixed(2)}</td>
                                    {idx===0 && !readOnly && <td rowSpan={comps.length} className={`${tdCls} text-center align-top no-print`}>
                                      <div className="flex flex-col gap-1 items-center">
                                        <button onClick={() => setEditingArticle(article)} className="text-blue-600 hover:text-blue-800"><Pencil className="h-3.5 w-3.5"/></button>
                                        <button onClick={() => handleDeleteArticle(article.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5"/></button>
                                      </div>
                                    </td>}
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── COLOR-WISE FABRIC SUMMARY (SEPARATE VIEW) ───────────── */}
          {viewMode === "separate" && colorFabricSummary.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-xs font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor:"#1F3864" }}>
                FABRIC REQUIREMENT SUMMARY — BY COLOR — {activePo?.po_number}
              </div>
              {colorFabricSummary.map(({ color, items }) => (
                <div key={color} className="overflow-x-auto rounded border border-gray-300 shadow-sm">
                  <table className="w-full text-xs border-collapse" style={{ fontFamily:"Arial,sans-serif" }}>
                    <thead>
                      <tr style={{ backgroundColor:"#1F6B3F", color:"white" }}>
                        <th className={thCls} colSpan={2}>● {color.toUpperCase()}</th>
                        <th className={thCls}>Width</th>
                        <th className={`${thCls} text-right`}>Net Mtrs</th>
                        <th className={`${thCls} text-right`}>Total Mtrs (incl. wastage)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((f, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx%2===0?"#EBF0FA":"white" }}>
                          <td className={tdCls} colSpan={2}>{f.fabric_type}</td>
                          <td className={`${tdCls} text-center`}>{f.width?`${f.width}cm`:"—"}</td>
                          <td className={`${tdCls} text-right`}>{(f.net_total||0).toFixed(2)}</td>
                          <td className={highlightTd} style={{ backgroundColor:"#FFF2CC", textAlign:"right" }}>{(f.total_with_wastage||0).toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr style={{ backgroundColor:"#1F6B3F", color:"white", fontWeight:"bold" }}>
                        <td className="border border-gray-400 px-3 py-1.5 text-xs" colSpan={3}>SUBTOTAL</td>
                        <td className="border border-gray-400 px-3 py-1.5 text-xs text-right">{items.reduce((s,f)=>s+f.net_total,0).toFixed(2)}</td>
                        <td className="border border-gray-400 px-3 py-1.5 text-xs text-right">{items.reduce((s,f)=>s+f.total_with_wastage,0).toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
              <div className="overflow-x-auto rounded border border-gray-300">
                <table className="w-full text-xs border-collapse" style={{ fontFamily:"Arial,sans-serif" }}>
                  <tbody>
                    <tr style={{ backgroundColor:"#1F3864", color:"white", fontWeight:"bold" }}>
                      <td className="border border-gray-400 px-3 py-2 text-xs" colSpan={3}>GRAND TOTAL (ALL COLORS)</td>
                      <td className="border border-gray-400 px-3 py-2 text-xs text-right">{fabricSummary.reduce((s,f)=>s+f.net_total,0).toFixed(2)}</td>
                      <td className="border border-gray-400 px-3 py-2 text-xs text-right">{fabricSummary.reduce((s,f)=>s+f.total_with_wastage,0).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── FABRIC REQUIREMENT SUMMARY ────────────────────────────── */}
          {fabricSummary.length > 0 && (
            <div className="overflow-x-auto rounded border border-gray-300 shadow-sm mt-2">
              <table className="w-full text-xs border-collapse" style={{ fontFamily:"Arial,sans-serif" }}>
                <thead>
                  <tr style={thStyle}>
                    <th className={thCls} colSpan={2}>FABRIC REQUIREMENT SUMMARY — {activePo?.po_number}</th>
                    <th className={thCls}>Width</th>
                    <th className={`${thCls} text-right`}>Net Mtrs (100%)</th>
                    <th className={`${thCls} text-right`}>Total Mtrs (w/ wastage)</th>
                  </tr>
                </thead>
                <tbody>
                  {fabricSummary.map((f, idx) => (
                    <tr key={idx} style={{ backgroundColor: idx%2===0?"#EBF0FA":"#fff" }}>
                      <td className={tdCls} colSpan={2}>{f.fabric_type}</td>
                      <td className={`${tdCls} text-center`}>{f.width?`${f.width}cm`:"—"}</td>
                      <td className={`${tdCls} text-right`}>{(f.net_total||0).toFixed(2)}</td>
                      <td className={highlightTd} style={{ backgroundColor:"#FFF2CC", textAlign:"right" }}>{(f.total_with_wastage||0).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr style={{ backgroundColor:"#1F3864", color:"white", fontWeight:"bold" }}>
                    <td className="border border-gray-400 px-3 py-1.5 text-xs" colSpan={3}>GRAND TOTAL</td>
                    <td className="border border-gray-400 px-3 py-1.5 text-xs text-right">{fabricSummary.reduce((s,f)=>s+f.net_total,0).toFixed(2)}</td>
                    <td className="border border-gray-400 px-3 py-1.5 text-xs text-right">{fabricSummary.reduce((s,f)=>s+f.total_with_wastage,0).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="text-[11px] italic text-slate-500 mt-2 no-print">
            Fabric components only. Trims, accessories and packaging are printed from a separate sheet.
          </div>
        </div>
      )}

      <FabricEditDialog
        open={!!editingArticle}
        onOpenChange={v => { if (!v) setEditingArticle(null); }}
        article={editingArticle}
        onSave={data => updateMutation.mutate({ id: data.id, data, allArticles: articles })}
        saving={updateMutation.isPending}
      />
    </div>
  );
}
