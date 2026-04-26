// supabase/functions/extract-document/index.ts
//
// Phase C of the unified AI extraction pipeline (spec 2026-04-25-ai-extraction).
//
// Adds on top of Phase B:
//   - XLSX parsing via SheetJS (CSV blocks per sheet)
//   - Anthropic call with tool_use for structured output
//   - Persistence of the ai_extractions row with raw response, tokens, and cost
//   - Cost computation per model (constants below; verify if Anthropic publishes new rates)
//
// Validation (Phase D) is intentionally not run here. New rows land with
// validation_status='skipped' and cannot be applied until Phase D ships and
// either re-validates them or applies inline going forward.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { getPromptForKind, type ExtractionKind } from "./prompts.ts";
import { validateExtraction } from "./extractionValidator.js";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const MAX_FILE_BYTES   = 10 * 1024 * 1024;        // 10 MB
const DEDUP_WINDOW_MS  = 6 * 60 * 60 * 1000;      // 6 hours
const ANTHROPIC_TIMEOUT_MS = 60_000;              // 60s
const ANTHROPIC_MAX_TOKENS = 16_000;
const SOURCES_BUCKET   = "ai-extraction-sources";
const ALLOWED_KINDS    = new Set<ExtractionKind>(["tech_pack", "master_data"]);

// USD per million tokens. Update if Anthropic changes published rates.
// Cache reads are billed at ~10% of base input rate; cache writes at ~125%.
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

// Render every sheet of an XLSX as labelled CSV blocks. This is the format
// the LLM reads — each sheet becomes:
//   === Sheet: "<name>" ===
//   row1,row2,row3...
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
): number | null {
  const r = COST_RATES[model];
  if (!r) return null;
  const baseIn      = (usage.input_tokens ?? 0)               * r.in        / 1_000_000;
  const cacheRead   = (usage.cache_read_input_tokens ?? 0)    * r.cacheRead / 1_000_000;
  const cacheWrite  = (usage.cache_creation_input_tokens ?? 0)* r.cacheWrite/ 1_000_000;
  const out         = (usage.output_tokens ?? 0)              * r.out       / 1_000_000;
  return Number((baseIn + cacheRead + cacheWrite + out).toFixed(4));
}

type AnthropicResult =
  | { kind: "ok"; raw: unknown; extracted: unknown; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
  | { kind: "timeout" }
  | { kind: "http_error"; status: number; body: unknown }
  | { kind: "no_tool_use"; raw: unknown };

async function callAnthropic(model: string, systemPrompt: string, tool: unknown, userText: string): Promise<AnthropicResult> {
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
        messages: [{ role: "user", content: userText }],
        tools: [tool],
        // deno-lint-ignore no-explicit-any
        tool_choice: { type: "tool", name: (tool as any).name },
      }),
    });

    const data = await resp.json();
    if (!resp.ok) return { kind: "http_error", status: resp.status, body: data };

    const usage = (data?.usage ?? {}) as AnthropicResult extends { usage: infer U } ? U : never;
    const block = (data?.content ?? []).find((c: { type?: string }) => c.type === "tool_use");
    if (!block) return { kind: "no_tool_use", raw: data };

    return {
      kind: "ok",
      raw: data,
      extracted: block.input,
      usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
      },
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { kind: "timeout" };
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  const fileHash = await sha256Hex(bytes);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve current user (RLS enforces auth_all but we still need created_by)
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return err("UNAUTHORISED", "You need to be signed in to extract documents.", userErr?.message ?? "no user", 401);
  }
  const userId = userData.user.id;

  // Dedup: same hash within 6h that hasn't been rejected/superseded
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

  // Reserve uuid + storage path so the eventual ai_extractions.id matches the path
  const extractionId = crypto.randomUUID();
  const storagePath = `${extractionId}/${fileName}`;

  const { error: uploadErr } = await supabase.storage
    .from(SOURCES_BUCKET)
    .upload(storagePath, bytes, { contentType: fileMime, upsert: false });
  if (uploadErr) {
    console.error("[extract-document] upload failed:", uploadErr.message);
    return err("STORAGE_UPLOAD_FAILED", "We couldn't save the uploaded file. Please try again.", uploadErr.message, 500);
  }

  const { systemPrompt, tool, version: promptVersion, model } = getPromptForKind(kind);

  // Parse XLSX
  let xlsxText: string;
  try {
    xlsxText = xlsxToText(bytes);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[extract-document] xlsx parse failed:", msg);
    await supabase.from("ai_extractions").insert({
      id: extractionId,
      kind,
      prompt_version: promptVersion,
      model,
      file_name: fileName,
      file_mime: fileMime,
      file_size_bytes: bytes.length,
      file_hash: fileHash,
      storage_path: storagePath,
      validation_status: "skipped",
      review_status: "pending_review",
      error_code: "EXTRACTION_PARSE_FAILED",
      error_message: msg,
      created_by: userId,
    });
    return err("EXTRACTION_PARSE_FAILED", "We couldn't read this XLSX file. It may be corrupt or password-protected.", `sheetjs threw: ${msg}`, 422);
  }

  if (!xlsxText.trim()) {
    await supabase.from("ai_extractions").insert({
      id: extractionId,
      kind,
      prompt_version: promptVersion,
      model,
      file_name: fileName,
      file_mime: fileMime,
      file_size_bytes: bytes.length,
      file_hash: fileHash,
      storage_path: storagePath,
      validation_status: "skipped",
      review_status: "pending_review",
      error_code: "EXTRACTION_PARSE_FAILED",
      error_message: "no usable sheets found",
      created_by: userId,
    });
    return err("EXTRACTION_PARSE_FAILED", "This file appears to be empty.", "no usable sheets after parse", 422);
  }

  // Build user message and call Claude
  const userText = `File: ${fileName} (${bytes.length} bytes, kind=${kind})\n\n${xlsxText}`;
  const result = await callAnthropic(model, systemPrompt, tool, userText);

  // Common fields written on every outcome (success and failure)
  const baseRow = {
    id: extractionId,
    kind,
    prompt_version: promptVersion,
    model,
    file_name: fileName,
    file_mime: fileMime,
    file_size_bytes: bytes.length,
    file_hash: fileHash,
    storage_path: storagePath,
    review_status: "pending_review" as const,
    created_by: userId,
  };

  if (result.kind === "timeout") {
    await supabase.from("ai_extractions").insert({ ...baseRow, validation_status: "skipped", error_code: "EXTRACTION_LLM_TIMEOUT", error_message: `aborted at ${ANTHROPIC_TIMEOUT_MS}ms` });
    return err("EXTRACTION_LLM_TIMEOUT", "The AI took too long to respond. Please try again in a minute.", `fetch aborted at ${ANTHROPIC_TIMEOUT_MS}ms`, 504);
  }

  if (result.kind === "http_error") {
    await supabase.from("ai_extractions").insert({ ...baseRow, validation_status: "skipped", raw_llm_response: result.body as Record<string, unknown>, error_code: "EXTRACTION_LLM_ERROR", error_message: `Anthropic ${result.status}` });
    console.error("[extract-document] anthropic error", result.status, JSON.stringify(result.body).slice(0, 200));
    return err("EXTRACTION_LLM_ERROR", "The AI service returned an error. Please try again, or contact support if it keeps happening.", `Anthropic returned status ${result.status}`, 502);
  }

  if (result.kind === "no_tool_use") {
    await supabase.from("ai_extractions").insert({ ...baseRow, validation_status: "skipped", raw_llm_response: result.raw as Record<string, unknown>, error_code: "EXTRACTION_LLM_INVALID_JSON", error_message: "tool_use block missing" });
    return err("EXTRACTION_LLM_INVALID_JSON", "The AI couldn't produce a structured result for this file. Please review the raw output or try a clearer source.", "tool_use block missing or invalid", 502);
  }

  // Success — run the deterministic validator before persisting
  const validation = validateExtraction(kind, result.extracted) as {
    issues: Array<Record<string, unknown>>;
    status: "passed" | "warned" | "failed";
    error_count: number;
    warning_count: number;
  };

  const cost = computeCostUsd(model, result.usage);
  const { error: insertErr } = await supabase.from("ai_extractions").insert({
    ...baseRow,
    validation_status: validation.status,
    validation_issues: validation.issues,
    raw_llm_response: result.raw as Record<string, unknown>,
    extracted_data: result.extracted as Record<string, unknown>,
    tokens_input: result.usage.input_tokens,
    tokens_output: result.usage.output_tokens,
    cost_usd: cost,
  });

  if (insertErr) {
    console.error("[extract-document] insert failed:", insertErr.message);
    return err("PERSIST_FAILED", "Extraction worked but we couldn't save the result. Please try again.", insertErr.message, 500);
  }

  // Build a small summary for the response. Counts per top-level array, plus
  // confidence overall if the model returned it.
  const ed = (result.extracted ?? {}) as Record<string, unknown>;
  const summary: Record<string, unknown> = {
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
