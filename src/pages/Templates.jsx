import React, { useState } from "react";
import { Download, FileSpreadsheet, Info, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Template definitions ────────────────────────────────────────────────────
// Each template has: id, title, description, uploadLocation, columns[], example row
const TEMPLATES = [
  {
    id: "po_items",
    title: "PO Line Items",
    description: "Upload line items into an existing Purchase Order. Each row is one SKU/colour/size combination.",
    uploadLocation: "Purchase Orders → Open a PO → Line Items → CSV button",
    color: "bg-blue-50 border-blue-200",
    headerColor: "bg-blue-600",
    badge: "bg-blue-100 text-blue-700",
    columns: [
      { name: "item_code",        required: true,  type: "text",    example: "GPMP33-WHT-S",    notes: "Unique SKU — used to match price lists & fabric templates" },
      { name: "quantity",         required: true,  type: "number",  example: "240",             notes: "Total pieces ordered" },
      { name: "item_description", required: false, type: "text",    example: "Polo Shirt White Small", notes: "Product description" },
      { name: "fabric_type",      required: false, type: "text",    example: "Pique Cotton",    notes: "Fabric description" },
      { name: "gsm",              required: false, type: "number",  example: "180",             notes: "Grams per square metre" },
      { name: "color",            required: false, type: "text",    example: "White",           notes: "Colour name" },
      { name: "unit",             required: false, type: "text",    example: "Pieces",          notes: "Default: Pieces" },
      { name: "unit_price",       required: false, type: "number",  example: "4.25",            notes: "Price per unit in PO currency" },
      { name: "cbm",              required: false, type: "number",  example: "0.045",           notes: "CBM per carton" },
      { name: "pieces_per_carton",required: false, type: "number",  example: "12",              notes: "Packing ratio" },
      { name: "delivery_date",    required: false, type: "date",    example: "2025-06-15",      notes: "Format: YYYY-MM-DD" },
    ],
  },
  {
    id: "fabric_working",
    title: "Fabric Working Sheet (FWS)",
    description: "Upload article fabric consumption specs. The AI parser reads any spreadsheet layout — but this standardized format gives the most reliable results.",
    uploadLocation: "Articles → Upload Sheet  OR  Fabric Working → Upload Sheet",
    color: "bg-emerald-50 border-emerald-200",
    headerColor: "bg-emerald-600",
    badge: "bg-emerald-100 text-emerald-700",
    columns: [
      { name: "item_code",              required: true,  type: "text",   example: "GPMP33-WHT-S",         notes: "Must match PO item_code exactly" },
      { name: "article_name",           required: false, type: "text",   example: "Polo Shirt",           notes: "Product name (populated if blank)" },
      { name: "order_quantity",         required: false, type: "number", example: "240",                  notes: "Quantity; used to calculate totals" },
      { name: "fabric_type",            required: true,  type: "text",   example: "180 GSM Pique 180cm",  notes: "Full fabric description" },
      { name: "gsm",                    required: false, type: "number", example: "180",                  notes: "Numeric GSM value" },
      { name: "width_cm",               required: false, type: "number", example: "180",                  notes: "Fabric width in cm" },
      { name: "consumption_per_unit",   required: true,  type: "number", example: "1.45",                 notes: "Metres per piece — REQUIRED per fabric row" },
      { name: "wastage_percent",        required: false, type: "number", example: "6",                    notes: "Default: 6. Enter as plain number (6 = 6%)" },
    ],
    notes: "For items with multiple fabrics, add one row per fabric with the same item_code.",
  },
  {
    id: "accessories",
    title: "Accessories",
    description: "Bulk upload trim and accessory requirements linked to a PO.",
    uploadLocation: "Accessories & Packaging → (coming via CSV — currently add one by one)",
    color: "bg-violet-50 border-violet-200",
    headerColor: "bg-violet-600",
    badge: "bg-violet-100 text-violet-700",
    columns: [
      { name: "po_number",          required: true,  type: "text",   example: "D710824-001",  notes: "Must match an existing PO number" },
      { name: "article_code",       required: true,  type: "text",   example: "GPMP33",       notes: "Base article code (without size/colour suffix)" },
      { name: "article_name",       required: true,  type: "text",   example: "Polo Shirt",   notes: "Article name" },
      { name: "category",           required: true,  type: "text",   example: "Label",        notes: "Label / Polybag / Inner Box / Master Carton / Hang Tag / Sticker / Button / Zipper / Thread / Other" },
      { name: "item_description",   required: true,  type: "text",   example: "Main Label",   notes: "Description of the accessory" },
      { name: "color",              required: false, type: "text",   example: "Navy",         notes: "Colour if applicable" },
      { name: "size_spec",          required: false, type: "text",   example: "50x30mm",      notes: "Size specification" },
      { name: "multiplier",         required: false, type: "number", example: "1",            notes: "Accessories per piece. Default: 1" },
      { name: "wastage_percent",    required: false, type: "number", example: "3",            notes: "Default: 3" },
      { name: "quantity_required",  required: false, type: "number", example: "250",          notes: "Auto-calculated if blank (order_qty × multiplier)" },
      { name: "unit",               required: false, type: "text",   example: "Pcs",          notes: "Default: Pcs" },
      { name: "supplier",           required: false, type: "text",   example: "ABC Labels Co", notes: "Supplier name" },
      { name: "unit_cost",          required: false, type: "number", example: "0.05",         notes: "Cost per unit" },
      { name: "pc_ean_code",        required: false, type: "text",   example: "5901234123457", notes: "Barcode for individual piece" },
      { name: "carton_ean_code",    required: false, type: "text",   example: "15901234123454", notes: "Barcode for carton" },
    ],
  },
  {
    id: "yarn_planning",
    title: "Yarn Requirements",
    description: "Upload yarn requirements per fabric type for a PO.",
    uploadLocation: "Yarn Planning → (currently auto-generated from FWS; use this to override or bulk-load)",
    color: "bg-amber-50 border-amber-200",
    headerColor: "bg-amber-600",
    badge: "bg-amber-100 text-amber-700",
    columns: [
      { name: "po_number",      required: true,  type: "text",   example: "D710824-001",      notes: "Must match an existing PO number" },
      { name: "fabric_type",    required: true,  type: "text",   example: "180 GSM Pique",    notes: "Fabric description" },
      { name: "gsm",            required: false, type: "number", example: "180",              notes: "GSM of fabric" },
      { name: "width_cm",       required: false, type: "number", example: "180",              notes: "Fabric width in cm" },
      { name: "total_meters",   required: true,  type: "number", example: "350.5",            notes: "Total fabric metres required" },
      { name: "yarn_kg",        required: false, type: "number", example: "75.2",             notes: "Auto-calculated if blank (metres × gsm × width / 1,000,000)" },
      { name: "yarn_type",      required: false, type: "text",   example: "Cotton Combed",    notes: "e.g. Cotton Combed, Polyester, Viscose" },
      { name: "yarn_count",     required: false, type: "text",   example: "30/1",             notes: "Yarn count / ticket number" },
      { name: "supplier",       required: false, type: "text",   example: "Indus Yarn Mills", notes: "Yarn supplier" },
      { name: "notes",          required: false, type: "text",   example: "2-ply",            notes: "Any additional notes" },
    ],
  },
  {
    id: "trims",
    title: "Trims",
    description: "Upload trim requirements (labels, threads, buttons, etc.) for articles in a PO.",
    uploadLocation: "Trims page → (currently add one by one; CSV import coming soon)",
    color: "bg-pink-50 border-pink-200",
    headerColor: "bg-pink-600",
    badge: "bg-pink-100 text-pink-700",
    columns: [
      { name: "po_number",            required: true,  type: "text",   example: "D710824-001",  notes: "Must match an existing PO" },
      { name: "article_code",         required: true,  type: "text",   example: "GPMP33",       notes: "Article code" },
      { name: "article_name",         required: false, type: "text",   example: "Polo Shirt",   notes: "Article name" },
      { name: "trim_category",        required: true,  type: "text",   example: "Label",        notes: "Label / Thread / Button / Zipper / Elastic / Interlining / Patch / Other" },
      { name: "item_description",     required: true,  type: "text",   example: "Care Label",   notes: "Trim description" },
      { name: "color",                required: false, type: "text",   example: "Black",        notes: "Colour" },
      { name: "size_spec",            required: false, type: "text",   example: "50x30mm",      notes: "Size / spec" },
      { name: "calc_type",            required: false, type: "text",   example: "Per Piece",    notes: "Per Piece / Per Metre / Per Dozen" },
      { name: "consumption_per_unit", required: false, type: "number", example: "1",            notes: "Quantity per piece (or per metre/dozen)" },
      { name: "wastage_percent",      required: false, type: "number", example: "5",            notes: "Default: 5" },
      { name: "order_quantity",       required: false, type: "number", example: "240",          notes: "PO quantity for this article" },
      { name: "quantity_required",    required: false, type: "number", example: "252",          notes: "Auto-calculated if blank" },
      { name: "unit",                 required: false, type: "text",   example: "Pcs",          notes: "Pcs / Mtrs / Kgs / Sets / Dozens" },
      { name: "supplier",             required: false, type: "text",   example: "Label World",  notes: "Trim supplier" },
      { name: "unit_cost",            required: false, type: "number", example: "0.08",         notes: "Cost per unit" },
    ],
  },
  {
    id: "price_list",
    title: "Price List",
    description: "Upload your standard price list to auto-populate unit prices when PO items are imported.",
    uploadLocation: "Settings → Price List (if available) or through AI Programmer",
    color: "bg-orange-50 border-orange-200",
    headerColor: "bg-orange-600",
    badge: "bg-orange-100 text-orange-700",
    columns: [
      { name: "item_code",    required: true,  type: "text",   example: "GPMP33",   notes: "SKU / item code — matched against PO items" },
      { name: "unit_price",   required: true,  type: "number", example: "4.25",     notes: "Price per unit" },
      { name: "currency",     required: false, type: "text",   example: "USD",      notes: "Default: USD" },
      { name: "customer_name",required: false, type: "text",   example: "Bob's Discount Furniture", notes: "Customer — if price is buyer-specific" },
      { name: "season",       required: false, type: "text",   example: "SS25",     notes: "Season code" },
      { name: "valid_from",   required: false, type: "date",   example: "2025-01-01", notes: "Format: YYYY-MM-DD" },
      { name: "valid_to",     required: false, type: "date",   example: "2025-12-31", notes: "Format: YYYY-MM-DD" },
      { name: "notes",        required: false, type: "text",   example: "FOB price", notes: "Any notes" },
    ],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    description: "Bulk-load your supplier / factory directory.",
    uploadLocation: "Suppliers page → (currently add one by one; CSV import coming soon)",
    color: "bg-slate-50 border-slate-200",
    headerColor: "bg-slate-600",
    badge: "bg-slate-100 text-slate-700",
    columns: [
      { name: "supplier_name",   required: true,  type: "text",   example: "Union Fabrics Ltd",  notes: "Full supplier name" },
      { name: "supplier_code",   required: false, type: "text",   example: "UFL-001",            notes: "Internal code" },
      { name: "country",         required: false, type: "text",   example: "Pakistan",           notes: "Country of operation" },
      { name: "contact_person",  required: false, type: "text",   example: "Ahmed Khan",         notes: "Primary contact" },
      { name: "email",           required: false, type: "email",  example: "ahmed@unionfabrics.com", notes: "Contact email" },
      { name: "phone",           required: false, type: "text",   example: "+92 301 1234567",    notes: "Phone number" },
      { name: "address",         required: false, type: "text",   example: "Lahore Industrial Estate", notes: "Address" },
      { name: "payment_terms",   required: false, type: "text",   example: "60 days",            notes: "Payment terms" },
      { name: "category",        required: false, type: "text",   example: "Fabric Mill",        notes: "Fabric Mill / Garment Factory / Accessory Supplier / Other" },
      { name: "notes",           required: false, type: "text",   example: "ISO 9001 certified", notes: "Any notes" },
    ],
  },
];

// ─── CSV generator ────────────────────────────────────────────────────────────
function generateCSV(template) {
  const headers = template.columns.map(c => c.name);
  const examples = template.columns.map(c => c.example || "");
  const lines = [headers.join(","), examples.join(",")];
  return lines.join("\n");
}

function downloadCSV(template) {
  const csv = generateCSV(template);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MerQuant_Template_${template.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Template Card ─────────────────────────────────────────────────────────────
function TemplateCard({ tpl }) {
  const [expanded, setExpanded] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = () => {
    downloadCSV(tpl);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  };

  return (
    <Card className={cn("border-2 transition-shadow hover:shadow-md", tpl.color)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", tpl.headerColor)}>
              <FileSpreadsheet className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-bold leading-tight">{tpl.title}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{tpl.description}</p>
            </div>
          </div>
          <Button
            size="sm"
            className={cn("shrink-0 gap-1.5 text-xs transition-all", downloaded ? "bg-emerald-600 hover:bg-emerald-600" : "")}
            onClick={handleDownload}
          >
            {downloaded
              ? <><CheckCircle2 className="h-3.5 w-3.5" /> Downloaded!</>
              : <><Download className="h-3.5 w-3.5" /> Download CSV</>
            }
          </Button>
        </div>

        {/* Upload location */}
        <div className="flex items-start gap-1.5 mt-2 text-xs">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          <span className="text-muted-foreground"><strong>Upload at:</strong> {tpl.uploadLocation}</span>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Column count + toggle */}
        <button
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {tpl.columns.length} columns
          <span className="text-muted-foreground font-normal">
            ({tpl.columns.filter(c => c.required).length} required, {tpl.columns.filter(c => !c.required).length} optional)
          </span>
        </button>

        {expanded && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left py-1.5 pr-3 font-semibold text-foreground w-40">Column name</th>
                  <th className="text-left py-1.5 pr-3 font-semibold text-foreground w-20">Required</th>
                  <th className="text-left py-1.5 pr-3 font-semibold text-foreground w-16">Type</th>
                  <th className="text-left py-1.5 pr-3 font-semibold text-foreground w-36">Example value</th>
                  <th className="text-left py-1.5 font-semibold text-foreground">Notes</th>
                </tr>
              </thead>
              <tbody>
                {tpl.columns.map((col, i) => (
                  <tr key={col.name} className={cn("border-b border-border/30", i % 2 === 0 ? "bg-white/40" : "")}>
                    <td className="py-1.5 pr-3 font-mono font-medium text-[11px] text-foreground">{col.name}</td>
                    <td className="py-1.5 pr-3">
                      {col.required
                        ? <span className="text-red-600 font-semibold">Required</span>
                        : <span className="text-muted-foreground">Optional</span>
                      }
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground capitalize">{col.type}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-blue-700 bg-blue-50/50 rounded px-1">{col.example}</td>
                    <td className="py-1.5 text-muted-foreground">{col.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tpl.notes && (
              <p className="mt-2 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded px-3 py-2">
                ⚠️ {tpl.notes}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Templates() {
  const handleDownloadAll = () => {
    TEMPLATES.forEach((tpl, i) => {
      setTimeout(() => downloadCSV(tpl), i * 120);
    });
  };

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            CSV Upload Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Download standardized templates for every data input. Fill in the sample row and upload to the corresponding page.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadAll}>
          <Download className="h-4 w-4" /> Download All Templates
        </Button>
      </div>

      {/* Rules */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
        <p className="font-semibold">General rules for all templates:</p>
        <ul className="list-disc list-inside space-y-0.5 text-amber-700">
          <li>Keep the header row exactly as shown — column names are case-insensitive but must match</li>
          <li>Delete the example data row before uploading your real data</li>
          <li>Date fields must be in <strong>YYYY-MM-DD</strong> format (e.g. 2025-06-15)</li>
          <li>Numbers must be plain numerals — no currency symbols, commas, or spaces (e.g. <strong>4.25</strong> not $4.25)</li>
          <li>Text with commas must be wrapped in double quotes (e.g. <strong>"Smith, John"</strong>)</li>
          <li>Leave optional columns blank rather than deleting them</li>
        </ul>
      </div>

      {/* Template cards */}
      <div className="space-y-4">
        {TEMPLATES.map(tpl => (
          <TemplateCard key={tpl.id} tpl={tpl} />
        ))}
      </div>
    </div>
  );
}

