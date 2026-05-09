/**
 * MerQuant — email-po-agent Edge Function
 * Version: v1
 * Runtime: Deno (Supabase Edge Functions)
 *
 * Receives a raw email, runs a multi-step agentic loop using Claude
 * tool-calling to extract, validate, and draft a Purchase Order.
 *
 * POST /functions/v1/email-po-agent
 * Body: { email_id?: string, subject: string, body: string, sender?: string }
 * Returns: { draft: EmailPODraft, confidence: ConfidenceReport }
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// Tool definitions — Claude decides when to call each one
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "extract_po_data",
    description:
      "Extract all purchase order fields from the email text. Call this first. " +
      "Return every field you can find. Use null for fields not present in the email.",
    input_schema: {
      type: "object",
      required: ["buyer_name", "items"],
      properties: {
        buyer_name: {
          type: "string",
          description: "Name of the buying company or buyer contact",
        },
        buyer_email: {
          type: "string",
          description: "Sender email address if present",
        },
        po_number: {
          type: "string",
          description: "PO or order reference number from the email",
        },
        order_date: {
          type: "string",
          description: "Date the order was placed (ISO 8601 or as written)",
        },
        delivery_date: {
          type: "string",
          description: "Requested delivery or ship date",
        },
        currency: {
          type: "string",
          description: "Currency code e.g. USD, EUR, GBP. Default USD if not stated.",
        },
        destination_country: {
          type: "string",
          description: "Destination country for the shipment",
        },
        payment_terms: {
          type: "string",
          description: "Payment terms e.g. LC 60 days, TT 30 days",
        },
        incoterms: {
          type: "string",
          description: "Incoterms e.g. FOB, CIF, DDP",
        },
        special_instructions: {
          type: "string",
          description: "Any special packing, labelling, or compliance notes",
        },
        items: {
          type: "array",
          description: "All line items found in the email",
          items: {
            type: "object",
            required: ["description", "quantity"],
            properties: {
              description: {
                type: "string",
                description: "Item description as written in the email",
              },
              sku: {
                type: "string",
                description: "SKU, style number, or article code if present",
              },
              quantity: {
                type: "number",
                description: "Total quantity ordered",
              },
              unit_price: {
                type: "number",
                description: "Unit price if stated",
              },
              size_breakdown: {
                type: "object",
                description:
                  "Size ratio if present e.g. { S: 100, M: 200, L: 150, XL: 50 }",
                additionalProperties: { type: "number" },
              },
              colour: {
                type: "string",
                description: "Colour or colour code",
              },
              fabric_composition: {
                type: "string",
                description: "Fabric content if mentioned e.g. 100% Cotton",
              },
            },
          },
        },
      },
    },
  },
  {
    name: "assess_confidence",
    description:
      "After extracting PO data, assess the confidence level of each critical field. " +
      "Call this after extract_po_data. Score each field 0.0–1.0.",
    input_schema: {
      type: "object",
      required: ["field_scores", "overall_score", "missing_critical_fields", "ambiguities"],
      properties: {
        field_scores: {
          type: "object",
          description: "Confidence score per field name",
          additionalProperties: { type: "number" },
        },
        overall_score: {
          type: "number",
          description: "Overall confidence score 0.0–1.0",
        },
        missing_critical_fields: {
          type: "array",
          items: { type: "string" },
          description: "List of critical fields that could not be extracted",
        },
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
          description: "Fields where the value is present but unclear or ambiguous",
        },
      },
    },
  },
  {
    name: "flag_unmatched_items",
    description:
      "Flag line items that have no SKU or article code, or whose description " +
      "is too vague to match against the articles master. These will need manual resolution.",
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
          description: "Best-guess SKU matches for unmatched items based on description",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the MerQuant Email-to-PO Agent, an expert at extracting 
purchase order data from buyer emails for a textile/garment manufacturing ERP.

Your job is to:
1. Call extract_po_data to pull all PO fields from the email
2. Call assess_confidence to score extraction quality
3. Call flag_unmatched_items for any items without clear SKUs

Rules:
- Always call all three tools in sequence
- Be liberal in extraction — capture everything present
- Use null for truly absent fields, never guess critical numbers
- Size breakdowns are common in garments: look for ratio tables or S/M/L/XL splits
- Currency defaults to USD unless stated
- Dates: preserve original format, also attempt ISO 8601 conversion
- If the email is NOT a purchase order (e.g. general enquiry, complaint), 
  set buyer_name to "NOT_A_PO" and items to empty array`;

// ---------------------------------------------------------------------------
// Agentic loop — runs until Claude stops calling tools
// ---------------------------------------------------------------------------

async function runAgentLoop(
  emailText: string,
  anthropicKey: string
): Promise<{ extracted: Record<string, unknown>; confidence: Record<string, unknown>; unmatched: Record<string, unknown> }> {
  const messages: Array<{ role: string; content: unknown }> = [
    {
      role: "user",
      content: `Please process this email and extract purchase order data:\n\n${emailText}`,
    },
  ];

  const results: Record<string, unknown> = {};
  let iterations = 0;
  const MAX_ITERATIONS = 6; // safety cap

  while (iterations < MAX_ITERATIONS) {
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

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = await response.json();

    // Add assistant message to history
    messages.push({ role: "assistant", content: data.content });

    // Stop if no more tool calls
    if (data.stop_reason === "end_turn") break;
    if (data.stop_reason !== "tool_use") break;

    // Process all tool calls in this response
    const toolResults: Array<{
      type: string;
      tool_use_id: string;
      content: string;
    }> = [];

    for (const block of data.content) {
      if (block.type !== "tool_use") continue;

      const toolName: string = block.name;
      const toolInput = block.input;

      // Store result by tool name
      results[toolName] = toolInput;

      // Return a simple acknowledgement to Claude
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify({ status: "ok", received: toolName }),
      });
    }

    // Feed tool results back to Claude
    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }
  }

  return {
    extracted: (results["extract_po_data"] as Record<string, unknown>) ?? {},
    confidence: (results["assess_confidence"] as Record<string, unknown>) ?? {},
    unmatched: (results["flag_unmatched_items"] as Record<string, unknown>) ?? {},
  };
}

// ---------------------------------------------------------------------------
// Build the draft PO object from extracted data
// ---------------------------------------------------------------------------

function buildDraft(
  extracted: Record<string, unknown>,
  confidence: Record<string, unknown>,
  unmatched: Record<string, unknown>,
  emailId: string | null,
  sender: string | null
) {
  const items = (extracted.items as Array<Record<string, unknown>>) ?? [];
  const fieldScores = (confidence.field_scores as Record<string, number>) ?? {};

  return {
    // Header
    email_id: emailId,
    sender_email: sender ?? extracted.buyer_email ?? null,
    raw_extracted: extracted,

    // PO fields
    buyer_name: extracted.buyer_name ?? null,
    po_number: extracted.po_number ?? null,
    order_date: extracted.order_date ?? null,
    delivery_date: extracted.delivery_date ?? null,
    currency: extracted.currency ?? "USD",
    destination_country: extracted.destination_country ?? null,
    payment_terms: extracted.payment_terms ?? null,
    incoterms: extracted.incoterms ?? null,
    special_instructions: extracted.special_instructions ?? null,

    // Line items
    items: items.map((item, i) => ({
      ...item,
      confidence: fieldScores[`item_${i}`] ?? (confidence.overall_score as number) ?? 0.5,
      matched: !(unmatched.unmatched_items as Array<{ item_index: number }>)
        ?.some((u) => u.item_index === i),
    })),

    // Confidence
    overall_confidence: confidence.overall_score ?? 0,
    field_scores: fieldScores,
    missing_critical_fields: confidence.missing_critical_fields ?? [],
    ambiguities: confidence.ambiguities ?? [],
    unmatched_items: unmatched.unmatched_items ?? [],
    match_suggestions: unmatched.match_suggestions ?? [],

    // Status
    status: "pending_review",
    is_po_email:
      extracted.buyer_name !== "NOT_A_PO" && items.length > 0,
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

// CORS — ERP convention (regex-allow localhost dev ports + named allowlist)
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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  try {
    // Parse request
    const body = await req.json();
    const { email_id, subject, body: emailBody, sender } = body;

    if (!emailBody && !subject) {
      return new Response(
        JSON.stringify({ error: "email body or subject required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Combine subject + body for extraction
    const emailText = [
      subject ? `Subject: ${subject}` : "",
      sender ? `From: ${sender}` : "",
      "",
      emailBody ?? "",
    ]
      .filter(Boolean)
      .join("\n");

    // Get Anthropic key
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      throw new Error("ANTHROPIC_API_KEY not set in edge function secrets");
    }

    // Run agentic loop
    const { extracted, confidence, unmatched } = await runAgentLoop(
      emailText,
      anthropicKey
    );

    // Build draft
    const draft = buildDraft(extracted, confidence, unmatched, email_id ?? null, sender ?? null);

    return new Response(JSON.stringify({ draft, success: true }), {
      status: 200,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[email-po-agent] error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        success: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      },
    );
  }
});
