// src/pages/FileFeeder.jsx
//
// File Feeder — conversational data input.
//
// Phase 1 scope (2026-05-01):
//   - Tech pack files only (XLSX, PDF, images including embedded scans)
//   - One file per turn; multi-file batches handled by drag-drop multi-select
//   - Strong validation gate: every extraction lands in `ai_extractions`
//     (review_status='pending') and is NEVER auto-applied. The user has to
//     approve each one before it touches live tables.
//   - Image content (PDFs, photos, embedded XLSX images) is handled by the
//     existing `extract-document` edge function which uses Claude vision on
//     PDFs/images and a BOB-format fast-path on structured XLSX.
//
// Reuses:
//   - Edge fn `extract-document` (audit doc 2026-05-01)
//   - Staging table `ai_extractions`
//   - RPC `fn_apply_tech_pack_extraction` for final commit
//   - RPC `fn_reject_extraction` for rejection
//
// What this page does NOT do (Phase 2+):
//   - Free-form text input ("add 5 articles for PureCare King size, $42")
//   - Master data files (SKU/fabric/accessory/carton consumption)
//   - Multi-turn refinement / clarifying questions
//   - Cross-document dedup beyond what extract-document already does
//
// All of those will land in later phases without re-architecting this page.

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Sparkles, Upload, Paperclip, FileText, Image as ImageIcon, AlertTriangle, CheckCircle2, XCircle, Loader2, ExternalLink, Trash2 } from "lucide-react";
import { dedupeMasterData } from "@/lib/masterDataDedup";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — matches extract-document's server limit
const ACCEPTED_EXTS = [".xlsx", ".xls", ".pdf", ".jpg", ".jpeg", ".png", ".webp"];

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function looksLikeImage(mime, name) {
  if ((mime || "").startsWith("image/")) return true;
  const lower = (name || "").toLowerCase();
  return /\.(jpe?g|png|webp|gif|bmp|tiff?)$/.test(lower);
}

function extOk(name) {
  const lower = (name || "").toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Guess extraction kind from filename. Master-data files usually contain
// "master", "consumption", "price", "supplier", etc.; everything else
// defaults to tech_pack. The user can always override via the selector.
function guessKindFromFilename(name) {
  const n = (name || "").toLowerCase();
  if (/master.?data|consumption|price.?list|supplier|article.?master|carton.?master/.test(n)) {
    return "master_data";
  }
  if (/tech.?pack|tp|spec|pillow.?protector|encasement|sheet.?set|sheet|comforter|duvet|skirt|throw|sham/.test(n)) {
    return "tech_pack";
  }
  // Default: tech pack — most uploads are tech packs.
  return "tech_pack";
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function AssistantBubble({ children, time }) {
  return (
    <div className="flex gap-2 items-start max-w-[85%]">
      <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center mt-0.5">
        <Sparkles className="w-4 h-4" />
      </div>
      <div className="flex-1">
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm">
          {children}
        </div>
        {time && <div className="text-[10px] text-muted-foreground mt-0.5 ml-1">{time}</div>}
      </div>
    </div>
  );
}

function UserBubble({ children, time }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
          {children}
        </div>
        {time && <div className="text-[10px] text-muted-foreground mt-0.5 mr-1 text-right">{time}</div>}
      </div>
    </div>
  );
}

function FileChip({ file }) {
  const Icon = looksLikeImage(file.type, file.name)
    ? ImageIcon
    : file.name.toLowerCase().endsWith(".pdf")
    ? FileText
    : Paperclip;
  return (
    <div className="inline-flex items-center gap-1.5 bg-background/20 border border-border/40 rounded-md px-2 py-1 text-xs">
      <Icon className="w-3.5 h-3.5" />
      <span className="font-medium truncate max-w-[200px]">{file.name}</span>
      <span className="text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
    </div>
  );
}

// ── Validation card ─────────────────────────────────────────────────────────
//
// Renders a different summary table depending on extraction.kind:
//   tech_pack   → skus, fabric_specs, trim_specs, accessory_specs, labels
//   master_data → articles, fabric_consumption, accessory_consumption,
//                 carton_master, price_list, suppliers, seasons,
//                 production_lines

function ExtractionValidationCard({ extraction, onApply, onReject, onOpenReview, busy }) {
  const data = extraction.extracted_data || {};
  const kind = extraction.kind;
  const confidence = data._confidence?.overall;

  // Build section list polymorphically. Each section becomes a SummaryRow
  // showing count + first few sample identifiers.
  const sections = kind === "master_data"
    ? buildMasterDataSections(data)
    : buildTechPackSections(data);

  const sectionCount = sections.filter((s) => s.count > 0).length;
  const lowConfidence = confidence != null && confidence < 0.6;

  const kindLabel = kind === "master_data" ? "Master data" : "Tech pack";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-sm font-bold">{extraction.file_name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {kindLabel} · {sectionCount} section{sectionCount !== 1 ? "s" : ""} extracted
          </div>
        </div>
        {confidence != null && (
          <div
            className={`px-2 py-1 rounded text-xs font-semibold ${
              confidence >= 0.85
                ? "bg-emerald-100 text-emerald-700"
                : confidence >= 0.6
                ? "bg-amber-100 text-amber-700"
                : "bg-rose-100 text-rose-700"
            }`}
            title="AI confidence in this extraction"
          >
            {Math.round(confidence * 100)}% confidence
          </div>
        )}
      </div>

      <div className="px-4 py-3 space-y-2">
        {sections.filter((s) => s.count > 0).map((s) => (
          <SummaryRow key={s.label} label={`${s.count} ${s.label}`} sample={s.sample} />
        ))}
        {sectionCount === 0 && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            No structured data found. AI couldn't parse meaningful content from this file. Open in full review to inspect raw output.
          </div>
        )}
      </div>

      {lowConfidence && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          Low AI confidence — strongly recommend reviewing in detail before applying.
        </div>
      )}

      <div className="px-4 py-3 bg-muted/20 border-t border-border flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onReject} disabled={busy}>
          <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenReview} disabled={busy}>
          <ExternalLink className="w-3.5 h-3.5 mr-1" /> Review in detail
        </Button>
        <Button
          size="sm"
          onClick={onApply}
          disabled={busy || sectionCount === 0}
          className="gap-1"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Validate & Apply
        </Button>
      </div>
    </div>
  );
}

function buildTechPackSections(data) {
  const sample = (arr, fieldGetters, n = 5) =>
    arr.slice(0, n).map((r) => {
      for (const get of fieldGetters) {
        const v = get(r);
        if (v) return v;
      }
      return null;
    }).filter(Boolean).join(", ") + (arr.length > n ? ` (+${arr.length - n})` : "");
  return [
    { label: "SKU(s)",                    count: (data.skus || []).length,            sample: sample(data.skus || [],            [(r) => r.item_code]) },
    { label: "fabric component(s)",       count: (data.fabric_specs || []).length,    sample: sample(data.fabric_specs || [],    [(r) => r.component_type, (r) => r.fabric_type], 3) },
    { label: "trim(s)",                   count: (data.trim_specs || []).length,      sample: sample(data.trim_specs || [],      [(r) => r.trim_type, (r) => r.description], 3) },
    { label: "accessor(ies)",             count: (data.accessory_specs || []).length, sample: sample(data.accessory_specs || [], [(r) => r.accessory_type, (r) => r.description], 3) },
    { label: "label(s)",                  count: (data.labels || []).length,          sample: sample(data.labels || [],          [(r) => r.type, (r) => r.section], 3) },
  ];
}

function buildMasterDataSections(data) {
  const sample = (arr, fieldGetters, n = 5) =>
    arr.slice(0, n).map((r) => {
      for (const get of fieldGetters) {
        const v = get(r);
        if (v) return v;
      }
      return null;
    }).filter(Boolean).join(", ") + (arr.length > n ? ` (+${arr.length - n})` : "");
  return [
    { label: "article(s)",                count: (data.articles || []).length,              sample: sample(data.articles || [],              [(r) => r.item_code]) },
    { label: "fabric consumption row(s)", count: (data.fabric_consumption || []).length,    sample: sample(data.fabric_consumption || [],    [(r) => `${r.item_code}/${r.component_type}`], 3) },
    { label: "accessory consumption row(s)", count: (data.accessory_consumption || []).length, sample: sample(data.accessory_consumption || [], [(r) => `${r.item_code}/${r.category}`], 3) },
    { label: "carton master row(s)",      count: (data.carton_master || []).length,         sample: sample(data.carton_master || [],         [(r) => r.item_code]) },
    { label: "price list row(s)",         count: (data.price_list || []).length,            sample: sample(data.price_list || [],            [(r) => r.item_code]) },
    { label: "supplier(s)",               count: (data.suppliers || []).length,             sample: sample(data.suppliers || [],             [(r) => r.name]) },
    { label: "season(s)",                 count: (data.seasons || []).length,               sample: sample(data.seasons || [],               [(r) => r.name]) },
    { label: "production line(s)",        count: (data.production_lines || []).length,      sample: sample(data.production_lines || [],      [(r) => r.name]) },
  ];
}

function SummaryRow({ label, sample }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="font-semibold text-foreground">{label}</span>
      {sample && <span className="text-muted-foreground truncate font-mono">{sample}</span>}
    </div>
  );
}

// ── Progress bubble ─────────────────────────────────────────────────────────
//
// Shows live status + elapsed time + (optional) percent bar for the current
// file. Phase strings are short ("Reading file", "Uploading", "AI parsing",
// "Done") and the bar fills proportionally for phases where we have hard
// percent (file→base64 conversion); for AI phases we show an indeterminate
// pulse + elapsed counter so the user knows it's not hung.

function ProgressBubble({ fileName, fileSize, phase, percent, startedAt }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase === "done" || phase === "error") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  const phaseLabel = {
    reading: "Reading file from disk",
    uploading: "Uploading to AI",
    parsing: "AI parsing (this can take 10–30s)",
    done: "Done",
    error: "Failed",
  }[phase] || phase;

  const isDeterminate = typeof percent === "number" && percent >= 0 && percent <= 100;

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2.5 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {phase === "done" ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          ) : phase === "error" ? (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-primary" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{fileName}</div>
            <div className="text-muted-foreground text-[11px]">
              {phaseLabel}
              {phase !== "done" && phase !== "error" && (
                <span className="ml-1 font-mono">· {elapsed}s</span>
              )}
              {fileSize != null && (
                <span className="ml-2 text-muted-foreground/70">
                  {(fileSize / 1024).toFixed(0)} KB
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        {isDeterminate ? (
          <div
            className={`h-full ${
              phase === "done" ? "bg-emerald-500" : phase === "error" ? "bg-rose-500" : "bg-primary"
            } transition-all duration-200`}
            style={{ width: `${percent}%` }}
          />
        ) : phase === "done" ? (
          <div className="h-full bg-emerald-500 w-full" />
        ) : phase === "error" ? (
          <div className="h-full bg-rose-500 w-full" />
        ) : (
          <div
            className="h-full bg-primary animate-pulse"
            style={{ width: phase === "parsing" ? "85%" : phase === "uploading" ? "60%" : "30%" }}
          />
        )}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function FileFeeder() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const [messages, setMessages] = useState(() => [
    {
      id: "welcome",
      type: "assistant",
      time: fmtTime(),
      content: (
        <div>
          <p className="font-semibold text-foreground mb-1">Welcome to File Feeder.</p>
          <p>
            Drop a file here — tech packs (XLSX, PDF, photos) or master-data sheets (consumption library, price list, suppliers). I'll parse it, then show you what I found before anything gets saved.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            <strong>Validation gate:</strong> nothing is written to the database until you click <em>Validate &amp; Apply</em> on each file.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the <strong>type selector</strong> in the top right if I guess wrong about what kind of file you're uploading.
          </p>
        </div>
      ),
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  // Selected file kind for the next upload. "auto" lets us guess from the
  // filename; otherwise pin the kind explicitly.
  const [kindOverride, setKindOverride] = useState("auto");

  // Scroll to bottom on every new message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const append = useCallback((msg) => {
    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setMessages((m) => [...m, { id, time: fmtTime(), ...msg }]);
    return id;
  }, []);

  // Update an existing message in place (used for live progress bubbles).
  const updateMessage = useCallback((id, patch) => {
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, ...patch } : msg)));
  }, []);

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFiles = useCallback(
    async (files) => {
      console.log("[FileFeeder] handleFiles entered, count:", files?.length);
      const list = Array.from(files || []);
      if (list.length === 0) {
        console.warn("[FileFeeder] handleFiles called with empty list");
        return;
      }
      console.log("[FileFeeder] files:", list.map((f) => ({ name: f.name, size: f.size, type: f.type })));

      // Echo what the user dropped as a user bubble.
      try {
        append({
          type: "user",
          content: (
            <div className="flex flex-wrap gap-1.5">
              {list.map((f, i) => (
                <FileChip key={i} file={f} />
              ))}
            </div>
          ),
        });
        console.log("[FileFeeder] user bubble appended");
      } catch (err) {
        console.error("[FileFeeder] FAILED to append user bubble:", err);
      }

      setBusy(true);

      for (const file of list) {
        // Per-file validation FIRST so a bad file doesn't get sent to the API.
        if (!extOk(file.name)) {
          append({
            type: "assistant",
            content: (
              <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                Skipping <strong>{file.name}</strong> — not a supported file type. Accepted: XLSX, PDF, JPG, PNG, WEBP.
              </div>
            ),
          });
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          append({
            type: "assistant",
            content: (
              <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                Skipping <strong>{file.name}</strong> — exceeds 10 MB limit ({(file.size / 1024 / 1024).toFixed(1)} MB).
              </div>
            ),
          });
          continue;
        }

        // Live progress bubble for this file. We mutate it through phases
        // (reading → uploading → parsing → done/error) so the user always
        // sees something moving and an elapsed-time counter instead of a
        // silent spinner that looks hung during the 10–30s AI call.
        const startedAt = Date.now();
        const progressId = append({
          type: "assistant",
          content: (
            <ProgressBubble
              fileName={file.name}
              fileSize={file.size}
              phase="reading"
              percent={0}
              startedAt={startedAt}
            />
          ),
        });

        // Track the latest phase so the delayed setTimeout in `uploading`
        // doesn't accidentally clobber a faster `done`/`error` transition.
        let currentPhase = "reading";
        const setPhase = (phase, percent) => {
          // Once we've reached a terminal state, ignore later updates from
          // the setTimeout below.
          if ((currentPhase === "done" || currentPhase === "error") &&
              phase !== "done" && phase !== "error") {
            return;
          }
          currentPhase = phase;
          updateMessage(progressId, {
            content: (
              <ProgressBubble
                fileName={file.name}
                fileSize={file.size}
                phase={phase}
                percent={percent}
                startedAt={startedAt}
              />
            ),
          });
        };

        // Call the edge function.
        try {
          console.log("[FileFeeder] Starting:", file.name, file.type, file.size);
          // Phase 1: read file → base64. For tiny files this is fast; for
          // 8–10 MB files it can take a second or two. We update percent in
          // 25/50/75/100 bands so the bar visibly moves.
          setPhase("reading", 10);
          const b64 = await fileToBase64(file);
          console.log("[FileFeeder] base64 length:", b64.length);
          setPhase("reading", 100);

          // Phase 2: hand off to the edge function (network upload).
          // supabase.functions.invoke doesn't expose upload progress, but
          // the indeterminate pulse + phase label communicates the handoff.
          setPhase("uploading");
          const kind = kindOverride === "auto" ? guessKindFromFilename(file.name) : kindOverride;
          console.log("[FileFeeder] kind:", kind, "(override:", kindOverride, ")");
          const invokePromise = supabase.functions.invoke("extract-document", {
            body: {
              kind,
              file_name: file.name,
              file_mime: file.type || "application/octet-stream",
              file_size_bytes: file.size,
              file_base64: b64,
            },
          });
          // After ~1.5s, flip the label from "uploading" to "parsing" so
          // the user sees both phases. setPhase guards against clobbering
          // a faster done/error.
          setTimeout(() => setPhase("parsing"), 1500);

          let { data, error } = await invokePromise;
          console.log("[FileFeeder] invoke result:", { data, error });

          // The Supabase JS client throws an error on any non-2xx status, but
          // the real response body still contains useful info (e.g. the
          // EXTRACTION_DUPLICATE code returned with status 409). Recover the
          // body off error.context (which is the underlying Response object)
          // so we can route on it the same way as a 2xx.
          if (error && error.context && typeof error.context.json === "function") {
            try {
              const recovered = await error.context.json();
              console.log("[FileFeeder] recovered body from error:", recovered);
              if (recovered && typeof recovered === "object") {
                data = recovered;
                error = null;
              }
            } catch (parseErr) {
              console.warn("[FileFeeder] could not parse error.context body:", parseErr);
            }
          }

          if (error) {
            setPhase("error");
            throw new Error(error.message || error.name || "Edge function call failed");
          }
          if (!data) {
            setPhase("error");
            throw new Error("Edge function returned empty response");
          }
          setPhase("done", 100);

          // Duplicate handling: extract-document returns ok:false + EXTRACTION_DUPLICATE
          // (HTTP 409) when the same file hash was uploaded recently and is
          // still pending review.
          if (!data?.ok) {
            if (data?.code === "EXTRACTION_DUPLICATE" && data?.dev_detail?.existing_extraction_id) {
              const existingId = data.dev_detail.existing_extraction_id;
              // Fetch the existing extraction so we can show its card.
              const existing = await fetchExtraction(existingId);
              append({
                type: "assistant",
                content: (
                  <div>
                    <p className="text-xs mb-2 text-amber-800">
                      <AlertTriangle className="w-3 h-3 inline mr-1" />
                      You uploaded <strong>{file.name}</strong> recently and it's still pending review. Showing the existing extraction.
                    </p>
                    {existing && (
                      <ExtractionValidationCard
                        extraction={existing}
                        busy={applyingId === existing.id}
                        onApply={() => doApply(existing)}
                        onReject={() => doReject(existing)}
                        onOpenReview={() => navigate(`/AIExtractionReview?id=${existing.id}`)}
                      />
                    )}
                  </div>
                ),
              });
              continue;
            }
            throw new Error(data?.user_message || data?.code || "Extraction failed");
          }

          // Success — fetch the staged row to render.
          let ext = await fetchExtraction(data.extraction_id);
          if (!ext) throw new Error("Could not load the staged extraction");

          // Master-data extractions can contain rows that share the same DB
          // unique key (item_code, component_type, color) for fabric_consumption.
          // Two cases to handle differently:
          //   - EXACT duplicates: every field identical → safe to collapse
          //     silently (pure data-entry duplicates).
          //   - KEY-only duplicates: same key but different consumption →
          //     usually means the AI mis-categorised (e.g. all 4 parts of
          //     a sheet set labelled with the same component_type). DO NOT
          //     auto-sum: that loses per-part info irrecoverably. Flag for
          //     the user instead so they can re-extract or fix manually.
          let dedupNotice = null;
          let flaggedNotice = null;
          if (ext.kind === "master_data") {
            const { data: deduped, summary } = dedupeMasterData(ext.extracted_data || {});
            const exactCollapsed =
              (summary.fabric.before - summary.fabric.after - summary.fabric.flagged.length) +
              (summary.accessory.before - summary.accessory.after - summary.accessory.flagged.length);
            const flaggedCount = summary.fabric.flagged.length + summary.accessory.flagged.length;

            if (exactCollapsed > 0 || flaggedCount > 0) {
              const { error: updErr } = await supabase
                .from("ai_extractions")
                .update({
                  extracted_data: deduped,
                  validation_issues: (ext.validation_issues || []).filter((i) => i?.code !== "DUPLICATE_KEY"),
                  validation_status: ext.validation_status === "failed" ? "warned" : ext.validation_status,
                  review_notes: `[file-feeder ${new Date().toISOString().slice(0,10)}] dedup: ${exactCollapsed} exact duplicate(s) collapsed; ${flaggedCount} group(s) flagged for review.`,
                })
                .eq("id", ext.id);
              if (updErr) {
                console.warn("[FileFeeder] dedup update failed (non-fatal):", updErr);
              } else {
                ext = await fetchExtraction(ext.id);
                if (exactCollapsed > 0) {
                  dedupNotice = `Removed ${exactCollapsed} exact duplicate row(s) (every field matched).`;
                }
                if (flaggedCount > 0) {
                  // Build a readable list of flagged keys for the notice.
                  const samples = [...summary.fabric.flagged, ...summary.accessory.flagged]
                    .slice(0, 3)
                    .map((f) => `${f.key} (${f.rowCount} rows)`)
                    .join(", ");
                  flaggedNotice = `${flaggedCount} group(s) had different consumption values under the same key — likely an AI miscategorisation (e.g. multiple parts labelled with the same component_type). Kept the first row of each. Examples: ${samples}. Recommend opening in Review and either re-extracting or editing component_type per part before applying.`;
                }
              }
            }
          }

          append({
            type: "assistant",
            content: (
              <div>
                <p className="text-xs mb-2">
                  Done. Here's what I found in <strong>{file.name}</strong>. Review and click <em>Validate &amp; Apply</em> to commit, or <em>Reject</em> to discard.
                </p>
                {dedupNotice && (
                  <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 mb-2">
                    <CheckCircle2 className="w-3 h-3 inline mr-1" />
                    {dedupNotice}
                  </p>
                )}
                {flaggedNotice && (
                  <p className="text-[11px] text-rose-800 bg-rose-50 border border-rose-300 rounded px-2 py-1 mb-2 leading-relaxed">
                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                    <strong>Heads up — possible mis-categorisation:</strong> {flaggedNotice}
                  </p>
                )}
                <ExtractionValidationCard
                  extraction={ext}
                  busy={applyingId === ext.id}
                  onApply={() => doApply(ext)}
                  onReject={() => doReject(ext)}
                  onOpenReview={() => navigate(`/AIExtractionReview?id=${ext.id}`)}
                />
              </div>
            ),
          });
        } catch (e) {
          console.error("[FileFeeder] EXCEPTION for", file.name, e);
          setPhase("error");
          append({
            type: "assistant",
            content: (
              <div className="text-rose-800 bg-rose-50 border border-rose-200 rounded p-2 text-xs">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                <strong>{file.name}:</strong> {e.message || String(e)}
                <div className="text-[10px] text-rose-600 mt-1 font-mono">
                  Check browser DevTools console (F12) for full stack trace.
                </div>
              </div>
            ),
          });
        }
      }

      setBusy(false);
    },
    [append, applyingId, navigate, kindOverride, updateMessage],
  );

  async function fetchExtraction(id) {
    // ai_extractions schema (migration 0002): no confidence_score column
    // — overall confidence lives inside extracted_data._confidence.overall.
    // The validation column is `validation_issues` (jsonb), not validation_errors.
    const { data, error } = await supabase
      .from("ai_extractions")
      .select("id, file_name, kind, extracted_data, review_status, validation_status, validation_issues")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[FileFeeder] failed to load extraction", id, error);
      return null;
    }
    return data;
  }

  async function doApply(ext) {
    setApplyingId(ext.id);
    try {
      let data, error, createdSummary;
      if (ext.kind === "master_data") {
        // Master data goes through fn_apply_master_data_extraction with a
        // row filter naming every row to apply. p_force=false means the
        // RPC will refuse to overwrite existing rows; we surface that via
        // the conflict path. p_dry_run=false means commit on success.
        const filter = buildAllRowsFilter(ext.extracted_data);
        ({ data, error } = await supabase.rpc("fn_apply_master_data_extraction", {
          p_extraction_id: ext.id,
          p_row_filter: filter,
          p_force: false,
          p_dry_run: false,
        }));
        if (error) throw error;
        if (data?.code === "APPLY_TARGET_CONFLICT") {
          // Some rows already exist with different values. Direct user
          // to the full Review page where they can resolve per-row.
          throw new Error(
            `${data?.dev_detail?.conflict_count ?? "Some"} row(s) conflict with existing data. Open in full review to resolve.`,
          );
        }
        if (!data?.ok) {
          throw new Error(data?.user_message || data?.code || "Apply failed");
        }
        const counts = data?.dev_detail?.applied_counts ?? {};
        const parts = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k.replaceAll("_", " ")}`);
        createdSummary = parts.length ? parts.join(", ") : "no rows";
      } else {
        // Tech pack
        const skuCodes = (ext.extracted_data?.skus ?? []).map((s) => s.item_code).filter(Boolean);
        ({ data, error } = await supabase.rpc("fn_apply_tech_pack_extraction", {
          p_extraction_id: ext.id,
          p_sku_codes: skuCodes,
        }));
        if (error) throw error;
        if (!data?.ok) {
          throw new Error(data?.user_message || data?.code || "Apply failed");
        }
        createdSummary = data?.dev_detail?.created_count ? `${data.dev_detail.created_count} record(s) created` : "applied";
      }

      append({
        type: "assistant",
        content: (
          <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2 text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
            Applied <strong>{ext.file_name}</strong> to the system. {createdSummary && <span className="font-mono">({createdSummary})</span>}
          </div>
        ),
      });
      qc.invalidateQueries({ queryKey: ["ai_extractions"] });
      qc.invalidateQueries({ queryKey: ["techPacks"] });
      qc.invalidateQueries({ queryKey: ["consumption_library"] });
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["price_list"] });
    } catch (e) {
      append({
        type: "assistant",
        content: (
          <div className="text-rose-800 bg-rose-50 border border-rose-200 rounded p-2 text-xs">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            Could not apply <strong>{ext.file_name}</strong>: {e.message || String(e)}
          </div>
        ),
      });
    } finally {
      setApplyingId(null);
    }
  }

  // Helper for master-data apply: build a row-filter that selects every row
  // in every section. Mirrors buildAllRowsFilter from AIExtractionReview.jsx.
  function buildAllRowsFilter(extracted) {
    const f = {};
    if (Array.isArray(extracted?.articles) && extracted.articles.length)
      f.articles = extracted.articles.map((r) => r.item_code).filter(Boolean);
    if (Array.isArray(extracted?.fabric_consumption) && extracted.fabric_consumption.length)
      f.fabric_consumption = extracted.fabric_consumption.map((r) => ({ item_code: r.item_code, component_type: r.component_type, color: r.color ?? "" }));
    if (Array.isArray(extracted?.accessory_consumption) && extracted.accessory_consumption.length)
      f.accessory_consumption = extracted.accessory_consumption.map((r) => ({ item_code: r.item_code, category: r.category, material: r.material ?? "" }));
    if (Array.isArray(extracted?.carton_master) && extracted.carton_master.length)
      f.carton_master = extracted.carton_master.map((r) => r.item_code).filter(Boolean);
    if (Array.isArray(extracted?.price_list) && extracted.price_list.length)
      f.price_list = extracted.price_list.map((r) => r.item_code).filter(Boolean);
    if (Array.isArray(extracted?.suppliers) && extracted.suppliers.length)
      f.suppliers = extracted.suppliers.map((r) => r.name).filter(Boolean);
    if (Array.isArray(extracted?.seasons) && extracted.seasons.length)
      f.seasons = extracted.seasons.map((r) => r.name).filter(Boolean);
    if (Array.isArray(extracted?.production_lines) && extracted.production_lines.length)
      f.production_lines = extracted.production_lines.map((r) => r.name).filter(Boolean);
    return f;
  }

  async function doReject(ext) {
    setApplyingId(ext.id);
    try {
      const { error } = await supabase.rpc("fn_reject_extraction", {
        p_extraction_id: ext.id,
        p_reason: "Rejected via File Feeder",
      });
      if (error) throw error;
      append({
        type: "assistant",
        content: (
          <div className="text-xs text-muted-foreground">
            <Trash2 className="w-3.5 h-3.5 inline mr-1" />
            Rejected <strong>{ext.file_name}</strong>. No data was written.
          </div>
        ),
      });
      qc.invalidateQueries({ queryKey: ["ai_extractions"] });
    } catch (e) {
      append({
        type: "assistant",
        content: (
          <div className="text-rose-800 bg-rose-50 border border-rose-200 rounded p-2 text-xs">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            Could not reject: {e.message || String(e)}
          </div>
        ),
      });
    } finally {
      setApplyingId(null);
    }
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (busy) return;
    if (!e.dataTransfer.files?.length) return;
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };

  const onDragLeave = (e) => {
    if (e.currentTarget === e.target) setDragActive(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-background gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> File Feeder
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drop tech packs, master data, or photos. AI parses. You validate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Type:</span>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {[
              { id: "auto",        label: "Auto-detect" },
              { id: "tech_pack",   label: "Tech Pack" },
              { id: "master_data", label: "Master Data" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setKindOverride(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  kindOverride === opt.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-foreground hover:bg-muted"
                }`}
                disabled={busy}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/AIExtractionReview")} className="gap-1 ml-1">
            <ExternalLink className="w-3.5 h-3.5" /> All extractions
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-6 py-4 space-y-4 transition-colors ${
          dragActive ? "bg-primary/5" : ""
        }`}
      >
        {messages.map((m) =>
          m.type === "user" ? (
            <UserBubble key={m.id} time={m.time}>{m.content}</UserBubble>
          ) : (
            <AssistantBubble key={m.id} time={m.time}>{m.content}</AssistantBubble>
          ),
        )}

        {dragActive && (
          <div className="fixed inset-0 z-50 bg-primary/10 border-4 border-dashed border-primary flex items-center justify-center pointer-events-none">
            <div className="bg-card border border-border rounded-xl px-6 py-4 shadow-lg">
              <Upload className="w-8 h-8 text-primary mx-auto mb-2" />
              <p className="font-bold text-foreground">Drop your tech pack here</p>
              <p className="text-xs text-muted-foreground mt-1">XLSX, PDF, JPG, PNG, WEBP — up to 10 MB</p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border px-6 py-3 bg-card">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTS.join(",")}
          multiple
          onChange={(e) => {
            console.log("[FileFeeder] file input onChange fired, files:", e.target.files?.length);
            // Snapshot files BEFORE clearing the input — Chrome and
            // Firefox empty the FileList when input.value is reset, even
            // through a captured reference.
            const filesArr = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            if (filesArr.length) handleFiles(filesArr);
          }}
          style={{ display: "none" }}
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="gap-1.5"
          >
            <Paperclip className="w-3.5 h-3.5" />
            {busy ? "Processing…" : "Choose file(s)"}
          </Button>
          <p className="text-xs text-muted-foreground flex-1">
            Or drag &amp; drop anywhere on this page. Embedded images in XLSX/PDFs are read automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
