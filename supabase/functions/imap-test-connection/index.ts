// supabase/functions/imap-test-connection/index.ts
//
// Tests IMAP credentials without saving them. Used by the IMAP setup
// dialog inside EmailCrawler page.
//
// POST /functions/v1/imap-test-connection
// Body: { host, port, secure, username, password }
// Response: { success: bool, message: string }
//
// Note: returns 200 on auth/connection failure too — the JSON body
// carries the success flag so the frontend can render the error inline.

import { ImapFlow } from "https://esm.sh/imapflow@1.0.162";

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
    const { host, port, secure, username, password } = await req.json();
    if (!host || !username || !password) throw new Error("host, username, password required");

    const client = new ImapFlow({
      host,
      port:   parseInt(port) || 993,
      secure: secure ?? true,
      auth:   { user: username, pass: password },
      logger: false,
      tls:    { rejectUnauthorized: true },
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timed out after 10 seconds")), 10_000),
    );

    await Promise.race([
      (async () => {
        await client.connect();
        const mailbox = await client.mailboxOpen("INBOX");
        await client.logout();
        return mailbox;
      })(),
      timeout,
    ]);

    return new Response(
      JSON.stringify({ success: true, message: `Connected to ${host} successfully. INBOX accessible.` }),
      { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        message: err instanceof Error ? err.message : "Connection failed",
      }),
      // 200 even on failure so the frontend can render the message inline.
      { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
