import React, { useState, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Database, Upload, Download, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, AlertTriangle, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateMasterData } from "@/lib/validators/masterDataValidator";
import ValidationReport from "@/components/masterdata/ValidationReport";

async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.XLSX;
}

const toStr  = (v) => v == null ? null : (String(v).trim() || null);
const toNum  = (v) => { if (v === "" || v == null) return null; const n = Number(v); return isNaN(n) ? null : n; };
const toBool = (v) => { if (typeof v === "boolean") return v; if (v == null || v === "") return null; const s = String(v).trim().toLowerCase(); return s === "true" || s === "yes" || s === "1"; };
const toDate = (v) => { if (!v) return null; const s = String(v).trim(); return s || null; };

const SHEETS = {
  "1. Articles (SKUs)": {
    table: "articles",
    matchBy: ["article_code"],
    required: ["item_code"],
    columns: ["tech_pack_code","brand","product_type","product_category","size","item_code","bob_sku","color","product_length_in","product_width_in","product_depth_in","finish_dimensions","insert_dimensions","pvc_bag_dimensions","stiffener_size","zipper_length_cm","units_per_carton","carton_size_cm"],
    transform: (r) => ({
      article_code: toStr(r.item_code),
      article_name: [toStr(r.product_type), toStr(r.size), toStr(r.color)].filter(Boolean).join(" — ") || toStr(r.item_code),
      color: toStr(r.color),
      size: toStr(r.size),
      product_category: toStr(r.product_category),
      product_length_in: toNum(r.product_length_in),
      product_width_in:  toNum(r.product_width_in),
      product_depth_in:  toNum(r.product_depth_in),
      finish_dimensions: toStr(r.finish_dimensions),
      order_quantity: 0,
      size_labels: toStr(r.size) ? [toStr(r.size)] : [],
    }),
  },
  "2. SKU Fabric Consumption": {
    table: "consumption_library",
    matchBy: ["item_code","kind","component_type","color"],
    required: ["item_code","component_type"],
    columns: ["tech_pack_code","item_code","size","product_size","component_type","direction","fabric_type","construction","yarn_count","composition","gsm","finish","color","width_cm","consumption_per_unit","wastage_percent","total_required","supplier","remarks"],
    transform: (r) => ({
      item_code: toStr(r.item_code), size: toStr(r.size),
      kind: "fabric", component_type: toStr(r.component_type),
      fabric_type: toStr(r.fabric_type), gsm: toNum(r.gsm),
      construction: toStr(r.construction),
      treatment: toStr(r.finish) || toStr(r.treatment),
      // Upsert key requires non-null for stable matching (see 2026-04-24 cleanup migration)
      color: toStr(r.color) ?? "", material: "",
      width_cm: toNum(r.width_cm),
      consumption_per_unit: toNum(r.consumption_per_unit),
      wastage_percent: toNum(r.wastage_percent),
      supplier: toStr(r.supplier), tech_pack_code: toStr(r.tech_pack_code),
      notes: [toStr(r.direction) ? `dir: ${toStr(r.direction)}` : null,
              toStr(r.product_size) ? `size: ${toStr(r.product_size)}` : null,
              toStr(r.yarn_count) ? `yarn: ${toStr(r.yarn_count)}` : null,
              toStr(r.composition) ? `comp: ${toStr(r.composition)}` : null,
              toStr(r.remarks) || null].filter(Boolean).join(" · ") || null,
    }),
  },
  "3. SKU Accessory Consumption": {
    table: "consumption_library",
    matchBy: ["item_code","kind","component_type","material"],
    required: ["item_code","category"],
    columns: ["tech_pack_code","item_code","size","category","item_name","material","size_spec","placement","variant","consumption_per_unit","unit","wastage_percent","total_required","supplier"],
    transform: (r) => {
      const itemName = toStr(r.item_name) || "";
      const rawMaterial = toStr(r.material) || "";
      // Disambiguate: include both item_name AND material in the material field
      // so e.g. (Care Label, "3M non-woven") and (Size Label, "3M non-woven")
      // become distinct upsert keys. Within a single SKU+category, duplicates
      // only collide if BOTH item_name and material are identical (a true dup).
      let material;
      if (itemName && rawMaterial && itemName !== rawMaterial) {
        material = `${itemName} — ${rawMaterial}`;
      } else {
        material = itemName || rawMaterial || "";
      }
      return {
        item_code: toStr(r.item_code), size: toStr(r.size),
        kind: "accessory",
        component_type: toStr(r.category) || itemName,
        color: "",
        material,
        size_spec: toStr(r.size_spec),
        placement: toStr(r.placement),
        consumption_per_unit: toNum(r.consumption_per_unit),
        wastage_percent: toNum(r.wastage_percent) || 0,
        supplier: toStr(r.supplier), tech_pack_code: toStr(r.tech_pack_code),
        notes: [toStr(r.variant), toStr(r.unit) ? `unit: ${toStr(r.unit)}` : null].filter(Boolean).join(" · ") || null,
      };
    },
  },
  "4. Carton Master": {
    table: "price_list", matchBy: ["item_code"], required: ["item_code"],
    columns: ["tech_pack_code","size","item_code","units_per_carton","carton_size_cm","carton_length_cm","carton_width_cm","carton_height_cm","cbm_per_carton","weight_per_carton_kg"],
    transform: (r) => {
      const L = toNum(r.carton_length_cm), W = toNum(r.carton_width_cm), H = toNum(r.carton_height_cm);
      const cbm = toNum(r.cbm_per_carton) ?? (L && W && H ? +((L*W*H)/1e6).toFixed(4) : null);
      return {
        item_code: toStr(r.item_code),
        description: toStr(r.size) ? `Size ${toStr(r.size)}` : null,
        qty_per_carton: toNum(r.units_per_carton),
        carton_length: L, carton_width: W, carton_height: H,
        cbm_per_carton: cbm,
      };
    },
  },
  "5. Price List": {
    table: "price_list", matchBy: ["item_code"], required: ["item_code"],
    columns: ["item_code","item_description","price_usd","currency","effective_from","effective_to","pieces_per_carton","carton_length_cm","carton_width_cm","carton_height_cm","cbm_per_carton","is_active","notes"],
    transform: (r) => {
      const L = toNum(r.carton_length_cm), W = toNum(r.carton_width_cm), H = toNum(r.carton_height_cm);
      const cbm = toNum(r.cbm_per_carton) ?? (L && W && H ? +((L*W*H)/1e6).toFixed(4) : null);
      const price = toNum(r.price_usd);
      const effFrom = toDate(r.effective_from);
      const effTo = toDate(r.effective_to);
      // Determine pricing_status:
      //   - has price + has effective_from → 'active' as given
      //   - has price, no effective_from   → 'active', set effective_from = today
      //   - missing price, has effective_to → INVALID (caller validates)
      //   - missing price, no dates        → 'pending', set effective_from = today
      const today = new Date().toISOString().slice(0, 10);
      let status = "active";
      let finalEffFrom = effFrom;
      if (price == null) {
        // No price provided
        if (effTo != null) {
          // Has end date but no price/start — invalid; let validator block
          status = "invalid";
        } else {
          status = "pending";
          finalEffFrom = today;
        }
      } else {
        // Has price
        if (effFrom == null) finalEffFrom = today;
      }
      return {
        item_code: toStr(r.item_code), description: toStr(r.item_description),
        price_usd: price, currency: toStr(r.currency) || "USD",
        qty_per_carton: toNum(r.pieces_per_carton),
        carton_length: L, carton_width: W, carton_height: H, cbm_per_carton: cbm,
        effective_from: finalEffFrom, effective_to: effTo,
        is_active: toBool(r.is_active) ?? true,
        pricing_status: status === "invalid" ? "active" : status,  // 'invalid' rejected pre-import; never reaches DB
        notes: toStr(r.notes),
      };
    },
    // Custom validator: reject only when price is missing AND effective_to is set
    validate: (row) => {
      if (!row.item_code) return "missing item_code";
      if (row.price_usd == null && row.effective_to != null) {
        return "missing price_usd but has effective_to (cannot determine when price expires from no price)";
      }
      return null;
    },
  },
  "6. Suppliers": {
    table: "suppliers", matchBy: ["name"], required: ["name"],
    columns: ["name","code","category","supplier_type","contact_person","email","phone","whatsapp","city","country","payment_terms","currency","lead_time_days","rating","notes"],
    transform: (r) => ({
      name: toStr(r.name), code: toStr(r.code), category: toStr(r.category),
      supplier_type: toStr(r.supplier_type), contact_person: toStr(r.contact_person),
      email: toStr(r.email), phone: toStr(r.phone), whatsapp: toStr(r.whatsapp),
      city: toStr(r.city), country: toStr(r.country),
      payment_terms: toStr(r.payment_terms), currency: toStr(r.currency) || "USD",
      lead_time_days: toNum(r.lead_time_days), rating: toNum(r.rating), notes: toStr(r.notes),
    }),
  },
  "7. Seasons": {
    table: "seasons", matchBy: ["name"], required: ["name"],
    columns: ["name","start_date","end_date","notes","status"],
    transform: (r) => {
      const STATUS_MAP = {
        "planning":"Planning", "active":"Active", "completed":"Completed", "cancelled":"Cancelled",
        "Planning":"Planning", "Active":"Active", "Completed":"Completed", "Cancelled":"Cancelled",
      };
      const raw = toStr(r.status) || "Active";
      return {
        name: toStr(r.name),
        start_date: toDate(r.start_date), end_date: toDate(r.end_date),
        notes: toStr(r.notes),
        status: STATUS_MAP[raw] || "Active",
      };
    },
  },
  "8. Production Lines": {
    table: "production_lines", matchBy: ["name"], required: ["name","line_type","daily_capacity"],
    columns: ["name","line_type","daily_capacity","operator_count","is_active","notes"],
    transform: (r) => ({
      name: toStr(r.name), line_type: toStr(r.line_type) || "stitching",
      daily_capacity: toNum(r.daily_capacity) || 0, operator_count: toNum(r.operator_count) || 0,
      is_active: toBool(r.is_active) ?? true, notes: toStr(r.notes),
    }),
  },
};

const SHEET_ORDER = Object.keys(SHEETS);

function readSheet(XLSX, wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  return rows.filter(r => Object.values(r).some(v => String(v).trim() !== ""));
}

function validate(row, cfg) {
  const errs = [];
  for (const req of cfg.required) {
    const v = row[req];
    if (v == null || String(v).trim() === "") errs.push(`missing ${req}`);
  }
  return errs;
}

export default function MasterData() {
  const qc = useQueryClient();
  const [stage, setStage] = useState("idle");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [validation, setValidation] = useState(null);
  const [activeTab, setActiveTab] = useState(SHEET_ORDER[0]);
  const [tpLinked, setTpLinked] = useState(new Set());
  const fileRef = useRef();

  const reset = () => {
    setStage("idle"); setMessage(""); setPreview(null); setValidation(null); setTpLinked(new Set());
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadTemplate = () => {
    const a = document.createElement("a");
    a.href = "/bob-techpack-master-data.xlsx";
    a.download = "merquant-master-data-template.xlsx";
    a.click();
  };

  const handleFile = async (f) => {
    if (!f) return;
    setStage("parsing"); setMessage(`Reading ${f.name}…`);
    try {
      const XLSX = await loadSheetJS();
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const report = {};
      for (const sheetName of SHEET_ORDER) {
        const cfg = SHEETS[sheetName];
        const rows = readSheet(XLSX, wb, sheetName);
        const valid = [], invalid = [];
        for (const raw of rows) {
          const errs = validate(raw, cfg);
          if (errs.length) invalid.push({ raw, errors: errs });
          else {
            try { valid.push({ raw, payload: cfg.transform(raw) }); }
            catch (e) { invalid.push({ raw, errors: [e.message] }); }
          }
        }
        report[sheetName] = { valid, invalid };
      }

      const itemCodes = new Set();
      for (const s of ["2. SKU Fabric Consumption","3. SKU Accessory Consumption","1. Articles (SKUs)"]) {
        for (const v of report[s]?.valid || []) {
          const ic = v.payload.item_code || v.payload.article_code;
          if (ic) itemCodes.add(ic);
        }
      }
      if (itemCodes.size) {
        const { data: tps } = await supabase.from("tech_packs")
          .select("article_code").in("article_code", Array.from(itemCodes));
        setTpLinked(new Set((tps || []).map(t => t.article_code)));
      }

      setPreview(report); setStage("preview");
      const totV = Object.values(report).reduce((s, r) => s + r.valid.length, 0);
      const totI = Object.values(report).reduce((s, r) => s + r.invalid.length, 0);
      setMessage(`${totV} rows ready · ${totI} with errors`);
      const first = SHEET_ORDER.find(n => report[n].valid.length + report[n].invalid.length > 0);
      if (first) setActiveTab(first);

      // Layer 1 deterministic validation — runs across ALL parsed rows (valid+invalid).
      // Catches structural issues like duplicate upsert keys BEFORE the user clicks Import,
      // so we don't hit the "ON CONFLICT DO UPDATE cannot affect row a second time" failure.
      const sheetsForValidation = {};
      for (const sheetName of SHEET_ORDER) {
        const r = report[sheetName];
        if (!r) continue;
        sheetsForValidation[sheetName] = [
          ...r.valid.map(v => v.raw),
          ...r.invalid.map(v => v.raw),
        ];
      }
      setValidation(validateMasterData(sheetsForValidation));
    } catch (e) { setStage("error"); setMessage(e.message || "Parse failed"); }
  };

  const handleImport = async () => {
    if (!preview) return;
    setStage("importing");
    setMessage("Starting import…");

    let wakeLock = null;
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen").catch(() => null);
      }
    } catch {}

    try {
      const order = ["1. Articles (SKUs)","2. SKU Fabric Consumption","3. SKU Accessory Consumption",
                     "6. Suppliers","7. Seasons","8. Production Lines","4. Carton Master","5. Price List"];

      const conflictCols = {
        articles:             "article_code",
        consumption_library:  "item_code,kind,component_type,color,material",
        suppliers:            "name",
        buyer_contacts:       "customer_name,email",
        seasons:              "name",
        production_lines:     "name",
        price_list:           "item_code",
      };

      const { data: allTps } = await supabase.from("tech_packs").select("id, article_code");
      const tpByCode = (allTps || []).map(t => [t.article_code, t.id]);

      const rowsBySheet = {};
      for (const sheetName of order) {
        const cfg = SHEETS[sheetName];
        const rows = (preview[sheetName]?.valid || []).map(v => v.payload);
        rowsBySheet[sheetName] = { table: cfg.table, rows };
      }

      const { data: { session } } = await supabase.auth.getSession();

      const worker = new Worker(new URL("../workers/masterDataWorker.js", import.meta.url), { type: "module" });

      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === "progress") {
            setMessage(`${m.sheet}: ${m.done} / ${m.total}`);
          } else if (m.type === "done") {
            resolve({ totalIns: m.totalIns, failures: m.failures });
          } else if (m.type === "error") {
            reject(new Error(m.message));
          }
        };
        worker.onerror = (e) => reject(new Error(e.message || "Worker error"));
        worker.postMessage({
          type: "import",
          supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
          anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          accessToken: session?.access_token,
          rowsBySheet,
          conflictCols,
          order,
          tpByCode,
        });
      });

      worker.terminate();

      ["suppliers","buyerContacts","seasons","prodLines","priceList","allArticles","consumptionLibrary"]
        .forEach(k => qc.invalidateQueries({ queryKey: [k] }));

      // After import: check if any rows landed with pricing_status='pending'
      // and email the owner so they know to fill prices.
      let pendingCount = 0;
      try {
        const importedItemCodes = (preview["5. Price List"]?.valid || [])
          .map(v => v.payload?.item_code)
          .filter(Boolean);
        if (importedItemCodes.length > 0) {
          const { data: pendingRows } = await supabase
            .from("price_list")
            .select("item_code,description,effective_from")
            .eq("pricing_status", "pending")
            .in("item_code", importedItemCodes);
          pendingCount = pendingRows?.length || 0;
          if (pendingCount > 0) {
            // Fire-and-forget notification to owner via edge function.
            // Don't block the success message on email delivery.
            supabase.functions.invoke("notify-pricing-pending", {
              body: { rows: pendingRows },
            }).catch(err => console.warn("[notify-pricing-pending] failed:", err));
          }
        }
      } catch (err) {
        console.warn("[pricing-status check] failed:", err);
      }

      setStage("done");
      const baseMsg = result.failures.length
        ? `Imported ${result.totalIns} rows · ${result.failures.length} chunk(s) failed (see console)`
        : `Imported ${result.totalIns} rows`;
      setMessage(pendingCount > 0
        ? `${baseMsg} · ${pendingCount} item(s) flagged for pricing — owner notified`
        : baseMsg);
      if (result.failures.length) console.warn("Import warnings:", result.failures);
    } catch (e) {
      setStage("error"); setMessage(e.message || "Import failed");
    } finally {
      if (wakeLock) wakeLock.release().catch(() => {});
    }
  };

  const handleExport = async () => {
    setStage("importing"); setMessage("Exporting current data…");
    try {
      const XLSX = await loadSheetJS();
      const wb = XLSX.utils.book_new();
      for (const sheetName of SHEET_ORDER) {
        const cfg = SHEETS[sheetName];
        let rows = [];
        if (cfg.table === "consumption_library") {
          const kind = sheetName.includes("Fabric") ? "fabric" : "accessory";
          const { data } = await supabase.from("consumption_library").select("*").eq("kind", kind);
          rows = (data || []).map(r => {
            const out = {};
            for (const col of cfg.columns) {
              if (col === "category" || col === "item_name") out[col] = r.component_type;
              else out[col] = r[col] ?? "";
            }
            return out;
          });
        } else if (cfg.table === "articles") {
          const { data } = await supabase.from("articles").select("*");
          rows = (data || []).map(r => {
            const out = {};
            for (const col of cfg.columns) {
              if (col === "item_code") out[col] = r.article_code;
              else out[col] = r[col] ?? "";
            }
            return out;
          });
        } else {
          const { data } = await supabase.from(cfg.table).select("*");
          rows = (data || []).map(r => {
            const out = {};
            for (const col of cfg.columns) {
              if (col === "carton_length_cm") out[col] = r.carton_length;
              else if (col === "carton_width_cm")  out[col] = r.carton_width;
              else if (col === "carton_height_cm") out[col] = r.carton_height;
              else out[col] = r[col] ?? "";
            }
            return out;
          });
        }
        const ws = XLSX.utils.json_to_sheet(rows, { header: cfg.columns });
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
      const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `merquant-master-data-${new Date().toISOString().slice(0,10)}.xlsx`;
      a.click();
      setStage("done"); setMessage("Export complete");
    } catch (e) { setStage("error"); setMessage(e.message || "Export failed"); }
  };

  const groups = useMemo(() => ({
    "Consumption Library": ["1. Articles (SKUs)","2. SKU Fabric Consumption","3. SKU Accessory Consumption","4. Carton Master","5. Price List"],
    "Reference Data":      ["6. Suppliers","7. Seasons","8. Production Lines"],
  }), []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Database className="h-5 w-5 text-primary"/>
          <h1 className="text-base font-bold">Master Data & Consumption Library</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5 mr-1.5"/>Blank Template
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1.5"/>Export Current
          </Button>
        </div>
      </div>

      <Card><CardContent className="p-5 space-y-4">
        {stage === "idle" && (
          <>
            <div onClick={() => fileRef.current?.click()}
                 className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30">
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground"/>
              <p className="text-sm font-medium">Click to upload master data workbook</p>
              <p className="text-xs text-muted-foreground mt-1">.xlsx only · dry-run preview before writes</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden"
                     onChange={e => handleFile(e.target.files[0])}/>
            </div>
            <p className="text-xs text-muted-foreground">
              Fabric & accessory specs come from tech packs. If an item_code has a tech pack, spec fields
              are linked (shown with a link icon). You only edit consumption/width/wastage. Upload writes
              to the consumption library and denormalizes into articles.components[].
            </p>
          </>
        )}

        {(stage === "parsing" || stage === "importing") && (
          <div className="flex items-center gap-3 py-6">
            <Loader2 className="h-5 w-5 text-primary animate-spin"/><p className="text-sm">{message}</p>
          </div>
        )}

        {stage === "preview" && preview && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">{message}</p>

            {Object.entries(groups).map(([groupName, sheets]) => (
              <div key={groupName}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{groupName}</p>
                <div className="flex gap-1 flex-wrap">
                  {sheets.map(s => {
                    const r = preview[s]; if (!r) return null;
                    return (
                      <button key={s} onClick={() => setActiveTab(s)}
                              className={cn("px-3 py-1.5 text-xs font-medium rounded border whitespace-nowrap",
                                activeTab === s ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted")}>
                        {s.replace(/^\d+\. /, "")}
                        {r.valid.length > 0 && <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">{r.valid.length}</span>}
                        {r.invalid.length > 0 && <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1 rounded">{r.invalid.length}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {(() => {
              const r = preview[activeTab]; const cfg = SHEETS[activeTab]; if (!r) return null;
              const isConsumption = cfg.table === "consumption_library";
              const visibleCols = cfg.columns.slice(0, 8);
              return (
                <div className="space-y-2">
                  {r.invalid.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-red-800">
                        <AlertTriangle className="h-3 w-3 inline mr-1"/>
                        {r.invalid.length} row{r.invalid.length !== 1 ? "s" : ""} skipped
                      </p>
                      <ul className="text-[11px] text-red-700 mt-1 max-h-24 overflow-y-auto">
                        {r.invalid.slice(0, 10).map((x, i) => <li key={i}>→ {x.errors.join(", ")}</li>)}
                      </ul>
                    </div>
                  )}

                  {r.valid.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2">No valid rows.</p>
                  ) : (
                    <div className="border rounded-lg max-h-96 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-[#1F3864] text-white sticky top-0">
                          <tr>
                            {isConsumption && <th className="px-2 py-1.5 w-6"></th>}
                            {visibleCols.map(c => <th key={c} className="text-left px-2 py-1.5 font-medium">{c}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {r.valid.slice(0, 50).map((v, i) => {
                            const hasTP = isConsumption && tpLinked.has(v.payload.item_code);
                            return (
                              <tr key={i} className={cn("border-b", i % 2 === 0 && "bg-[#EBF0FA]/50", hasTP && "bg-emerald-50/40")}>
                                {isConsumption && <td className="px-2 py-1.5">{hasTP && <LinkIcon className="h-3 w-3 text-emerald-600"/>}</td>}
                                {visibleCols.map(c => <td key={c} className="px-2 py-1.5 truncate max-w-[200px]">{String(v.raw[c] ?? v.payload[c] ?? "")}</td>)}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {r.valid.length > 50 && (
                        <p className="text-[10px] text-muted-foreground px-2 py-1">Showing first 50 of {r.valid.length}. All will import.</p>
                      )}
                    </div>
                  )}

                  {isConsumption && tpLinked.size > 0 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <LinkIcon className="h-3 w-3 text-emerald-600"/>
                      Linked to tech pack — spec fields stay in sync on future imports.
                    </p>
                  )}
                </div>
              );
            })()}

            {validation && <ValidationReport result={validation} />}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={reset}>Cancel</Button>
              <Button size="sm" onClick={handleImport}
                      disabled={
                        Object.values(preview).every(r => r.valid.length === 0) ||
                        (validation && validation.errors.length > 0)
                      }
                      title={validation && validation.errors.length > 0
                        ? `Fix ${validation.errors.length} error${validation.errors.length > 1 ? 's' : ''} in the validation report to enable Import`
                        : undefined}>
                Import {Object.values(preview).reduce((s, r) => s + r.valid.length, 0)} rows
              </Button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5"/>
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-800">{message}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={reset}>Upload Another</Button>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5"/>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">{message}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={reset}>Try Again</Button>
            </div>
          </div>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-5">
        <p className="text-sm font-semibold mb-3">Workbook structure</p>
        {Object.entries(groups).map(([g, sheets]) => (
          <div key={g} className="mb-4 last:mb-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">{g}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {sheets.map(s => {
                const cfg = SHEETS[s];
                return (
                  <div key={s} className="border rounded-lg px-3 py-2 text-xs">
                    <p className="font-semibold flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground"/>{s.replace(/^\d+\. /, "")}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {cfg.columns.length} cols · Required: {cfg.required.join(", ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Matched by: {cfg.matchBy.join(" + ")}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}
