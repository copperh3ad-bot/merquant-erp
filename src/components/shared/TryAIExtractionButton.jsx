import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

// Reusable button for both TechPacks and MasterDataImport pages.
// Pick a kind ('tech_pack' | 'master_data'); on click, opens a file picker,
// base64-encodes the file, calls the extract-document edge function, and
// navigates to the AI Extraction Review detail view on success.

const ACCEPT_BY_KIND = {
  tech_pack:   ".xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp",
  master_data: ".xlsx,.xls",
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result;
      const i = typeof s === "string" ? s.indexOf(",") : -1;
      resolve(typeof s === "string" && i >= 0 ? s.slice(i + 1) : "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function TryAIExtractionButton({ kind, label, variant = "outline", size = "default" }) {
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again triggers change
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("File is larger than 10 MB.");
      const b64 = await fileToBase64(file);
      const { data, error: invokeErr } = await supabase.functions.invoke("extract-document", {
        body: {
          kind,
          file_name: file.name,
          file_mime: file.type || "application/octet-stream",
          file_size_bytes: file.size,
          file_base64: b64,
        },
      });
      if (invokeErr) throw new Error(invokeErr.message || "Edge function call failed");
      if (!data?.ok) {
        if (data?.code === "EXTRACTION_DUPLICATE" && data?.dev_detail?.existing_extraction_id) {
          navigate(`/AIExtractionReview?id=${data.dev_detail.existing_extraction_id}`);
          return;
        }
        throw new Error(data?.user_message || data?.code || "Extraction failed");
      }
      navigate(`/AIExtractionReview?id=${data.extraction_id}`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_BY_KIND[kind] ?? ".xlsx"}
        onChange={handleFile}
        className="hidden"
      />
      <div className="flex items-center gap-2">
        <Button variant={variant} size={size} disabled={busy} onClick={() => inputRef.current?.click()}>
          <Sparkles className="w-4 h-4 mr-1" />
          {busy ? "Uploading…" : (label ?? "Try AI Extraction")}
        </Button>
        {error && <span className="text-xs text-rose-700">{error}</span>}
      </div>
    </>
  );
}
