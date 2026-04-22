const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { message: "ANTHROPIC_API_KEY not configured" } }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
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

    console.log("ai-proxy v18: model=" + model + " msgs=" + (messages ? messages.length : 0));

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: { message: "messages array required" } }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
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
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error("ai-proxy error: " + msg);
    return new Response(
      JSON.stringify({ error: { message: msg } }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
