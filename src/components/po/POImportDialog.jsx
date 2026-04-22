import React, { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { callClaude } from "@/lib/aiProxy";
import {
  Upload, FileText, FileSpreadsheet, Image, X,
  Loader2, CheckCircle2, AlertCircle, ChevronRight, Sparkles
} from "lucide-react";

const ACCEPTED = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-excel": "XLS",
  "text/csv": "CSV",
  "text/plain": "TXT",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
};

function fileIcon(type) {
  if (type?.includes("image")) return <Image className="h-5 w-5 text-violet-500" />;
  if (type?.includes("pdf")) return <FileText className="h-5 w-5 text-red-500" />;
  if (type?.includes("csv") || type?.includes("text")) return <FileText className="h-5 w-5 text-green-500" />;
  return <FileSpreadsheet className="h-5 w-5 text-emerald-500" />;
}

async function readFileAsBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

async function readXLSX(file) {
  // Dynamically load SheetJS from CDN
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
  const ws = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_csv(ws);
}

async function extractTextFromPDF(file) {
  // Use pdf.js from CDN
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        res();
      };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return text.trim();
}

const SYSTEM_PROMPT = `You are an expert Purchase Order parser for a textile merchandising ERP system.
Extract ALL purchase order data from the provided content and return ONLY valid JSON — no markdown, no explanation, no code fences.

JSON structure (use null for missing fields):
{
  "po_number": string,
  "customer_name": string,
  "order_date": "YYYY-MM-DD" or null,
  "delivery_date": "YYYY-MM-DD" or null,
  "ex_factory_date": "YYYY-MM-DD" or null,
  "etd": "YYYY-MM-DD" or null,
  "eta": "YYYY-MM-DD" or null,
  "currency": "USD"|"EUR"|"GBP"|"INR"|"CNY"|"PKR"|"BDT",
  "total_po_value": number or null,
  "total_quantity": number or null,
  "season": string or null,
  "payment_terms": string or null,
  "ship_via": string or null,
  "port_of_loading": string or null,
  "port_of_destination": string or null,
  "country_of_origin": string or null,
  "ship_to_name": string or null,
  "ship_to_address": string or null,
  "buyer_address": string or null,
  "sales_order_number": string or null,
  "notes": string or null,
  "source": "PDF"|"Email"|"Manual",
  "items": [
    {
      "item_code": string or null,
      "item_description": string,
      "fabric_type": string or null,
      "gsm": number or null,
      "color": string or null,
      "quantity": number,
      "unit": "Pieces"|"Dozens"|"Yards"|"Meters"|"Kg",
      "unit_price": number or null,
      "total_price": number or null,
      "delivery_date": "YYYY-MM-DD" or null,
      "cbm": number or null,
      "pieces_per_carton": number or null,
      "carton_length": number or null,
      "carton_width": number or null,
      "carton_height": number or null
    }
  ]
}

Rules:
- po_number and customer_name are REQUIRED; make a best guess if unclear
- For dates: convert ANY format (DD/MM/YYYY, Month DD YYYY, DD-MMM-YY, etc.) to YYYY-MM-DD
- items array may be empty [] if no line items found
- currency defaults to USD if not specified
- ship_via: look for "Container Direct", "Air", "Courier", etc.
- port_of_loading: factory/origin port (e.g. "Karachi, Pakistan")
- port_of_destination: buyer port (e.g. "Norfolk, Virginia, USA")
- country_of_origin: manufacturing country (e.g. "Pakistan")
- For carton dimensions: look for L×W×H in cm or inches, convert to cm
- Return ONLY the JSON object, nothing else`;

async function callClaudeAPI(messages, isVision = false) {
  const data = await callClaude({ system: SYSTEM_PROMPT, messages, max_tokens: 8000 });
  return data.content?.[0]?.text || "";
}

async function parseFile(file) {
  const type = file.type;
  let messages;

  if (type.includes("image")) {
    const b64 = await readFileAsBase64(file);
    messages = [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: type, data: b64 } },
        { type: "text", text: "Parse this purchase order image and extract all data." }
      ]
    }];
  } else {
    let text = "";
    if (type.includes("pdf")) {
      text = await extractTextFromPDF(file);
      if (!text || text.length < 50) {
        // Scanned PDF — render as image
        const b64 = await readFileAsBase64(file);
        messages = [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: "Parse this purchase order PDF and extract all data." }
          ]
        }];
      } else {
        messages = [{ role: "user", content: `Parse this purchase order text:\n\n${text}` }];
      }
    } else if (type.includes("sheet") || type.includes("excel") || file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      text = await readXLSX(file);
      messages = [{ role: "user", content: `Parse this purchase order spreadsheet data (CSV format):\n\n${text}` }];
    } else {
      text = await readFileAsText(file);
      messages = [{ role: "user", content: `Parse this purchase order:\n\n${text}` }];
    }
  }

  if (!messages) {
    // Fallback: send raw file as text
    const text = await readFileAsText(file).catch(() => `[Could not read file: ${file.name}]`);
    messages = [{ role: "user", content: `Parse this purchase order:\n\n${text.substring(0, 12000)}` }];
  }
  const raw = await callClaudeAPI(messages);
  return safeParseJSON(raw);
}

// Attempt to parse potentially truncated JSON by closing open structures
function safeParseJSON(raw) {
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const match = clean.match(/\{[\s\S]*/);
  if (!match) throw new Error("Could not find JSON in AI response. Try a different file format.");

  let jsonStr = match[0];

  // First try direct parse
  try { return JSON.parse(jsonStr); } catch {}

  // Try to repair truncated JSON — close any open arrays/objects
  try {
    // Count unclosed brackets/braces
    let depth = 0;
    let inString = false;
    let escape = false;
    const closers = [];
    for (let i = 0; i < jsonStr.length; i++) {
      const c = jsonStr[i];
      if (escape) { escape = false; continue; }
      if (c === "\\" && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") closers.push("}");
      else if (c === "[") closers.push("]");
      else if (c === "}" || c === "]") closers.pop();
    }
    // Remove trailing comma before we close
    const repaired = jsonStr.replace(/,\s*$/, "") + closers.reverse().join("");
    return JSON.parse(repaired);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}. The PDF may be too large — try splitting into fewer items.`);
  }
}

export default function POImportDialog({ open, onOpenChange, onImport }) {
  const [file, setFile] = useState(null);
  const [pastedText, setPastedText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | parsing | success | error
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("file"); // file | text
  const inputRef = useRef();

  const reset = () => {
    setFile(null); setPastedText(""); setStatus("idle");
    setParsed(null); setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = (v) => { if (!v) reset(); onOpenChange(v); };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const handleParse = async () => {
    setStatus("parsing"); setError(""); setParsed(null);
    try {
      let result;
      if (activeTab === "text") {
        const messages = [{ role: "user", content: `Parse this purchase order:\n\n${pastedText}` }];
        const raw = await callClaudeAPI(messages);
        result = safeParseJSON(raw);
      } else {
        result = await parseFile(file);
      }
      setParsed(result);
      setStatus("success");
    } catch (e) {
      setError(e.message || "Failed to parse. Try a different file.");
      setStatus("error");
    }
  };

  const handleImport = () => {
    onImport(parsed);
    handleClose(false);
  };

  const canParse = (activeTab === "file" && file) || (activeTab === "text" && pastedText.trim().length > 20);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Import Purchase Order
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-border mb-4">
          {["file", "text"].map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t === "file" ? "Upload File" : "Paste Text"}
            </button>
          ))}
        </div>

        {activeTab === "file" && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !file && inputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
              file && "cursor-default"
            )}
          >
            <input ref={inputRef} type="file"
              accept=".pdf,.xlsx,.xls,.csv,.txt,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={e => { const f = e.target.files[0]; if (f) setFile(f); e.target.value = ""; }} />

            {file ? (
              <div className="flex items-center justify-center gap-3">
                {fileIcon(file.type)}
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · {ACCEPTED[file.type] || "File"}</p>
                </div>
                <button className="ml-auto p-1 hover:bg-muted rounded"
                  onClick={e => { e.stopPropagation(); setFile(null); setStatus("idle"); setParsed(null); }}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div>
                <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground mb-1">Drop file here or click to browse</p>
                <p className="text-xs text-muted-foreground">PDF · XLSX · CSV · TXT · JPG · PNG</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "text" && (
          <textarea
            className="w-full h-40 text-sm border border-input rounded-lg p-3 bg-transparent resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            placeholder="Paste your PO email, text, or any raw content here…"
            value={pastedText}
            onChange={e => { setPastedText(e.target.value); setStatus("idle"); setParsed(null); }}
          />
        )}

        {/* Parse button */}
        {status !== "success" && (
          <Button onClick={handleParse} disabled={!canParse || status === "parsing"} className="w-full mt-2">
            {status === "parsing"
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Parsing with AI…</>
              : <><Sparkles className="h-4 w-4 mr-2" /> Parse with AI</>}
          </Button>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Result preview */}
        {status === "success" && parsed && (
          <div className="space-y-3 mt-1">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Parsed successfully — review before importing
            </div>

            <div className="bg-muted/40 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-muted-foreground text-xs uppercase tracking-wide">PO Number</span><p className="font-medium">{parsed.po_number || "—"}</p></div>
                <div><span className="text-muted-foreground text-xs uppercase tracking-wide">Customer</span><p className="font-medium">{parsed.customer_name || "—"}</p></div>
                <div><span className="text-muted-foreground text-xs uppercase tracking-wide">Order Date</span><p>{parsed.order_date || "—"}</p></div>
                <div><span className="text-muted-foreground text-xs uppercase tracking-wide">Delivery Date</span><p>{parsed.delivery_date || "—"}</p></div>
                <div><span className="text-muted-foreground text-xs uppercase tracking-wide">Currency</span><p>{parsed.currency || "USD"}</p></div>
                <div><span className="text-muted-foreground text-xs uppercase tracking-wide">Total Value</span><p>{parsed.total_po_value ? `${parsed.currency} ${Number(parsed.total_po_value).toLocaleString()}` : "—"}</p></div>
                <div><span className="text-muted-foreground text-xs uppercase tracking-wide">Total Qty</span><p>{parsed.total_quantity ? Number(parsed.total_quantity).toLocaleString() + " pcs" : "—"}</p></div>
                <div><span className="text-muted-foreground text-xs uppercase tracking-wide">Season</span><p>{parsed.season || "—"}</p></div>
              </div>

              {parsed.items?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{parsed.items.length} Line Item{parsed.items.length !== 1 ? "s" : ""}</p>
                  <div className="space-y-1.5">
                    {parsed.items.slice(0, 5).map((item, i) => (
                      <div key={i} className="flex items-center justify-between bg-background rounded-lg px-3 py-2 text-xs">
                        <div>
                          <span className="font-medium">{item.item_code || `Item ${i + 1}`}</span>
                          {item.item_description && <span className="text-muted-foreground ml-2">{item.item_description}</span>}
                        </div>
                        <div className="text-muted-foreground">
                          {item.quantity?.toLocaleString()} {item.unit || "pcs"}
                          {item.unit_price ? ` · ${parsed.currency} ${item.unit_price}` : ""}
                        </div>
                      </div>
                    ))}
                    {parsed.items.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center">+{parsed.items.length - 5} more items</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} className="flex-1">
                <X className="h-4 w-4 mr-2" /> Try Again
              </Button>
              <Button onClick={handleImport} className="flex-1">
                Import to PO <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

