import React, { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPageUrl } from "@/utils";
import { db, mfg, priceList as priceListAPI, supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, FileText, Trash2, Mail, Upload, Loader2, Download, Tag as TagIcon, Users, CheckCheck, FileDown, Square, CheckSquare } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import POFormDialog from "@/components/po/POFormDialog";
import EmailImportDialog from "@/components/po/EmailImportDialog";
import RedactedValue from "@/components/shared/RedactedValue";

const STATUSES = ["All","PO Received","Items Entered","Price Verification","Price Approved","CBM Calculated","FWS Prepared","Yarn Planned","Accessories Planned","Packaging Planned","In Production","QC Inspection","Ready to Ship","Completed","Shipped","At Port","Delivered","Cancelled"];
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };

export default function PurchaseOrders() {
  const [showForm, setShowForm] = useState(false);
  const [showEmailImport, setShowEmailImport] = useState(false);
  const [prefillData, setPrefillData] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [approvalFilter, setApprovalFilter] = useState("All");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDialog, setBulkDialog] = useState(null); // "status" | "assign" | "tag" | null
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const { can, profile } = useAuth();
  const canSubmitApproval = can("PO_SUBMIT_APPROVAL");
  const canApprove = can("PO_APPROVE");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: purchaseOrders = [], isLoading } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => db.purchaseOrders.list("-created_at"),
  });

  const handleCreate = async (data) => {
    const po = await db.purchaseOrders.create(data);
    if (prefillData?.items?.length > 0) {
      const items = prefillData.items.map((item) => ({
        ...item, po_id: po.id, po_number: po.po_number,
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        total_price: (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
        unit: item.unit || "Pieces", price_status: "Pending",
      }));
      await db.poItems.bulkCreate(items);
    }
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
    setShowForm(false); setPrefillData(null);
  };

  // ─── Full enrichment import (smart-tex-planner logic) ─────────────────────
  const handleImportExtracted = async (extracted) => {
    setImporting(true);
    setImportMsg("Fetching price list & fabric templates…");
    try {
      const [existingItemsData, priceData, historicArticlesData, fabricTemplatesData] = await Promise.all([
        db.poItems.list(),
        priceListAPI.list(),
        mfg.articles.list(),
        mfg.fabricTemplates.list(),
      ]);

      const historyMap = {};
      existingItemsData.forEach((i) => { const k = i.item_code?.trim().toUpperCase(); if (k && !historyMap[k]) historyMap[k] = i; });
      const priceMap = {};
      priceData.forEach((p) => { if (p.item_code) priceMap[p.item_code.trim().toUpperCase()] = p; });
      const fabricTemplateMap = {};
      fabricTemplatesData.forEach((t) => { if (t.article_code) fabricTemplateMap[t.article_code.trim().toUpperCase()] = t; });
      const articleHistoryMap = {};
      historicArticlesData.forEach((a) => {
        if (a.article_code) articleHistoryMap[a.article_code.trim().toUpperCase()] = a;
        if (a.article_name)  articleHistoryMap[a.article_name.trim().toUpperCase()]  = a;
      });

      setImportMsg("Creating PO…");
      // Dates must be null (not empty string) for Postgres date columns
      const toDateOrNull = (v) => (v && String(v).trim()) ? v : null;
      const poData = {
        po_number: extracted.po_number || `IMP-${Date.now()}`,
        customer_name: extracted.customer_name || "Unknown",
        ship_to_name: extracted.ship_to_name || "",
        ship_to_address: extracted.ship_to_address || "",
        buyer_address: extracted.buyer_address || "",
        order_date: toDateOrNull(extracted.order_date),
        delivery_date: toDateOrNull(extracted.delivery_date),
        ex_factory_date: toDateOrNull(extracted.ex_factory_date),
        etd: toDateOrNull(extracted.etd),
        eta: toDateOrNull(extracted.eta),
        currency: extracted.currency || "USD",
        total_po_value: Number(extracted.total_po_value) || undefined,
        total_quantity: Number(extracted.total_quantity) || undefined,
        season: extracted.season || "",
        payment_terms: extracted.payment_terms || "",
        ship_via: extracted.ship_via || "",
        port_of_loading: extracted.port_of_loading || "",
        port_of_destination: extracted.port_of_destination || "",
        country_of_origin: extracted.country_of_origin || "Pakistan",
        sales_order_number: extracted.sales_order_number || "",
        notes: extracted.notes || "",
        source: extracted.source || "Email",
        status: "PO Received",
      };

      const po = await db.purchaseOrders.create(poData);

      if (extracted.items?.length > 0) {
        setImportMsg(`Enriching ${extracted.items.length} items…`);

        const enrichedItems = extracted.items.map((item) => {
          const key  = item.item_code?.trim().toUpperCase();
          const hist = historyMap[key];
          const ref  = priceMap[key];
          const qty            = Number(item.quantity)         || 0;
          const unit_price     = Number(item.unit_price)       || Number(ref?.price_usd)       || 0;
          const ppc            = Number(item.pieces_per_carton)|| Number(ref?.qty_per_carton)   || Number(hist?.pieces_per_carton) || 0;
          const cbm_per_carton = Number(ref?.cbm_per_carton)   || 0;
          const num_cartons    = ppc > 0 ? Math.ceil(qty / ppc) : 0;
          const cbm            = Number(item.cbm) || (cbm_per_carton > 0 && num_cartons > 0 ? Number((num_cartons * cbm_per_carton).toFixed(4)) : undefined);
          const price_status   = unit_price > 0 && ref?.price_usd
            ? (Math.abs(unit_price - ref.price_usd) < 0.001 ? "Matched" : "Mismatch") : "Pending";
          return {
            po_id: po.id, po_number: po.po_number,
            item_code: item.item_code || "",
            item_description: item.item_description || hist?.item_description || "",
            fabric_type: item.fabric_type || hist?.fabric_type || "",
            gsm: Number(item.gsm) || Number(hist?.gsm) || undefined,
            width: Number(item.width) || Number(hist?.width) || undefined,
            fabric_construction: item.fabric_construction || hist?.fabric_construction || "",
            finish: item.finish || hist?.finish || "",
            shrinkage: item.shrinkage || hist?.shrinkage || "",
            packing_method: hist?.packing_method || "Carton",
            quantity: qty, unit: item.unit || hist?.unit || "Pieces",
            unit_price, total_price: qty * unit_price,
            delivery_date: toDateOrNull(item.delivery_date || poData.delivery_date),
            pieces_per_carton: ppc || undefined, num_cartons: num_cartons || undefined, cbm,
            carton_length: Number(item.carton_length) || Number(ref?.carton_length) || Number(hist?.carton_length) || undefined,
            carton_width:  Number(item.carton_width)  || Number(ref?.carton_width)  || Number(hist?.carton_width)  || undefined,
            carton_height: Number(item.carton_height) || Number(ref?.carton_height) || Number(hist?.carton_height) || undefined,
            expected_price: ref?.price_usd || undefined, price_status,
          };
        });

        await db.poItems.bulkCreate(enrichedItems);

        // ── Master Data BOM Explosion ──────────────────────────────────────
        // Pre-flight check: every item_code must exist in consumption_library before we create articles.
        setImportMsg("Verifying all SKUs exist in Master Data…");
        // Normalize to uppercase and strip whitespace/dashes so 'gpte-78' matches 'GPTE78'
        const normalizeCode = (c) => (c || "").trim().toUpperCase().replace(/[\s\-_]+/g, "");
        const itemCodesRaw = [...new Set(enrichedItems.map(i => i.item_code?.trim()).filter(Boolean))];
        const itemCodeNorm = itemCodesRaw.map(c => ({ raw: c, norm: normalizeCode(c) }));
        if (!itemCodesRaw.length) {
          throw new Error("PO has no item codes — cannot import without line items.");
        }

        // Widen query: pull by raw codes AND normalized forms (in case Master Data has variants)
        const { data: cl, error: clErr } = await supabase
          .from("consumption_library")
          .select("item_code, kind, component_type, fabric_type, material, gsm, color, construction, treatment, width_cm, consumption_per_unit, wastage_percent, supplier, placement, size_spec, size");
        if (clErr) throw clErr;

        // Index master data by normalized item_code so we can match loosely
        const clByNorm = new Map();       // norm -> [rows]
        const hasFabricNorm = new Set();  // normalized codes that have at least one fabric row
        const canonicalFor = new Map();   // norm -> actual item_code as stored in DB
        for (const r of cl || []) {
          const n = normalizeCode(r.item_code);
          if (!clByNorm.has(n)) { clByNorm.set(n, []); canonicalFor.set(n, r.item_code); }
          clByNorm.get(n).push(r);
          if (r.kind === "fabric") hasFabricNorm.add(n);
        }

        // Levenshtein distance for fuzzy SKU match (handles OCR errors like P→B, F→E, K→O)
        const levenshtein = (a, b) => {
          if (a === b) return 0;
          const m = a.length, n = b.length;
          if (!m) return n;
          if (!n) return m;
          const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
          for (let i = 0; i <= m; i++) dp[i][0] = i;
          for (let j = 0; j <= n; j++) dp[0][j] = j;
          for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
              dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
            }
          }
          return dp[m][n];
        };

        const allMasterCodes = [...hasFabricNorm];
        const baseSkuResolutions = new Map();  // raw -> resolved norm (deterministic, auto-apply)
        const fuzzyResolutions = new Map();    // raw -> resolved norm (OCR, needs confirmation)
        const stillMissing = [];
        const stripVariantSuffix = (code) => {
          const m = /^(.+)-([A-Z0-9]{1,4})$/i.exec(code);
          return m ? m[1] : null;
        };
        for (const { raw, norm } of itemCodeNorm) {
          if (hasFabricNorm.has(norm)) continue;
          // 1) Deterministic: strip color/variant suffix and check exact match
          const base = stripVariantSuffix(norm);
          if (base && hasFabricNorm.has(base)) {
            baseSkuResolutions.set(raw, base);
            console.log(`[PO Import] Base-SKU match (auto): "${raw}" → "${canonicalFor.get(base)}"`);
            continue;
          }
          // 2) Fuzzy: Levenshtein for likely OCR errors
          const maxDist = Math.max(2, Math.floor(norm.length / 5));
          let best = null, bestDist = Infinity;
          for (const md of allMasterCodes) {
            if (Math.abs(md.length - norm.length) > maxDist) continue;
            const d = levenshtein(norm, md);
            if (d < bestDist && d <= maxDist) { best = md; bestDist = d; }
          }
          if (best) {
            fuzzyResolutions.set(raw, best);
            console.log(`[PO Import] Fuzzy match: "${raw}" → "${canonicalFor.get(best)}" (distance ${bestDist})`);
          } else {
            stillMissing.push(raw);
          }
        }

        // Auto-apply deterministic base-SKU matches (no user confirmation)
        for (const item of enrichedItems) {
          const raw = item.item_code?.trim();
          const baseNorm = baseSkuResolutions.get(raw);
          if (baseNorm) item.item_code = canonicalFor.get(baseNorm);
        }
        // Rebuild itemCodeNorm with corrected codes for downstream
        if (baseSkuResolutions.size > 0) {
          itemCodeNorm.length = 0;
          itemCodesRaw.length = 0;
          for (const i of enrichedItems) {
            const trimmed = i.item_code?.trim();
            if (trimmed && !itemCodesRaw.includes(trimmed)) {
              itemCodesRaw.push(trimmed);
              itemCodeNorm.push({ raw: trimmed, norm: normalizeCode(trimmed) });
            }
          }
        }

        // Confirm fuzzy matches with user before proceeding
        if (fuzzyResolutions.size > 0) {
          const lines = [...fuzzyResolutions.entries()].map(([raw, norm]) =>
            `  ${raw}  →  ${canonicalFor.get(norm)}`
          ).join("\n");
          const ok = confirm(
            `${fuzzyResolutions.size} SKU code(s) didn't match exactly but look similar to existing Master Data SKUs.\n\n` +
            `Likely OCR errors during PO extraction. Use these matches?\n\n${lines}\n\n` +
            `Click OK to use these matches, or Cancel to abort and fix the PO manually.`
          );
          if (!ok) throw new Error("Import cancelled — fuzzy SKU matches not approved.");
          // Apply fuzzy matches: rewrite item_codes in enrichedItems to canonical form
          for (const item of enrichedItems) {
            const raw = item.item_code?.trim();
            const fuzzyNorm = fuzzyResolutions.get(raw);
            if (fuzzyNorm) {
              item.item_code = canonicalFor.get(fuzzyNorm);
            }
          }
          // Also rebuild itemCodeNorm so downstream uses the corrected codes
          itemCodeNorm.length = 0;
          itemCodesRaw.length = 0;
          for (const i of enrichedItems) {
            const trimmed = i.item_code?.trim();
            if (trimmed && !itemCodesRaw.includes(trimmed)) {
              itemCodesRaw.push(trimmed);
              itemCodeNorm.push({ raw: trimmed, norm: normalizeCode(trimmed) });
            }
          }
        }

        if (stillMissing.length) {
          throw new Error(
            `Missing SKU(s) in Master Data: ${stillMissing.slice(0, 10).join(", ")}` +
            `${stillMissing.length > 10 ? ` (+${stillMissing.length - 10} more)` : ""}. ` +
            `Add these to the Consumption Library before importing this PO.`
          );
        }

        // Build clByCode in the raw-code shape callers expect downstream
        const clByCode = new Map();
        for (const { raw, norm } of itemCodeNorm) {
          clByCode.set(raw, clByNorm.get(norm) || []);
        }

        // Build authoritative BOM from consumption_library — replaces any existing article.components[]
        setImportMsg("Building BOM from Master Data…");
        const directionFor = (component_type, kind) => {
          if (kind !== "fabric") return null;
          const t = (component_type || "").toLowerCase();
          if (t === "skirt") return "LXW";                              // strip cut along fabric length
          if (t === "piping" || t === "binding") return "WXL";          // bias strips cut across width
          if (/platform|bottom|sleeper|evalon|sheet|front|back|top fabric|pillow case/.test(t)) return "WXL";
          return null;
        };

        const articleRecords = enrichedItems.map((item) => {
          const code = item.item_code.trim();
          const qty  = Number(item.quantity) || 0;
          const clRows = clByCode.get(code) || [];
          // product_size = finish dimensions (e.g. "39x75x18\"") from the article table,
          // or fall back to the size label (Twin/Queen/King) if dimensions aren't set
          const productSize = item.finish_dimensions || item.size || clRows.find(r => r.size)?.size || null;

          const components = clRows
            .sort((a, b) => {
              const rank = k => k === "fabric" ? 1 : k === "accessory" ? 2 : 3;
              return rank(a.kind) - rank(b.kind) ||
                     (a.component_type || "").localeCompare(b.component_type || "");
            })
            .map(r => {
              const consumption = Number(r.consumption_per_unit) || 0;
              const wastage     = Number(r.wastage_percent) || 0;
              const net         = consumption * qty;
              return {
                component_type:       r.component_type,
                kind:                 r.kind,
                fabric_type:          r.fabric_type,
                material:             r.material,
                gsm:                  r.gsm,
                width:                r.width_cm,
                color:                r.color,
                construction:         r.construction,
                finish:               r.treatment,
                placement:            r.placement,
                size_spec:            r.size_spec,
                product_size:         productSize,
                direction:            directionFor(r.component_type, r.kind),
                consumption_per_unit: consumption,
                wastage_percent:      wastage,
                supplier:             r.supplier || null,
                net_total:            +net.toFixed(4),
                total_required:       +(net * (1 + wastage / 100)).toFixed(4),
              };
            });

          const total_fabric_required = +components
            .filter(c => c.kind === "fabric")
            .reduce((s, c) => s + (c.total_required || 0), 0)
            .toFixed(4);

          return {
            po_id:         po.id,
            po_number:     po.po_number,
            article_name:  item.item_description || code,
            article_code:  code,
            size:          productSize,
            components,
            order_quantity: qty,
            total_fabric_required,
          };
        });

        // Authoritative upsert: replaces components[] on every import
        await supabase.from("articles").upsert(articleRecords, {
          onConflict: "article_code", ignoreDuplicates: false,
        });

        // Auto-copy accessories from most recent previous PO for same articles
        setImportMsg("Copying accessories from history…");
        const { data: historicAccItems } = await supabase
          .from("accessory_items").select("*")
          .order("created_at", { ascending: false }).limit(2000);

        const toCopy = [];
        articleRecords.forEach((art) => {
          if (!art.article_code) return;
          const key = art.article_code.trim().toUpperCase();
          const prev = (historicAccItems || []).filter(
            (i) => i.article_code?.trim().toUpperCase() === key && i.po_id !== po.id
          );
          if (!prev.length) return;
          const recentPoId = prev[0].po_id;
          prev.filter((i) => i.po_id === recentPoId).forEach((item) => {
            const multiplier = item.multiplier || 1;
            const wastage    = item.wastage_percent || 0;
            toCopy.push({
              po_id: po.id, po_number: po.po_number,
              article_name: art.article_name, article_code: art.article_code,
              category: item.category, item_description: item.item_description,
              color: item.color || "", size_spec: item.size_spec || "",
              quantity_required: Math.ceil((art.order_quantity || 0) * multiplier * (1 + wastage / 100)),
              wastage_percent: wastage, multiplier,
              pc_ean_code: item.pc_ean_code || "", carton_ean_code: item.carton_ean_code || "",
              unit: item.unit || "Pcs", status: "Planned", notes: item.notes || "",
            });
          });
        });

        if (toCopy.length > 0) {
          for (let i = 0; i < toCopy.length; i += 10) {
            await supabase.from("accessory_items").insert(toCopy.slice(i, i + 10));
          }
        }

        // Update PO totals
        const total_cbm      = enrichedItems.reduce((s, i) => s + (Number(i.cbm)         || 0), 0);
        const total_po_value = enrichedItems.reduce((s, i) => s + (Number(i.total_price)  || 0), 0);
        const total_quantity = enrichedItems.reduce((s, i) => s + (Number(i.quantity)     || 0), 0);
        await db.purchaseOrders.update(po.id, {
          total_cbm:      total_cbm      > 0 ? Number(total_cbm.toFixed(4))      : undefined,
          total_po_value: total_po_value > 0 ? Number(total_po_value.toFixed(2)) : poData.total_po_value,
          total_quantity: total_quantity       || poData.total_quantity,
          status: "Items Entered",
        });
      }

      qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      navigate(`/PODetail?id=${po.id}`);
    } catch (err) {
      console.error("Import error:", err);
      alert("Import failed: " + (err.message || "Unknown error"));
    } finally {
      setImporting(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ["PO Number","Customer","Status","Season","Order Date","Ex-Factory","ETD","ETA","Currency","Total Value","Total Qty","Total CBM","Payment Terms","Port of Loading","Port of Destination","Ship Via","Country of Origin","Notes"];
    const rows = filtered.map(po => [
      po.po_number, po.customer_name, po.status, po.season||"",
      po.order_date||"", po.ex_factory_date||"", po.etd||"", po.eta||"",
      po.currency||"USD", po.total_po_value||0, po.total_quantity||0, po.total_cbm||0,
      po.payment_terms||"", po.port_of_loading||"", po.port_of_destination||"",
      po.ship_via||"", po.country_of_origin||"", (po.notes||"").replace(/\n/g," "),
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(","))
      .join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: `MerQuant_POs_${new Date().toISOString().split("T")[0]}.csv`,
    });
    a.click();
  };

  const handleDelete = async (id, e) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm("Delete this PO?")) return;
    await db.purchaseOrders.delete(id);
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
  };

  const toggleOne = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelectedIds(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)));
  const clearSel = () => setSelectedIds(new Set());

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.size} POs? This cannot be undone.`)) return;
    setBulkBusy(true);
    for (const id of selectedIds) { try { await db.purchaseOrders.delete(id); } catch (e) { console.error(e); } }
    clearSel();
    setBulkBusy(false);
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
  };

  const handleBulkStatusApply = async () => {
    if (!bulkValue) return;
    setBulkBusy(true);
    for (const id of selectedIds) { try { await db.purchaseOrders.update(id, { status: bulkValue }); } catch (e) { console.error(e); } }
    clearSel(); setBulkDialog(null); setBulkValue(""); setBulkBusy(false);
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
  };

  const handleBulkAssignApply = async () => {
    if (!bulkValue.trim()) return;
    setBulkBusy(true);
    for (const id of selectedIds) { try { await db.purchaseOrders.update(id, { assigned_to: bulkValue.trim() }); } catch (e) { console.error(e); } }
    clearSel(); setBulkDialog(null); setBulkValue(""); setBulkBusy(false);
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
  };

  const handleBulkTagApply = async () => {
    const tags = bulkValue.split(",").map(s => s.trim()).filter(Boolean);
    if (!tags.length) return;
    setBulkBusy(true);
    for (const id of selectedIds) {
      const po = purchaseOrders.find(p => p.id === id);
      const existing = Array.isArray(po?.tags) ? po.tags : [];
      const merged = Array.from(new Set([...existing, ...tags]));
      try { await db.purchaseOrders.update(id, { tags: merged }); } catch (e) { console.error(e); }
    }
    clearSel(); setBulkDialog(null); setBulkValue(""); setBulkBusy(false);
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
  };

  const handleBulkExportCSV = () => {
    const selectedPos = purchaseOrders.filter(p => selectedIds.has(p.id));
    if (!selectedPos.length) return;
    const headers = ["PO Number","Customer","Status","Season","Order Date","Ex-Factory","ETD","ETA","Currency","Total Value","Total Qty","Total CBM","Payment Terms","POL","POD","Ship Via","Origin","Notes"];
    const rows = selectedPos.map(po => [po.po_number, po.customer_name, po.status, po.season||"", po.order_date||"", po.ex_factory_date||"", po.etd||"", po.eta||"", po.currency||"USD", po.total_po_value||0, po.total_quantity||0, po.total_cbm||0, po.payment_terms||"", po.port_of_loading||"", po.port_of_destination||"", po.ship_via||"", po.country_of_origin||"", (po.notes||"").replace(/\n/g," ")]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `MerQuant_POs_Selected_${new Date().toISOString().split("T")[0]}.csv` });
    a.click();
  };

  const filtered = purchaseOrders.filter((po) => {
    const ms = !search || po.po_number?.toLowerCase().includes(search.toLowerCase()) || po.customer_name?.toLowerCase().includes(search.toLowerCase());
    return ms && (statusFilter === "All" || po.status === statusFilter) && (approvalFilter === "All" || po.approval_status === approvalFilter);
  });

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-1 gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search PO or customer…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={approvalFilter} onValueChange={setApprovalFilter}>
            <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="Approval"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Approvals</SelectItem>
              <SelectItem value="not_submitted">Not Submitted</SelectItem>
              <SelectItem value="pending">Pending ⏳</SelectItem>
              <SelectItem value="approved">Approved ✓</SelectItem>
              <SelectItem value="rejected">Rejected ✗</SelectItem>
              <SelectItem value="changes_requested">Changes Requested</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          {filtered.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExportCSV} className="hidden sm:flex">
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowEmailImport(true)}>
            <Mail className="h-4 w-4 mr-2" /> Import from Email
          </Button>
          <Button variant="outline" onClick={() => setShowEmailImport(true)} className="hidden sm:flex">
            <Upload className="h-4 w-4 mr-2" /> Import PDF / Excel
          </Button>
          <Button onClick={() => { setPrefillData(null); setShowForm(true); }} className="bg-primary hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" /> New PO
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No Purchase Orders" description="Create your first PO or import from email/PDF." actionLabel="Create PO" onAction={() => setShowForm(true)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs w-8">
                      <button onClick={toggleAll} className="p-1 hover:bg-muted rounded">
                        {selectedIds.size === filtered.length && filtered.length > 0 ? <CheckSquare className="h-4 w-4 text-primary"/> : <Square className="h-4 w-4 text-muted-foreground"/>}
                      </button>
                    </TableHead>
                    <TableHead className="text-xs">PO Number</TableHead>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">Approval</TableHead>
                    <TableHead className="text-xs hidden lg:table-cell">Order Date</TableHead>
                    <TableHead className="text-xs hidden lg:table-cell">ETD</TableHead>
                    <TableHead className="text-xs hidden xl:table-cell">ETA</TableHead>
                    <TableHead className="text-xs">Value</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">Qty</TableHead>
                    <TableHead className="text-xs hidden lg:table-cell">CBM</TableHead>
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((po) => (
                    <TableRow key={po.id} className={`hover:bg-muted/30 cursor-pointer ${selectedIds.has(po.id) ? "bg-primary/5" : ""}`} onClick={() => navigate(`/PODetail?id=${po.id}`)}>
                      <TableCell onClick={e => { e.stopPropagation(); toggleOne(po.id); }} className="w-8">
                        <button className="p-1 hover:bg-muted rounded">
                          {selectedIds.has(po.id) ? <CheckSquare className="h-4 w-4 text-primary"/> : <Square className="h-4 w-4 text-muted-foreground"/>}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs font-medium text-primary">{po.po_number}</TableCell>
                      <TableCell className="text-xs">{po.customer_name}</TableCell>
                      <TableCell><StatusBadge status={po.status} /></TableCell>
                      <TableCell className="hidden md:table-cell">
                        {po.approval_status && po.approval_status !== "not_submitted" && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                            po.approval_status === "pending"            ? "bg-amber-50 text-amber-700 border-amber-200" :
                            po.approval_status === "approved"           ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                            po.approval_status === "rejected"           ? "bg-red-50 text-red-700 border-red-200" :
                            po.approval_status === "changes_requested"  ? "bg-orange-50 text-orange-700 border-orange-200" :
                            "bg-gray-50 text-gray-500 border-gray-200"
                          }`}>
                            {po.approval_status === "pending"           ? "⏳ Pending" :
                             po.approval_status === "approved"          ? "✓ Approved" :
                             po.approval_status === "rejected"          ? "✗ Rejected" :
                             po.approval_status === "changes_requested" ? "⚠ Changes Requested" :
                             po.approval_status}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{fmt(po.order_date)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{fmt(po.etd)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden xl:table-cell">{fmt(po.eta)}</TableCell>
                      <TableCell className="text-xs font-medium">
                        <RedactedValue group="PO_FINANCIAL" placeholder={`${po.currency || ""} ••••••`}>
                          {po.currency} {po.total_po_value?.toLocaleString() || "—"}
                        </RedactedValue>
                      </TableCell>
                      <TableCell className="text-xs hidden md:table-cell">{po.total_quantity?.toLocaleString() || "—"}</TableCell>
                      <TableCell className="text-xs hidden lg:table-cell">{po.total_cbm?.toFixed(2) || "—"}</TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => handleDelete(po.id, e)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-xl p-6 shadow-xl flex flex-col items-center gap-3 max-w-sm mx-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground text-center">{importMsg}</p>
            <p className="text-xs text-muted-foreground text-center">Enriching from price list, fabric templates & accessory history…</p>
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-foreground text-background rounded-full shadow-xl px-4 py-2.5 flex items-center gap-2">
          <span className="text-xs font-semibold pr-2 border-r border-background/20">{selectedIds.size} selected</span>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-background hover:bg-background/10 gap-1.5" onClick={handleBulkExportCSV}><FileDown className="h-3.5 w-3.5"/>Export CSV</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-background hover:bg-background/10 gap-1.5" onClick={() => { setBulkDialog("status"); setBulkValue(""); }}><CheckCheck className="h-3.5 w-3.5"/>Status</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-background hover:bg-background/10 gap-1.5" onClick={() => { setBulkDialog("assign"); setBulkValue(""); }}><Users className="h-3.5 w-3.5"/>Assign</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-background hover:bg-background/10 gap-1.5" onClick={() => { setBulkDialog("tag"); setBulkValue(""); }}><TagIcon className="h-3.5 w-3.5"/>Tag</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-red-300 hover:bg-red-500/20 gap-1.5" onClick={handleBulkDelete} disabled={bulkBusy}><Trash2 className="h-3.5 w-3.5"/>Delete</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-background/60 hover:bg-background/10" onClick={clearSel}>Clear</Button>
        </div>
      )}

      <Dialog open={bulkDialog === "status"} onOpenChange={v => { if (!v) { setBulkDialog(null); setBulkValue(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Status for {selectedIds.size} POs</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">New Status</Label>
            <Select value={bulkValue} onValueChange={setBulkValue}>
              <SelectTrigger><SelectValue placeholder="Select status…"/></SelectTrigger>
              <SelectContent>{STATUSES.filter(s => s !== "All").map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkDialog(null); setBulkValue(""); }}>Cancel</Button>
            <Button disabled={!bulkValue || bulkBusy} onClick={handleBulkStatusApply}>{bulkBusy ? "Updating…" : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === "assign"} onOpenChange={v => { if (!v) { setBulkDialog(null); setBulkValue(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign {selectedIds.size} POs</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Assigned to (name or email)</Label>
            <Input value={bulkValue} onChange={e => setBulkValue(e.target.value)} placeholder="e.g. John Doe or john@company.com"/>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkDialog(null); setBulkValue(""); }}>Cancel</Button>
            <Button disabled={!bulkValue.trim() || bulkBusy} onClick={handleBulkAssignApply}>{bulkBusy ? "Updating…" : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === "tag"} onOpenChange={v => { if (!v) { setBulkDialog(null); setBulkValue(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Tags to {selectedIds.size} POs</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Tags (comma-separated)</Label>
            <Input value={bulkValue} onChange={e => setBulkValue(e.target.value)} placeholder="e.g. Urgent, Q2-2026, VIP"/>
            <p className="text-[11px] text-muted-foreground">New tags will be merged with existing ones.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkDialog(null); setBulkValue(""); }}>Cancel</Button>
            <Button disabled={!bulkValue.trim() || bulkBusy} onClick={handleBulkTagApply}>{bulkBusy ? "Adding…" : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <POFormDialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setPrefillData(null); }} onSave={handleCreate} initialData={prefillData} />
      <EmailImportDialog open={showEmailImport} onOpenChange={setShowEmailImport} onExtracted={handleImportExtracted} />
    </div>
  );
}
