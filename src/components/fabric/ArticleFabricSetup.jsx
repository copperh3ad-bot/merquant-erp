import React, { useState } from "react";
import { callClaude } from "@/lib/aiProxy";
import { Button } from "@/components/ui/button";
import { Upload, Pencil, Loader2, CheckCircle2 } from "lucide-react";

const COMPONENT_TYPES = ["Front", "Skirt", "Bottom", "Piping", "Binding", "Filling", "Lamination", "Top Fabric", "Window (Outside)", "Window (Inside)", "Fabric Bag", "Fabric Swatch", "Quilting", "Pillow Compression"];

/**
 * Shown when an article has no fabric components yet.
 * Offers two paths: Upload a file (AI extracts components) or Manual Entry.
 * Props:
 *   article     — the Article record
 *   onSetup(components) — called with the extracted/entered components array
 *   onEdit      — triggers the existing inline edit mode (manual path shortcut)
 */
export default function ArticleFabricSetup({ article, onSetup, onEdit }) {
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Always reset input so same file can be re-selected
    e.target.value = "";
    setUploading(true);
    setStatusMsg("Reading file...");
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const isPDF = ext === "pdf";
      const isXLSX = ["xlsx", "xls"].includes(ext);
      const isImage = ["png", "jpg", "jpeg", "webp"].includes(ext);

      let messages;
      const basePrompt = `Extract fabric components for article "${article.article_name}" (code: ${article.article_code || "N/A"}).
Return JSON only: {"components": [{"component_type": "...", "fabric_type": "...", "gsm": 0, "width": 0, "consumption_per_unit": 0, "wastage_percent": 6, "total_required": 0}]}
Component types: ${COMPONENT_TYPES.join(", ")}`;

      if (isPDF) {
        // Send PDF as base64 document block (not text — it's binary)
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
        });
        messages = [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: basePrompt }
        ]}];
      } else if (isImage) {
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
        });
        const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
        messages = [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mimeMap[ext] || "image/jpeg", data: b64 } },
          { type: "text", text: basePrompt }
        ]}];
      } else if (isXLSX) {
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
        const fileText = window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
        messages = [{ role: "user", content: `${basePrompt}\n\nFile content:\n${fileText.substring(0, 8000)}` }];
      } else {
        // CSV / TXT / plain text
        const fileText = await file.text();
        messages = [{ role: "user", content: `${basePrompt}\n\nFile content:\n${fileText.substring(0, 8000)}` }];
      }

      setStatusMsg("Extracting fabric specs with AI...");

      const data = await callClaude({
        system: "You extract fabric component data from textile spec files. Return ONLY valid JSON, no markdown.",
        messages,
        max_tokens: 2000,
      });

      const raw = data.content?.[0]?.text || "{}";
      const clean = raw.replace(/\`\`\`json\n?/g, "").replace(/\`\`\`\n?/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      const result = match ? JSON.parse(match[0]) : {};
      const components = result?.components || [];
      if (components.length === 0) {
        setStatusMsg("No components found. Please enter manually.");
        setUploading(false);
        return;
      }

      // Recalculate totals with actual quantity
      const qty = article.order_quantity || 0;
      const enriched = components.map((c) => {
        const net = (c.consumption_per_unit || 0) * qty;
        return {
          ...c,
          wastage_percent: c.wastage_percent ?? 6,
          total_required: +(net * (1 + (c.wastage_percent ?? 6) / 100)).toFixed(4),
        };
      });

      setStatusMsg("Done!");
      onSetup(enriched);
    } catch (err) {
      setStatusMsg("Error: " + (err.message || "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <td colSpan={10} className="border border-gray-300 px-3 py-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 font-medium">
          ⚠ New Article — No fabric working defined
        </span>

        {uploading ? (
          <span className="flex items-center gap-1.5 text-xs text-blue-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {statusMsg}
          </span>
        ) : statusMsg === "Done!" ? (
          <span className="flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> {statusMsg}
          </span>
        ) : (
          <>
            <label className="cursor-pointer">
              <input type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={handleFileUpload} />
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-300 bg-blue-50 hover:bg-blue-100 rounded px-2 py-1 transition-colors">
                <Upload className="h-3.5 w-3.5" /> Upload Fabric Spec File
              </span>
            </label>
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-300 bg-gray-50 hover:bg-gray-100 rounded px-2 py-1 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" /> Enter Manually
            </button>
            {statusMsg && <span className="text-xs text-red-600">{statusMsg}</span>}
          </>
        )}
      </div>
    </td>
  );
}
