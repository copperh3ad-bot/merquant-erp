// supabase/functions/classify-components/index.ts
//
// Claude-powered classifier for accessories / trims / packaging items the
// keyword-based componentClassifier.js couldn't confidently classify.
// Caller batches up to 50 items per request — typical master-data import or
// BOB tech-pack upload sends 10–30. One round-trip per batch.
//
// Cost (Sonnet 4.6 with prompt caching): ~$0.005 per batch of 30 items.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const VISION_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4000;
const ANTHROPIC_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `
You are classifying accessory / trim / packaging items extracted from
textile tech packs and master-data spreadsheets into a fixed taxonomy.

Categories (return EXACTLY one for each item):
  • Label          - sewn-in / printed cloth labels (care, brand, size, composition, country of origin)
  • Insert Card    - printed paper card placed inside packaging (info card, color insert, leaflet)
  • Polybag        - the MAIN product packaging bag (large, contains the product)
  • Accessory Bag  - SMALL bag for hang tags, accessories, or swatches (has hanger / adhesive / tiny dim)
  • Stiffener      - cardboard or foam insert that maintains the product shape inside packaging
  • Carton         - outer master / shipping / export carton (corrugated, ply, B-flute)
  • Sticker        - adhesive printed label (barcode, UPC, QR code, carton mark)
  • Zipper         - a STANDALONE zipper item (NOT a bag that has a zipper — that's Polybag)
  • Trim           - binding, piping, elastic, drawcord, ribbon, velcro, hook-and-loop, button, rivet
  • Hang Tag       - paper card with brand/info hung by a string/loop (NOT cloth label)
  • Other          - none of the above clearly fits

Critical rules:
  - Disambiguate Polybag vs Accessory Bag by context: a small bag (any
    dimension under 20 cm) with a hanger / adhesive seal is Accessory Bag.
    A large bag that contains the product is Polybag.
  - "No hanger" / "without hanger" in the description means it is NOT an
    accessory bag.
  - A polybag with a zipper feature is Polybag, not Zipper. Only classify
    as Zipper when the item itself IS a zipper (not a bag with one).

Return STRICT JSON only — no markdown fences, no prose. Schema:
{
  "classifications": [
    { "id": "<id from input>", "component_type": "<one of the categories>", "confidence": 0.0-1.0, "reason": "<short>" },
    ...
  ]
}
`.trim();

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

const err = (code: string, msg: string, dev: unknown, status: number) =>
  j({ ok: false, code, user_message: msg, dev_detail: dev }, status);

interface InputItem {
  id: string | number;
  raw_category?: string;
  item_name?: string;
  material?: string;
  description?: string;
  size_spec?: string;
  placement?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return err("METHOD_NOT_ALLOWED", "Only POST is supported.", `received ${req.method}`, 405);
  if (!ANTHROPIC_API_KEY)
    return err("AI_UNAVAILABLE", "AI features are temporarily unavailable.", "ANTHROPIC_API_KEY missing", 200);

  const auth = req.headers.get("Authorization");
  if (!auth) return err("UNAUTHORISED", "You need to be signed in.", "missing Authorization header", 401);

  let body: { items?: InputItem[] };
  try {
    body = await req.json();
  } catch (e) {
    return err("INVALID_JSON", "We couldn't read the request.", String(e), 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0)
    return err("NO_ITEMS", "No items to classify.", "items array missing/empty", 400);
  if (body.items.length > 50)
    return err("TOO_MANY", "Max 50 items per batch.", `received ${body.items.length}`, 400);

  // Build user message: a JSON array of items keyed by their id.
  const slim = body.items.map((it) => ({
    id: it.id,
    raw_category: it.raw_category || "",
    item_name: it.item_name || "",
    material: (it.material || "").slice(0, 500),
    description: (it.description || "").slice(0, 500),
    size_spec: it.size_spec || "",
    placement: (it.placement || "").slice(0, 200),
  }));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Classify these ${slim.length} items. Return JSON only.\n\n${JSON.stringify(slim)}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return err("ANTHROPIC_ERR", "Could not classify items.", `${resp.status}: ${text.slice(0, 300)}`, 502);
    }

    const data = await resp.json();
    const text =
      (data?.content ?? []).find((c: { type?: string }) => c.type === "text")?.text ?? "{}";
    const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed: { classifications?: Array<{ id: unknown; component_type: string; confidence?: number; reason?: string }> };
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return err("BAD_JSON", "Could not parse classifier response.", `parseErr: ${(e as Error).message}; raw: ${jsonText.slice(0, 200)}`, 502);
    }

    const classifications = (parsed.classifications ?? []).filter(
      (c) => c && c.id != null && typeof c.component_type === "string",
    );

    return j({
      ok: true,
      classifications,
      tokens_input: data?.usage?.input_tokens ?? 0,
      tokens_output: data?.usage?.output_tokens ?? 0,
      cost_usd: Number(((data?.usage?.input_tokens ?? 0) * 3 / 1_000_000 + (data?.usage?.output_tokens ?? 0) * 15 / 1_000_000).toFixed(4)),
    });
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? `aborted at ${ANTHROPIC_TIMEOUT_MS}ms` : ((e as Error).message ?? String(e));
    return err("CLASSIFY_FAILED", "Classifier call failed.", msg, 502);
  } finally {
    clearTimeout(timer);
  }
});
