// supabase/functions/extract-document/index.ts
//
// Phase E2 of the unified AI extraction pipeline (spec 2026-04-25-ai-extraction).
//
// Adds on top of Phase D:
//   - PDF and image input (Anthropic document/image content blocks)
//   - BOB fast path: deterministic XLSX parser tried first for kind=tech_pack;
//     when it succeeds, no LLM call is made and cost is $0.
//   - Haiku-first / Sonnet fallback: every kind starts on Haiku; if the model
//     returns _confidence.overall below CONFIDENCE_FALLBACK_THRESHOLD,
//     the same input is retried with Sonnet. The kept result reports the
//     final model; cost_usd sums across all attempts.
//
// File-type detection: file_mime first, file extension as fallback.
// Supported MIME prefixes (Phase E2):
//   xlsx: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel
//   pdf:  application/pdf
//   image: image/jpeg, image/png, image/webp

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { getPromptForKind, type ExtractionKind } from "./prompts.ts";
import { validateExtraction } from "./extractionValidator.js";
import { parseBobTechPack } from "./bobTechPackParser.js";
import { bobToTechPackShape } from "./bobAdapter.js";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const MAX_FILE_BYTES = 10 * 1024 * 1024;      // 10 MB
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;   // 6 hours
const ANTHROPIC_TIMEOUT_MS = 120_000;         // 120s per attempt (master_data with many sections can take 60-90s on Haiku)
const ANTHROPIC_MAX_TOKENS = 32_000;       // master_data XLSX with 8 sections needs more headroom; was 16k
const SOURCES_BUCKET = "ai-extraction-sources";
const ALLOWED_KINDS = new Set<ExtractionKind>(["tech_pack", "master_data"]);
const CONFIDENCE_FALLBACK_THRESHOLD = 0.7;    // Phase E2 P1=B

type FileFormat = "xlsx" | "pdf" | "image";
const IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const PDF_MIMES   = new Set(["application/pdf"]);
const XLSX_MIMES  = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

// USD per million tokens. Update if Anthropic publishes new rates.
// Cache reads ~10% of base input rate; cache writes ~125%.
const COST_RATES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-4-6":          { in: 3.00, out: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001":  { in: 1.00, out:  5.00, cacheRead: 0.10, cacheWrite: 1.25 },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const err = (code: string, user_message: string, dev_detail: unknown, status: number) =>
  j({ ok: false, code, user_message, dev_detail }, status);

// -------- helpers --------

function sanitiseFileName(raw: string): string {
  const noPath = raw.split(/[\\/]/).pop() ?? "file";
  const cleaned = noPath.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "file";
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(b64: string): Uint8Array {
  const stripped = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const binary = atob(stripped);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack overflow on String.fromCharCode for large inputs
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}

function detectFormat(fileMime: string, fileName: string): FileFormat | null {
  const mime = (fileMime || "").toLowerCase();
  if (XLSX_MIMES.has(mime)) return "xlsx";
  if (PDF_MIMES.has(mime))  return "pdf";
  if (IMAGE_MIMES.has(mime)) return "image";
  // Extension fallback
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "pdf") return "pdf";
  if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp") return "image";
  return null;
}

function xlsxToText(bytes: Uint8Array): string {
  const wb = XLSX.read(bytes, { type: "array" });
  const blocks: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (!csv) continue;
    blocks.push(`=== Sheet: "${name}" ===\n${csv}`);
  }
  return blocks.join("\n\n");
}

function computeCostUsd(
  model: string,
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
): number {
  const r = COST_RATES[model];
  if (!r) return 0;
  const baseIn     = (usage.input_tokens ?? 0)               * r.in        / 1_000_000;
  const cacheRead  = (usage.cache_read_input_tokens ?? 0)    * r.cacheRead / 1_000_000;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0)* r.cacheWrite/ 1_000_000;
  const out        = (usage.output_tokens ?? 0)              * r.out       / 1_000_000;
  return baseIn + cacheRead + cacheWrite + out;
}

// Build the user-message content array per file format. Anthropic accepts an
// array mixing text/image/document blocks; XLSX is sent as text after SheetJS
// rendering, PDF as document, images as image.
function buildUserContent(format: FileFormat, fileName: string, fileMime: string, bytes: Uint8Array, kind: ExtractionKind): unknown[] {
  if (format === "xlsx") {
    const xlsxText = xlsxToText(bytes);
    return [{ type: "text", text: `File: ${fileName} (${bytes.length} bytes, kind=${kind})\n\n${xlsxText}` }];
  }
  const b64 = bytesToBase64(bytes);
  if (format === "pdf") {
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
      { type: "text", text: `Extract per the tool schema. File: ${fileName} (${bytes.length} bytes, kind=${kind}).` },
    ];
  }
  // image
  return [
    { type: "image", source: { type: "base64", media_type: fileMime || "image/jpeg", data: b64 } },
    { type: "text", text: `Extract per the tool schema. File: ${fileName} (${bytes.length} bytes, kind=${kind}).` },
  ];
}

type AttemptResult =
  | { kind: "ok"; raw: unknown; extracted: unknown; usage: AnthropicUsage; model: string }
  | { kind: "timeout"; model: string }
  | { kind: "http_error"; status: number; body: unknown; model: string }
  | { kind: "no_tool_use"; raw: unknown; model: string }
  | { kind: "truncated"; raw: unknown; model: string; usage: AnthropicUsage };

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

async function callAnthropicOnce(
  model: string,
  systemPrompt: string,
  tool: { name: string; [k: string]: unknown },
  userContent: unknown[],
): Promise<AttemptResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
      }),
    });

    const data = await resp.json();
    if (!resp.ok) return { kind: "http_error", status: resp.status, body: data, model };

    const usage: AnthropicUsage = data?.usage ?? {};
    // Claude hit max_tokens before finishing the tool call → output is truncated
    // and the parsed JSON cannot be trusted (mid-string/mid-array cutoff).
    if (data?.stop_reason === "max_tokens") {
      return { kind: "truncated", raw: data, model, usage };
    }
    const block = (data?.content ?? []).find((c: { type?: string }) => c.type === "tool_use");
    if (!block) return { kind: "no_tool_use", raw: data, model };
    return { kind: "ok", raw: data, extracted: block.input, usage, model };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { kind: "timeout", model };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Try each model in order; if a successful call returns confidence below the
// threshold AND there is a stronger model behind it, re-try. Returns the
// final attempt plus the cumulative cost across all attempts.
type ChainResult =
  | { kind: "ok"; attempts: AttemptResult[]; final: Extract<AttemptResult, { kind: "ok" }>; total_cost_usd: number }
  | { kind: "exhausted"; attempts: AttemptResult[]; total_cost_usd: number };

async function callAnthropicChain(
  models: string[],
  systemPrompt: string,
  tool: { name: string; [k: string]: unknown },
  userContent: unknown[],
): Promise<ChainResult> {
  const attempts: AttemptResult[] = [];
  let totalCost = 0;
  for (let i = 0; i < models.length; i++) {
    const isLast = i === models.length - 1;
    const result = await callAnthropicOnce(models[i], systemPrompt, tool, userContent);
    attempts.push(result);
    if (result.kind === "ok") {
      totalCost += computeCostUsd(result.model, result.usage);
      const conf = (result.extracted as { _confidence?: { overall?: number } })?._confidence?.overall;
      const lowConfidence = typeof conf === "number" && conf < CONFIDENCE_FALLBACK_THRESHOLD;
      if (!lowConfidence || isLast) {
        return { kind: "ok", attempts, final: result, total_cost_usd: totalCost };
      }
      console.log(`[extract-document] confidence ${conf} below ${CONFIDENCE_FALLBACK_THRESHOLD}; escalating ${result.model} -> ${models[i + 1]}`);
      continue;
    }
    if (result.kind === "truncated") {
      // Cost was incurred — track it, but don't escalate to the next model.
      // Larger model would also truncate at the same cap. User must split the file.
      totalCost += computeCostUsd(result.model, result.usage);
      return { kind: "exhausted", attempts, total_cost_usd: totalCost };
    }
    if (result.kind === "http_error" || result.kind === "no_tool_use" || result.kind === "timeout") {
      // Non-recoverable per-attempt failure: don't escalate (likely the whole
      // chain would fail similarly).
      return { kind: "exhausted", attempts, total_cost_usd: totalCost };
    }
  }
  return { kind: "exhausted", attempts, total_cost_usd: totalCost };
}

// -------- handler --------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return err("METHOD_NOT_ALLOWED", "Only POST is supported.", `received ${req.method}`, 405);

  if (!ANTHROPIC_API_KEY) {
    console.error("[extract-document] ANTHROPIC_API_KEY not configured");
    return err("EXTRACTION_LLM_ERROR", "The AI service is not configured. Please contact support.", "ANTHROPIC_API_KEY missing", 500);
  }

  const auth = req.headers.get("Authorization");
  if (!auth) return err("UNAUTHORISED", "You need to be signed in to extract documents.", "missing Authorization header", 401);

  let body: { kind?: string; file_name?: string; file_mime?: string; file_size_bytes?: number; file_base64?: string };
  try { body = await req.json(); }
  catch (e) { return err("INVALID_JSON", "We couldn't read the request. Please try again.", String(e), 400); }

  const kind = body.kind as ExtractionKind | undefined;
  if (!kind || !ALLOWED_KINDS.has(kind)) {
    return err("EXTRACTION_KIND_INVALID", "Unknown extraction type — please pick \"Tech pack\" or \"Master data\".", `kind=${JSON.stringify(kind)}`, 400);
  }

  const fileBase64 = body.file_base64;
  if (!fileBase64 || typeof fileBase64 !== "string") {
    return err("EXTRACTION_NO_FILE", "No file was uploaded. Please choose a file and try again.", "file_base64 missing", 400);
  }

  const declaredSize = Number(body.file_size_bytes);
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return err("EXTRACTION_NO_FILE", "No file was uploaded. Please choose a file and try again.", `file_size_bytes=${body.file_size_bytes}`, 400);
  }
  if (declaredSize > MAX_FILE_BYTES) {
    return err("EXTRACTION_FILE_TOO_LARGE", "This file is larger than 10 MB. Please save a smaller version and try again.", `received ${declaredSize} bytes; limit ${MAX_FILE_BYTES}`, 413);
  }

  let bytes: Uint8Array;
  try { bytes = decodeBase64(fileBase64); }
  catch (e) { return err("EXTRACTION_NO_FILE", "We couldn't read the uploaded file. It may be corrupted.", `base64 decode failed: ${String(e)}`, 400); }

  if (bytes.length === 0) return err("EXTRACTION_NO_FILE", "The uploaded file is empty. Please choose another file.", "decoded zero bytes", 400);
  if (bytes.length > MAX_FILE_BYTES) {
    return err("EXTRACTION_FILE_TOO_LARGE", "This file is larger than 10 MB. Please save a smaller version and try again.", `decoded ${bytes.length} bytes; limit ${MAX_FILE_BYTES}`, 413);
  }

  const fileName = sanitiseFileName(body.file_name ?? "upload");
  const fileMime = (body.file_mime ?? "application/octet-stream").slice(0, 200);
  const format = detectFormat(fileMime, fileName);
  if (!format) {
    return err(
      "EXTRACTION_UNSUPPORTED_FORMAT",
      "We don't support this file type yet. Please upload an XLSX, PDF, JPG, PNG, or WEBP file.",
      `mime=${fileMime}, name=${fileName}`,
      415,
    );
  }
  const fileHash = await sha256Hex(bytes);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return err("UNAUTHORISED", "You need to be signed in to extract documents.", userErr?.message ?? "no user", 401);
  }
  const userId = userData.user.id;

  // Dedup
  const sinceIso = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const { data: dupRows, error: dupErr } = await supabase
    .from("ai_extractions")
    .select("id, created_at, review_status")
    .eq("file_hash", fileHash)
    .gte("created_at", sinceIso)
    .not("review_status", "in", "(rejected,superseded)")
    .order("created_at", { ascending: false })
    .limit(1);
  if (dupErr) {
    console.error("[extract-document] dedup query failed:", dupErr.message);
    return err("DEDUP_QUERY_FAILED", "We hit an internal problem checking for duplicates. Please try again.", dupErr.message, 500);
  }
  if (dupRows && dupRows.length > 0) {
    const existing = dupRows[0];
    return j({
      ok: false,
      code: "EXTRACTION_DUPLICATE",
      user_message: "This file was already uploaded recently. Open the existing extraction to review it.",
      dev_detail: { existing_extraction_id: existing.id, matched_at: existing.created_at, review_status: existing.review_status },
    }, 409);
  }

  const extractionId = crypto.randomUUID();
  const storagePath = `${extractionId}/${fileName}`;
  const { error: uploadErr } = await supabase.storage
    .from(SOURCES_BUCKET)
    .upload(storagePath, bytes, { contentType: fileMime, upsert: false });
  if (uploadErr) {
    console.error("[extract-document] upload failed:", uploadErr.message);
    return err("STORAGE_UPLOAD_FAILED", "We couldn't save the uploaded file. Please try again.", uploadErr.message, 500);
  }

  const { systemPrompt, tool, version: promptVersion, models } = getPromptForKind(kind);
  const baseRow = {
    id: extractionId,
    kind,
    prompt_version: promptVersion,
    file_name: fileName,
    file_mime: fileMime,
    file_size_bytes: bytes.length,
    file_hash: fileHash,
    storage_path: storagePath,
    review_status: "pending_review" as const,
    created_by: userId,
  };

  // ---------------------------------------------------------------- BOB fast path
  // Tech_pack + XLSX + sheet structure matches BOB → deterministic parse, $0.
  if (kind === "tech_pack" && format === "xlsx") {
    try {
      const bob = parseBobTechPack(bytes);
      if (bob && Array.isArray(bob.skus) && bob.skus.length > 0) {
        const extracted = bobToTechPackShape(bob);
        const validation = validateExtraction(kind, extracted) as {
          issues: Array<Record<string, unknown>>;
          status: "passed" | "warned" | "failed";
          error_count: number;
          warning_count: number;
        };
        const { error: insertErr } = await supabase.from("ai_extractions").insert({
          ...baseRow,
          model: "bob_parser",
          validation_status: validation.status,
          validation_issues: validation.issues,
          extracted_data: extracted as Record<string, unknown>,
          tokens_input: 0,
          tokens_output: 0,
          cost_usd: 0,
        });
        if (insertErr) {
          console.error("[extract-document] insert (bob path) failed:", insertErr.message);
          return err("PERSIST_FAILED", "Extraction worked but we couldn't save the result. Please try again.", insertErr.message, 500);
        }
        const summary: Record<string, unknown> = {
          model: "bob_parser",
          source: "bob_fast_path",
          errors: validation.error_count,
          warnings: validation.warning_count,
          skus: extracted.skus.length,
          confidence_overall: extracted._confidence.overall,
        };
        return j({ ok: true, extraction_id: extractionId, validation_status: validation.status, summary }, 200);
      }
    } catch (e) {
      // Not a BOB-format file or parse error — silently fall through to the LLM.
      console.log("[extract-document] BOB fast path skipped:", (e as Error).message ?? String(e));
    }
  }

  // ---------------------------------------------------------------- LLM path
  // For XLSX we parse to text first (reused as user-content); for PDF/image
  // we send raw base64 to Anthropic.
  if (format === "xlsx") {
    try { xlsxToText(bytes); }
    catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error("[extract-document] xlsx parse failed:", msg);
      await supabase.from("ai_extractions").insert({
        ...baseRow,
        model: models[0],
        validation_status: "skipped",
        error_code: "EXTRACTION_PARSE_FAILED",
        error_message: msg,
      });
      return err("EXTRACTION_PARSE_FAILED", "We couldn't read this XLSX file. It may be corrupt or password-protected.", `sheetjs threw: ${msg}`, 422);
    }
  }

  const userContent = buildUserContent(format, fileName, fileMime, bytes, kind);
  const chain = await callAnthropicChain(models, systemPrompt, tool, userContent);

  if (chain.kind === "exhausted") {
    const lastFailure = chain.attempts[chain.attempts.length - 1];
    const lastModel = (lastFailure as { model?: string })?.model ?? models[0];
    if (lastFailure.kind === "timeout") {
      await supabase.from("ai_extractions").insert({
        ...baseRow, model: lastModel, validation_status: "skipped",
        error_code: "EXTRACTION_LLM_TIMEOUT", error_message: `aborted at ${ANTHROPIC_TIMEOUT_MS}ms`,
        cost_usd: chain.total_cost_usd,
      });
      return err("EXTRACTION_LLM_TIMEOUT", "The AI took too long to respond. Please try again in a minute.", `fetch aborted at ${ANTHROPIC_TIMEOUT_MS}ms`, 504);
    }
    if (lastFailure.kind === "truncated") {
      await supabase.from("ai_extractions").insert({
        ...baseRow, model: lastModel, validation_status: "skipped",
        raw_llm_response: (lastFailure as { raw?: Record<string, unknown> }).raw,
        error_code: "EXTRACTION_LLM_TRUNCATED",
        error_message: `Claude hit max_tokens (${ANTHROPIC_MAX_TOKENS}); output truncated and unsafe to apply`,
        cost_usd: chain.total_cost_usd,
      });
      return err(
        "EXTRACTION_LLM_TRUNCATED",
        "This file is too big to extract in one shot — please split it into smaller files (e.g. one section per file) and try again.",
        `stop_reason=max_tokens at cap ${ANTHROPIC_MAX_TOKENS}`,
        413,
      );
    }
    if (lastFailure.kind === "http_error") {
      await supabase.from("ai_extractions").insert({
        ...baseRow, model: lastModel, validation_status: "skipped",
        raw_llm_response: lastFailure.body as Record<string, unknown>,
        error_code: "EXTRACTION_LLM_ERROR", error_message: `Anthropic ${lastFailure.status}`,
        cost_usd: chain.total_cost_usd,
      });
      console.error("[extract-document] anthropic error", lastFailure.status, JSON.stringify(lastFailure.body).slice(0, 200));
      return err("EXTRACTION_LLM_ERROR", "The AI service returned an error. Please try again, or contact support if it keeps happening.", `Anthropic returned status ${lastFailure.status}`, 502);
    }
    // no_tool_use
    await supabase.from("ai_extractions").insert({
      ...baseRow, model: lastModel, validation_status: "skipped",
      raw_llm_response: (lastFailure as { raw?: Record<string, unknown> }).raw,
      error_code: "EXTRACTION_LLM_INVALID_JSON", error_message: "tool_use block missing",
      cost_usd: chain.total_cost_usd,
    });
    return err("EXTRACTION_LLM_INVALID_JSON", "The AI couldn't produce a structured result for this file. Please review the raw output or try a clearer source.", "tool_use block missing or invalid", 502);
  }

  // Success
  const final = chain.final;
  const validation = validateExtraction(kind, final.extracted) as {
    issues: Array<Record<string, unknown>>;
    status: "passed" | "warned" | "failed";
    error_count: number;
    warning_count: number;
  };

  const { error: insertErr } = await supabase.from("ai_extractions").insert({
    ...baseRow,
    model: final.model,
    validation_status: validation.status,
    validation_issues: validation.issues,
    raw_llm_response: final.raw as Record<string, unknown>,
    extracted_data: final.extracted as Record<string, unknown>,
    tokens_input: final.usage.input_tokens,
    tokens_output: final.usage.output_tokens,
    cost_usd: Number(chain.total_cost_usd.toFixed(4)),
  });
  if (insertErr) {
    console.error("[extract-document] insert failed:", insertErr.message);
    return err("PERSIST_FAILED", "Extraction worked but we couldn't save the result. Please try again.", insertErr.message, 500);
  }

  const ed = (final.extracted ?? {}) as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    model: final.model,
    source: chain.attempts.length > 1 ? "llm_with_fallback" : "llm",
    attempts: chain.attempts.length,
    errors: validation.error_count,
    warnings: validation.warning_count,
  };
  for (const [k, v] of Object.entries(ed)) {
    if (Array.isArray(v)) summary[k] = v.length;
  }
  const conf = (ed._confidence as { overall?: number } | undefined)?.overall;
  if (typeof conf === "number") summary["confidence_overall"] = conf;

  return j({
    ok: true,
    extraction_id: extractionId,
    validation_status: validation.status,
    summary,
  }, 200);
});
