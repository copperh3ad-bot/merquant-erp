// supabase/functions/extract-barcodes/index.ts
//
// Reads embedded images from a tech-pack XLSX and uses Claude vision to
// recognise barcode numbers + size labels for each. Returns a list of
// { size, barcode } pairs the caller can stitch into ai_extractions or
// tech_packs.extracted_data.upc.
//
// Why this exists: BOB-format tech packs put their UPC table as a barcode
// IMAGE rather than as text cells, so SheetJS / Claude text-mode parsing
// can't read the digits. This function unzips the XLSX (which is a zip),
// extracts xl/media/* images, and sends them to Claude vision in a single
// batched call.
//
// One Anthropic request per upload, regardless of how many images are
// embedded — keeps latency and cost predictable. Cost: ~$0.05–$0.10 per
// tech pack (Sonnet 4.6 vision pricing on ~10–15 small barcode images).

import JSZip from "https://esm.sh/jszip@3.10.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const VISION_MODEL = "claude-sonnet-4-6";   // vision-capable; Haiku 4.5 also works but Sonnet reads small barcode digits more reliably
const MAX_TOKENS   = 2000;                  // response is small JSON
const MAX_IMAGES   = 20;                    // Anthropic's per-request image cap

const ANTHROPIC_TIMEOUT_MS = 120_000;       // 120s for vision + Anthropic processing

const SYSTEM_PROMPT = `
You are inspecting embedded images extracted from a textile tech pack
spreadsheet. Each image is one of: a barcode (vertical bars + digits + a
size label nearby), a logo, a product photo, a technical drawing, or
similar.

For each image that contains a barcode, identify:
  - size: the size name printed near or above the barcode
          (e.g. "TWIN", "FULL", "QUEEN", "KING", "CAL KING",
           "SLEEPER - QUEEN", "SPLIT HEAD KING"). Preserve the exact
          spelling and case shown.
  - barcode: the digits printed directly under the bars (typically 12–13
             digits, sometimes 10 or 14). Read carefully — barcode digits
             are small and easy to misread.

Skip any image that does not contain a barcode (logos, photos, drawings,
size diagrams). Skip barcodes whose digits are unreadable.

Return STRICT JSON only — no markdown fences, no prose. Schema:
{
  "results": [
    { "image_index": <number>, "size": "<name>", "barcode": "<digits>" },
    ...
  ]
}

If no images contain readable barcodes, return: {"results": []}.
`.trim();

// Origin allowlist for CORS — tightened from `*` per hardening audit
// Finding 17. Env var `ALLOWED_ORIGINS` extends the defaults.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://merquanterp.netlify.app",
  "https://merquant-mas.netlify.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
];
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .concat(DEFAULT_ALLOWED_ORIGINS),
);
function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const isLocalhostDev = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  const allow = (ALLOWED_ORIGINS.has(origin) || isLocalhostDev) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function decodeBase64(b64: string): Uint8Array {
  const stripped = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const binary = atob(stripped);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function mediaTypeForPath(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png")  return "image/png";
  if (ext === "gif")  return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png"; // fallback
}

type ExtractedImage = { path: string; mediaType: string; base64: string; sizeBytes: number };

async function extractImagesFromXlsx(bytes: Uint8Array): Promise<ExtractedImage[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: ExtractedImage[] = [];
  // XLSX zips put embedded images at xl/media/image1.png, image2.jpeg, etc.
  // Older variants may include them at xl/embeddings/* — we read both.
  const entries = Object.entries(zip.files);
  for (const [path, entry] of entries) {
    if (entry.dir) continue;
    if (!/^xl\/(media|embeddings)\/.+\.(png|jpe?g|gif|webp)$/i.test(path)) continue;
    const data = await entry.async("base64");
    const sizeBytes = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? Math.floor(data.length * 0.75);
    out.push({ path, mediaType: mediaTypeForPath(path), base64: data, sizeBytes });
  }
  // Sort by name so image_index in the response is deterministic.
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function callClaudeVision(images: ExtractedImage[]): Promise<{ results: Array<{ image_index: number; size: string | null; barcode: string | null }>; usage: { input_tokens: number; output_tokens: number } }> {
  // Batch up to MAX_IMAGES per request. For tech packs with more images, take
  // the first MAX_IMAGES (covers typical 13-size tech packs comfortably).
  const batch = images.slice(0, MAX_IMAGES);
  const content: unknown[] = [
    { type: "text", text: `Inspect each of the ${batch.length} attached images and report any barcodes per the schema in the system prompt. The images are indexed 0..${batch.length - 1} in the order they are attached.` },
  ];
  for (const img of batch) {
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
  }

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
        model: VISION_MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${body.slice(0, 300)}`);
    }
    const data = await resp.json();
    const usage = data?.usage ?? {};
    const text = (data?.content ?? []).find((c: { type?: string }) => c.type === "text")?.text ?? "{}";

    // Strip markdown code fences if Claude wrapped the JSON despite instructions.
    const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: { results?: Array<{ image_index: number; size: string | null; barcode: string | null }> };
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      throw new Error(`Could not parse vision response as JSON: ${(parseErr as Error).message}; raw: ${jsonText.slice(0, 200)}`);
    }

    const results = (parsed.results ?? []).filter((r) => typeof r.image_index === "number");
    return {
      results,
      usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function computeCostUsd(inputTokens: number, outputTokens: number): number {
  // Sonnet 4.6: $3/MTok input, $15/MTok output
  const inUsd  = (inputTokens  * 3.0)  / 1_000_000;
  const outUsd = (outputTokens * 15.0) / 1_000_000;
  return Number((inUsd + outUsd).toFixed(4));
}

// -------- handler --------

Deno.serve(async (req) => {
  // Per-request CORS headers (allowlist-checked against the Origin
  // header). Helper functions defined below close over `CORS`.
  const CORS = corsHeaders(req);
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  const err = (code: string, user_message: string, dev_detail: unknown, status: number) =>
    j({ ok: false, code, user_message, dev_detail }, status);

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return err("METHOD_NOT_ALLOWED", "Only POST is supported.", `received ${req.method}`, 405);

  if (!ANTHROPIC_API_KEY) {
    return err("AI_UNAVAILABLE", "AI features are temporarily unavailable.", "ANTHROPIC_API_KEY missing", 200);
  }

  // Auth gate. verify_jwt is also set at the platform level, but we
  // verify the JWT in-handler so a real user object is required. A bare
  // header presence check (the previous behaviour) accepted any string,
  // letting an unauthenticated caller burn the Anthropic budget.
  const auth = req.headers.get("Authorization");
  if (!auth) return err("UNAUTHORISED", "You need to be signed in.", "missing Authorization header", 401);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return err("AUTH_BACKEND_MISCONFIGURED", "Auth backend not configured.", "SUPABASE_URL or SUPABASE_ANON_KEY missing", 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return err("UNAUTHORISED", "Invalid or expired session. Please sign in again.", userErr?.message ?? "no user", 401);
  }

  // Two input modes:
  //   A. Legacy / small files — caller sends `file_base64` (whole .xlsx).
  //      Server unzips and extracts images. Limited by Supabase's ~6 MB
  //      edge-fn payload cap (~4.5 MB raw .xlsx file size).
  //   B. New chunked path — caller sends pre-extracted images directly
  //      (`images: [{ media_type, base64 }, ...]`). Lets the frontend
  //      handle arbitrarily large XLSX (it does the JSZip work in-browser
  //      and batches images under the payload cap before each call).
  type IncomingImage = { media_type?: string; mediaType?: string; base64: string; path?: string };
  let body: { file_base64?: string; file_name?: string; images?: IncomingImage[] };
  try { body = await req.json(); }
  catch (e) { return err("INVALID_JSON", "We couldn't read the request.", String(e), 400); }

  let images: ExtractedImage[];

  if (Array.isArray(body.images) && body.images.length > 0) {
    // Mode B — pre-extracted images from the client.
    images = body.images.map((img, i) => {
      const mt = img.media_type ?? img.mediaType ?? "image/png";
      const b64 = (img.base64 ?? "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
      return {
        path: img.path ?? `client-${i}`,
        mediaType: mt,
        base64: b64,
        sizeBytes: Math.floor(b64.length * 0.75),
      };
    }).filter((img) => img.base64.length > 0);
    if (images.length === 0) {
      return err("EXTRACTION_NO_FILE", "All images were empty.", "every image.base64 was empty after stripping", 400);
    }
  } else if (body.file_base64 && typeof body.file_base64 === "string") {
    // Mode A — legacy whole-file upload, server unzips.
    let bytes: Uint8Array;
    try { bytes = decodeBase64(body.file_base64); }
    catch (e) { return err("EXTRACTION_NO_FILE", "Could not decode the file.", String(e), 400); }
    if (bytes.length === 0) return err("EXTRACTION_NO_FILE", "Empty file.", "decoded zero bytes", 400);

    try {
      images = await extractImagesFromXlsx(bytes);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      return err("UNZIP_FAILED", "Could not read images from the file.", msg, 422);
    }
  } else {
    return err("EXTRACTION_NO_FILE", "No file payload.", "neither file_base64 nor images[] provided", 400);
  }

  if (images.length === 0) {
    return j({ ok: true, results: [], image_count: 0, cost_usd: 0, model: null, message: "No embedded images found in the file." });
  }

  let visionResult;
  try {
    visionResult = await callClaudeVision(images);
  } catch (e) {
    const msg = (e as Error).name === "AbortError"
      ? `vision call aborted at ${ANTHROPIC_TIMEOUT_MS}ms`
      : ((e as Error).message ?? String(e));
    return err("VISION_FAILED", "Could not extract barcodes from the images.", msg, 502);
  }

  const cost_usd = computeCostUsd(visionResult.usage.input_tokens, visionResult.usage.output_tokens);

  // Decorate results with the source image path for debugging.
  const decorated = visionResult.results.map((r) => ({
    image_index: r.image_index,
    image_path: images[r.image_index]?.path ?? null,
    size: r.size,
    barcode: r.barcode,
  })).filter((r) => r.size && r.barcode);

  return j({
    ok: true,
    results: decorated,
    image_count: images.length,
    barcode_count: decorated.length,
    model: VISION_MODEL,
    cost_usd,
    tokens_input: visionResult.usage.input_tokens,
    tokens_output: visionResult.usage.output_tokens,
  });
});
