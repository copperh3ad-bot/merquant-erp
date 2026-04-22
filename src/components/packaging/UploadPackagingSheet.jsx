import React, { useState, useRef } from "react";
import { callClaude } from "@/lib/aiProxy";
import { articlePackaging } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Loader2, CheckCircle, AlertCircle, FileSpreadsheet } from "lucide-react";

export default function UploadPackagingSheet({ onSuccess }) {
  const [open, setOpen]       = useState(false);
  const [file, setFile]       = useState(null);
  const [status, setStatus]   = useState("idle");   // idle | uploading | extracting | updating | done | error
  const [message, setMessage] = useState("");
  const [results, setResults] = useState(null);
  const inputRef = useRef();

  const reset = () => { setFile(null); setStatus("idle"); setMessage(""); setResults(null); if (inputRef.current) inputRef.current.value = ""; };

  const handleFile = (e) => { const f = e.target.files[0]; if (f) { setFile(f); } e.target.value = ""; };

  const handleProcess = async () => {
    if (!file) return;
    setStatus("uploading"); setMessage("Reading file…");

    let text = "";
    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      try {
        if (!window.XLSX) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
        }
        const buf = await file.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: "array" });
        text = window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      } catch (e) {
        setStatus("error"); setMessage("Could not read Excel file: " + e.message); return;
      }
    } else {
      text = await file.text();
    }

    setStatus("extracting"); setMessage("Extracting packaging data with AI…");

    try {
      const data = await callClaude({
        system: "You are a textile packaging data extractor. Respond ONLY with valid JSON.",
        messages: [{
          role: "user",
          content: `Extract accessories and packaging specs from this CSV/spreadsheet. For each article extract:
- article_name, article_code, customer_name
- labels: array of { label_type, description, supplier, unit_cost, notes }
- polybag: { type (PVC/PP/PE/LDPE/OPP), thickness_microns, printed, size_cm, supplier, unit_cost, notes }
- stiffener: { used, material, size_cm, supplier, unit_cost, notes }
- carton: { type, quality, size_cm, pieces_per_carton, gross_weight_kg, net_weight_kg, supplier, unit_cost }
- stickers: array of { sticker_type, description, supplier, unit_cost, notes }
- notes

Respond ONLY with JSON: {"articles": [...]}

Content:
${text.substring(0, 15000)}`
        }],
        max_tokens: 4000,
      });

      const raw   = data.content?.find(b => b.type === "text")?.text || "{}";
      const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      const extracted = match ? JSON.parse(match[0]) : {};
      const articles  = extracted?.articles || [];

      if (articles.length === 0) {
        setStatus("error"); setMessage("No data extracted. Save as CSV and try again."); return;
      }

      setStatus("updating"); setMessage(`Creating/updating ${articles.length} packaging records…`);

      let created = 0, updated = 0;
      for (const art of articles) {
        if (!art.article_name) continue;
        try {
          const existing = await articlePackaging.getByCode(art.article_code || "");
          if (existing) {
            await articlePackaging.update(existing.id, art); updated++;
          } else {
            await articlePackaging.create(art); created++;
          }
        } catch { continue; }
      }

      setStatus("done");
      setResults({ created, updated });
      setMessage("Done!");
      if (onSuccess) onSuccess();
    } catch (err) {
      setStatus("error"); setMessage("Extraction failed: " + err.message);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5 text-xs">
        <Upload className="h-3.5 w-3.5" /> Upload Sheet
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); setOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Upload Accessories & Packaging Sheet
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload an Excel or CSV with packaging specs. AI will extract label, polybag, carton, and sticker data per article.
            </p>

            {status === "idle" && (
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">{file ? file.name : "Click to select file"}</p>
                <p className="text-xs text-muted-foreground mt-1">Supports .xlsx, .xls, .csv</p>
                <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden" onChange={handleFile} />
              </div>
            )}

            {["uploading","extracting","updating"].includes(status) && (
              <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
                <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0" />
                <p className="text-sm text-blue-800">{message}</p>
              </div>
            )}

            {status === "done" && (
              <div className="p-4 bg-green-50 rounded-lg space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <p className="text-sm font-semibold text-green-800">Import Complete</p>
                </div>
                <p className="text-xs text-green-700">Created: {results?.created} · Updated: {results?.updated} templates</p>
              </div>
            )}

            {status === "error" && (
              <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
                <p className="text-sm text-red-800">{message}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { reset(); setOpen(false); }}>
                {status === "done" ? "Close" : "Cancel"}
              </Button>
              {status === "idle" && (
                <Button size="sm" onClick={handleProcess} disabled={!file}>Process File</Button>
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

