// supabase/functions/imap-credentials-save/index.ts
//
// Saves IMAP credentials, encrypting the password via Supabase Vault.
// Called by the IMAP setup dialog after a successful test-connection.
//
// POST /functions/v1/imap-credentials-save
// Body: { host, port, secure, username, password, provider, email_label? }
// Response: { success: true, credential_id: uuid } | { error: string }
//
// Auth: Authorization Bearer JWT. Resolves the user via anon-key client
// then writes via service-role client (vault writes need service role).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS — ERP convention.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !anonKey) {
      throw new Error("Missing Supabase env vars");
    }

    const { host, port, secure, username, password, provider, email_label } = await req.json();
    if (!host || !username || !password) {
      return new Response(
        JSON.stringify({ error: "host, username, password required" }),
        { status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
      );
    }

    // Resolve current user via JWT (anon-key client tied to caller's session)
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userErr } = await anonClient.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated. Sign in and try again." }),
        { status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
      );
    }

    // Service-role client for vault write
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Upsert credential record (no password stored here)
    const { data: cred, error: credErr } = await supabase
      .from("imap_credentials")
      .upsert({
        user_id:    user.id,
        host,
        port:       parseInt(port) || 993,
        secure:     secure ?? true,
        username,
        provider:   provider ?? "imap",
        email_label: email_label ?? null,
        active:     true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select()
      .single();
    if (credErr) throw credErr;

    // Store password in Vault via SECURITY DEFINER RPC (mig 0031).
    const { error: vaultErr } = await supabase.rpc("store_imap_password", {
      p_credential_id: cred.id,
      p_password:      password,
    });
    if (vaultErr) throw vaultErr;

    return new Response(
      JSON.stringify({ success: true, credential_id: cred.id }),
      { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[imap-credentials-save]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Save failed" }),
      { status: 500, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
