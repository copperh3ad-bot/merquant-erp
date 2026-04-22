// supabase/functions/user-approval/index.ts
// Actions: list_pending / approve / reject / notify_owner
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || "https://merquant2.netlify.app";
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") || "waqas.ahmed@unionfabrics.com";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function getRequesterId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user?.id || null;
}

async function isOwner(userId: string): Promise<boolean> {
  const { data: profile } = await admin.from("user_profiles").select("role,email").eq("id", userId).maybeSingle();
  if (!profile) return false;
  if (profile.role === "owner" || profile.role === "admin") return true;
  const { data: wl } = await admin.from("signup_whitelist").select("role").eq("email", profile.email).maybeSingle();
  return !!wl;
}

// Send email via Supabase auth magic link (piggyback built-in SMTP)
async function sendApprovalEmail(email: string, loginUrl: string) {
  try {
    // Uses built-in Supabase SMTP to send via magic link
    const { error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: loginUrl },
    });
    if (error) {
      console.error("[user-approval] magic link error:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[user-approval] email error:", (e as Error).message);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const requesterId = await getRequesterId(req);
    const body = await req.json();
    const action = body.action;

    // Public action: when a new user signs up, this logs the request
    if (action === "notify_owner") {
      const { user_id, email, full_name, signup_method } = body;
      if (!user_id || !email) return j({ error: "user_id and email required" }, 400);

      // Update the profile
      await admin.from("user_profiles").upsert({
        id: user_id,
        email,
        full_name,
        signup_method,
        approval_status: "pending",
        requested_at: new Date().toISOString(),
      }, { onConflict: "id" });

      // Email owner via magic link redirect to a special approval URL
      const ownerApprovalUrl = `${APP_URL}/UserManagement?tab=pending`;
      await sendApprovalEmail(OWNER_EMAIL, ownerApprovalUrl);

      return j({ ok: true, message: "Owner notified" });
    }

    // Rest require authenticated owner
    if (!requesterId) return j({ error: "not_authenticated" }, 401);
    const owner = await isOwner(requesterId);
    if (!owner) return j({ error: "not_authorized" }, 403);

    if (action === "list_pending") {
      const { data, error } = await admin.from("user_profiles")
        .select("*")
        .eq("approval_status", "pending")
        .order("requested_at", { ascending: false });
      if (error) return j({ error: error.message }, 500);
      return j({ pending: data || [] });
    }

    if (action === "approve") {
      const { user_id } = body;
      if (!user_id) return j({ error: "user_id required" }, 400);

      const { data: profile, error: pErr } = await admin.from("user_profiles")
        .update({
          approval_status: "approved",
          approved_by: requesterId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", user_id)
        .select()
        .single();
      if (pErr) return j({ error: pErr.message }, 500);

      // Send login email to the newly approved user
      const loginUrl = `${APP_URL}/Dashboard`;
      const sent = await sendApprovalEmail(profile.email, loginUrl);

      return j({ ok: true, email_sent: sent, profile });
    }

    if (action === "reject") {
      const { user_id, reason } = body;
      if (!user_id) return j({ error: "user_id required" }, 400);
      const { error } = await admin.from("user_profiles")
        .update({
          approval_status: "rejected",
          rejection_reason: reason || null,
        })
        .eq("id", user_id);
      if (error) return j({ error: error.message }, 500);
      return j({ ok: true });
    }

    return j({ error: "unknown_action" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[user-approval] exception:", msg);
    return j({ error: "internal", message: msg }, 500);
  }
});
