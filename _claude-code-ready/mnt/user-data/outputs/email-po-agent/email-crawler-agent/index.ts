/**
 * MerQuant — email-crawler-agent Edge Function
 * Version: v1
 *
 * Runs autonomously via pg_cron every 15 minutes.
 * Pulls unread emails from Gmail API, classifies them,
 * extracts PO data using Claude tool-calling, saves drafts,
 * and notifies Merchandisers — zero human involvement until review.
 *
 * Triggered by:
 *   SELECT net.http_post(
 *     url := 'https://<project>.supabase.co/functions/v1/email-crawler-agent',
 *     headers := '{"Authorization": "Bearer <service_role_key>", "Content-Type": "application/json"}'::jsonb,
 *     body := '{}'::jsonb
 *   );
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const MODEL = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

// How many emails to process per cron run (avoid timeout)
const MAX_EMAILS_PER_RUN = 10;

// ---------------------------------------------------------------------------
// Claude tools (same as email-po-agent but with added classify tool)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "classify_email",
    description:
      "First, decide whether this email is a purchase order or contains PO-related content. " +
      "A PO email typically contains: item descriptions, quantities, prices, delivery dates, " +
      "buyer references, or order numbers. Invoices, shipment advices, and sample requests also count. " +
      "Marketing, newsletters, meeting requests, and general queries do NOT count.",
    input_schema: {
      type: "object",
      required: ["is_po_email", "confidence", "reason"],
      properties: {
        is_po_email: { type: "boolean" },
        confidence: { type: "number", description: "0.0–1.0 confidence in classification" },
        email_type: {
          type: "string",
          enum: ["purchase_order", "invoice", "sample_request", "shipment_advice", "general_enquiry", "other"],
        },
        reason: { type: "string", description: "One sentence explaining the classification" },
      },
    },
  },
  {
    name: "extract_po_data",
    description:
      "Extract all purchase order fields from the email. Only call this if classify_email returned is_po_email=true.",
    input_schema: {
      type: "object",
      required: ["buyer_name", "items"],
      properties: {
        buyer_name: { type: "string" },
        buyer_email: { type: "string" },
        po_number: { type: "string" },
        order_date: { type: "string" },
        delivery_date: { type: "string" },
        currency: { type: "string" },
        destination_country: { type: "string" },
        payment_terms: { type: "string" },
        incoterms: { type: "string" },
        special_instructions: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["description", "quantity"],
            properties: {
              description: { type: "string" },
              sku: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" },
              size_breakdown: { type: "object", additionalProperties: { type: "number" } },
              colour: { type: "string" },
              fabric_composition: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "assess_confidence",
    description: "Score confidence of each extracted field. Call after extract_po_data.",
    input_schema: {
      type: "object",
      required: ["field_scores", "overall_score", "missing_critical_fields", "ambiguities"],
      properties: {
        field_scores: { type: "object", additionalProperties: { type: "number" } },
        overall_score: { type: "number" },
        missing_critical_fields: { type: "array", items: { type: "string" } },
        ambiguities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              issue: { type: "string" },
              suggestion: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "flag_unmatched_items",
    description: "Flag items with no clear SKU. Call after assess_confidence.",
    input_schema: {
      type: "object",
      required: ["unmatched_items", "match_suggestions"],
      properties: {
        unmatched_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_index: { type: "number" },
              description: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
        match_suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_index: { type: "number" },
              suggested_sku: { type: "string" },
              suggestion_basis: { type: "string" },
            },
          },
        },
      },
    },
  },
];

const SYSTEM_PROMPT = `You are the MerQuant autonomous Email-to-PO Agent processing buyer emails 
for a textile/garment manufacturing ERP.

For each email:
1. Call classify_email — determine if this is a PO-related email
2. If is_po_email=true: call extract_po_data, then assess_confidence, then flag_unmatched_items
3. If is_po_email=false: only call classify_email, then stop

Rules:
- Always classify first
- Only extract if classified as PO
- Be thorough but fast — this runs on every email in the inbox
- Size breakdowns are common: look for S/M/L/XL ratios or tables
- Currency defaults to USD unless stated`;

// ---------------------------------------------------------------------------
// Gmail helpers
// ---------------------------------------------------------------------------

async function getGmailToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  // Fetch the stored OAuth token for this user
  const { data, error } = await supabase
    .from("gmail_tokens")
    .select("access_token, refresh_token, expires_at, token_type")
    .eq("user_id", userId)
    .single();

  if (error || !data) throw new Error(`No Gmail token for user ${userId}: ${error?.message}`);

  // Check expiry — if expired, refresh
  const now = Date.now();
  const expiresAt = new Date(data.expires_at).getTime();

  if (now >= expiresAt - 60_000) {
    // Refresh the token
    const refreshed = await refreshGmailToken(data.refresh_token);

    // Persist refreshed token
    await supabase
      .from("gmail_tokens")
      .update({
        access_token: refreshed.access_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq("user_id", userId);

    return refreshed.access_token;
  }

  return data.access_token;
}

async function refreshGmailToken(refreshToken: string) {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");

  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET not set");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json();
}

async function fetchUnreadEmails(accessToken: string, maxResults = MAX_EMAILS_PER_RUN) {
  // List unread messages with label PO or just unread in inbox
  const listRes = await fetch(
    `${GMAIL_API_BASE}/users/me/messages?q=is:unread+in:inbox&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listRes.ok) throw new Error(`Gmail list error: ${await listRes.text()}`);
  const list = await listRes.json();
  if (!list.messages?.length) return [];

  // Fetch full content for each message
  const emails = await Promise.all(
    list.messages.map(async (msg: { id: string }) => {
      const msgRes = await fetch(
        `${GMAIL_API_BASE}/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!msgRes.ok) return null;
      return { id: msg.id, ...(await msgRes.json()) };
    })
  );

  return emails.filter(Boolean);
}

function extractEmailText(gmailMessage: Record<string, unknown>): { subject: string; sender: string; body: string } {
  const headers: Array<{ name: string; value: string }> =
    (gmailMessage?.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> ?? [];

  const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
  const sender = headers.find((h) => h.name === "From")?.value ?? "";

  // Extract plain text body
  const body = extractBody(gmailMessage?.payload as Record<string, unknown>);

  return { subject, sender, body };
}

function extractBody(payload: Record<string, unknown>): string {
  if (!payload) return "";

  // Direct body data
  if (payload.body && (payload.body as Record<string, unknown>).data) {
    return atob(
      ((payload.body as Record<string, unknown>).data as string)
        .replace(/-/g, "+")
        .replace(/_/g, "/")
    );
  }

  // Multipart — prefer text/plain
  const parts = (payload.parts as Array<Record<string, unknown>>) ?? [];
  for (const part of parts) {
    if (part.mimeType === "text/plain") {
      const data = (part.body as Record<string, unknown>)?.data as string;
      if (data) return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    }
  }

  // Fallback: text/html
  for (const part of parts) {
    if (part.mimeType === "text/html") {
      const data = (part.body as Record<string, unknown>)?.data as string;
      if (data) {
        const html = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
        // Strip tags for plain text
        return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    // Recurse nested multipart
    if (part.mimeType?.startsWith("multipart/")) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return "";
}

async function markEmailAsRead(accessToken: string, messageId: string) {
  await fetch(`${GMAIL_API_BASE}/users/me/messages/${messageId}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

// ---------------------------------------------------------------------------
// Claude agentic loop (classify + extract)
// ---------------------------------------------------------------------------

async function processEmailWithAgent(
  emailText: string,
  anthropicKey: string
): Promise<{
  classification: Record<string, unknown>;
  extracted?: Record<string, unknown>;
  confidence?: Record<string, unknown>;
  unmatched?: Record<string, unknown>;
}> {
  const messages: Array<{ role: string; content: unknown }> = [
    {
      role: "user",
      content: `Process this email:\n\n${emailText}`,
    },
  ];

  const results: Record<string, unknown> = {};
  let iterations = 0;

  while (iterations < 8) {
    iterations++;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      }),
    });

    if (!response.ok) throw new Error(`Anthropic error ${response.status}: ${await response.text()}`);

    const data = await response.json();
    messages.push({ role: "assistant", content: data.content });

    if (data.stop_reason === "end_turn" || data.stop_reason !== "tool_use") break;

    const toolResults = [];
    for (const block of data.content) {
      if (block.type !== "tool_use") continue;
      results[block.name] = block.input;

      // If classified as not a PO — stop immediately
      if (block.name === "classify_email" && !block.input.is_po_email) {
        return { classification: block.input };
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify({ status: "ok" }),
      });
    }

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }
  }

  return {
    classification: results["classify_email"] as Record<string, unknown> ?? {},
    extracted: results["extract_po_data"] as Record<string, unknown>,
    confidence: results["assess_confidence"] as Record<string, unknown>,
    unmatched: results["flag_unmatched_items"] as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Save to email_crawl_log
// ---------------------------------------------------------------------------

async function logEmailCrawl(
  supabase: ReturnType<typeof createClient>,
  {
    gmailMessageId,
    subject,
    sender,
    body,
    isPoEmail,
    emailType,
    classificationConfidence,
    draftId,
    status,
    errorMessage,
  }: {
    gmailMessageId: string;
    subject: string;
    sender: string;
    body: string;
    isPoEmail: boolean;
    emailType: string;
    classificationConfidence: number;
    draftId?: string;
    status: "processed" | "skipped" | "error";
    errorMessage?: string;
  }
) {
  await supabase.from("email_crawl_log").insert({
    gmail_message_id:         gmailMessageId,
    subject,
    sender,
    raw_body:                 body.substring(0, 5000), // cap stored body
    is_po_email:              isPoEmail,
    email_type:               emailType,
    classification_confidence: classificationConfidence,
    draft_id:                 draftId ?? null,
    status,
    error_message:            errorMessage ?? null,
    crawled_at:               new Date().toISOString(),
    agent_version:            "crawler-v1",
  });
}

// ---------------------------------------------------------------------------
// Create in-app notification
// ---------------------------------------------------------------------------

async function notifyMerchandisers(
  supabase: ReturnType<typeof createClient>,
  { buyerName, poNumber, draftId }: { buyerName: string; poNumber?: string; draftId: string }
) {
  // Get all Merchandiser + Manager + Owner user IDs
  const { data: users } = await supabase
    .from("user_profiles")
    .select("id")
    .in("role", ["Owner", "Manager", "Merchandiser"]);

  if (!users?.length) return;

  const notifications = users.map((u) => ({
    user_id: u.id,
    type: "email_po_draft",
    title: "New PO Draft from Email",
    message: `AI extracted a PO from ${buyerName}${poNumber ? ` (${poNumber})` : ""}. Review and confirm.`,
    link: `/email-po-agent?draft=${draftId}`,
    read: false,
    created_at: new Date().toISOString(),
  }));

  await supabase.from("notifications").insert(notifications);
}

// ---------------------------------------------------------------------------
// Main: process one email end-to-end
// ---------------------------------------------------------------------------

async function processEmail(
  supabase: ReturnType<typeof createClient>,
  anthropicKey: string,
  accessToken: string,
  gmailMessage: Record<string, unknown>
): Promise<"draft_created" | "skipped" | "error"> {
  const gmailMessageId = gmailMessage.id as string;
  const { subject, sender, body } = extractEmailText(gmailMessage);

  if (!body && !subject) {
    await logEmailCrawl(supabase, {
      gmailMessageId, subject, sender, body,
      isPoEmail: false, emailType: "other",
      classificationConfidence: 0, status: "skipped",
    });
    return "skipped";
  }

  const emailText = [
    `Subject: ${subject}`,
    `From: ${sender}`,
    "",
    body,
  ].join("\n");

  try {
    const { classification, extracted, confidence, unmatched } =
      await processEmailWithAgent(emailText, anthropicKey);

    const isPoEmail = classification?.is_po_email as boolean ?? false;
    const emailType = classification?.email_type as string ?? "other";
    const classConf = classification?.confidence as number ?? 0;

    if (!isPoEmail || !extracted) {
      // Mark as read, log as skipped
      await markEmailAsRead(accessToken, gmailMessageId);
      await logEmailCrawl(supabase, {
        gmailMessageId, subject, sender, body,
        isPoEmail, emailType, classificationConfidence: classConf,
        status: "skipped",
      });
      return "skipped";
    }

    // Build and save draft
    const items = (extracted.items as Array<Record<string, unknown>>) ?? [];
    const fieldScores = (confidence?.field_scores as Record<string, number>) ?? {};

    const { data: draft, error: draftError } = await supabase
      .from("email_po_drafts")
      .insert({
        email_id:                gmailMessageId,
        sender_email:            sender,
        raw_extracted:           extracted,
        buyer_name:              extracted.buyer_name ?? null,
        po_number:               extracted.po_number ?? null,
        order_date:              extracted.order_date ?? null,
        delivery_date:           extracted.delivery_date ?? null,
        currency:                extracted.currency ?? "USD",
        destination_country:     extracted.destination_country ?? null,
        payment_terms:           extracted.payment_terms ?? null,
        incoterms:               extracted.incoterms ?? null,
        special_instructions:    extracted.special_instructions ?? null,
        items: items.map((item, i) => ({
          ...item,
          confidence: fieldScores[`item_${i}`] ?? confidence?.overall_score ?? 0.5,
          matched: !(unmatched?.unmatched_items as Array<{ item_index: number }>)
            ?.some((u) => u.item_index === i),
        })),
        overall_confidence:      confidence?.overall_score ?? 0,
        field_scores:            fieldScores,
        missing_critical_fields: confidence?.missing_critical_fields ?? [],
        ambiguities:             confidence?.ambiguities ?? [],
        unmatched_items:         unmatched?.unmatched_items ?? [],
        match_suggestions:       unmatched?.match_suggestions ?? [],
        is_po_email:             true,
        agent_version:           "crawler-v1",
        status:                  "pending_review",
      })
      .select()
      .single();

    if (draftError) throw draftError;

    // Mark email as read in Gmail
    await markEmailAsRead(accessToken, gmailMessageId);

    // Log the crawl
    await logEmailCrawl(supabase, {
      gmailMessageId, subject, sender, body,
      isPoEmail: true, emailType, classificationConfidence: classConf,
      draftId: draft.id, status: "processed",
    });

    // Notify merchandisers
    await notifyMerchandisers(supabase, {
      buyerName: extracted.buyer_name as string ?? sender,
      poNumber:  extracted.po_number as string ?? undefined,
      draftId:   draft.id,
    });

    return "draft_created";
  } catch (err) {
    console.error(`[crawler-agent] error on message ${gmailMessageId}:`, err);
    await logEmailCrawl(supabase, {
      gmailMessageId, subject, sender, body,
      isPoEmail: false, emailType: "other",
      classificationConfidence: 0,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return "error";
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), { status: 500 });
  }

  // Use service role — this runs as a background agent, no user session
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Get all users with Gmail tokens (could be multiple accounts)
    const { data: tokenUsers, error: tokenError } = await supabase
      .from("gmail_tokens")
      .select("user_id")
      .eq("active", true);

    if (tokenError) throw tokenError;
    if (!tokenUsers?.length) {
      return new Response(
        JSON.stringify({ message: "No active Gmail tokens found", drafts_created: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const runSummary = {
      users_processed: 0,
      emails_checked: 0,
      drafts_created: 0,
      skipped: 0,
      errors: 0,
    };

    // Process each connected Gmail account
    for (const { user_id } of tokenUsers) {
      try {
        const accessToken = await getGmailToken(supabase, user_id);
        const emails = await fetchUnreadEmails(accessToken);

        runSummary.users_processed++;
        runSummary.emails_checked += emails.length;

        for (const email of emails) {
          const result = await processEmail(supabase, anthropicKey, accessToken, email);
          if (result === "draft_created") runSummary.drafts_created++;
          else if (result === "skipped") runSummary.skipped++;
          else runSummary.errors++;
        }
      } catch (userErr) {
        console.error(`[crawler-agent] failed for user ${user_id}:`, userErr);
        runSummary.errors++;
      }
    }

    // Log the cron run result
    await supabase.from("agent_run_log").insert({
      agent_name:      "email-crawler-agent",
      run_at:          new Date().toISOString(),
      summary:         runSummary,
      status:          runSummary.errors > 0 ? "partial" : "success",
    }).throwOnError().then(() => {}).catch(() => {}); // non-fatal if table doesn't exist yet

    return new Response(JSON.stringify({ success: true, ...runSummary }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("[crawler-agent] fatal error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error", success: false }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
