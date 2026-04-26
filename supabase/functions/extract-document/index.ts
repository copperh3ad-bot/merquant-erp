// supabase/functions/extract-document/index.ts
//
// Phase B skeleton for the unified AI extraction pipeline
// (spec 2026-04-25-ai-extraction).
//
// What this version does:
//   1. Verifies the caller's JWT (Supabase platform handles this when the
//      function is deployed without --no-verify-jwt).
//   2. Validates the request body — `kind`, file size, base64 payload.
//   3. Computes SHA-256 of the decoded bytes.
//   4. Looks up `ai_extractions` for a matching `file_hash` within 6 hours
//      and short-circuits with EXTRACTION_DUPLICATE if found.
//   5. Uploads the bytes to the `ai-extraction-sources` storage bucket at
//      `<extraction_id>/<sanitised_file_name>`.
//   6. Returns 501 NOT_IMPLEMENTED — extraction itself lands in Phase C.
//
// What this version DOES NOT do (Phase C onwards):
//   - parse the XLSX, build the Anthropic prompt, call Claude
//   - run server-side validation and persist `ai_extractions` row
//   - record tokens / cost
//
// Invoked from the React app via `supabase.functions.invoke('extract-document', { body })`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const MAX_FILE_BYTES = 10 * 1024 * 1024;            // 10 MB
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;         // 6 hours
const SOURCES_BUCKET = "ai-extraction-sources";
const ALLOWED_KINDS = new Set(["tech_pack", "master_data"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type ErrorBody = {
  ok: false;
  code: string;
  user_message: string;
  dev_detail: unknown;
};

const err = (code: string, user_message: string, dev_detail: unknown, status: number) =>
  j({ ok: false, code, user_message, dev_detail } satisfies ErrorBody, status);

// Path-safety: strip directory traversal and slashes; keep extension.
// Hard-cap length so storage keys stay sane.
function sanitiseFileName(raw: string): string {
  const noPath = raw.split(/[\\/]/).pop() ?? "file";
  const cleaned = noPath.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "file";
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function decodeBase64(b64: string): Uint8Array {
  // Strip data:...;base64, prefix if present, plus any whitespace
  const stripped = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const binary = atob(stripped);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return err("METHOD_NOT_ALLOWED", "Only POST is supported.", `received ${req.method}`, 405);
  }

  const auth = req.headers.get("Authorization");
  if (!auth) {
    return err("UNAUTHORISED", "You need to be signed in to extract documents.", "missing Authorization header", 401);
  }

  let body: {
    kind?: string;
    file_name?: string;
    file_mime?: string;
    file_size_bytes?: number;
    file_base64?: string;
  };
  try {
    body = await req.json();
  } catch (e) {
    return err("INVALID_JSON", "We couldn't read the request. Please try again.", String(e), 400);
  }

  const kind = body.kind;
  if (!kind || !ALLOWED_KINDS.has(kind)) {
    return err(
      "EXTRACTION_KIND_INVALID",
      "Unknown extraction type — please pick \"Tech pack\" or \"Master data\".",
      `kind=${JSON.stringify(kind)}`,
      400
    );
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
    return err(
      "EXTRACTION_FILE_TOO_LARGE",
      "This file is larger than 10 MB. Please save a smaller version and try again.",
      `received ${declaredSize} bytes; limit ${MAX_FILE_BYTES}`,
      413
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(fileBase64);
  } catch (e) {
    return err("EXTRACTION_NO_FILE", "We couldn't read the uploaded file. It may be corrupted.", `base64 decode failed: ${String(e)}`, 400);
  }
  if (bytes.length === 0) {
    return err("EXTRACTION_NO_FILE", "The uploaded file is empty. Please choose another file.", "decoded zero bytes", 400);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return err(
      "EXTRACTION_FILE_TOO_LARGE",
      "This file is larger than 10 MB. Please save a smaller version and try again.",
      `decoded ${bytes.length} bytes; limit ${MAX_FILE_BYTES}`,
      413
    );
  }

  const fileName = sanitiseFileName(body.file_name ?? "upload");
  const fileMime = (body.file_mime ?? "application/octet-stream").slice(0, 200);

  const fileHash = await sha256Hex(bytes);

  // Build a per-request supabase client that forwards the caller's JWT, so
  // RLS evaluates against the authenticated user (auth_all permits, but we
  // still want correct attribution on inserts/queries).
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Dedup check — same hash uploaded within 6 hours and not rejected/superseded.
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
      dev_detail: {
        existing_extraction_id: existing.id,
        matched_at: existing.created_at,
        review_status: existing.review_status,
      },
    }, 409);
  }

  // Reserve a uuid for the storage path even though Phase B doesn't insert
  // an `ai_extractions` row yet. This keeps the upload path stable across
  // phases — Phase C will insert with the same id.
  const extractionId = crypto.randomUUID();
  const storagePath = `${extractionId}/${fileName}`;

  const { error: uploadErr } = await supabase.storage
    .from(SOURCES_BUCKET)
    .upload(storagePath, bytes, { contentType: fileMime, upsert: false });

  if (uploadErr) {
    console.error("[extract-document] upload failed:", uploadErr.message);
    return err("STORAGE_UPLOAD_FAILED", "We couldn't save the uploaded file. Please try again.", uploadErr.message, 500);
  }

  // Phase B intentional stop. Phase C replaces this with the LLM call.
  return j({
    ok: false,
    code: "NOT_IMPLEMENTED",
    user_message: "Extraction is not yet wired up — your file was uploaded, but no data was extracted.",
    dev_detail: {
      file_hash: fileHash,
      storage_path: storagePath,
      extraction_id_reserved: extractionId,
      kind,
    },
  }, 501);
});
