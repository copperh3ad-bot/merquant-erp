import React, { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, mfg, supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Plus, Trash2, Download, Printer, Layers, Info, FileText } from "lucide-react";
import { jsPDF } from "jspdf";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Calculation engine                                                        */
/*  Each calc_type has its own formula. To add a new method, add one key.     */
/* ────────────────────────────────────────────────────────────────────────── */
const CALC_TYPES = {
  "Per Piece": {
    desc: "consumption × order_qty",
    consumpLabel: "Pcs/Piece",
    consumpPlaceholder: "e.g. 1, 2",
    unit: "Pcs",
    calc: (row, art) => {
      const qty = art.order_quantity || 0;
      const c = parseFloat(row.consumption_per_unit) || 0;
      const w = parseFloat(row.wastage_percent) || 0;
      return Math.ceil(qty * c * (1 + w / 100));
    },
    qtyLabel: (art) => `Order Qty: ${(art.order_quantity || 0).toLocaleString()} pcs`,
  },
  "Per Meter": {
    desc: "consumption × fabric_meters",
    consumpLabel: "Units/Meter",
    consumpPlaceholder: "e.g. 0.5, 1.2",
    unit: "Meters",
    calc: (row, art) => {
      const meters = parseFloat(row.fabric_meters) || 0;
      const c = parseFloat(row.consumption_per_unit) || 0;
      const w = parseFloat(row.wastage_percent) || 0;
      return Math.ceil(meters * c * (1 + w / 100));
    },
    qtyLabel: (art) => `Fabric: ${(art.total_fabric_required || 0).toLocaleString()} m`,
    needsFabricMeters: true,
  },
  "Per Set": {
    desc: "sets × order_qty",
    consumpLabel: "Sets/Piece",
    consumpPlaceholder: "e.g. 1, 2",
    unit: "Sets",
    calc: (row, art) => {
      const qty = art.order_quantity || 0;
      const c = parseFloat(row.consumption_per_unit) || 0;
      const w = parseFloat(row.wastage_percent) || 0;
      return Math.ceil(qty * c * (1 + w / 100));
    },
    qtyLabel: (art) => `Order Qty: ${(art.order_quantity || 0).toLocaleString()} pcs`,
  },
  "Percentage": {
    desc: "% of order_qty",
    consumpLabel: "% of Qty",
    consumpPlaceholder: "e.g. 5, 10",
    unit: "Pcs",
    calc: (row, art) => {
      const qty = art.order_quantity || 0;
      const pct = parseFloat(row.consumption_per_unit) || 0;
      const w = parseFloat(row.wastage_percent) || 0;
      return Math.ceil(qty * (pct / 100) * (1 + w / 100));
    },
    qtyLabel: (art) => `Order Qty: ${(art.order_quantity || 0).toLocaleString()} pcs`,
  },
  "Per Dozen": {
    desc: "consumption × dozens",
    consumpLabel: "Qty/Dozen",
    consumpPlaceholder: "e.g. 12",
    unit: "Pcs",
    calc: (row, art) => {
      const qty = art.order_quantity || 0;
      const c = parseFloat(row.consumption_per_unit) || 0;
      const w = parseFloat(row.wastage_percent) || 0;
      return Math.ceil((qty / 12) * c * (1 + w / 100));
    },
    qtyLabel: (art) => `Order Qty: ${(art.order_quantity || 0).toLocaleString()} pcs`,
  },
  "Fixed": {
    desc: "fixed total quantity",
    consumpLabel: "Total Qty",
    consumpPlaceholder: "e.g. 500",
    unit: "Pcs",
    calc: (row) => Math.ceil(parseFloat(row.consumption_per_unit) || 0),
    qtyLabel: () => "Flat quantity (no multiplication)",
  },
};

const TRIM_CATEGORIES = [
  "Zipper", "Elastic", "Button", "Dori", "Eyelet", "Stitching Thread",
  "Velcro", "Snap Button", "Hook & Eye", "Buckle", "Drawstring",
  "Ribbon", "Tape", "Interlining", "Lace", "Patch", "Thread", "Other",
];

const UNITS = ["Pcs", "Meters", "Kgs", "Rolls", "Dozens", "Gross", "Sets", "Pairs"];

/* ────────────────────────────────────────────────────────────────────────── */
/*  Styles (match PackagingPlanning for visual consistency)                   */
/* ────────────────────────────────────────────────────────────────────────── */
const inputCls  = "w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400";
const numInputCls = "w-full text-center text-xs border border-gray-300 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400";

const defaultRow = () => ({
  trim_category: "Zipper",
  item_description: "",
  color: "",
  size_spec: "",
  calc_type: "Per Piece",
  consumption_per_unit: 1,
  fabric_meters: "",
  wastage_percent: 5,
  unit: "Pcs",
  supplier: "",
  unit_cost: "",
  status: "Planned",
  notes: "",
  existing_id: null,
});

/* Helper: infer trim category from description text */
function inferCategory(text = "") {
  const s = text.toLowerCase();
  if (/zip|slider/.test(s)) return "Zipper";
  if (/elastic/.test(s)) return "Elastic";
  if (/button/.test(s)) return "Button";
  if (/thread/.test(s)) return "Stitching Thread";
  if (/eyelet/.test(s)) return "Eyelet";
  if (/dori|draw|string/.test(s)) return "Dori";
  if (/velcro/.test(s)) return "Velcro";
  if (/tape|ribbon/.test(s)) return "Ribbon";
  if (/snap/.test(s)) return "Snap Button";
  return "Other";
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Per-Article Block                                                          */
/* ────────────────────────────────────────────────────────────────────────── */
function ArticleBlock({ art, rows, onChange, libraryTrims = [] }) {
  const artRows = rows[art.id] || [defaultRow()];
  const fabricMetersDefault = art.total_fabric_required || 0;

  const add = () => onChange(art.id, [...artRows, { ...defaultRow(), fabric_meters: fabricMetersDefault || "" }]);
  const remove = (idx) => onChange(art.id, artRows.filter((_, i) => i !== idx));
  const update = (idx, field, val) =>
    onChange(art.id, artRows.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const applyFromLibrary = (libId) => {
    if (!libId) return;
    const lib = libraryTrims.find(l => l.id === libId);
    if (!lib) return;
    const newRow = {
      ...defaultRow(),
      trim_category: inferCategory(lib.component_key || lib.component_description),
      item_description: lib.component_description || lib.component_key || "",
      calc_type: "Per Piece",
      consumption_per_unit: lib.consumption_per_unit || 1,
      wastage_percent: lib.wastage_percent || 5,
      unit: lib.unit === "meters" ? "Meters" : "Pcs",
      unit_cost: lib.avg_unit_cost || "",
    };
    // Replace first empty row, else append
    const emptyIdx = artRows.findIndex(r => !r.item_description);
    if (emptyIdx >= 0) {
      const next = [...artRows];
      next[emptyIdx] = newRow;
      onChange(art.id, next);
    } else {
      onChange(art.id, [...artRows, newRow]);
    }
  };

  return (
    <div className="rounded border border-gray-300 shadow-sm overflow-hidden bg-white">
      <div className="px-3 py-2 text-xs font-bold text-white flex justify-between items-center flex-wrap gap-2" style={{ backgroundColor: "#1F3864" }}>
        <span>
          {art.article_name}
          {art.article_code ? ` (${art.article_code})` : ""}
          {art.color ? ` · ${art.color}` : ""}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-normal opacity-80 text-[11px]">
            Qty: {(art.order_quantity || 0).toLocaleString()} · Fabric: {(art.total_fabric_required || 0).toFixed(1)} m
          </span>
          {libraryTrims.length > 0 && (
            <select
              className="text-[11px] text-gray-800 border border-white/30 rounded px-1.5 py-0.5 bg-white/95"
              value=""
              onChange={(e) => { applyFromLibrary(e.target.value); e.target.value = ""; }}
            >
              <option value="">+ From Library</option>
              {libraryTrims.map(l => (
                <option key={l.id} value={l.id}>
                  {l.component_description || l.component_key} · {l.consumption_per_unit}/pc
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#EBF0FA" }}>
              <th className="border border-gray-300 px-2 py-1.5 text-left w-32">Category</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Description / Spec</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left w-24">Color</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left w-24">Size</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center w-28" style={{ backgroundColor: "#E3F2FD" }}>Calc Type</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center w-24" style={{ backgroundColor: "#E3F2FD" }}>Consumption</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center w-24" style={{ backgroundColor: "#E3F2FD" }}>Fabric m</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center w-16">Wastage %</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center w-20">Unit</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center w-24" style={{ backgroundColor: "#FFF2CC" }}>Qty Req.</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left w-28">Supplier</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center w-20">Unit Cost</th>
              <th className="border border-gray-300 px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {artRows.map((row, idx) => {
              const calcDef = CALC_TYPES[row.calc_type] || CALC_TYPES["Per Piece"];
              const calcQty = calcDef.calc(row, art);
              const fabricMetersDisabled = !calcDef.needsFabricMeters;
              return (
                <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <select className={inputCls} value={row.trim_category} onChange={e => update(idx, "trim_category", e.target.value)}>
                      {TRIM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input
                      className={inputCls}
                      placeholder="e.g. 5mm nylon zipper, white"
                      value={row.item_description}
                      onChange={e => update(idx, "item_description", e.target.value)}
                    />
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input className={inputCls} value={row.color} onChange={e => update(idx, "color", e.target.value)} />
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input className={inputCls} placeholder="e.g. 5cm" value={row.size_spec} onChange={e => update(idx, "size_spec", e.target.value)} />
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <select className={inputCls} value={row.calc_type} onChange={e => update(idx, "calc_type", e.target.value)}>
                      {Object.keys(CALC_TYPES).map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input
                      type="number"
                      step="any"
                      className={numInputCls}
                      placeholder={calcDef.consumpPlaceholder}
                      value={row.consumption_per_unit}
                      onChange={e => update(idx, "consumption_per_unit", e.target.value)}
                    />
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input
                      type="number"
                      className={numInputCls + (fabricMetersDisabled ? " bg-gray-100 text-gray-400" : "")}
                      disabled={fabricMetersDisabled}
                      placeholder={fabricMetersDisabled ? "—" : "500"}
                      value={fabricMetersDisabled ? "" : row.fabric_meters}
                      onChange={e => update(idx, "fabric_meters", e.target.value)}
                    />
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input type="number" className={numInputCls} value={row.wastage_percent} onChange={e => update(idx, "wastage_percent", e.target.value)} />
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <select className={inputCls} value={row.unit} onChange={e => update(idx, "unit", e.target.value)}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1 text-center font-bold" style={{ backgroundColor: "#FFF2CC" }}>
                    {calcQty.toLocaleString()}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input className={inputCls} value={row.supplier} onChange={e => update(idx, "supplier", e.target.value)} />
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1">
                    <input type="number" step="any" className={numInputCls} value={row.unit_cost} onChange={e => update(idx, "unit_cost", e.target.value)} />
                  </td>
                  <td className="border border-gray-300 px-1 py-1 text-center">
                    {artRows.length > 1 && (
                      <button onClick={() => remove(idx)} className="text-red-500 hover:text-red-700" title="Remove row">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={13} className="border-t border-gray-200 px-2 py-1.5">
                <button
                  onClick={add}
                  className="text-[11px] text-blue-700 hover:text-blue-900 inline-flex items-center gap-1 font-medium"
                >
                  <Plus className="h-3 w-3" /> Add Row
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Main Page                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */
export default function Trims() {
  const [searchParams] = useSearchParams();
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("po_id") || "");
  const [allRows, setAllRows] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const initKeyRef = useRef(null);
  const qc = useQueryClient();

  const { data: pos = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => db.purchaseOrders.list("-created_at"),
  });
  const activePo = useMemo(
    () => selectedPoId ? pos.find(p => p.id === selectedPoId) : pos[0],
    [pos, selectedPoId]
  );

  const { data: articles = [] } = useQuery({
    queryKey: ["articles", activePo?.id],
    queryFn: () => mfg.articles.listByPO(activePo.id),
    enabled: !!activePo?.id,
  });

  const { data: existingTrims = [] } = useQuery({
    queryKey: ["trims", activePo?.id],
    queryFn: () => mfg.trims.listByPO(activePo.id),
    enabled: !!activePo?.id,
  });

  const { data: libraryByCode = {} } = useQuery({
    queryKey: ["trimLibraryByCode"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("style_consumption")
        .select("*")
        .eq("component_type", "trim")
        .eq("is_active", true);
      if (error) return {};
      const map = {};
      (data || []).forEach(r => {
        if (!r.article_code) return;
        (map[r.article_code] = map[r.article_code] || []).push(r);
      });
      return map;
    },
  });

  /* Seed form state from existing trims + defaults */
  const poArticleIds = articles.map(a => a.id).sort().join(",");
  const trimIds = existingTrims.map(t => t.id).sort().join(",");

  useEffect(() => {
    if (!activePo || articles.length === 0) return;
    const key = `${activePo.id}|${poArticleIds}|${trimIds}`;
    if (initKeyRef.current === key) return;
    initKeyRef.current = key;

    const init = {};
    articles.forEach(art => {
      const existing = existingTrims.filter(
        t => t.po_id === activePo.id && (t.article_code === art.article_code || t.article_name === art.article_name)
      );
      if (existing.length > 0) {
        init[art.id] = existing.map(e => ({
          trim_category: e.trim_category || "Zipper",
          item_description: e.item_description || "",
          color: e.color || "",
          size_spec: e.size_spec || "",
          calc_type: e.calc_type || "Per Piece",
          consumption_per_unit: e.consumption_per_unit ?? 1,
          fabric_meters: e.fabric_meters || "",
          wastage_percent: e.wastage_percent ?? 5,
          unit: e.unit || "Pcs",
          supplier: e.supplier || "",
          unit_cost: e.unit_cost ?? "",
          status: e.status || "Planned",
          notes: e.notes || "",
          existing_id: e.id,
        }));
      } else {
        init[art.id] = [defaultRow()];
      }
    });
    setAllRows(init);
  }, [activePo?.id, poArticleIds, trimIds]);  // eslint-disable-line

  const handleChange = (artId, newRows) =>
    setAllRows(prev => ({ ...prev, [artId]: newRows }));

  /* Save — upsert existing / create new / delete rows removed from form */
  const handleSave = async () => {
    if (!activePo) return;
    setSaving(true);
    setSavedMsg("");
    try {
      const ops = [];
      const keptIds = new Set();

      for (const art of articles) {
        const rows = allRows[art.id] || [];
        for (const row of rows) {
          // Skip blank rows (no description)
          if (!row.item_description) continue;
          const calcDef = CALC_TYPES[row.calc_type] || CALC_TYPES["Per Piece"];
          const qty = calcDef.calc(row, art);
          const unitCost = row.unit_cost === "" ? null : Number(row.unit_cost);
          const payload = {
            po_id: activePo.id,
            po_number: activePo.po_number,
            article_name: art.article_name,
            article_code: art.article_code,
            trim_category: row.trim_category,
            item_description: row.item_description,
            color: row.color || null,
            size_spec: row.size_spec || null,
            calc_type: row.calc_type,
            consumption_per_unit: Number(row.consumption_per_unit) || 0,
            fabric_meters: row.fabric_meters === "" ? null : Number(row.fabric_meters),
            wastage_percent: Number(row.wastage_percent) || 0,
            order_quantity: art.order_quantity || 0,
            quantity_required: qty,
            unit: row.unit || "Pcs",
            supplier: row.supplier || null,
            unit_cost: unitCost,
            total_cost: unitCost != null ? +(unitCost * qty).toFixed(2) : null,
            status: row.status || "Planned",
            notes: row.notes || null,
          };
          if (row.existing_id) {
            keptIds.add(row.existing_id);
            ops.push(mfg.trims.update(row.existing_id, payload));
          } else {
            ops.push(mfg.trims.create(payload));
          }
        }
      }

      // Delete trims that were removed from the form
      for (const t of existingTrims) {
        if (!keptIds.has(t.id)) {
          ops.push(mfg.trims.delete(t.id));
        }
      }

      // Batch in groups of 3 to avoid rate limits
      const BATCH = 3;
      for (let i = 0; i < ops.length; i += BATCH) {
        await Promise.all(ops.slice(i, i + BATCH));
      }
      qc.invalidateQueries({ queryKey: ["trims", activePo.id] });
      initKeyRef.current = null; // force re-seed from fresh data
      setSavedMsg(`Saved ${ops.length} operation${ops.length !== 1 ? "s" : ""}`);
      setTimeout(() => setSavedMsg(""), 3000);
    } finally {
      setSaving(false);
    }
  };

  /* ────────── Summary / Totals ────────── */
  const totals = useMemo(() => {
    const byKey = {};
    articles.forEach(art => {
      (allRows[art.id] || []).forEach(row => {
        if (!row.item_description) return;
        const calcDef = CALC_TYPES[row.calc_type] || CALC_TYPES["Per Piece"];
        const key = `${row.trim_category}||${row.item_description}||${row.unit}`;
        if (!byKey[key]) byKey[key] = { category: row.trim_category, desc: row.item_description, unit: row.unit, qty: 0, cost: 0 };
        const q = calcDef.calc(row, art);
        byKey[key].qty += q;
        if (row.unit_cost) byKey[key].cost += Number(row.unit_cost) * q;
      });
    });
    return Object.values(byKey).sort((a, b) => a.category.localeCompare(b.category) || a.desc.localeCompare(b.desc));
  }, [articles, allRows]);

  const grandTotalCost = totals.reduce((s, t) => s + (t.cost || 0), 0);

  /* ────────── Exports ────────── */
  const handleDownloadCSV = () => {
    const rows = [[
      "PO Number", "Article", "Article Code", "Category", "Description",
      "Color", "Size", "Calc Type", "Consumption", "Fabric m",
      "Order Qty", "Wastage %", "Qty Required", "Unit", "Supplier",
      "Unit Cost", "Total Cost", "Status",
    ]];
    articles.forEach(art => {
      (allRows[art.id] || []).forEach(row => {
        if (!row.item_description) return;
        const calcDef = CALC_TYPES[row.calc_type] || CALC_TYPES["Per Piece"];
        const qty = calcDef.calc(row, art);
        rows.push([
          activePo?.po_number || "",
          art.article_name || "",
          art.article_code || "",
          row.trim_category,
          row.item_description,
          row.color || "",
          row.size_spec || "",
          row.calc_type,
          row.consumption_per_unit,
          row.fabric_meters || "",
          art.order_quantity || 0,
          row.wastage_percent,
          qty,
          row.unit,
          row.supplier || "",
          row.unit_cost || "",
          row.unit_cost ? (Number(row.unit_cost) * qty).toFixed(2) : "",
          row.status || "Planned",
        ]);
      });
    });
    const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: `Trims_${activePo?.po_number || "PO"}.csv`,
    });
    a.click();
  };

  const handlePrint = () => {
    const tableRows = articles.flatMap(art =>
      (allRows[art.id] || [])
        .filter(row => row.item_description)
        .map(row => {
          const calcDef = CALC_TYPES[row.calc_type] || CALC_TYPES["Per Piece"];
          const qty = calcDef.calc(row, art);
          return `<tr>
            <td>${art.article_name || ""}${art.article_code ? ` <span style="color:#888">(${art.article_code})</span>` : ""}</td>
            <td>${row.trim_category}</td>
            <td>${row.item_description}</td>
            <td>${row.color || ""}</td>
            <td>${row.size_spec || ""}</td>
            <td>${row.calc_type}</td>
            <td style="text-align:right">${row.consumption_per_unit}</td>
            <td style="text-align:right">${(art.order_quantity || 0).toLocaleString()}</td>
            <td style="text-align:right">${row.wastage_percent}%</td>
            <td style="background:#FFF2CC;font-weight:bold;text-align:right">${qty.toLocaleString()}</td>
            <td>${row.unit}</td>
            <td>${row.supplier || ""}</td>
          </tr>`;
        })
    ).join("");

    const html = `<html><head><title>Trims — ${activePo?.po_number || ""}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
        h2 { color: #1F3864; margin: 0 0 4px 0; }
        .meta { color: #555; font-size: 11px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #bbb; padding: 4px 6px; }
        th { background: #EBF0FA; text-align: left; }
        tr:nth-child(even) td { background: #F9FAFB; }
      </style></head>
      <body>
        <h2>Trims Planning</h2>
        <div class="meta"><b>PO:</b> ${activePo?.po_number || ""} &nbsp;
          <b>Customer:</b> ${activePo?.customer_name || ""} &nbsp;
          <b>Date:</b> ${new Date().toLocaleDateString()}</div>
        <table>
          <thead><tr>
            <th>Article</th><th>Category</th><th>Description</th><th>Color</th><th>Size</th>
            <th>Calc</th><th>Consumption</th><th>Order Qty</th><th>Wastage %</th>
            <th style="background:#FFF2CC">Qty Required</th><th>Unit</th><th>Supplier</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    w.print();
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", format: "a4" });
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text(`Trims Planning — ${activePo?.po_number || ""}`, 14, 15);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Customer: ${activePo?.customer_name || ""}    Date: ${new Date().toLocaleDateString()}`, 14, 22);

    const cols = ["Article", "Category", "Description", "Color", "Calc", "Consumption", "Order Qty", "Wastage", "Qty Required", "Unit", "Supplier"];
    const widths = [40, 22, 48, 18, 20, 20, 20, 14, 22, 14, 30];
    let y = 32;

    const drawHeader = (yPos) => {
      doc.setFillColor(31, 56, 100); doc.setTextColor(255, 255, 255);
      let x = 14;
      cols.forEach((c, i) => {
        doc.rect(x, yPos - 4, widths[i], 7, "F");
        doc.setFontSize(7); doc.text(c, x + 1, yPos);
        x += widths[i];
      });
      doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");
      return yPos + 5;
    };
    y = drawHeader(y);

    articles.forEach((art) => {
      (allRows[art.id] || []).forEach((row, idx) => {
        if (!row.item_description) return;
        if (y > 190) { doc.addPage(); y = 20; y = drawHeader(y); }
        const calcDef = CALC_TYPES[row.calc_type] || CALC_TYPES["Per Piece"];
        const qty = calcDef.calc(row, art);
        const rowData = [
          (art.article_name || "").substring(0, 22),
          row.trim_category,
          (row.item_description || "").substring(0, 32),
          (row.color || "").substring(0, 10),
          row.calc_type,
          String(row.consumption_per_unit),
          Number(art.order_quantity || 0).toLocaleString(),
          `${row.wastage_percent}%`,
          qty.toLocaleString(),
          row.unit,
          (row.supplier || "").substring(0, 18),
        ];
        if (idx % 2 === 0) {
          doc.setFillColor(235, 240, 250);
          let rx = 14;
          widths.forEach((w) => { doc.rect(rx, y - 3.5, w, 6, "F"); rx += w; });
        }
        doc.setFontSize(7);
        let x = 14;
        rowData.forEach((val, i) => { doc.text(String(val), x + 1, y); x += widths[i]; });
        y += 6;
      });
    });

    doc.save(`Trims_${activePo?.po_number || "PO"}.pdf`);
  };

  if (!activePo) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold">Trims Planning</h1>
          <Select value={selectedPoId || activePo?.id || ""} onValueChange={setSelectedPoId}>
            <SelectTrigger className="w-72 h-8 text-xs">
              <SelectValue placeholder="Select Purchase Order" />
            </SelectTrigger>
            <SelectContent>
              {pos.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.po_number} – {p.customer_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 items-center">
          {savedMsg && <span className="text-xs text-emerald-600 font-medium">✓ {savedMsg}</span>}
          <Button size="sm" onClick={handleSave} disabled={saving || articles.length === 0} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save All"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownloadCSV} className="gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownloadPDF} className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" /> PDF
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5 text-xs">
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </div>
      </div>

      {/* Help strip */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-muted rounded px-3 py-2">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          <b>Calculation types:</b>{" "}
          {Object.entries(CALC_TYPES).map(([k, v]) => (
            <span key={k} className="mr-3">
              <b>{k}</b> = {v.desc}
            </span>
          ))}
        </div>
      </div>

      {articles.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No articles on this PO"
          description="Add articles via Fabric Working or Email Crawler first, then come back to plan trims."
        />
      ) : (
        <div className="space-y-3">
          {articles.map(art => (
            <ArticleBlock
              key={art.id}
              art={art}
              rows={allRows}
              onChange={handleChange}
              libraryTrims={libraryByCode[art.article_code] || []}
            />
          ))}
        </div>
      )}

      {/* Totals summary */}
      {totals.length > 0 && (
        <div className="rounded border border-gray-300 shadow-sm overflow-hidden bg-white">
          <div className="px-3 py-2 text-xs font-bold text-white" style={{ backgroundColor: "#1F3864" }}>
            TRIMS SUMMARY — {activePo.po_number}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ backgroundColor: "#EBF0FA" }}>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">Category</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">Description</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-right w-28">Total Qty</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left w-16">Unit</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-right w-28">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                    <td className="border border-gray-300 px-2 py-1">{t.category}</td>
                    <td className="border border-gray-300 px-2 py-1">{t.desc}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-semibold">{t.qty.toLocaleString()}</td>
                    <td className="border border-gray-300 px-2 py-1">{t.unit}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{t.cost ? t.cost.toFixed(2) : "—"}</td>
                  </tr>
                ))}
                {grandTotalCost > 0 && (
                  <tr style={{ backgroundColor: "#1F3864", color: "white", fontWeight: "bold" }}>
                    <td colSpan={4} className="border border-gray-400 px-2 py-1.5 text-right">GRAND TOTAL</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right">{grandTotalCost.toFixed(2)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
