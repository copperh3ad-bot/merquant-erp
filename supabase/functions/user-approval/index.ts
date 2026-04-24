// supabase/functions/user-approval/index.ts
//
// 2026-04 rewrite: sends real emails via Resend (https://resend.com)
//
// Previous version called supabase.auth.admin.generateLink(), which only
// generates a link string — it does NOT send an email. Every signup
// notification and every approval magic link was silently dropped.
//
// Now we:
//   - Generate the link via generateLink() (still useful — we want the
//     magic-link URL embedded in the HTML email body)
//   - Send the email ourselves via Resend's /emails API
//   - Surface any failure both to the function response AND to console
//     logs for debugging
//
// Env vars required (set via: supabase secrets set KEY=value):
//   SUPABASE_URL                  — auto-populated by Supabase runtime
//   SUPABASE_SERVICE_ROLE_KEY     — auto-populated by Supabase runtime
//   RESEND_API_KEY                — from resend.com/api-keys (re_xxx...)
//   APP_URL                       — https://merquanterp.netlify.app
//   OWNER_EMAIL                   — waqas.ahmed@unionfabrics.com
//   EMAIL_FROM                    — optional, defaults to Resend test domain
//
// Deploy:
//   supabase secrets set RESEND_API_KEY=re_xxx...
//   supabase secrets set APP_URL=https://merquanterp.netlify.app
//   supabase secrets set OWNER_EMAIL=waqas.ahmed@unionfabrics.com
//   supabase functions deploy user-approval

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------- Config ----------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") || "";
const APP_URL      = Deno.env.get("APP_URL") || "https://merquanterp.netlify.app";
const OWNER_EMAIL  = Deno.env.get("OWNER_EMAIL") || "waqas.ahmed@unionfabrics.com";
// Resend's default test domain — swap to noreply@yourdomain.com after DNS is set up.
const EMAIL_FROM   = Deno.env.get("EMAIL_FROM") || "MerQuant <onboarding@resend.dev>";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

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

// ---------- Helpers ----------

async function getRequesterId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

async function isOwner(userId: string): Promise<boolean> {
  const { data: profile } = await admin
    .from("user_profiles")
    .select("role,email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) {
    // No profile row — fall back to signup_whitelist using auth.users.email
    const { data: user } = await admin.auth.admin.getUserById(userId);
    const email = user?.user?.email;
    if (!email) return false;
    const { data: wl } = await admin
      .from("signup_whitelist")
      .select("role")
      .eq("email", email)
      .maybeSingle();
    return !!wl;
  }
  // Case-insensitive role check. Schema uses capitalized values ("Owner",
  // "Manager"); older code used lowercase. Accept both.
  const role = (profile.role || "").toLowerCase();
  if (role === "owner" || role === "admin") return true;
  const { data: wl } = await admin
    .from("signup_whitelist")
    .select("role")
    .eq("email", profile.email)
    .maybeSingle();
  return !!wl;
}

// Send email via Resend API. Returns { ok, id?, error? }.
async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) {
    console.error("[user-approval] RESEND_API_KEY is not set");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        html,
      }),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      console.error(`[user-approval] resend failed ${res.status}: ${bodyText}`);
      return { ok: false, error: `Resend ${res.status}: ${bodyText}` };
    }
    try {
      const body = JSON.parse(bodyText);
      console.log(`[user-approval] email sent to ${to} (id: ${body.id})`);
      return { ok: true, id: body.id };
    } catch {
      return { ok: true };
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[user-approval] resend exception: ${msg}`);
    return { ok: false, error: msg };
  }
}

// Generate a magic-link URL via Supabase admin API. Returns URL string or null.
async function generateMagicLink(email: string, redirectTo: string): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error) {
      console.error(`[user-approval] generateLink error: ${error.message}`);
      return null;
    }
    return data?.properties?.action_link || null;
  } catch (e) {
    console.error(`[user-approval] generateLink exception: ${(e as Error).message}`);
    return null;
  }
}

// ---------- Email templates ----------

const baseStyle = `
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
    .container { max-width: 560px; margin: 40px auto; padding: 32px; background: white; border-radius: 12px; border: 1px solid #e2e8f0; }
    .logo { font-size: 22px; font-weight: 700; color: #1e40af; margin-bottom: 24px; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 16px; color: #0f172a; }
    p { font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 16px; }
    .btn { display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 16px 0; }
    .meta { font-size: 13px; color: #64748b; background: #f1f5f9; padding: 12px; border-radius: 6px; margin: 16px 0; }
    .footer { font-size: 12px; color: #94a3b8; margin-top: 32px; text-align: center; }
    a { color: #1e40af; }
  </style>
`;

function emailNotifyOwner(fullName: string, email: string, signupMethod: string) {
  const approvalUrl = `${APP_URL}/UserManagement?tab=pending`;
  return {
    subject: `New MerQuant sign-up request: ${fullName || email}`,
    html: `
      ${baseStyle}
      <body>
        <div class="container">
          <div class="logo">MerQuant</div>
          <h1>New user awaiting your approval</h1>
          <p>A new user has requested access to MerQuant. Review and approve or reject from the User Management page.</p>
          <div class="meta">
            <strong>Name:</strong> ${fullName || "—"}<br>
            <strong>Email:</strong> ${email}<br>
            <strong>Signup via:</strong> ${signupMethod || "—"}
          </div>
          <a class="btn" href="${approvalUrl}">Review Request</a>
          <p style="font-size: 13px; color: #64748b;">Or copy this link: ${approvalUrl}</p>
          <div class="footer">You're receiving this because you're the MerQuant account owner.</div>
        </div>
      </body>
    `,
  };
}

function emailApprovalWelcome(fullName: string, loginLink: string) {
  return {
    subject: `Welcome to MerQuant — your account is approved`,
    html: `
      ${baseStyle}
      <body>
        <div class="container">
          <div class="logo">MerQuant</div>
          <h1>Your account is approved</h1>
          <p>Hi ${fullName || "there"},</p>
          <p>Your access request has been approved. Click below to log in and get started. This link is valid for one use.</p>
          <a class="btn" href="${loginLink}">Log in to MerQuant</a>
          <p style="font-size: 13px; color: #64748b; word-break: break-all;">Or copy this link into your browser:<br>${loginLink}</p>
          <div class="footer">If you didn't request access, please ignore this email.</div>
        </div>
      </body>
    `,
  };
}

function emailRejection(fullName: string, reason: string | null) {
  return {
    subject: `MerQuant access request update`,
    html: `
      ${baseStyle}
      <body>
        <div class="container">
          <div class="logo">MerQuant</div>
          <h1>Access request update</h1>
          <p>Hi ${fullName || "there"},</p>
          <p>Unfortunately, your access request to MerQuant was not approved at this time.</p>
          ${reason ? `<div class="meta"><strong>Reason:</strong> ${reason}</div>` : ""}
          <p>If you believe this was in error, please contact your organization's MerQuant administrator.</p>
          <div class="footer">This is an automated message.</div>
        </div>
      </body>
    `,
  };
}

// ---------- Request handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const requesterId = await getRequesterId(req);
    const body = await req.json();
    const action = body.action;
    console.log(`[user-approval] action=${action} requester=${requesterId || "anon"}`);

    // ---- PUBLIC ACTION: notify_owner ---------------------------------
    // Called by the frontend immediately after a new user signs up.
    // No auth required (the user just signed up and isn't approved yet).
    if (action === "notify_owner") {
      const { user_id, email, full_name, signup_method } = body;
      if (!user_id || !email) return j({ error: "user_id and email required" }, 400);

      // Set approval_status=pending so they show up in Pending tab
      const { error: upsertErr } = await admin.from("user_profiles").upsert({
        id: user_id,
        email,
        full_name,
        signup_method,
        approval_status: "pending",
        requested_at: new Date().toISOString(),
      }, { onConflict: "id" });

      if (upsertErr) {
        console.error(`[user-approval] user_profiles upsert failed: ${upsertErr.message}`);
        return j({ error: upsertErr.message }, 500);
      }

      // Email the owner so they know to come approve
      const { subject, html } = emailNotifyOwner(full_name, email, signup_method);
      const sent = await sendEmail(OWNER_EMAIL, subject, html);

      return j({
        ok: true,
        message: "Owner notified",
        email_sent: sent.ok,
        email_error: sent.ok ? undefined : sent.error,
      });
    }

    // ---- AUTHENTICATED ACTIONS: require owner role -------------------

    if (!requesterId) return j({ error: "not_authenticated" }, 401);
    const owner = await isOwner(requesterId);
    if (!owner) return j({ error: "not_authorized" }, 403);

    // ---- list_pending ------------------------------------------------
    if (action === "list_pending") {
      const { data, error } = await admin
        .from("user_profiles")
        .select("*")
        .eq("approval_status", "pending")
        .order("requested_at", { ascending: false });
      if (error) return j({ error: error.message }, 500);
      return j({ pending: data || [] });
    }

    // ---- approve -----------------------------------------------------
    if (action === "approve") {
      const { user_id } = body;
      if (!user_id) return j({ error: "user_id required" }, 400);

      const { data: profile, error: pErr } = await admin
        .from("user_profiles")
        .update({
          approval_status: "approved",
          approved_by: requesterId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", user_id)
        .select()
        .single();

      if (pErr) {
        console.error(`[user-approval] approve update failed: ${pErr.message}`);
        return j({ error: pErr.message }, 500);
      }

      // Generate a magic login link and email it to the user
      const redirectTo = `${APP_URL}/Dashboard`;
      const magicLink = await generateMagicLink(profile.email, redirectTo);

      let emailStatus: { ok: boolean; error?: string } = { ok: false, error: "no_link" };
      if (magicLink) {
        const { subject, html } = emailApprovalWelcome(profile.full_name, magicLink);
        emailStatus = await sendEmail(profile.email, subject, html);
      }

      return j({
        ok: true,
        profile,
        email_sent: emailStatus.ok,
        email_error: emailStatus.ok ? undefined : emailStatus.error,
      });
    }

    // ---- reject ------------------------------------------------------
    if (action === "reject") {
      const { user_id, reason } = body;
      if (!user_id) return j({ error: "user_id required" }, 400);

      const { data: profile, error } = await admin
        .from("user_profiles")
        .update({
          approval_status: "rejected",
          rejection_reason: reason || null,
        })
        .eq("id", user_id)
        .select()
        .single();

      if (error) return j({ error: error.message }, 500);

      // Email the user to let them know (best-effort)
      let emailStatus: { ok: boolean; error?: string } = { ok: true };
      if (profile?.email) {
        const { subject, html } = emailRejection(profile.full_name, reason || null);
        emailStatus = await sendEmail(profile.email, subject, html);
      }

      return j({
        ok: true,
        email_sent: emailStatus.ok,
        email_error: emailStatus.ok ? undefined : emailStatus.error,
      });
    }

    return j({ error: "unknown_action", received: action }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[user-approval] unhandled exception: ${msg}`);
    return j({ error: "internal", message: msg }, 500);
  }
});
