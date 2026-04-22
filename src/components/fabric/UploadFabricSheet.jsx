import React, { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callClaude } from "@/lib/aiProxy";
import { mfg } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Loader2, CheckCircle, AlertCircle, FileSpreadsheet, Download } from "lucide-react";

// Load SheetJS from CDN for xlsx/xls reading
async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.XLSX;
}

// Convert any supported file type to CSV text for Claude
async function fileToCSV(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  // CSV / TXT — read as text directly
  if (["csv", "txt", "tsv"].includes(ext)) {
    return await file.text();
  }

  // XLSX / XLS / XLSM — use SheetJS
  if (["xlsx", "xls", "xlsm"].includes(ext)) {
    const XLSX = await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    // Use first sheet
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(ws);
  }

  throw new Error(`Unsupported file type: .${ext}. Please use .xlsx, .xls, or .csv`);
}

export default function UploadFabricSheet({ onSuccess, activePo }) {
  const [open, setOpen]       = useState(false);
  const [file, setFile]       = useState(null);
  const [status, setStatus]   = useState("idle"); // idle|reading|extracting|updating|done|error
  const [message, setMessage] = useState("");
  const [results, setResults] = useState(null);
  const inputRef = useRef();
  const qc = useQueryClient();

  const reset = () => { setFile(null); setStatus("idle"); setMessage(""); setResults(null); if (inputRef.current) inputRef.current.value = ""; };

  const handleProcess = async () => {
    if (!file) return;
    try {
      // ── Step 1: Read file ──────────────────────────────────────────────
      setStatus("reading");
      setMessage(`Reading ${file.name}…`);
      const csvText = await fileToCSV(file);

      if (!csvText || csvText.trim().length < 20) {
        setStatus("error");
        setMessage("File appears empty or unreadable. Try saving as CSV from Excel.");
        return;
      }

      // ── Step 2: AI extraction ──────────────────────────────────────────
      setStatus("extracting");
      setMessage("Extracting fabric data with AI…");

      const data = await callClaude({
        system: `You are a textile merchandising assistant that extracts fabric working sheet data.
Return ONLY valid JSON with no markdown, no code fences, no explanation.
The JSON must follow this exact structure: {"articles": [...]}`,
        messages: [{
          role: "user",
          content: `Extract fabric component data from this working sheet. Sheets come in two formats:

FORMAT A — PIVOTED (one row per article, fabric components in columns):
  item_code | article_name | qty | [Fabric1 cols: gsm/width/consumption] | [Fabric2 cols...]
  Each row = 1 article with multiple components across columns.

FORMAT B — FLAT (one row per article-component pair):
  item_code | article_name | qty | component_type | fabric_type | gsm | width | consumption | wastage
  Multiple rows per article, one row per component. GROUP rows by item_code.

CRITICAL RULES:
- If you see rows where item_code is BLANK but other rows above have a code, those blank-code rows are CONTINUATION rows for the SAME article. Merge their components into the previous article.
- If a "row" has no item_code AND no valid SKU format (like ABC-123 or GPMP33), it is NOT an article — it is probably a component header or a fabric-type row. Do not create an article for it.
- Component type names like "Flat Sheet", "Fitted Sheet", "Pillow Case", "Fabric Bag", "Top Fabric", "Lining", "Binding" are COMPONENT TYPES, not article codes. Never use them as item_code.
- An article_code must match an SKU pattern: uppercase letters, numbers, hyphens, optionally a color suffix. Examples: PCSJMO-CK, GPMP33-WHT-S, RNTS-K, MBSHMSB3.
- Skip rows where item_code is missing AND no clear parent article can be inferred.

For each article, extract:
- item_code: the SKU (must look like an SKU) — required
- article_name: full product description
- color: colour if present
- order_quantity: total quantity as number (0 if unknown)
- components: array of:
  {
    "component_type": "Flat Sheet" | "Fitted Sheet" | "Pillow Case" | "Top Fabric" | "Lining" | "Binding" | etc,
    "fabric_type": full fabric description e.g. "70% MODAL 15% Nylon JERSEY KNIT 170GSM",
    "gsm": numeric GSM (null if unknown),
    "width": width in cm (null if unknown),
    "consumption_per_unit": meters per piece — required, skip component if 0 or empty,
    "wastage_percent": wastage % (default 6)
  }

Return {"articles": [...]}

CSV content:
${csvText.substring(0, 15000)}`
        }],
        max_tokens: 4000,
      });

      const raw = data.content?.[0]?.text || "{}";
      let parsed;
      try {
        const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const match = clean.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : { articles: [] };
      } catch {
        parsed = { articles: [] };
      }

      const articles = parsed.articles || [];
      if (!articles.length) {
        setStatus("error");
        setMessage("AI could not extract articles. Make sure the file has item codes and fabric consumption columns.");
        return;
      }

      // ── Step 3: Update database ────────────────────────────────────────
      setStatus("updating");
      setMessage(`Updating ${articles.length} articles in database…`);

      // Reject rows where "item_code" is actually a component type name.
      // Valid SKUs contain at least one digit OR a hyphen; component names
      // like "Flat Sheet" or "Pillow Case" don't.
      const COMPONENT_NAMES = new Set([
        "flat sheet", "fitted sheet", "pillow case", "pillowcase",
        "fabric bag", "top fabric", "bottom fabric", "lining",
        "binding", "piping", "filling", "shell fabric", "main fabric",
        "outer", "inner", "padding", "interlining",
      ]);
      const looksLikeSku = (code) => {
        if (!code) return false;
        const c = String(code).trim();
        if (c.length < 3) return false;
        if (COMPONENT_NAMES.has(c.toLowerCase())) return false;
        // Must contain at least one digit OR one hyphen
        return /\d/.test(c) || /-/.test(c);
      };

      let updated = 0, created = 0, skipped = 0, rejected = 0;

      for (const art of articles) {
        if (!art.item_code) { skipped++; continue; }
        if (!looksLikeSku(art.item_code)) {
          console.warn("UploadFabricSheet: rejected non-SKU row:", art.item_code);
          rejected++; continue;
        }

        const qty = Number(art.order_quantity) || 0;
        const components = (art.components || []).map(c => ({
          component_type:      c.component_type || "Shell Fabric",
          fabric_type:         c.fabric_type || "",
          gsm:                 c.gsm ? Number(c.gsm) : null,
          width:               c.width ? Number(c.width) : null,
          consumption_per_unit: Number(c.consumption_per_unit) || 0,
          wastage_percent:     Number(c.wastage_percent) || 6,
          total_required:      +(
            (Number(c.consumption_per_unit) || 0) *
            Math.max(qty, 1) *
            (1 + (Number(c.wastage_percent) || 6) / 100)
          ).toFixed(4),
        })).filter(c => c.consumption_per_unit > 0);

        if (!components.length) { skipped++; continue; }

        try {
          const totalFabric = +components.reduce((s, c) => s + c.total_required, 0).toFixed(4);

          // Always save to fabric template master (removes total_required for template)
          await mfg.fabricTemplates.upsert({
            article_code: art.item_code,
            article_name: art.article_name || art.item_code,
            components: components.map(({ total_required, ...rest }) => rest),
          });

          // Match to existing articles
          let matches = await mfg.articles.getByCode(art.item_code);
          if (!matches.length) {
            matches = await mfg.articles.searchByCode(art.item_code.trim());
          }

          if (matches.length > 0) {
            for (const m of matches) {
              await mfg.articles.update(m.id, {
                components,
                total_fabric_required: totalFabric,
                ...(qty > 0      ? { order_quantity: qty }                : {}),
                ...(art.color    ? { color: art.color }                   : {}),
                ...(art.article_name ? { article_name: art.article_name } : {}),
              });
              updated++;
            }
          } else {
            await mfg.articles.create({
              article_code:          art.item_code,
              article_name:          art.article_name || art.item_code,
              color:                 art.color || null,
              order_quantity:        qty,
              components,
              total_fabric_required: totalFabric,
              ...(activePo ? { po_id: activePo.id, po_number: activePo.po_number } : {}),
            });
            created++;
          }
        } catch (e) {
          console.error("Article update error:", art.item_code, e);
          skipped++;
        }
      }

      setStatus("done");
      setResults({ updated, created, skipped, rejected, total: articles.length });
      setMessage("Done!");
      qc.invalidateQueries({ queryKey: ["allArticles"] });
      if (onSuccess) onSuccess();

    } catch (err) {
      setStatus("error");
      setMessage(err.message || "Unexpected error — check console for details.");
      console.error("UploadFabricSheet error:", err);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5 text-xs">
        <Upload className="h-3.5 w-3.5"/> Upload Sheet
      </Button>

      <Dialog open={open} onOpenChange={v => { if (!v) reset(); setOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary"/> Upload Fabric Working Sheet
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Upload your fabric working sheet in any format. Claude will extract all fabric
                components and update matching article records automatically.
              </p>
              <button
                className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0 ml-3"
                onClick={() => {
                  const csv = "item_code,article_name,order_quantity,fabric_type,gsm,width_cm,consumption_per_unit,wastage_percent\nGPMP33-WHT-S,Polo Shirt,240,180 GSM Pique 180cm,180,180,1.45,6";
                  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv],{type:"text/csv"})), download: "MerQuant_Template_fabric_working.csv" });
                  a.click();
                }}
              >
                <Download className="h-3 w-3"/> Template
              </button>
            </div>

            {/* File drop zone */}
            {status === "idle" && (
              <div
                onClick={() => inputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground"/>
                <p className="text-sm font-medium">
                  {file ? file.name : "Click to select file"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  .xlsx · .xls · .csv · .txt supported
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls,.xlsm"
                  className="hidden"
                  onChange={e => { setFile(e.target.files[0]); e.target.value = ""; }}
                />
              </div>
            )}

            {/* Progress states */}
            {["reading", "extracting", "updating"].includes(status) && (
              <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl">
                <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0"/>
                <div>
                  <p className="text-sm font-medium text-blue-800">
                    {status === "reading"    ? "Reading file…"           :
                     status === "extracting" ? "AI extracting data…"     :
                                               "Updating database…"}
                  </p>
                  <p className="text-xs text-blue-600 mt-0.5">{message}</p>
                </div>
              </div>
            )}

            {/* Done */}
            {status === "done" && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-emerald-600"/>
                  <p className="text-sm font-semibold text-emerald-800">Import Complete</p>
                </div>
                <p className="text-xs text-emerald-700">
                  {results?.updated} updated · {results?.created} created · {results?.skipped} skipped{results?.rejected ? ` · ${results.rejected} rejected` : ""}
                  {" "}(of {results?.total} articles)
                </p>
                {results?.rejected > 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    {results.rejected} row{results.rejected !== 1 ? "s" : ""} rejected — looked like component types, not SKUs.
                  </p>
                )}
                <p className="text-xs text-emerald-600 mt-1">
                  Fabric templates also saved — future POs will auto-populate.
                </p>
              </div>
            )}

            {/* Error */}
            {status === "error" && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5"/>
                <p className="text-sm text-red-800">{message}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { reset(); setOpen(false); }}>
                {status === "done" ? "Close" : "Cancel"}
              </Button>
              {status === "idle" && (
                <Button size="sm" onClick={handleProcess} disabled={!file}>
                  Process File
                </Button>
              )}
              {(status === "done" || status === "error") && (
                <Button size="sm" onClick={reset}>Upload Another</Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

