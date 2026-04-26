import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Plus, Trash2, Upload, Download, Printer, Package, Settings } from "lucide-react";
import UploadPackagingSheet from "@/components/packaging/UploadPackagingSheet";
import { db, mfg, accessoryTemplates, supabase } from "@/api/supabaseClient";
import { resolveDescription, findTechPackForArticle } from "@/lib/descriptionResolver";

// ── Tab configuration ─────────────────────────────────────────────────────

const TAB_CONFIG = {
  Labels: {
    category: "Label",
    typeOptions: [
      "Brand Label","Care Label","Size Label","Direction Label","GOTS Label",
      "Barcode Label","Hang Tag","Country of Origin Label","Composition Label",
      "Wash Label","Price Ticket","Compliance Label","Retailer Label","Eco Label",
      "Care label in 3 Languages 1X3","Custom Label",
    ],
    typeLabel: "Label Type",
    qualityLabel: "Quality / Description",
    qualityPlaceholder: "e.g. Woven, Satin, 3x5cm",
    defaultWastage: 5,
    showMultiplier: true,
  },
  "Insert Card": {
    category: "Insert Card",
    typeOptions: ["Art Card","Box Packaging","Bleach Card","Bux Board","Custom"],
    typeLabel: "Insert Card Type",
    qualityLabel: "Quality / Size",
    qualityPlaceholder: "e.g. 300gsm, 10x15cm",
    defaultWastage: 5,
    showEAN: true,
  },
  Polybag: {
    category: "Polybag",
    typeOptions: ["PVC","PP","PE","LDPE","OPP"],
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
    typeOptions: ["Cardboard","PVC Sheet","Foam Board","MDF","Corrugated","Other"],
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
    typeOptions: ["Printed","Plain","Brown","White"],
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
    typeOptions: ["UPC Sticker","Packaging Info Sticker","Retailer Sticker","Warning Sticker","QR Code Sticker","Compliance Sticker","Custom Sticker"],
    typeLabel: "Sticker Type",
    qualityLabel: "Size / Description",
    qualityPlaceholder: "e.g. 5x3cm, matte",
    defaultWastage: 5,
    showEAN: true,
  },
  Zipper: {
    category: "Zipper",
    typeOptions: ["SBS Nylon Zipper","Coil Zipper","Metal Zipper","Invisible Zipper","Plastic Molded Zipper","Custom"],
    typeLabel: "Zipper Type",
    qualityLabel: "Length / Description",
    qualityPlaceholder: "e.g. #3 SBS locking, 120cm, white",
    defaultWastage: 3,
  },
  Trim: {
    category: "Trim",
    typeOptions: ["Elastic","Drawcord","Cord Lock","Drawcord Stopper","Jacquard Band","Velcro","Rivet","Button","Ribbon","Piping","Custom"],
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

const defaultRow = (cfg) => ({
  type: cfg.typeOptions[0],
  quality: "",
  description: "",
  size: "",
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
  // tech-pack tier — but for Packaging, techPack is always null (Path A), so
  // consumption_library is the only fallback source for this page.
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

  // Tech packs — fetched for future Trims/Accessory wiring. Packaging passes
  // techPack: null to resolveDescription (Path A), so this data is not used on
  // this page today. The query is cheap (5 columns, extracted-only rows) and
  // including it here means the dependency key already accounts for it.
  const { data: techPacks = [] } = useQuery({
    queryKey: ["techPacksExtracted"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tech_packs")
        .select("id,article_code,po_id,extracted_accessory_specs,extracted_trim_specs,extracted_label_specs")
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

  // Build carton size map from PO items: article_code → "LxWxH"
  const cartonSizeMap = useMemo(() => {
    const map = {};
    if (activePo) {
      poItemsForCarton.filter(i => i.po_id === activePo.id).forEach(item => {
        if (item.item_code && item.carton_length && item.carton_width && item.carton_height) {
          map[item.item_code.trim().toUpperCase()] = `${item.carton_length}x${item.carton_width}x${item.carton_height}`;
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
        const existing = existingItems.filter(
          i => i.po_id === activePo.id && i.article_code === art.article_code && i.category === cfg.category
        );

        if (existing.length > 0) {
          init[tab][art.id] = existing.map(e => ({
            type: cfg.category === "Insert Card" ? (e.size_spec || "") : e.item_description,
            quality: cfg.category === "Insert Card" ? (e.item_description || "") : (cfg.splitDescSize ? "" : (e.size_spec || "")),
            description: cfg.splitDescSize ? (e.size_spec || "") : "",
            size: cfg.splitDescSize ? (e.color || "") : "",
            wastage_percent: e.wastage_percent ?? cfg.defaultWastage,
            multiplier: e.multiplier ?? 1,
            pc_ean_code: e.pc_ean_code || "",
            carton_ean_code: e.carton_ean_code || "",
            existing_id: e.id,
          }));
        } else {
          // No saved rows for this article+category — try to seed from master data.
          // For Packaging Planning, techPack is explicitly null (Path A): this page
          // only falls back to consumption_library, never to the tech pack.
          const seeded = resolveDescription({
            articleCode: art.article_code,
            tabCategory: cfg.category,
            cfg,
            masterSpecs: masterAccessorySpecs,
            techPack: null,
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
        const hasContent = cfg.splitDescSize ? (row.description || row.size) : (row.type || row.quality);
        if (!hasContent) continue;
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
          color: cfg.splitDescSize ? (row.size || "") : "",
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

  // Tab summary counts
  const tabCounts = useMemo(() => {
    const counts = {};
    SUB_TABS.forEach(tab => {
      const cfg = TAB_CONFIG[tab];
      counts[tab] = existingItems.filter(
        i => i.po_id === activePo?.id && i.category === cfg.category && i.quantity_required > 0
      ).length;
    });
    return counts;
  }, [existingItems, activePo?.id]);

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
    </div>
  );
}
