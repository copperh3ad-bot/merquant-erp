import React, { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { callClaude } from "@/lib/aiProxy";
import { supabase } from "@/api/supabaseClient";
import { Loader2, Mail, Sparkles, FileText, FileSpreadsheet, Upload, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "email", label: "Email Body",   icon: Mail },
  { id: "pdf",   label: "PDF File",     icon: FileText },
  { id: "excel", label: "Excel / CSV",  icon: FileSpreadsheet },
];

const EXTRACT_PROMPT = `Extract the full purchase order details from the provided content.

CRITICAL — IDENTIFYING PARTIES (read carefully, do NOT confuse these):
A PO document typically has THREE distinct parties:
1. BUYER / CUSTOMER: the party who is ISSUING the PO (the brand placing the order). Usually found at the TOP of the document, in the letterhead, or above the "PURCHASE ORDER" title. This goes in "customer_name". Examples: Purecare, H&M, Walmart, Bob's Discount Furniture (when they are the buyer).
2. VENDOR / SUPPLIER / SELLER: the party who RECEIVES the PO and must fulfill it (the factory/manufacturer). Usually labeled "VENDOR", "SUPPLIER", "SELLER", "SOLD TO", "BILL TO" on a supplier invoice. DO NOT put the vendor in "customer_name". Examples: Union Fabrics Ltd., textile mills, garment factories.
3. SHIP-TO / CONSIGNEE: where physical goods are delivered. Labeled "SHIP TO", "DELIVER TO", "CONSIGNEE", "DC", "WAREHOUSE". Goes in "ship_to_name" and "ship_to_address". Often different from the buyer (e.g., buyer is Purecare but ship-to is a retailer's DC like Bob's Discount Furniture).

RULES:
- customer_name MUST be the BUYER/ISSUER of the PO (the entity paying / ordering), NEVER the vendor/supplier.
- If the same company appears in BOTH the letterhead AND the VENDOR block, something is off — prefer the letterhead/top-of-page entity as the customer.
- If the letterhead shows one brand (e.g. "Purecare") and the VENDOR block shows another (e.g. "Union Fabrics Ltd."), then customer_name = Purecare and vendor_name = Union Fabrics Ltd.
- Normalize customer_name to a clean brand name — strip trailing phrases like "Direct to consumer warehouse", "DC", addresses, etc. (e.g. "Purecare Direct to consumer warehouse" → "Purecare").
- Always populate vendor_name with the factory/supplier from the VENDOR block.

Extract BOTH the PO header info AND every line item/article with all available details.
For dates use YYYY-MM-DD format.
For each item extract: item code/SKU, description, fabric type, GSM, width, quantity, unit, unit price, delivery date, fabric construction, finish, shrinkage, CBM, pieces per carton, carton dimensions (L×W×H in cm).

CRITICAL — SKU/ITEM CODE EXTRACTION:
The item_code MUST be copied EXACTLY as written in the source document, character-for-character.
- DO NOT shorten, abbreviate, or "correct" what looks like typos.
- DO NOT drop letters even if they seem redundant (e.g., GPFRIOMP33 has TWO letter Ps before the number — never write GPFRIOM33).
- DO NOT add or remove dashes, spaces, or underscores.
- Preserve case exactly (uppercase letters stay uppercase, lowercase stays lowercase).
- If the SKU appears multiple times in the document (header table, line item, packing list), use the form that appears at the line item / quantity row — that is the authoritative one.
- If a SKU is hard to read (poor OCR, smudged), prefer copying the literal characters you see rather than guessing the "correct" code.
- Common BOB SKU patterns to preserve verbatim:
  • GP[FRIO]MP[size]  (Mattress Protector — note the MP, not just M)
  • GP[FRIO]PP[K|Q]   (Pillow Protector — note the PP, not just P)
  • GPTE[size], GPSE[size]  (Total Encasement, Sleeper Encasement)

Respond ONLY with valid JSON matching this exact shape — no markdown, no explanation:
{
  "po_number": "",
  "customer_name": "",
  "vendor_name": "",
  "ship_to_name": "",
  "ship_to_address": "",
  "buyer_address": "",
  "order_date": "",
  "delivery_date": "",
  "ex_factory_date": "",
  "etd": "",
  "eta": "",
  "currency": "USD",
  "total_po_value": 0,
  "total_quantity": 0,
  "season": "",
  "payment_terms": "",
  "ship_via": "",
  "port_of_loading": "",
  "port_of_destination": "",
  "country_of_origin": "",
  "sales_order_number": "",
  "notes": "",
  "source": "Email",
  "items": [
    {
      "item_code": "",
      "item_description": "",
      "fabric_type": "",
      "gsm": 0,
      "width": 0,
      "quantity": 0,
      "unit": "Pieces",
      "unit_price": 0,
      "total_price": 0,
      "delivery_date": "",
      "fabric_construction": "",
      "finish": "",
      "shrinkage": "",
      "cbm": 0,
      "pieces_per_carton": 0,
      "carton_length": 0,
      "carton_width": 0,
      "carton_height": 0
    }
  ]
}`;

export default function EmailImportDialog({ open, onOpenChange, onExtracted }) {
  const [tab, setTab] = useState("email");
  const [emailText, setEmailText] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef();

  const reset = () => {
    setEmailText(""); setFiles([]); setLoading(false); setDragOver(false);
    setProgress([]); setResult(null); setError(""); setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    setFiles(prev => {
      const keys = new Set(prev.map(f => `${f.name}-${f.size}`));
      return [...prev, ...incoming.filter(f => !keys.has(`${f.name}-${f.size}`))];
    });
  };

  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const readFileAsBase64 = (f) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  const readFileAsText = (f) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsText(f);
  });

  const normalizeCustomerName = (name) => {
    if (!name) return name;
    return name
      .replace(/\s*[\-,·]?\s*(direct to consumer warehouse|direct to consumer|DC|distribution center|warehouse|dc)\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  const validateExtraction = (extracted) => {
    if (!extracted) return extracted;
    extracted.customer_name = normalizeCustomerName(extracted.customer_name);
    // Guard: if customer_name == vendor_name, the AI confused the two — flag it
    if (
      extracted.customer_name &&
      extracted.vendor_name &&
      extracted.customer_name.trim().toLowerCase() === extracted.vendor_name.trim().toLowerCase()
    ) {
      extracted._warning = `Extraction may be incorrect: customer and vendor are both "${extracted.customer_name}". Please review the buyer/vendor fields before creating the PO.`;
    }
    return extracted;
  };

  const parseExtracted = (raw) => {
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const match = clean.match(/\{[\s\S]*/);
    if (!match) throw new Error("No JSON found in response");
    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      let jsonStr = match[0];
      const closers = [];
      let inStr = false, esc = false;
      for (const c of jsonStr) {
        if (esc) { esc = false; continue; }
        if (c === "\\" && inStr) { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") closers.push("}");
        else if (c === "[") closers.push("]");
        else if (c === "}" || c === "]") closers.pop();
      }
      parsed = JSON.parse(jsonStr.replace(/,\s*$/, "") + closers.reverse().join(""));
    }
    return validateExtraction(parsed);
  };

  const extractOneFile = async (file, kind) => {
    let messages;
    if (kind === "pdf") {
      const b64 = await readFileAsBase64(file);
      messages = [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: EXTRACT_PROMPT, cache_control: { type: "ephemeral" } }
        ]
      }];
    } else {
      let text = "";
      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
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
      } else {
        text = await readFileAsText(file);
      }
      messages = [{
        role: "user",
        content: `${EXTRACT_PROMPT}\n\nFile content (${file.name}):\n${text.substring(0, 12000)}`
      }];
    }

    const data = await callClaude({
      system: "You are a textile ERP data extraction assistant. Always respond with valid JSON only.",
      messages,
      max_tokens: 2000,
      cacheSystem: true,
    });
    const raw = data.content?.find(b => b.type === "text")?.text || "{}";
    const extracted = parseExtracted(raw);
    extracted.source = kind === "pdf" ? "PDF" : "Manual";
    extracted._sourceFile = file.name;
    return extracted;
  };

  const handleExtract = async () => {
    setError("");
    setResult(null);

    // Keep screen awake + prevent tab throttling via silent audio
    let wakeLock = null;
    let audioCtx = null;
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen").catch(() => null);
    } catch {}
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.0001; // effectively silent
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start();
      audioCtx._osc = osc;
    } catch {}

    const cleanup = () => {
      if (wakeLock) wakeLock.release().catch(() => {});
      if (audioCtx) {
        try { audioCtx._osc?.stop(); audioCtx.close(); } catch {}
      }
    };

    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const systemPrompt = "You are a textile ERP data extraction assistant. Always respond with valid JSON only.";

    // Build file payloads (read blobs first on main thread, then send to worker)
    let workerFiles;
    if (tab === "email") {
      if (!emailText.trim()) { cleanup(); return; }
      workerFiles = [{ name: "email", kind: "text", text: emailText }];
    } else {
      if (!files.length) { cleanup(); return; }
      workerFiles = await Promise.all(files.map(async (f) => {
        if (tab === "pdf") {
          const b64 = await readFileAsBase64(f);
          return { name: f.name, kind: "pdf", b64 };
        } else {
          let text = "";
          if (f.name.endsWith(".xlsx") || f.name.endsWith(".xls")) {
            if (!window.XLSX) {
              await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
              });
            }
            const buf = await f.arrayBuffer();
            const wb = window.XLSX.read(buf, { type: "array" });
            text = window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          } else {
            text = await readFileAsText(f);
          }
          return { name: f.name, kind: "text", text };
        }
      }));
    }

    setLoading(true);
    const initial = workerFiles.map(f => ({ name: f.name, status: "pending" }));
    setProgress(initial);
    const results = [...initial];

    try {
      const worker = new Worker(new URL("../../workers/poExtractWorker.js", import.meta.url), { type: "module" });

      await new Promise((resolve, reject) => {
        worker.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === "progress") {
            results[m.idx] = { ...results[m.idx], status: m.status };
            setProgress([...results]);
          } else if (m.type === "result") {
            try {
              const extracted = parseExtracted(m.raw);
              extracted.source = tab === "pdf" ? "PDF" : (tab === "email" ? "Email" : "Manual");
              extracted._sourceFile = workerFiles[m.idx].name;
              results[m.idx] = { ...results[m.idx], status: "done", result: extracted };
            } catch (err) {
              results[m.idx] = { ...results[m.idx], status: "error", error: err.message || "Parse failed" };
            }
            setProgress([...results]);
          } else if (m.type === "fail") {
            results[m.idx] = { ...results[m.idx], status: "error", error: m.message };
            setProgress([...results]);
          } else if (m.type === "allDone") {
            resolve();
          }
        };
        worker.onerror = (e) => reject(new Error(e.message || "Worker error"));
        worker.postMessage({
          type: "extract",
          files: workerFiles,
          systemPrompt,
          extractPrompt: EXTRACT_PROMPT,
          supabaseUrl,
          accessToken,
          model: "claude-haiku-4-5",
        });
      });

      worker.terminate();
    } catch (err) {
      setError("Extraction failed: " + (err.message || "Unknown error"));
      setLoading(false);
      cleanup();
      return;
    }

    setLoading(false);
    cleanup();

    // Single file (or email) → jump to review
    if (workerFiles.length === 1) {
      const only = results[0];
      if (only?.status === "done" && only.result) setResult(only.result);
      else if (only?.status === "error") setError("Extraction failed: " + only.error);
    }
  };

  const handleConfirm = () => {
    if (result) {
      onExtracted(result);
      onOpenChange(false);
      reset();
    }
  };

  const bulkImport = async () => {
    setImporting(true);
    const successful = progress.filter(p => p.status === "done" && p.result);
    for (const p of successful) {
      try {
        await onExtracted(p.result);
      } catch (err) {
        console.error("Import failed for", p.name, err);
      }
    }
    setImporting(false);
    onOpenChange(false);
    reset();
  };

  const canSubmit = (tab === "email" && emailText.trim()) || (tab !== "email" && files.length > 0);
  const itemCount = result?.items?.length || 0;
  const successCount = progress.filter(p => p.status === "done").length;
  const errorCount = progress.filter(p => p.status === "error").length;
  const showBulkList = tab !== "email" && files.length > 1 && progress.length > 0 && !result;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Import PO{files.length > 1 ? "s" : ""} with AI
          </DialogTitle>
        </DialogHeader>

        {!result && !showBulkList && (
          <>
            <div className="flex gap-1 bg-muted p-1 rounded-lg">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setTab(id); setFiles([]); setProgress([]); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all",
                    tab === id ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>

            <div className="py-2 space-y-3">
              <p className="text-xs text-muted-foreground">
                {tab === "email" && "Paste the full email. AI extracts PO header + all line items."}
                {tab === "pdf"   && "Upload one or more PDF purchase orders. Each becomes a separate PO."}
                {tab === "excel" && "Upload one or more Excel/CSV files. Each becomes a separate PO."}
              </p>

              {tab === "email" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Email Content</Label>
                  <Textarea
                    placeholder="Paste the full email text here..."
                    value={emailText}
                    onChange={(e) => setEmailText(e.target.value)}
                    rows={10}
                    className="text-sm font-mono resize-none"
                  />
                </div>
              )}

              {(tab === "pdf" || tab === "excel") && (
                <>
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                      dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40"
                    )}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                  >
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {files.length === 0
                        ? (tab === "pdf" ? "Drop PDFs here, or click to browse" : "Drop Excel/CSV files here, or click to browse")
                        : `${files.length} file${files.length > 1 ? "s" : ""} selected — click to add more`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tab === "pdf" ? ".pdf" : ".xlsx, .xls, .csv"} — multiple files allowed
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={tab === "pdf" ? ".pdf" : ".xlsx,.xls,.csv"}
                      className="hidden"
                      onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                    />
                  </div>

                  {files.length > 0 && (
                    <div className="space-y-1 max-h-40 overflow-y-auto border rounded-lg p-2 bg-muted/20">
                      {files.map((f, i) => (
                        <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-xs">
                          {tab === "pdf" ? <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                          <span className="truncate flex-1">{f.name}</span>
                          <span className="text-muted-foreground tabular-nums">{Math.round(f.size/1024)} KB</span>
                          <button onClick={() => removeFile(i)} className="text-red-600 hover:text-red-800 px-1">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
              <Button onClick={handleExtract} disabled={loading || !canSubmit}>
                {loading
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Extracting...</>
                  : <><Sparkles className="h-4 w-4 mr-2" /> Extract {files.length > 1 ? `${files.length} POs` : "PO Details"}</>
                }
              </Button>
            </DialogFooter>
          </>
        )}

        {showBulkList && (
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{files.length} files</span>
              <span className="text-muted-foreground">
                {successCount} extracted {errorCount > 0 && <span className="text-red-600">· {errorCount} failed</span>}
              </span>
            </div>

            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {progress.map((p, i) => <BulkFileRow key={i} p={p} />)}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }} disabled={importing}>Cancel</Button>
              <Button onClick={bulkImport} disabled={importing || loading || successCount === 0}>
                {importing
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...</>
                  : `Create ${successCount} PO${successCount !== 1 ? "s" : ""}`
                }
              </Button>
            </DialogFooter>
          </div>
        )}

        {result && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold text-sm">Extraction Complete</span>
            </div>

            {result._warning && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{result._warning}</span>
              </div>
            )}

            <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
              {result.po_number     && <div className="flex justify-between"><span className="text-muted-foreground">PO Number</span><span className="font-medium">{result.po_number}</span></div>}
              {result.customer_name && <div className="flex justify-between"><span className="text-muted-foreground">Customer (Buyer)</span><span className="font-medium">{result.customer_name}</span></div>}
              {result.vendor_name   && <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span className="font-medium">{result.vendor_name}</span></div>}
              {result.ship_to_name  && <div className="flex justify-between"><span className="text-muted-foreground">Ship To</span><span className="font-medium">{result.ship_to_name}</span></div>}
              {result.ship_to_address && <div className="flex justify-between gap-4"><span className="text-muted-foreground shrink-0">Ship To Address</span><span className="font-medium text-right text-xs">{result.ship_to_address}</span></div>}
              {result.delivery_date && <div className="flex justify-between"><span className="text-muted-foreground">Delivery Date</span><span className="font-medium">{result.delivery_date}</span></div>}
              {result.total_po_value && <div className="flex justify-between"><span className="text-muted-foreground">Total Value</span><span className="font-medium">{result.currency || "USD"} {result.total_po_value?.toLocaleString()}</span></div>}
              {result.total_quantity && <div className="flex justify-between"><span className="text-muted-foreground">Total Qty</span><span className="font-medium">{result.total_quantity?.toLocaleString()}</span></div>}
            </div>

            {itemCount > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  {itemCount} line item{itemCount > 1 ? "s" : ""} extracted — will auto-create articles + accessories
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {result.items.map((item, i) => (
                    <div key={i} className="bg-card border rounded px-3 py-2 text-xs flex justify-between">
                      <span className="font-medium">{item.item_code || item.item_description || `Item ${i + 1}`}</span>
                      <span className="text-muted-foreground">Qty: {item.quantity} {item.unit || ""} {item.unit_price ? `· $${item.unit_price}` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {itemCount === 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                No line items found. You can add items manually after creating the PO.
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setResult(null)}>Re-extract</Button>
              <Button onClick={handleConfirm}>
                Create PO {itemCount > 0 ? `+ ${itemCount} Items` : ""}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkFileRow({ p }) {
  const icon =
    p.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> :
    p.status === "error" ? <AlertTriangle className="h-4 w-4 text-red-600" /> :
    p.status === "extracting" ? <Loader2 className="h-4 w-4 text-blue-600 animate-spin" /> :
    <div className="h-4 w-4 rounded-full border border-muted-foreground" />;

  return (
    <div className={cn(
      "flex items-start gap-2 p-2 border rounded-lg",
      p.result?._warning ? "bg-amber-50 border-amber-300" : "bg-card"
    )}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{p.name}</p>
        {p.status === "done" && p.result && (
          <>
            <p className="text-xs text-emerald-700">
              {p.result.po_number || "(no PO#)"} · {p.result.customer_name || "—"}
              {p.result.vendor_name ? ` ← ${p.result.vendor_name}` : ""}
              {` · ${p.result.items?.length || 0} items`}
              {p.result.total_po_value ? ` · ${p.result.currency || "USD"} ${Number(p.result.total_po_value).toLocaleString()}` : ""}
            </p>
            {p.result._warning && (
              <p className="text-[11px] text-amber-800 mt-1 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                {p.result._warning}
              </p>
            )}
          </>
        )}
        {p.status === "error" && <p className="text-xs text-red-600">{p.error}</p>}
        {p.status === "extracting" && <p className="text-xs text-blue-600">Extracting…</p>}
        {p.status === "pending" && <p className="text-xs text-muted-foreground">Waiting…</p>}
      </div>
    </div>
  );
}

