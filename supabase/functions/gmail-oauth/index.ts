// supabase/functions/gmail-oauth/index.ts v2 (verbose errors)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function getUserIdFromAuth(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) { console.error("auth error:", error); return null; }
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const action = body.action;
    const userId = await getUserIdFromAuth(req);

    console.log(`[gmail-oauth] action=${action} userId=${userId}`);

    if (action === "exchange_code") {
      const { code, redirect_uri } = body;
      if (!code || !redirect_uri) return j({ error: "code and redirect_uri required" }, 400);
      if (!userId) return j({ error: "not_authenticated" }, 401);

      const params = new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri, grant_type: "authorization_code",
      });
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const tokenData = await tokenResp.json();
      console.log(`[gmail-oauth] google_token_status=${tokenResp.status} has_refresh=${!!tokenData.refresh_token}`);

      if (!tokenResp.ok) return j({ error: "google_token_exchange_failed", details: tokenData }, 400);

      const { access_token, refresh_token, expires_in, scope } = tokenData;
      if (!refresh_token) return j({ error: "no_refresh_token", hint: "Revoke app access at myaccount.google.com/permissions and retry" }, 400);

      const profResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const prof = await profResp.json();
      const email = prof.email;
      console.log(`[gmail-oauth] connected_email=${email}`);

      const expires_at = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString();

      const { data: saved, error: upsertErr } = await supabaseAdmin
        .from("gmail_oauth")
        .upsert({
          user_id: userId,
          email,
          refresh_token,
          access_token,
          token_expires_at: expires_at,
          scope,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" })
        .select();

      if (upsertErr) {
        console.error("[gmail-oauth] upsert error:", JSON.stringify(upsertErr));
        return j({ error: "save_failed", details: upsertErr.message, code: upsertErr.code, hint: upsertErr.hint }, 500);
      }
      console.log(`[gmail-oauth] saved rows=${saved?.length}`);
      return j({ success: true, email });
    }

    if (action === "refresh") {
      if (!userId) return j({ error: "not_authenticated" }, 401);
      const { data: rec } = await supabaseAdmin.from("gmail_oauth").select("*").eq("user_id", userId).maybeSingle();
      if (!rec) return j({ error: "no_oauth_record" }, 404);

      const params = new URLSearchParams({
        refresh_token: rec.refresh_token,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      });
      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const data = await resp.json();
      if (!resp.ok) return j({ error: "refresh_failed", details: data }, 400);

      const expires_at = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
      await supabaseAdmin.from("gmail_oauth").update({
        access_token: data.access_token,
        token_expires_at: expires_at,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId);

      return j({ success: true, access_token: data.access_token, expires_at });
    }

    if (action === "disconnect") {
      if (!userId) return j({ error: "not_authenticated" }, 401);
      await supabaseAdmin.from("gmail_oauth").delete().eq("user_id", userId);
      return j({ success: true });
    }

    if (action === "status") {
      if (!userId) return j({ error: "not_authenticated" }, 401);
      const { data } = await supabaseAdmin.from("gmail_oauth").select("email, token_expires_at, last_crawl_at, last_crawl_status").eq("user_id", userId).maybeSingle();
      return j({ connected: !!data, ...data });
    }

    return j({ error: "unknown_action" }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[gmail-oauth] exception:", msg);
    return j({ error: "internal", message: msg }, 500);
  }
});
