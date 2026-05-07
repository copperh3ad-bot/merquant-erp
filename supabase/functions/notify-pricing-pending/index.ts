// supabase/functions/notify-pricing-pending/index.ts
//
// Sends an email to OWNER_EMAIL when master data import lands rows with
// pricing_status='pending' (no price specified). Reuses Resend setup from
// user-approval function.
//
// Invoked from MasterDataImport.jsx after a successful import:
//   supabase.functions.invoke("notify-pricing-pending", { body: { rows: [...] } })
//
// Body shape:
//   { rows: [{ item_code: string, description?: string, effective_from?: string }] }
//
// Env vars (shared with user-approval):
//   RESEND_API_KEY, APP_URL, OWNER_EMAIL, EMAIL_FROM, SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_KEY  = Deno.env.get("RESEND_API_KEY") || "";
const APP_URL     = Deno.env.get("APP_URL") || "https://merquanterp.netlify.app";
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") || "waqas.ahmed@unionfabrics.com";
const EMAIL_FROM  = Deno.env.get("EMAIL_FROM") || "MerQuant <onboarding@resend.dev>";

// Origin allowlist for CORS — tightened from `*` per hardening audit
// Finding 17. Env var `ALLOWED_ORIGINS` extends the defaults.
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

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) {
    console.warn("[notify-pricing-pending] RESEND_API_KEY not set — skipping email");
    return { ok: false, error: "no_api_key" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("[Resend] failed:", res.status, errText);
    return { ok: false, error: errText };
  }
  return { ok: true };
}

function renderEmail(rows: Array<{ item_code: string; description?: string; effective_from?: string }>) {
  const tableRows = rows.map(r => `
    <tr>
      <td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; font-family:monospace;">${escapeHtml(r.item_code)}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #e5e7eb;">${escapeHtml(r.description || "—")}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; color:#6b7280; font-size:13px;">${escapeHtml(r.effective_from || "—")}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; max-width:680px; margin:0 auto; padding:24px; color:#111827;">
      <h2 style="color:#b45309; margin:0 0 8px 0;">Pricing pending: ${rows.length} item${rows.length > 1 ? "s" : ""}</h2>
      <p style="color:#374151; line-height:1.5; margin:0 0 16px 0;">
        A master data import just completed with <strong>${rows.length}</strong> SKU${rows.length > 1 ? "s" : ""} that ${rows.length > 1 ? "have" : "has"} no price filled in.
        These items have been imported with <code style="background:#fef3c7; padding:2px 6px; border-radius:3px;">pricing_status='pending'</code>
        and effective_from = today. They will not appear in PO costing until prices are added.
      </p>
      <table style="width:100%; border-collapse:collapse; background:#fff; border:1px solid #e5e7eb; border-radius:6px; overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="text-align:left; padding:8px 12px; font-size:12px; text-transform:uppercase; color:#6b7280; border-bottom:1px solid #e5e7eb;">Item Code</th>
            <th style="text-align:left; padding:8px 12px; font-size:12px; text-transform:uppercase; color:#6b7280; border-bottom:1px solid #e5e7eb;">Description</th>
            <th style="text-align:left; padding:8px 12px; font-size:12px; text-transform:uppercase; color:#6b7280; border-bottom:1px solid #e5e7eb;">Effective From</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <div style="margin-top:24px;">
        <a href="${APP_URL}/master-data" style="display:inline-block; padding:10px 20px; background:#1f2937; color:#fff; text-decoration:none; border-radius:6px; font-weight:500;">
          Open Master Data in MerQuant
        </a>
      </div>
      <p style="color:#9ca3af; font-size:12px; margin-top:32px; padding-top:16px; border-top:1px solid #e5e7eb;">
        This is an automated notification from MerQuant ERP. You're receiving it because you're listed as the owner for pricing approvals.
      </p>
    </div>
  `;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req) => {
  // Per-request CORS headers (allowlist-checked against the Origin
  // header). Helper functions defined below close over `CORS`.
  const CORS = corsHeaders(req);
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  // Auth gate. Without this, anyone on the internet could POST to this
  // function and spam OWNER_EMAIL via Resend (and risk Resend rate-limiting
  // the sending domain). verify_jwt: true is also set at the platform level
  // — both layers in place as defence in depth.
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return j({ error: "unauthorised" }, 401);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return j({ error: "auth_backend_misconfigured" }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return j({ error: "unauthorised", detail: userErr?.message ?? "no user" }, 401);
  }

  let body: { rows?: Array<{ item_code: string; description?: string; effective_from?: string }> };
  try {
    body = await req.json();
  } catch {
    return j({ error: "invalid_json" }, 400);
  }

  const rows = body.rows || [];
  if (rows.length === 0) {
    return j({ ok: true, sent: false, reason: "no_pending_rows" });
  }

  // Cap at 200 rows in the email to prevent spam-flagging on huge imports
  const capped = rows.slice(0, 200);
  const wasCapped = rows.length > capped.length;

  const subject = `MerQuant: ${rows.length} SKU${rows.length > 1 ? "s" : ""} need pricing`;
  const html = renderEmail(capped) +
    (wasCapped ? `<p style="color:#9ca3af; font-size:12px; padding:0 24px;">Showing first 200 of ${rows.length} pending items. View all in the app.</p>` : "");

  const result = await sendEmail(OWNER_EMAIL, subject, html);

  return j({
    ok: result.ok,
    sent: result.ok,
    pending_count: rows.length,
    error: result.error,
  }, result.ok ? 200 : 500);
});
