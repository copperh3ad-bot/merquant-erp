/**
 * imap-test-connection/index.ts
 * 
 * Tests IMAP credentials without saving them.
 * POST /functions/v1/imap-test-connection
 * Body: { host, port, secure, username, password }
 */

import { ImapFlow } from "https://esm.sh/imapflow@1.0.162";

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

    // Set a 10s timeout
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timed out after 10 seconds")), 10_000)
    );

    await Promise.race([
      (async () => {
        await client.connect();
        // Try opening INBOX to validate
        const mailbox = await client.mailboxOpen("INBOX");
        await client.logout();
        return mailbox;
      })(),
      timeout,
    ]);

    return new Response(
      JSON.stringify({ success: true, message: `Connected to ${host} successfully. INBOX accessible.` }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        message: err instanceof Error ? err.message : "Connection failed",
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      // Note: 200 even on failure so the frontend can show the error message nicely
    );
  }
});

// ============================================================

/**
 * imap-credentials-save/index.ts
 * 
 * Saves IMAP credentials, encrypting the password via Supabase Vault.
 * POST /functions/v1/imap-credentials-save
 * Body: { host, port, secure, username, password, provider }
 */

// Deno.serve for save function — deploy as separate edge function

/*
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") { ... }

  try {
    const { host, port, secure, username, password, provider } = await req.json();

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,  // service role to write vault
    );

    // Get current user
    const anonSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await anonSupabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Upsert credential record (without password)
    const { data: cred, error: credErr } = await supabase
      .from("imap_credentials")
      .upsert({
        user_id:  user.id,
        host,
        port:     parseInt(port),
        secure:   secure ?? true,
        username,
        provider: provider ?? "imap",
        active:   true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select()
      .single();

    if (credErr) throw credErr;

    // Store password in Vault via RPC
    const { error: vaultErr } = await supabase
      .rpc("store_imap_password", {
        p_credential_id: cred.id,
        p_password:      password,
      });

    if (vaultErr) throw vaultErr;

    return new Response(
      JSON.stringify({ success: true, credential_id: cred.id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Save failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
*/
