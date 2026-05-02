// supabase/functions/ai-proxy/index.ts
//
// Proxies Anthropic Claude calls. Origin-locked to production + dev hosts;
// degrades gracefully (200 with structured AI_UNAVAILABLE error) when the
// API key isn't configured so the frontend can render a friendly message
// instead of seeing an unhandled 500.

const ALLOWED_ORIGINS = new Set([
  "https://merquanterp.netlify.app",   // production (matches notify-pricing-pending APP_URL)
  "http://localhost:5173",             // Vite dev server
  "http://localhost:4173",             // Vite preview
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  // Reflect the requesting origin if it's allowed; fall back to the production
  // origin so non-browser callers (curl, Supabase dashboard) still see a valid
  // header. Wildcards are not used so credentials-bearing requests cannot be
  // hijacked from arbitrary origins.
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://merquanterp.netlify.app";
  return {
    "Access-Control-Allow-Origin":  allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  // No Origin header = non-browser caller (curl, server-to-server). Permit.
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  // Pre-body origin check: reject browsers from unexpected origins fast.
  if (!originAllowed(req)) {
    return new Response(
      JSON.stringify({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed." } }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      // Graceful degradation: 200 with a structured payload the client can
      // detect and render. A 500 here would surface as "Something went wrong"
      // in every UI consumer of callClaude.
      console.warn("[ai-proxy] ANTHROPIC_API_KEY not configured — returning AI_UNAVAILABLE");
      return new Response(
        JSON.stringify({
          error: {
            code: "AI_UNAVAILABLE",
            message: "AI features are temporarily unavailable.",
          },
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const messages = body.messages;
    const maxTokens = body.max_tokens || 4000;
    const system = body.system;
    const tools = body.tools;

    // Resolve model — map any claude-*-4-* variant to current names
    let model = body.model || "claude-sonnet-4-5";
    if (model.includes("sonnet-4")) model = "claude-sonnet-4-5";
    else if (model.includes("haiku-4")) model = "claude-haiku-4-5";
    else if (model.includes("opus-4")) model = "claude-opus-4-5";

    console.log("ai-proxy v19: model=" + model + " msgs=" + (messages ? messages.length : 0));

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: { code: "BAD_REQUEST", message: "messages array required" } }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const payload: Record<string, unknown> = { model, max_tokens: maxTokens, messages };
    if (system) payload.system = system;
    if (tools && Array.isArray(tools)) payload.tools = tools;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("Anthropic error " + resp.status + ": " + JSON.stringify(data).substring(0, 200));
      return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err && (err as Error).message ? (err as Error).message : String(err);
    console.error("ai-proxy error: " + msg);
    return new Response(
      JSON.stringify({ error: { code: "INTERNAL_ERROR", message: msg } }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
