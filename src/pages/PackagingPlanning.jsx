import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Plus, Trash2, Upload, Download, Printer, Package, Settings, FileSpreadsheet } from "lucide-react";
import UploadPackagingSheet from "@/components/packaging/UploadPackagingSheet";
import { db, mfg, accessoryTemplates, supabase } from "@/api/supabaseClient";
import { resolveDescription, findTechPackForArticle, matchesCategory } from "@/lib/descriptionResolver";
import { allCanonicals } from "@/lib/textileVocabulary";
import { isMultiSizeBlob } from "@/lib/dimensionNormalizer";

// ── Tab configuration ─────────────────────────────────────────────────────
//
// 2026-05-02 — typeOptions arrays now sourced from textileVocabulary
// sub-type registries (label_type, polybag_type, sticker_type, zipper_type,
// stiffener_type, insert_card_type, carton_type, trim_detail_type). Adding
// a new sub-type to the central vocab automatically surfaces it as a
// dropdown option here. The per-tab CONTEXT settings (labels, placeholders,
// wastage defaults) stay local because they're UI concerns.

const TAB_CONFIG = {
  Labels: {
    category: "Label",
    typeOptions: allCanonicals("label_type"),
    typeLabel: "Label Type",
    qualityLabel: "Quality / Description",
    qualityPlaceholder: "e.g. Woven, Satin, 3x5cm",
    defaultWastage: 5,
    showMultiplier: true,
  },
  "Insert Card": {
    category: "Insert Card",
    typeOptions: allCanonicals("insert_card_type"),
    typeLabel: "Insert Card Type",
    qualityLabel: "Quality / Size",
    qualityPlaceholder: "e.g. 300gsm, 10x15cm",
    defaultWastage: 5,
    showEAN: true,
  },
  Polybag: {
    category: "Polybag",
    typeOptions: allCanonicals("polybag_type"),
    typeLabel: "Polybag Type",
    splitDescSize: true,
    descLabel: "Description",
    descPlaceholder: "e.g. 50 micron, printed",
    sizeLabel: "Size",
    sizePlaceholder: "e.g. 40x60cm",
    defaultWastage: 3,
  },
  Stiffener: {
    category: "Stiffener",
    typeOptions: allCanonicals("stiffener_type"),
    typeLabel: "Material Type",
    splitDescSize: true,
    descLabel: "Description",
    descPlaceholder: "e.g. 2mm thick, white",
    sizeLabel: "Size",
    sizePlaceholder: "e.g. 20x30cm",
    defaultWastage: 3,
  },
  Carton: {
    category: "Carton",
    typeOptions: allCanonicals("carton_type"),
    typeLabel: "Carton Type",
    splitDescSize: true,
    descLabel: "Description",
    descPlaceholder: "e.g. 5-ply B-flute",
    sizeLabel: "Size (LxWxH cm)",
    sizePlaceholder: "e.g. 56x28x27",
    defaultWastage: 2,
  },
  Sticker: {
    category: "Sticker",
    typeOptions: allCanonicals("sticker_type"),
    typeLabel: "Sticker Type",
    qualityLabel: "Size / Description",
    qualityPlaceholder: "e.g. 5x3cm, matte",
    defaultWastage: 5,
    showEAN: true,
  },
  Zipper: {
    category: "Zipper",
    typeOptions: allCanonicals("zipper_type"),
    typeLabel: "Zipper Type",
    qualityLabel: "Length / Description",
    qualityPlaceholder: "e.g. #3 SBS locking, 120cm, white",
    defaultWastage: 3,
  },
  Trim: {
    category: "Trim",
    typeOptions: allCanonicals("trim_detail_type"),
    typeLabel: "Trim Type",
    qualityLabel: "Material / Description",
    qualityPlaceholder: "e.g. 0.6cm elastic, grey jacquard",
    defaultWastage: 3,
  },
};

const SUB_TABS = Object.keys(TAB_CONFIG);

// ── Helpers ───────────────────────────────────────────────────────────────

const inputCls = "w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400";
const numInputCls = "w-16 text-center text-xs border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400";

const calcInclWastage = (qty, wastage, multiplier = 1) =>
  Math.ceil((qty || 0) * (parseFloat(multiplier) || 1) * (1 + (parseFloat(wastage) || 0) / 100));

// Operator-friendly carton-size formatter — strips trailing decimals.
// Used by cartonSizeMap so a stored value of 60.000 renders as "60"
// rather than "60.0" or "60.000". Aligned with MAS.
const formatNum = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n ?? "");
  return String(num % 1 === 0 ? Math.round(num) : num);
};

// A row is meaningful (counts toward saves + summary) when the user
// has actually provided per-accessory content. Bare type alone — the
// pre-selected dropdown default — is NOT enough: that just means the
// row was seeded with a placeholder. Without this guard, every empty
// row totals to (order_qty × wastage) pieces and pollutes the
// procurement summary.
//
//   non-splitDescSize tabs (Labels, Insert Card, Sticker, Zipper, Trim):
//     row counts if `quality` (the description) is present OR
//     the user has typed a custom type that's not the default.
//   splitDescSize tabs (Polybag, Stiffener, Carton):
//     row counts if `description` OR `size` is present.
//
// Aligned with MAS.
const rowHasContent = (cfg, row) => {
  if (!row) return false;
  if (cfg.splitDescSize) {
    return !!(row.description?.trim() || row.size?.trim());
  }
  const qualityFilled = !!row.quality?.trim();
  // typeOptions[0] is the placeholder default. A row with the
  // placeholder type and no quality is unfilled.
  const typeFilled = !!row.type?.trim() && row.type !== cfg.typeOptions[0];
  return qualityFilled || typeFilled;
};

// Default row leaves `type` empty (placeholder shown via the dropdown
// itself). Without this, rowHasContent had to special-case
// typeOptions[0] which made the rule confusing — empty type now
// genuinely means "nothing selected".
//
// Procurement / floor-supervisor enrichment fields (color, placement,
// supplier) — AI extraction already pulls these from the source
// tech-pack; the page now surfaces them so a buyer can issue a
// complete supplier PO and a floor incharge knows where each accessory
// goes on the article. For splitDescSize tabs (Carton/Polybag/
// Stiffener), `color` is not rendered because their DB color column
// already stores the dimension under a legacy convention.
const defaultRow = (cfg) => ({
  type: "",
  quality: "",
  description: "",
  size: "",
  color: "",
  placement: "",
  supplier: "",
  wastage_percent: cfg.defaultWastage,
  multiplier: 1,
  pc_ean_code: "",
  carton_ean_code: "",
  existing_id: null,
});

// ── Article Block ─────────────────────────────────────────────────────────

function ArticleBlock({ art, cfg, rows, onChange, templates = [], cartonSize = "" }) {
  const qty = art.order_quantity || 0;
  const artRows = rows[art.id] || [defaultRow(cfg)];

  const add = () => {
    const newRow = defaultRow(cfg);
    if (cfg.autoFillSize && cartonSize) newRow.size = cartonSize;
    onChange(art.id, [...artRows, newRow]);
  };

  const remove = (idx) => onChange(art.id, artRows.filter((_, i) => i !== idx));

  const update = (idx, field, val) =>
    onChange(art.id, artRows.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const applyTemplate = (tplId) => {
    if (!tplId) return;
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    const newRow = {
      ...defaultRow(cfg),
      type: tpl.type || cfg.typeOptions[0],
      quality: tpl.description || "",
      description: tpl.description || "",
      size: tpl.size_spec || "",
      wastage_percent: tpl.default_wastage ?? cfg.defaultWastage,
      multiplier: tpl.default_multiplier ?? 1,
    };
    const emptyIdx = artRows.findIndex(r => !r.quality && !r.description);
    if (emptyIdx >= 0) {
      const updated = [...artRows]; updated[emptyIdx] = newRow;
      onChange(art.id, updated);
    } else {
      onChange(art.id, [...artRows, newRow]);
    }
  };

  return (
    <div className="rounded border border-gray-300 shadow-sm overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold text-white flex justify-between items-center" style={{ backgroundColor: "#1F3864" }}>
        <span>{art.article_name}{art.article_code ? ` (${art.article_code})` : ""}</span>
        <span className="font-normal opacity-80">Order Qty: {qty.toLocaleString()}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#EBF0FA" }}>
              <th className="border border-gray-300 px-2 py-1.5 text-left w-44">{cfg.typeLabel}</th>
              {cfg.splitDescSize ? (
                <>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">{cfg.descLabel}</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left w-36" style={{ backgroundColor: "#E8F5E9" }}>{cfg.sizeLabel}</th>
                </>
              ) : (
                <th className="border border-gray-300 px-2 py-1.5 text-left">{cfg.qualityLabel}</th>
              )}
              <th className="border border-gray-300 px-2 py-1.5 text-center w-20">Qty</th>
              {cfg.showMultiplier && (
                <th className="border border-gray-300 px-2 py-1.5 text-center w-24" style={{ backgroundColor: "#F3E5F5" }}>Multiplier</th>
              )}
              <th className="border border-gray-300 px-2 py-1.5 text-center w-24">Wastage %</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center w-28" style={{ backgroundColor: "#FFF2CC" }}>Incl. Wastage Qty</th>
              {/* Color column — only on tabs where the DB color
                  column isn't being used for the dimension under the
                  legacy convention. For splitDescSize tabs (Carton /
                  Polybag / Stiffener) the size column already plays
                  that role; their actual colour isn't currently
                  captured. */}
              {!cfg.splitDescSize && (
                <th className="border border-gray-300 px-2 py-1.5 text-left w-36" style={{ backgroundColor: "#FCE4EC" }}>Color</th>
              )}
              <th className="border border-gray-300 px-2 py-1.5 text-left w-44" style={{ backgroundColor: "#E1F5FE" }}>Placement</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left w-32" style={{ backgroundColor: "#FFF8E1" }}>Supplier</th>
              {cfg.showEAN && (
                <>
                  <th className="border border-gray-300 px-2 py-1.5 text-left w-36" style={{ backgroundColor: "#E8F5E9" }}>PC EAN Code</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left w-36" style={{ backgroundColor: "#E3F2FD" }}>Carton EAN Code</th>
                </>
              )}
              <th className="border border-gray-300 px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {artRows.map((row, idx) => (
              <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                <td className="border border-gray-300 px-1.5 py-1">
                  <select className={inputCls} value={row.type} onChange={e => update(idx, "type", e.target.value)}>
                    {cfg.typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                {cfg.splitDescSize ? (
                  <>
                    <td className="border border-gray-300 px-1.5 py-1">
                      <input className={inputCls} placeholder={cfg.descPlaceholder} value={row.description || ""}
                        onChange={e => update(idx, "description", e.target.value)} />
                    </td>
                    <td className="border border-gray-300 px-1.5 py-1" style={{ backgroundColor: "#F1F8E9" }}>
                      <input className={inputCls} placeholder={cfg.sizePlaceholder} value={row.size || ""}
                        onChange={e => update(idx, "size", e.target.value)} />
                    </td>
                  </>
                ) : (
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input className={inputCls} placeholder={cfg.qualityPlaceholder} value={row.quality || ""}
                      onChange={e => update(idx, "quality", e.target.value)} />
                  </td>
                )}
                <td className="border border-gray-300 px-2 py-1 text-center font-medium">{qty.toLocaleString()}</td>
                {cfg.showMultiplier && (
                  <td className="border border-gray-300 px-1.5 py-1 text-center" style={{ backgroundColor: "#FDF6FF" }}>
                    <select
                      className="w-14 text-center text-xs border border-gray-300 rounded px-1 py-0.5"
                      value={row.multiplier || 1}
                      onChange={e => update(idx, "multiplier", parseFloat(e.target.value))}>
                      {Array.from({ length: 20 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={m}>x{m}</option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="border border-gray-300 px-1.5 py-1 text-center">
                  <input type="number" min="0" max="100" step="0.5" className={numInputCls}
                    value={row.wastage_percent}
                    onChange={e => update(idx, "wastage_percent", e.target.value)} />
                </td>
                <td className="border border-gray-300 px-2 py-1 text-center font-bold" style={{ backgroundColor: "#FFF2CC" }}>
                  {calcInclWastage(qty, row.wastage_percent, row.multiplier || 1).toLocaleString()}
                </td>
                {!cfg.splitDescSize && (
                  <td className="border border-gray-300 px-1.5 py-1" style={{ backgroundColor: "#FCE4EC" }}>
                    <input className={inputCls} placeholder="e.g. White / PMS 5255C"
                      value={row.color || ""}
                      onChange={e => update(idx, "color", e.target.value)} />
                  </td>
                )}
                <td className="border border-gray-300 px-1.5 py-1" style={{ backgroundColor: "#E1F5FE" }}>
                  <input className={inputCls} placeholder="e.g. Inside neck seam"
                    value={row.placement || ""}
                    onChange={e => update(idx, "placement", e.target.value)} />
                </td>
                <td className="border border-gray-300 px-1.5 py-1" style={{ backgroundColor: "#FFF8E1" }}>
                  <input className={inputCls} placeholder="Supplier name"
                    value={row.supplier || ""}
                    onChange={e => update(idx, "supplier", e.target.value)} />
                </td>
                {cfg.showEAN && (
                  <>
                    <td className="border border-gray-300 px-1.5 py-1" style={{ backgroundColor: "#F1F8E9" }}>
                      <input className={inputCls} placeholder="e.g. 1234567890123" value={row.pc_ean_code || ""}
                        onChange={e => update(idx, "pc_ean_code", e.target.value)} />
                    </td>
                    <td className="border border-gray-300 px-1.5 py-1" style={{ backgroundColor: "#E3F2FD" }}>
                      <input className={inputCls} placeholder="e.g. 9876543210123" value={row.carton_ean_code || ""}
                        onChange={e => update(idx, "carton_ean_code", e.target.value)} />
                    </td>
                  </>
                )}
                <td className="border border-gray-300 px-1.5 py-1 text-center">
                  {artRows.length > 1 && (
                    <button onClick={() => remove(idx)} className="text-red-400 hover:text-red-600">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-200 flex items-center gap-3">
        <button onClick={add} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium">
          <Plus className="h-3 w-3" /> Add Row
        </button>
        {templates.length > 0 && (
          <select
            className="h-6 text-xs border border-gray-300 rounded px-1.5 bg-white text-gray-600"
            defaultValue=""
            onChange={e => { applyTemplate(e.target.value); e.target.value = ""; }}>
            <option value="" disabled>+ Apply template…</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.template_name} — {t.type}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function PackagingPlanning() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("po_id") || "");
  const [subTab, setSubTab] = useState("Labels");
  const [saving, setSaving] = useState(false);
  const [allRows, setAllRows] = useState({});
  const initKeyRef = useRef(null);

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const { data: articles = [] } = useQuery({ queryKey: ["allArticles"], queryFn: () => mfg.articles.list() });
  const { data: poItemsForCarton = [] } = useQuery({
    queryKey: ["poItemsForCarton"],
    queryFn: async () => {
      const { data, error } = await supabase.from("po_items").select("id,po_id,item_code,carton_length,carton_width,carton_height").limit(2000);
      if (error) return []; return data || [];
    }
  });

  const { data: existingItems = [] } = useQuery({
    queryKey: ["accessoryItems"],
    queryFn: async () => { const { data, error } = await supabase.from("accessory_items").select("*").order("category").limit(5000); if (error) throw error; return data; }
  });

  // Master data accessory specs (consumption_library). Tier-1 of the fallback
  // chain: seeded into rows when no saved accessory_items exist yet for a PO
  // article. If material is empty, resolveDescription falls through to the
  // tech-pack tier (Tier-2). Wired to chain-length-2 (formerly s12 Path A
  // chain-length-1) so Trims, Accessories, and Packaging tabs all pull
  // descriptions from the linked tech pack when consumption_library is empty.
  const { data: masterAccessorySpecs = [] } = useQuery({
    queryKey: ["masterAccessorySpecs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_library")
        .select("item_code,component_type,material,size_spec,placement,wastage_percent,consumption_per_unit")
        .eq("kind", "accessory")
        .limit(5000);
      if (error) return [];
      return data || [];
    }
  });

  // Tech packs — Tier-2 of the fallback chain. Each PO article finds its
  // matching tech pack via findTechPackForArticle (article_code first, then
  // po_id). Used to seed Trim, Accessory, Label, Polybag, Stiffener, Carton,
  // Sticker, etc. tab rows. The resolver reads from up to FIVE sources on
  // each tech_pack row: the three spec JSONB arrays + extracted_measurements
  // (per-SKU pvc_bag/stiffener/carton sizes) + extracted_data.upc (per-size
  // EAN codes). All fetched in one query so the page only round-trips once.
  const { data: techPacks = [] } = useQuery({
    queryKey: ["techPacksExtracted"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tech_packs")
        .select("id,article_code,po_id,extracted_accessory_specs,extracted_trim_specs,extracted_label_specs,extracted_measurements,extracted_data")
        .eq("extraction_status", "extracted")
        .limit(500);
      if (error) return [];
      return data || [];
    }
  });

  const { data: allTemplates = [] } = useQuery({
    queryKey: ["accessoryTemplates"],
    queryFn: () => accessoryTemplates.list(),
  });

  const activePo = useMemo(() =>
    selectedPoId ? pos.find(p => p.id === selectedPoId) : pos[0],
    [pos, selectedPoId]
  );

  const poArticles = useMemo(() =>
    activePo ? articles.filter(a => a.po_id === activePo.id).sort((a, b) => (a.article_name || "").localeCompare(b.article_name || "")) : [],
    [articles, activePo]
  );

  // Build carton size map from PO items: article_code → "LxWxH".
  //
  // The numbers come from po_items.carton_* which were populated by
  // explode_po_bom from master-data (price_list / master_articles).
  // We prefer this over articles.carton_size_cm because the latter
  // can contain the AI's messy combined-size string ("Varies by size:
  // 33X33X32 (Twin XL); 40X40X32 (Full/Queen); ...") whereas this map
  // gives a clean per-article numeric value. Decimals stripped via
  // formatNum for operator-friendly display (60.000 → "60").
  // Aligned with MAS.
  const cartonSizeMap = useMemo(() => {
    const map = {};
    if (activePo) {
      poItemsForCarton.filter(i => i.po_id === activePo.id).forEach(item => {
        if (item.item_code && item.carton_length && item.carton_width && item.carton_height) {
          map[item.item_code.trim().toUpperCase()] =
            `${formatNum(item.carton_length)}x${formatNum(item.carton_width)}x${formatNum(item.carton_height)}`;
        }
      });
    }
    return map;
  }, [poItemsForCarton, activePo]);

  const getCartonSize = (art) => {
    if (!art?.article_code) return "";
    return cartonSizeMap[art.article_code.trim().toUpperCase()] || "";
  };

  const poArticleIds = poArticles.map(a => a.id).sort().join(",");
  const itemIds = existingItems.map(i => i.id).sort().join(",");
  const masterSpecsKey = masterAccessorySpecs.length;
  const techPacksKey = techPacks.length;

  // Initialise rows from existing DB data when PO / articles change
  useEffect(() => {
    if (!activePo || poArticles.length === 0) return;
    const key = `${activePo.id}|${poArticleIds}|${itemIds}|${masterSpecsKey}|${techPacksKey}`;
    if (initKeyRef.current === key) return;
    initKeyRef.current = key;

    const init = {};
    SUB_TABS.forEach(tab => {
      const cfg = TAB_CONFIG[tab];
      init[tab] = {};
      poArticles.forEach(art => {
        // explode_po_bom writes the SPECIFIC accessory_type (e.g.
        // "Master Carton", "Brand Label") into the `category` column
        // rather than the canonical tab name ("Carton", "Label").
        // Strict equality misses those rows. matchesCategory does the
        // same alias-aware lookup the resolver uses elsewhere — same
        // change MAS made.
        const existing = existingItems.filter(
          i => i.po_id === activePo.id
            && i.article_code === art.article_code
            && (i.category === cfg.category || matchesCategory(i.category, cfg.category))
        );

        if (existing.length > 0) {
          init[tab][art.id] = existing.map(e => {
            // Existing accessory_items rows from explode_po_bom land
            // with shape:
            //   item_description = the build description ("3-Ply...")
            //   size_spec        = the SIZE blob ("Varies by size: ...")
            //   color            = NULL
            // …whereas page-saved rows for splitDescSize tabs use the
            // legacy convention where size_spec holds the description
            // text and color holds the dimension.
            //
            // Detect the explode shape via isMultiSizeBlob(size_spec)
            // and rearrange so the UI shows the description in the
            // Description column and gets a clean per-article size
            // from cartonSizeMap (Carton tab) or leaves the size for
            // the user to fill (Polybag / Stiffener).
            const sizeSpecIsBlob = isMultiSizeBlob(e.size_spec);
            if (cfg.splitDescSize && sizeSpecIsBlob) {
              return {
                type: "",
                quality: "",
                description: e.item_description || "",
                size: cfg.category === "Carton"
                  ? (cartonSizeMap[(art.article_code || "").trim().toUpperCase()] || "")
                  : "",
                color:     "",
                placement: e.placement || "",
                supplier:  e.supplier  || "",
                wastage_percent: e.wastage_percent ?? cfg.defaultWastage,
                multiplier: e.multiplier ?? 1,
                pc_ean_code: e.pc_ean_code || "",
                carton_ean_code: e.carton_ean_code || "",
                existing_id: e.id,
              };
            }
            // Standard mapping for page-saved rows.
            return {
              type: cfg.category === "Insert Card" ? (e.size_spec || "") : e.item_description,
              quality: cfg.category === "Insert Card" ? (e.item_description || "") : (cfg.splitDescSize ? "" : (e.size_spec || "")),
              description: cfg.splitDescSize ? (e.size_spec || "") : "",
              size: cfg.splitDescSize ? (e.color || "") : "",
              color:     cfg.splitDescSize ? "" : (e.color || ""),
              placement: e.placement || "",
              supplier:  e.supplier  || "",
              wastage_percent: e.wastage_percent ?? cfg.defaultWastage,
              multiplier: e.multiplier ?? 1,
              pc_ean_code: e.pc_ean_code || "",
              carton_ean_code: e.carton_ean_code || "",
              existing_id: e.id,
            };
          });
        } else {
          // No saved rows for this article+category — try to seed from master
          // data, then fall back to the linked tech pack. Tier-2 picks up
          // descriptions for Trim / Accessory / Label / etc. tabs from the
          // tech pack's JSONB columns when consumption_library has no rows
          // (or rows with empty material). The helper handles per-category
          // dispatch internally — passing techPack non-null is safe across
          // every tab.
          const techPack = findTechPackForArticle({
            articleCode: art.article_code,
            poId: activePo.id,
            techPacks,
          });
          // articleSizes — pass the article row directly. The resolver picks
          // out the relevant per-tab field (carton_size_cm, stiffener_size,
          // pvc_bag_dimensions, insert_dimensions, zipper_length_cm) based
          // on cfg.category. Populated from master-data Articles sheet via
          // migration 0005_articles_size_fields.
          //
          // Override articles.carton_size_cm with the clean numeric value
          // from cartonSizeMap (built off po_items.carton_*, which itself
          // came from master-data). Beats the AI-extracted "Varies by
          // size: 33X33X32cm (Twin XL); 40X40X32 (Full/Queen); ..." string
          // that articles.carton_size_cm sometimes holds for sheet-set
          // tech packs. Falls back to the article's own value when
          // cartonSizeMap has no entry. Aligned with MAS.
          const cleanCarton = getCartonSize(art);
          const articleSizesEffective = cleanCarton
            ? { ...art, carton_size_cm: cleanCarton }
            : art;

          const seeded = resolveDescription({
            articleCode: art.article_code,
            tabCategory: cfg.category,
            cfg,
            masterSpecs: masterAccessorySpecs,
            techPack,
            techPackLabelSpecs: techPack?.extracted_label_specs ?? null,
            articleSizes: articleSizesEffective,
          });
          init[tab][art.id] = seeded ?? [defaultRow(cfg)];
        }
      });
    });

    setAllRows(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePo?.id, poArticleIds, itemIds, masterSpecsKey, techPacksKey]);

  const handleChange = (tab, artId, newRows) =>
    setAllRows(prev => ({ ...prev, [tab]: { ...prev[tab], [artId]: newRows } }));

  const buildOps = (tab) => {
    const cfg = TAB_CONFIG[tab];
    const ops = [];
    for (const art of poArticles) {
      const rows = allRows[tab]?.[art.id] || [];
      for (const row of rows) {
        // rowHasContent treats placeholder-default + empty quality as
        // empty (matches MAS). Per docs/architecture.md §7, an emptied
        // row that came from the DB (existing_id present, no content
        // now) is DELETED — without this branch, clearing a row's
        // fields in the UI silently leaves the old DB row in place.
        if (!rowHasContent(cfg, row)) {
          if (row.existing_id) {
            ops.push(supabase.from("accessory_items").delete().eq("id", row.existing_id));
          }
          continue;
        }
        const qty = art.order_quantity || 0;
        const data = {
          po_id: activePo.id,
          po_number: activePo.po_number,
          article_name: art.article_name,
          article_code: art.article_code,
          category: cfg.category,
          item_description: cfg.category === "Insert Card" ? (row.quality || "") : row.type,
          size_spec: cfg.category === "Insert Card"
            ? (row.type || "")
            : (cfg.splitDescSize ? (row.description || "") : (row.quality || "")),
          // For splitDescSize tabs, DB color holds the dimension under
          // a legacy convention. For all other tabs it holds the
          // actual color (now persisted from row.color).
          color: cfg.splitDescSize ? (row.size || "") : (row.color || ""),
          placement: row.placement || "",
          supplier:  row.supplier  || "",
          quantity_required: calcInclWastage(qty, row.wastage_percent, row.multiplier || 1),
          wastage_percent: parseFloat(row.wastage_percent) || 0,
          multiplier: parseFloat(row.multiplier) || 1,
          pc_ean_code: row.pc_ean_code || "",
          carton_ean_code: row.carton_ean_code || "",
          unit: "Pcs",
          status: "Planned",
        };
        if (row.existing_id) {
          ops.push(supabase.from("accessory_items").update(data).eq("id", row.existing_id));
        } else {
          ops.push(supabase.from("accessory_items").insert(data));
        }
      }
    }
    return ops;
  };

  const handleSaveTab = async () => {
    if (!activePo) return;
    setSaving(true);
    try {
      const ops = buildOps(subTab);
      const BATCH = 5;
      for (let i = 0; i < ops.length; i += BATCH) {
        await Promise.all(ops.slice(i, i + BATCH));
      }
      queryClient.invalidateQueries({ queryKey: ["accessoryItems"] });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    if (!activePo) return;
    setSaving(true);
    try {
      const ops = SUB_TABS.flatMap(tab => buildOps(tab));
      const BATCH = 5;
      for (let i = 0; i < ops.length; i += BATCH) {
        await Promise.all(ops.slice(i, i + BATCH));
      }
      queryClient.invalidateQueries({ queryKey: ["accessoryItems"] });
    } finally {
      setSaving(false);
    }
  };

  // Tab summary counts.
  // Per docs/architecture.md §7 — tabs filter by matchesCategory()
  // (loose substring + alias + exclusion) rather than strict equality.
  // Strict equality would drop e.g. an item with category="Hang Tag"
  // from the Label tab even though Hang Tag is a Label alias per §5.
  const tabCounts = useMemo(() => {
    const counts = {};
    SUB_TABS.forEach(tab => {
      const cfg = TAB_CONFIG[tab];
      counts[tab] = existingItems.filter(
        i => i.po_id === activePo?.id
          && matchesCategory(i.category, cfg.category)
          && i.quantity_required > 0
      ).length;
    });
    return counts;
  }, [existingItems, activePo?.id]);

  // ── Bottom summary: aggregate ALL items for this PO across all tabs ─────
  //
  // Per docs/architecture.md §7, the summary key is the 7-tuple:
  //   (category, item_description, size_spec, color, placement,
  //    supplier, garment_size)
  //
  // Cartons and size-specific labels need to roll up per garment size
  // (Twin, Full, King, etc.) rather than collapsing across the whole PO.
  // articleSizeByCode maps article_code → the garment size on the
  // articles row. This is what gets keyed for the rollup; the
  // accessory_items row itself doesn't (yet) carry garment_size, so we
  // resolve it from the linked article.
  const articleSizeByCode = useMemo(() => {
    const m = new Map();
    for (const a of poArticles) {
      if (a.article_code) {
        m.set(a.article_code.trim().toUpperCase(), a.size || "");
      }
    }
    return m;
  }, [poArticles]);

  const itemSummary = useMemo(() => {
    if (!activePo) return [];
    const map = new Map();
    for (const it of existingItems) {
      if (it.po_id !== activePo.id) continue;
      if (!it.quantity_required || it.quantity_required <= 0) continue;
      // Drop summary rows that carry no descriptive content (legacy
      // empty placeholder rows from before today's empty-row guard).
      if (!String(it.item_description || "").trim() && !String(it.size_spec || "").trim()) continue;
      // Resolve the garment size for this row from the article_code.
      // Falls back to "" if the article isn't in the lookup (shouldn't
      // happen, but defensive).
      const garmentSize = articleSizeByCode.get((it.article_code || "").trim().toUpperCase()) || "";
      const placement = it.placement || "";
      const key = [
        it.category || "",
        it.item_description || "",
        it.size_spec || "",
        it.color || "",
        placement,
        it.supplier || "",
        garmentSize,
      ].join("||");
      if (!map.has(key)) {
        map.set(key, {
          category:         it.category || "",
          item_description: it.item_description || "",
          size_spec:        it.size_spec || "",
          color:            it.color || "",
          placement,
          supplier:         it.supplier || "",
          garment_size:     garmentSize,
          unit:             it.unit || "Pcs",
          total_qty:        0,
          articles:         new Set(),
          pc_ean_codes:     new Set(),
          carton_ean_codes: new Set(),
        });
      }
      const row = map.get(key);
      row.total_qty += Number(it.quantity_required) || 0;
      if (it.article_code) row.articles.add(it.article_code);
      if (it.pc_ean_code) row.pc_ean_codes.add(it.pc_ean_code);
      if (it.carton_ean_code) row.carton_ean_codes.add(it.carton_ean_code);
    }
    return Array.from(map.values())
      .map(r => ({
        ...r,
        articles_count:   r.articles.size,
        articles_list:    Array.from(r.articles).sort().join(", "),
        pc_ean_code:      Array.from(r.pc_ean_codes).join(", "),
        carton_ean_code:  Array.from(r.carton_ean_codes).join(", "),
      }))
      .sort((a, b) =>
        a.category.localeCompare(b.category)
        || a.item_description.localeCompare(b.item_description)
        || (a.garment_size || "").localeCompare(b.garment_size || "")
      );
  }, [existingItems, activePo?.id, articleSizeByCode]);

  // CSV export of the bottom summary. Format is what the procurement team
  // sends to suppliers — flat row-per-item with rolled-up totals.
  const handleExportCSV = () => {
    if (!activePo || itemSummary.length === 0) return;
    const headers = [
      "Category", "Item / Type", "Garment Size", "Size / Description",
      "Color", "Placement", "Supplier",
      "Total Qty (incl wastage)", "Unit",
      "Articles", "Articles count",
      "PC EAN", "Carton EAN",
    ];
    const rows = itemSummary.map(r => [
      r.category, r.item_description, r.garment_size, r.size_spec,
      r.color, r.placement, r.supplier,
      r.total_qty, r.unit,
      r.articles_list, r.articles_count,
      r.pc_ean_code, r.carton_ean_code,
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(cell => {
        const s = String(cell ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `Packaging_Summary_${activePo.po_number || "PO"}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cfg = TAB_CONFIG[subTab];
  const tabTemplates = allTemplates.filter(t => t.category === cfg.category);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold">Packaging Planning</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedPoId || activePo?.id || ""} onValueChange={setSelectedPoId}>
            <SelectTrigger className="w-72 h-8 text-xs">
              <SelectValue placeholder="Select PO" />
            </SelectTrigger>
            <SelectContent>
              {pos.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.po_number} — {p.customer_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <UploadPackagingSheet onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["accessoryItems"] }); }} />
          <Button size="sm" variant="outline" onClick={handleSaveTab} disabled={saving || !activePo} className="gap-1.5 text-xs">
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : `Save ${subTab}`}
          </Button>
          <Button size="sm" onClick={handleSaveAll} disabled={saving || !activePo} className="gap-1.5 text-xs">
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save All"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            disabled={!activePo || itemSummary.length === 0}
            className="gap-1.5 text-xs"
            title={itemSummary.length === 0 ? "Save items first to enable export" : "Download per-item summary as CSV"}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-border overflow-x-auto">
        {SUB_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              subTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {tab}
            {tabCounts[tab] > 0 && (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {tabCounts[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Trim tab — surface Sewing Thread prominently. Threads
          are easy to overlook because they're one entry among many
          on the Trim tab; floor supervisors and procurement both
          need to see the spec at a glance. The banner aggregates
          thread descriptions across techPacks for THIS PO's articles
          and shows them in one read-only block above the per-article
          editing tables. Aligned with MAS — per-spec list with
          color / placement / supplier and article-count. */}
      {subTab === "Trim" && activePo && (() => {
        const threads = new Map(); // key: description+color → { description, color, articles[] }
        for (const art of poArticles) {
          const tp = findTechPackForArticle({
            articleCode: art.article_code,
            poId: activePo.id,
            techPacks,
          });
          const trims = tp?.extracted_trim_specs ?? [];
          for (const t of trims) {
            const looksLikeThread =
              /thread/i.test(t?.trim_type || "") ||
              /thread/i.test(t?.description || "") ||
              /thread/i.test(t?.material || "");
            if (!looksLikeThread) continue;
            const key = `${t.description || t.material || ""}||${t.color || ""}`;
            if (!threads.has(key)) {
              threads.set(key, {
                description: t.description || t.material || "Sewing Thread",
                color: t.color || "",
                placement: t.placement || "",
                supplier: t.supplier || "",
                articles: new Set(),
              });
            }
            if (art.article_code) threads.get(key).articles.add(art.article_code);
          }
        }
        if (threads.size === 0) return null;
        return (
          <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs">
            <div className="font-semibold text-amber-900 mb-1.5">
              🧵 Sewing thread spec — read carefully before issuing the trim PO
            </div>
            <ul className="space-y-1 text-amber-900/90">
              {Array.from(threads.values()).map((t, i) => (
                <li key={i}>
                  <span className="font-medium">{t.description}</span>
                  {t.color && <span> · color: <strong>{t.color}</strong></span>}
                  {t.placement && <span> · use: {t.placement}</span>}
                  {t.supplier && <span> · supplier: {t.supplier}</span>}
                  <span className="text-amber-700/70"> ({t.articles.size} article{t.articles.size === 1 ? "" : "s"})</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Articles */}
      {!activePo ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Select a PO to start packaging planning.</div>
      ) : poArticles.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          No articles found for this PO. Add articles in Fabric Working first.
        </div>
      ) : (
        <div className="space-y-3">
          {poArticles.map(art => (
            <ArticleBlock
              key={art.id}
              art={art}
              cfg={cfg}
              rows={allRows[subTab] || {}}
              onChange={(artId, newRows) => handleChange(subTab, artId, newRows)}
              templates={tabTemplates}
              cartonSize={getCartonSize(art)}
            />
          ))}
        </div>
      )}

      {/* ── Bottom summary: per-item totals across all tabs ─────────────────
          Aggregates every saved row for this PO across all 8 sub-tabs into
          one item-per-row table. Same item ordered for multiple articles
          rolls up into a single line with summed total quantity. This is
          the procurement view — what you'd send to a supplier. */}
      {activePo && itemSummary.length > 0 && (
        <div className="rounded border border-gray-300 shadow-sm overflow-hidden mt-6">
          <div className="px-3 py-2 text-xs font-bold text-white flex justify-between items-center" style={{ backgroundColor: "#1F3864" }}>
            <span>
              Per-Item Summary — {activePo.po_number}
              <span className="ml-2 font-normal opacity-80">({itemSummary.length} unique item{itemSummary.length !== 1 ? "s" : ""})</span>
            </span>
            <span className="font-normal opacity-80 text-[10px]">All saved rows · totals incl. wastage</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ backgroundColor: "#EBF0FA" }}>
                  <th className="border border-gray-300 px-2 py-1.5 text-left w-28">Category</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">Item / Type</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">Size / Description</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-right w-28" style={{ backgroundColor: "#FFF2CC" }}>Total Qty</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-center w-16">Unit</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left w-40">Articles</th>
                </tr>
              </thead>
              <tbody>
                {itemSummary.map((r, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                    <td className="border border-gray-300 px-2 py-1.5 font-medium text-blue-900">{r.category}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{r.item_description || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-muted-foreground">{r.size_spec || "—"}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right font-bold" style={{ backgroundColor: "#FFF2CC" }}>
                      {r.total_qty.toLocaleString()}
                    </td>
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{r.unit}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-[11px] text-muted-foreground" title={r.articles_list}>
                      {r.articles_count} article{r.articles_count !== 1 ? "s" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-200 text-[11px] text-muted-foreground italic">
            Save changes on each tab to update this summary. Use Export CSV (top right) to download.
          </div>
        </div>
      )}
    </div>
  );
}
