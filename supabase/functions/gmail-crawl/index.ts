// supabase/functions/gmail-crawl/index.ts v2 - reduced memory footprint
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
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  return data?.user?.id || null;
}

async function ensureAccessToken(userId: string): Promise<{ access_token: string; email: string } | { error: string }> {
  const { data: rec } = await supabaseAdmin.from("gmail_oauth").select("*").eq("user_id", userId).maybeSingle();
  if (!rec) return { error: "not_connected" };

  const expiresAt = rec.token_expires_at ? new Date(rec.token_expires_at).getTime() : 0;
  if (rec.access_token && expiresAt > Date.now() + 60_000) {
    return { access_token: rec.access_token, email: rec.email };
  }

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
  if (!resp.ok) return { error: "refresh_failed" };

  const exp = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  await supabaseAdmin.from("gmail_oauth").update({
    access_token: data.access_token,
    token_expires_at: exp,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return { access_token: data.access_token, email: rec.email };
}

function decodeBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  try { return atob(padded); } catch { return ""; }
}

function decodeTextPart(part: any): string {
  if (!part?.body?.data) return "";
  const binary = decodeBase64Url(part.body.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function walkParts(payload: any, collector: { body: string; htmlBody: string; attachments: any[] }, depth = 0) {
  if (!payload || depth > 10) return;
  const mime = payload.mimeType || "";
  if (mime === "text/plain") {
    const t = decodeTextPart(payload);
    if (t) collector.body += (collector.body ? "\n" : "") + t.slice(0, 20000);
  } else if (mime === "text/html" && !collector.body) {
    const t = decodeTextPart(payload);
    if (t) collector.htmlBody += t.slice(0, 20000);
  } else if (payload.filename && payload.body?.attachmentId) {
    collector.attachments.push({
      attachmentId: payload.body.attachmentId,
      filename: payload.filename,
      mimeType: mime,
      size: payload.body.size || 0,
    });
  }
  if (Array.isArray(payload.parts)) for (const p of payload.parts) walkParts(p, collector, depth + 1);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const userId = await getUserIdFromAuth(req);
    if (!userId) return j({ error: "not_authenticated" }, 401);

    const body = await req.json();
    const action = body.action || "search";

    const tok = await ensureAccessToken(userId);
    if ("error" in tok) return j({ error: tok.error }, 400);
    const accessToken = tok.access_token;
    const userEmail = tok.email;

    if (action === "status") return j({ connected: true, email: userEmail });

    if (action === "search") {
      const query = body.query || "subject:order OR subject:PO OR subject:purchase";
      const maxResults = Math.min(body.max_results || 25, 50);  // cap lower
      const includeAttachments = body.include_attachments !== false;
      const maxAttachmentMB = 2; // cap attachment size

      console.log(`[gmail-crawl] query="${query}" max=${maxResults}`);

      const listResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const listData = await listResp.json();
      if (!listResp.ok) return j({ error: "gmail_list_failed", details: listData }, listResp.status);

      const ids: string[] = (listData.messages || []).map((m: any) => m.id);
      console.log(`[gmail-crawl] found ${ids.length} message ids`);

      if (ids.length === 0) {
        await supabaseAdmin.from("gmail_oauth").update({ last_crawl_at: new Date().toISOString(), last_crawl_status: "ok (0 results)" }).eq("user_id", userId);
        return j({ emails: [], count: 0, account: userEmail });
      }

      // Fetch messages in PARALLEL (not sequential) with concurrency limit
      const emails: any[] = [];
      const CONCURRENCY = 3;
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = ids.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(async (id) => {
          try {
            const mResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!mResp.ok) return null;
            const msg = await mResp.json();
            const headers: any = {};
            for (const h of (msg.payload?.headers || [])) headers[h.name.toLowerCase()] = h.value;
            const collector = { body: "", htmlBody: "", attachments: [] as any[] };
            walkParts(msg.payload, collector);

            // Attachments - metadata only, NO base64 in v2
            const atts = collector.attachments
              .filter(a => a.mimeType === "application/pdf" || a.mimeType.startsWith("image/"))
              .filter(a => a.size <= maxAttachmentMB * 1024 * 1024)
              .map(a => ({ filename: a.filename, mime_type: a.mimeType, size_bytes: a.size, attachment_id: a.attachmentId, message_id: id }));

            return {
              id: msg.id,
              threadId: msg.threadId,
              subject: headers["subject"] || "",
              sender: headers["from"] || "",
              date: headers["date"] || "",
              snippet: (msg.snippet || "").slice(0, 500),
              body: (collector.body || collector.htmlBody.replace(/<[^>]+>/g, "")).slice(0, 15000),
              attachments: atts,
            };
          } catch (e) {
            console.error(`[gmail-crawl] error fetching ${id}:`, (e as Error).message);
            return null;
          }
        }));
        for (const r of results) if (r) emails.push(r);
      }

      await supabaseAdmin.from("gmail_oauth").update({ last_crawl_at: new Date().toISOString(), last_crawl_status: `ok (${emails.length} emails)` }).eq("user_id", userId);
      return j({ emails, count: emails.length, account: userEmail });
    }

    if (action === "get_attachment") {
      const { message_id, attachment_id } = body;
      if (!message_id || !attachment_id) return j({ error: "message_id and attachment_id required" }, 400);
      const attResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/attachments/${attachment_id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const attData = await attResp.json();
      if (!attResp.ok) return j({ error: "attachment_fetch_failed", details: attData }, attResp.status);
      let b64 = (attData.data || "").replace(/-/g, "+").replace(/_/g, "/");
      const pad = (4 - b64.length % 4) % 4;
      b64 = b64 + "=".repeat(pad);
      return j({ content_base64: b64, size: attData.size || 0 });
    }

    return j({ error: "unknown_action" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[gmail-crawl] exception:", msg);
    return j({ error: "internal", message: msg }, 500);
  }
});
