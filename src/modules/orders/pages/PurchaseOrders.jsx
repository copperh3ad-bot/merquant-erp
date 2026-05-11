import React, { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPageUrl } from "@/utils";
import { db, mfg, priceList as priceListAPI, supabase } from "@/api/supabaseClient";
import { normalizeDim2D, normalizeDim3D } from "@/lib/dimensionNormalizer";
import { logError } from "@/lib/logger";
import { ENABLE_UPLOAD_ERROR_LOG } from "@/lib/featureFlags";
import { resolveProductSize } from "@/lib/skuSizeInference";
import { directionForPart } from "@/lib/textileVocabulary";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, FileText, Trash2, Mail, Upload, Loader2, Download, Tag as TagIcon, Users, CheckCheck, FileDown, Square, CheckSquare, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format, differenceInHours } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import POFormDialog from "@/modules/orders/components/po/POFormDialog";
import EmailImportDialog from "@/modules/orders/components/po/EmailImportDialog";
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

  // 48-hour discrepancy tracker: po_items with price mismatch, keyed by po_id
  const { data: mismatchItems = [] } = useQuery({
    queryKey: ["poMismatchItems"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("po_items")
        .select("po_id, price_status, updated_at")
        .eq("price_status", "Mismatch");
      if (error) throw error;
      return data || [];
    },
    staleTime: 2 * 60 * 1000,
  });
  // Map po_id → earliest mismatch timestamp
  const mismatchByPo = mismatchItems.reduce((acc, item) => {
    if (!acc[item.po_id] || new Date(item.updated_at) < new Date(acc[item.po_id])) {
      acc[item.po_id] = item.updated_at;
    }
    return acc;
  }, {});

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

      // ── PO revision detection ─────────────────────────────────────────────
      // If this PO number already exists, treat it as a revision: diff the key
      // fields, log every change to po_change_log, archive the old version,
      // and update the existing row instead of creating a duplicate.
      const { data: existingPoRows } = await supabase
        .from("purchase_orders")
        .select("id, delivery_date, ex_factory_date, etd, eta, total_po_value, total_quantity, payment_terms, status")
        .eq("po_number", poData.po_number)
        .limit(1);
      const existingPo = existingPoRows?.[0];

      let po;
      if (existingPo) {
        const TRACKED = ["delivery_date","ex_factory_date","etd","eta","total_po_value","total_quantity","payment_terms"];
        const changes = TRACKED.filter(f => String(existingPo[f]??'') !== String(poData[f]??''));
        if (changes.length > 0) {
          const changeLogRows = changes.map(f => ({
            po_id: existingPo.id,
            po_number: poData.po_number,
            change_type: "revision",
            field_name: f,
            old_value: String(existingPo[f] ?? ""),
            new_value: String(poData[f] ?? ""),
            reason: "Buyer sent revised PO",
            requested_by: "Import",
            status: "applied",
          }));
          await supabase.from("po_change_log").insert(changeLogRows);
          const changedFields = changes.join(", ");
          setImportMsg(`Revised PO detected — ${changes.length} field(s) changed (${changedFields}). Updating…`);
        }
        po = await db.purchaseOrders.update(existingPo.id, { ...poData, status: existingPo.status });
      } else {
        po = await db.purchaseOrders.create(poData);
      }

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

        // Per docs/architecture.md §4: SKU matching uses NORMALIZATION ONLY
        // (case + whitespace + dashes + base-SKU variant strip). No
        // fuzzy / Levenshtein — that path was responsible for false matches
        // like FRIOMP36 ↔ GPFRIOMP36 in early 2026. SKUs that don't resolve
        // via normalize-then-strip-variant fall through to the SKU review
        // queue, never auto-matched on similarity.
        const baseSkuResolutions = new Map();  // raw -> resolved norm (deterministic, auto-apply)
        const stillMissing = [];
        const stripVariantSuffix = (code) => {
          const m = /^(.+)-([A-Z0-9]{1,4})$/i.exec(code);
          return m ? m[1] : null;
        };
        for (const { raw, norm } of itemCodeNorm) {
          if (hasFabricNorm.has(norm)) continue;
          // Deterministic: strip color/variant suffix from RAW (preserves
          // hyphens), then normalize. If the stripped form is in master,
          // auto-resolve. Otherwise the SKU is genuinely missing.
          const baseRaw = stripVariantSuffix(raw);
          const baseNorm = baseRaw ? normalizeCode(baseRaw) : null;
          if (baseNorm && hasFabricNorm.has(baseNorm)) {
            baseSkuResolutions.set(raw, baseNorm);
            console.log(`[PO Import] Base-SKU match (auto): "${raw}" → "${canonicalFor.get(baseNorm)}"`);
            continue;
          }
          stillMissing.push(raw);
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

        // (No fuzzy-match confirmation step — removed per
        // docs/architecture.md §4. SKUs that didn't resolve via normalize +
        // base-SKU strip are now in stillMissing and will surface as the
        // user-facing error below.)

        if (stillMissing.length) {
          // For each missing SKU compute the closest match in master data
          // (normalized Levenshtein on the canonical-code set). Show only
          // suggestions within edit distance ≤ 3 — anything further is too
          // ambiguous to act on. The operator either fixes the file
          // upstream or hand-edits the SKU and re-imports.
          //
          // ADVISORY ONLY — never auto-applied. The §4 spec mandates
          // normalize-only matching; this Levenshtein pass exists purely
          // to enrich the error message with "did you mean…?" hints.
          // Aligned with MAS PurchaseOrders.jsx.
          const lev = (a, b) => {
            if (a === b) return 0;
            const m = a.length, n = b.length;
            if (!m) return n; if (!n) return m;
            const prev = Array(n + 1).fill(0).map((_, i) => i);
            for (let i = 1; i <= m; i++) {
              let cur = i;
              for (let j = 1; j <= n; j++) {
                const ins = prev[j] + 1;
                const del = cur + 1;
                const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
                prev[j - 1] = cur;
                cur = Math.min(ins, del, sub);
              }
              prev[n] = cur;
            }
            return prev[n];
          };
          const candidates = [...canonicalFor.entries()]; // [[norm, raw], ...]
          const suggestions = stillMissing.map(missing => {
            const mn = normalizeCode(missing);
            let bestRaw = null, bestDist = Infinity;
            for (const [norm, raw] of candidates) {
              const d = lev(mn, norm);
              if (d < bestDist) { bestDist = d; bestRaw = raw; }
            }
            // Threshold: 3 absolute, OR 30% of length, whichever is smaller.
            const thresh = Math.min(3, Math.floor(mn.length * 0.3));
            return { missing, suggestion: bestDist <= thresh ? bestRaw : null, dist: bestDist };
          });
          const lines = suggestions.slice(0, 10).map(s =>
            s.suggestion
              ? `  • "${s.missing}" — did you mean "${s.suggestion}"? (edit distance ${s.dist})`
              : `  • "${s.missing}" — no close match in master data`
          ).join("\n");
          const more = suggestions.length > 10 ? `\n  …and ${suggestions.length - 10} more.` : "";
          throw new Error(
            `Missing SKU(s) in Master Data:\n${lines}${more}\n\n` +
            `To fix:\n` +
            `  1) If a suggestion is correct, update the source file (or rename in master data) so the codes match exactly, then re-import.\n` +
            `  2) Otherwise, add the missing SKU to the Consumption Library before importing this PO.`
          );
        }

        // Build clByCode in the raw-code shape callers expect downstream
        const clByCode = new Map();
        for (const { raw, norm } of itemCodeNorm) {
          clByCode.set(raw, clByNorm.get(norm) || []);
        }

        // Build authoritative BOM from consumption_library — replaces any existing article.components[]
        setImportMsg("Building BOM from Master Data…");
        // Direction lookup is delegated to textileVocabulary.directionForPart()
        // (single source of truth — same table is used by ConsumptionLibrary
        // and any future planning page). Only fabric components have a
        // conventional cut direction; non-fabric (accessory/trim/packaging)
        // returns null per the consumption_library convention.
        const directionFor = (component_type, kind) =>
          kind === "fabric" ? directionForPart(component_type) : null;

        const articleRecords = enrichedItems.map((item) => {
          const code = item.item_code.trim();
          const qty  = Number(item.quantity) || 0;
          const clRows = clByCode.get(code) || [];
          // product_size resolution chain:
          //   1. finish_dimensions on the PO item (e.g. "39x75x18\"")
          //   2. size label on the PO item (Twin / Queen / King / ...)
          //   3. size column on consumption_library (rare, but used when set)
          //   4. SKU-suffix inference (last resort): SLPCSS-KCK-GY → "King/Cal King",
          //      GPMP38 → "38". Better than blank when master data only carries
          //      item_code without a size column.
          const productSize = resolveProductSize({
            finishDimensions:       item.finish_dimensions,
            itemSize:               item.size,
            consumptionLibrarySize: clRows.find((r) => r.size)?.size,
            articleCode:            code,
          });

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
            // Uppercase canonical — matches the DB trigger trg_normalize_article_code
            // and ensures dedupe by article_code below collapses case variants.
            article_code:  String(code).trim().toUpperCase(),
            size:          productSize,
            components,
            order_quantity: qty,
            total_fabric_required,
          };
        });

        // Dedupe by article_code (3 colors → 1 article); sum quantities and total_fabric_required
        const dedupedArticles = Object.values(
          articleRecords.reduce((acc, r) => {
            const k = r.article_code;
            if (!acc[k]) {
              acc[k] = { ...r };
            } else {
              acc[k].order_quantity = (acc[k].order_quantity || 0) + (r.order_quantity || 0);
              acc[k].total_fabric_required = +((acc[k].total_fabric_required || 0) + (r.total_fabric_required || 0)).toFixed(4);
            }
            return acc;
          }, {})
        );

        // Authoritative upsert: replaces components[] on every import.
        // Note: only the columns in dedupedArticles are written; existing
        // dimension columns (carton_size_cm, stiffener_size, etc.) are
        // preserved on UPDATE because they're not in the SET clause.
        await supabase.from("articles").upsert(dedupedArticles, {
          onConflict: "article_code", ignoreDuplicates: false,
        });

        // ── Article dimension backfill from tech_packs ──
        // When a tech pack was uploaded BEFORE the PO, the article row
        // doesn't exist yet at tech-pack time so the tech-pack→article sync
        // (in TechPacks.jsx) couldn't fire. Now that the articles exist,
        // pull the per-SKU dimensions out of any matching tech_packs and
        // fill any NULL dimension columns.
        try {
          const articleCodes = dedupedArticles.map(a => a.article_code).filter(Boolean);
          if (articleCodes.length > 0) {
            // Fetch ALL tech_packs and match case-insensitively in JS.
            // .in() is case-sensitive, and we may have stored article_codes
            // with mixed case ("GPFRIOPPk" tech pack vs "GPFRIOPPK" article).
            const upperCodes = new Set(articleCodes.map(c => String(c).trim().toUpperCase()));
            const { data: allTps } = await supabase
              .from("tech_packs")
              .select("article_code, extracted_measurements");
            const tps = (allTps || []).filter(t =>
              t.article_code && upperCodes.has(String(t.article_code).trim().toUpperCase())
            );
            if (tps.length > 0) {
              // Pick first-seen tech pack per upper-cased article_code.
              const byCode = new Map();
              for (const tp of tps) {
                const k = String(tp.article_code).trim().toUpperCase();
                if (!byCode.has(k)) byCode.set(k, tp);
              }
              for (const [, tp] of byCode) {
                const sku = tp.extracted_measurements?.this_sku;
                if (!sku) continue;

                // IMPORTANT: skip articles.product_dimensions — it's
                // FabricWorking's manual-override slot. Writing the
                // whole-SKU dim here would override its per-component
                // sheet-set resolution (Flat Sheet vs Fitted Sheet vs
                // Pillow Case). The other 5 columns are independent
                // (Packaging Planning's article-fallback target).
                // ilike() so mixed-case article_codes still match.
                const { data: art } = await supabase
                  .from("articles")
                  .select("id, pvc_bag_dimensions, stiffener_size, insert_dimensions, zipper_length_cm, carton_size_cm")
                  .ilike("article_code", tp.article_code)
                  .maybeSingle();
                if (!art) continue;

                const fillIfBlank = (cur, nv) =>
                  (cur == null || String(cur).trim() === "") && nv ? nv : null;

                // Normalize on write — see dimensionNormalizer.js. 2D dims
                // sort smaller→larger so W×L and L×W converge; 3D (carton)
                // and 1D (zipper) preserve order.
                const patch = {
                  pvc_bag_dimensions: fillIfBlank(art.pvc_bag_dimensions, normalizeDim2D(sku.pvc_bag_dimensions)),
                  stiffener_size:     fillIfBlank(art.stiffener_size,     normalizeDim2D(sku.stiffener_size)),
                  insert_dimensions:  fillIfBlank(art.insert_dimensions,  normalizeDim2D(sku.insert_dimensions)),
                  zipper_length_cm:   fillIfBlank(art.zipper_length_cm,   normalizeDim3D(sku.zipper_length)),
                  carton_size_cm:     fillIfBlank(art.carton_size_cm,     normalizeDim3D(sku.carton_size_cm)),
                };
                const filtered = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v != null));
                if (Object.keys(filtered).length > 0) {
                  await supabase.from("articles").update(filtered).eq("id", art.id);
                }
              }
            }
          }
        } catch (dimBackfillErr) {
          // Non-blocking — articles are already saved, this is enrichment.
          console.warn("[PO upload article dim backfill] failed (non-blocking):", dimBackfillErr?.message || dimBackfillErr);
        }

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
      if (ENABLE_UPLOAD_ERROR_LOG()) {
        logError(err, {
          category: "po_import",
          module: "PurchaseOrders",
          isMissingSkus: err?.message?.includes("Missing SKU"),
          severity: "error",
        }).catch(() => {});
      }
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
                      <TableCell className="text-xs font-medium text-primary">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {po.po_number}
                          {mismatchByPo[po.id] && (() => {
                            const hrs = differenceInHours(new Date(), new Date(mismatchByPo[po.id]));
                            return (
                              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${hrs >= 48 ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}
                                title={`Price mismatch since ${format(new Date(mismatchByPo[po.id]), "dd MMM HH:mm")} — notify buyer within 48 hrs`}>
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {hrs >= 48 ? `${hrs}h overdue` : `${hrs}h / 48h`}
                              </span>
                            );
                          })()}
                        </div>
                      </TableCell>
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
