/**
 * MerQuant — gmail-oauth-exchange Edge Function
 *
 * Called after Google redirects back with an auth code.
 * Exchanges the code for access + refresh tokens and stores in gmail_tokens.
 *
 * POST /functions/v1/gmail-oauth-exchange
 * Body: { code: string, redirect_uri: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  try {
    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) throw new Error("code and redirect_uri required");

    const clientId     = Deno.env.get("GMAIL_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri,
        grant_type:    "authorization_code",
      }),
    });

    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
    const tokens = await tokenRes.json();

    // Get Gmail address for display
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};

    // Get the current MerQuant user from JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Not authenticated");

    // Upsert token record
    const { error: upsertError } = await supabase
      .from("gmail_tokens")
      .upsert({
        user_id:       user.id,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type:    tokens.token_type ?? "Bearer",
        expires_at:    new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope:         tokens.scope,
        email:         profile.email ?? null,
        active:        true,
        updated_at:    new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (upsertError) throw upsertError;

    return new Response(
      JSON.stringify({ success: true, email: profile.email }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("[gmail-oauth-exchange]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});
