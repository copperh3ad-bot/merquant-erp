// ai-proxy edge function
//
// Routes Claude API calls through Supabase so the Anthropic API key
// stays server-side. Requires a valid Supabase user session — the
// function verifies the JWT in the Authorization header before
// forwarding to Anthropic. This prevents anonymous callers from
// burning the Anthropic API budget.
//
// Hardening note (2026-05-01): added explicit getUser() check and
// kept verify_jwt at the platform level. Both layers are in place
// because verify_jwt without an in-handler check would still let
// any signed-in user call the function unrestricted, but adding the
// in-handler check defends against accidental future redeploys with
// verify_jwt: false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Origin allowlist. Env var `ALLOWED_ORIGINS` (comma-separated) overrides
// the defaults — convenient for branch deploys / staging domains. The
// default list covers the production Netlify domain plus local dev ports.
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
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Admin client — bypasses RLS. Used only for service-side bookkeeping
// (rate-limit counters in ai_proxy_calls). NEVER expose this client to
// user-influenced inputs without an allowlist on the table being touched.
function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    // ─── Auth gate ───────────────────────────────────────────────────
    // Reject unauthenticated callers up front. verify_jwt is also set
    // to true in the platform config, but defence-in-depth.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(
        req,
        { error: { message: "Missing Authorization header. Sign in and try again." } },
        401,
      );
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error("ai-proxy: SUPABASE_URL or SUPABASE_ANON_KEY missing");
      return jsonResponse(req, { error: { message: "Auth backend not configured" } }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse(
        req,
        { error: { message: "Invalid or expired session. Please sign in again." } },
        401,
      );
    }

    // ─── Anthropic key ───────────────────────────────────────────────
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return jsonResponse(
        req,
        { error: { message: "ANTHROPIC_API_KEY not configured" } },
        500,
      );
    }

    // ─── Request payload ─────────────────────────────────────────────
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

    console.log(
      "ai-proxy v19: user=" + userData.user.id +
      " model=" + model +
      " msgs=" + (messages ? messages.length : 0),
    );

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return jsonResponse(req, { error: { message: "messages array required" } }, 400);
    }

    // ─── Rate limit (AI-RL) ──────────────────────────────────────────
    // Per-user cap, enforced via the check_ai_proxy_rate_limit RPC
    // which counts rows in public.ai_proxy_calls within a trailing
    // window. Defaults: 60 calls / 5 min. The admin client bypasses
    // RLS so we can write the audit row regardless of the caller's
    // policies. If the admin client isn't configured (missing
    // SERVICE_ROLE_KEY) we fail open with a warning — the auth gate
    // above is already in place, and burning Anthropic spend on a
    // misconfiguration is preferable to locking everyone out.
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data: rl, error: rlErr } = await admin.rpc("check_ai_proxy_rate_limit", {
        p_user_id: userData.user.id,
        p_window_seconds: 300,
        p_max_calls: 60,
      });
      if (rlErr) {
        console.error("ai-proxy: rate-limit check failed: " + rlErr.message);
      } else if (rl && rl.allowed === false) {
        return jsonResponse(
          req,
          {
            error: {
              type: "rate_limit",
              message: "AI request limit reached. Try again in a few minutes.",
              count: rl.count,
              max: rl.max,
              window_seconds: rl.window_seconds,
            },
          },
          429,
        );
      }
    } else {
      console.warn("ai-proxy: SUPABASE_SERVICE_ROLE_KEY missing — rate limit DISABLED");
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

    // Record the call in ai_proxy_calls (best-effort — never block the
    // user-visible response on bookkeeping).
    if (admin && resp.ok) {
      const tokens =
        (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0);
      admin
        .from("ai_proxy_calls")
        .insert({
          user_id: userData.user.id,
          model,
          tokens_used: tokens || null,
        })
        .then(({ error }) => {
          if (error) console.error("ai-proxy: failed to log call: " + error.message);
        });
    }

    if (!resp.ok) {
      console.error(
        "Anthropic error " + resp.status + ": " + JSON.stringify(data).substring(0, 200),
      );
      return jsonResponse(req, data, resp.status);
    }

    return jsonResponse(req, data);

  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error("ai-proxy error: " + msg);
    return jsonResponse(req, { error: { message: msg } }, 500);
  }
});
