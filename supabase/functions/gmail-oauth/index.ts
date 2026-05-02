// supabase/functions/gmail-oauth/index.ts v2 (verbose errors)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Origin allowlist for CORS — tightened from `*` per hardening audit
// Finding 17. Env var `ALLOWED_ORIGINS` (comma-separated) extends the
// defaults for branch deploys / staging.
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

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);


async function getUserIdFromAuth(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) { console.error("auth error:", error); return null; }
  return data.user.id;
}

Deno.serve(async (req) => {
  // Per-request CORS headers (allowlist-checked against the Origin
  // header). Helper functions defined below close over `CORS`.
  const CORS = corsHeaders(req);
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
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

      // Encrypt tokens at rest. The plaintext columns are written too
      // for backward compat during rollout — a follow-up migration will
      // backfill encrypted-only and drop the plaintext columns.
      const tokenKey = Deno.env.get("GMAIL_TOKEN_KEY") || "";
      let refresh_token_encrypted: string | null = null;
      let access_token_encrypted: string | null = null;
      if (tokenKey) {
        const { data: enc1 } = await supabaseAdmin.rpc("encrypt_gmail_token", { plaintext: refresh_token, passphrase: tokenKey });
        const { data: enc2 } = await supabaseAdmin.rpc("encrypt_gmail_token", { plaintext: access_token,  passphrase: tokenKey });
        refresh_token_encrypted = enc1 ?? null;
        access_token_encrypted  = enc2 ?? null;
      } else {
        console.warn("[gmail-oauth] GMAIL_TOKEN_KEY not set — storing tokens in plaintext only (encryption skipped)");
      }

      const { data: saved, error: upsertErr } = await supabaseAdmin
        .from("gmail_oauth")
        .upsert({
          user_id: userId,
          email,
          refresh_token,
          access_token,
          refresh_token_encrypted,
          access_token_encrypted,
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

      // Resolve plaintext refresh_token: prefer the encrypted column,
      // fall back to legacy plaintext until the rollout backfill runs.
      const tokenKey = Deno.env.get("GMAIL_TOKEN_KEY") || "";
      let refreshPlaintext: string | null = null;
      if (rec.refresh_token_encrypted && tokenKey) {
        const { data: dec } = await supabaseAdmin.rpc("decrypt_gmail_token", {
          ciphertext: rec.refresh_token_encrypted, passphrase: tokenKey,
        });
        refreshPlaintext = dec ?? null;
      }
      if (!refreshPlaintext) refreshPlaintext = rec.refresh_token ?? null;
      if (!refreshPlaintext) return j({ error: "no_refresh_token_stored" }, 500);

      const params = new URLSearchParams({
        refresh_token: refreshPlaintext,
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
      let access_token_encrypted: string | null = null;
      if (tokenKey) {
        const { data: enc } = await supabaseAdmin.rpc("encrypt_gmail_token", {
          plaintext: data.access_token, passphrase: tokenKey,
        });
        access_token_encrypted = enc ?? null;
      }
      await supabaseAdmin.from("gmail_oauth").update({
        access_token: data.access_token,
        access_token_encrypted,
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
