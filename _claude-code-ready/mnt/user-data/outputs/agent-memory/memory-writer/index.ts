/**
 * MerQuant — memory-writer Edge Function
 * Version: v1
 *
 * Called whenever a significant event occurs in MerQuant.
 * Uses Claude to summarise the event into a structured memory record.
 *
 * POST /functions/v1/memory-writer
 * Body: { event_type, entity_type, entity_id, entity_label, context, source_id? }
 *
 * Called by:
 *   - Email Agent (PO confirmed, email classified)
 *   - T&A Agent (milestone delayed, buyer notified)
 *   - Frontend (human corrects an agent draft)
 *   - Supabase DB triggers (PO approved, QC failed, payment received)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL             = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// Memory extraction tools
// ---------------------------------------------------------------------------

const MEMORY_TOOLS = [
  {
    name: "write_memory",
    description:
      "Extract and structure a memory from the event context. " +
      "Focus on facts that will be useful to recall in future agent runs. " +
      "Be specific and concrete — avoid vague generalities.",
    input_schema: {
      type: "object",
      required: ["summary", "importance", "sentiment", "tags", "detail"],
      properties: {
        summary: {
          type: "string",
          description:
            "1-2 sentence factual summary of what this memory records. " +
            "Write it as something an agent would want to know later. " +
            "Example: 'Buyer typically requests LC 60-day payment terms and flags early if unhappy with samples.'",
        },
        importance: {
          type: "number",
          enum: [1, 2, 3],
          description: "1=low (routine), 2=medium (notable), 3=high (critical to remember)",
        },
        sentiment: {
          type: "string",
          enum: ["positive", "neutral", "negative"],
          description: "Overall sentiment of this memory from the manufacturer's perspective",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "3-8 searchable keyword tags. Include: entity name, event type, " +
            "key facts (payment terms, delay days, etc). Lowercase, no spaces.",
          maxItems: 8,
        },
        detail: {
          type: "object",
          description: "Structured detail fields extracted from the context",
          properties: {
            // Buyer memories
            preferred_payment_terms:   { type: "string" },
            preferred_incoterms:       { type: "string" },
            typical_order_size_range:  { type: "string" },
            communication_style:       { type: "string" },
            complaint_tendency:        { type: "string" },
            key_contacts:              { type: "array", items: { type: "string" } },
            // Supplier memories
            average_delay_days:        { type: "number" },
            quality_failure_rate:      { type: "string" },
            reliability_score:         { type: "string" },
            pricing_trend:             { type: "string" },
            // Order/article memories
            typical_lead_time_days:    { type: "number" },
            common_delay_reasons:      { type: "array", items: { type: "string" } },
            seasonal_patterns:         { type: "string" },
            // Correction memories
            what_was_wrong:            { type: "string" },
            what_was_corrected_to:     { type: "string" },
            correction_field:          { type: "string" },
            // Universal
            notes:                     { type: "string" },
          },
        },
        should_supersede_previous: {
          type: "boolean",
          description: "True if this memory updates/contradicts a likely existing memory about the same entity",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// System prompts per memory type
// ---------------------------------------------------------------------------

const SYSTEM_PROMPTS: Record<string, string> = {
  buyer: `You are the MerQuant memory system recording buyer intelligence.
Extract facts about buyer behaviour, preferences, and patterns that will help
agents communicate better and anticipate buyer needs in future.
Focus on: payment terms, communication style, order patterns, complaint tendencies,
approval requirements, and any notable incidents.`,

  supplier: `You are the MerQuant memory system recording supplier intelligence.
Extract facts about supplier reliability, quality, pricing, and patterns that
help agents make better procurement and planning decisions.
Focus on: delivery reliability (days late/early), quality issues, pricing trends,
responsiveness, and capacity constraints.`,

  order: `You are the MerQuant memory system recording order and production patterns.
Extract facts about lead times, delay causes, seasonal patterns, and article-specific
characteristics that help agents plan more accurately.
Focus on: actual vs planned lead times, common delay reasons, quality hotspots,
and which article categories are most at-risk.`,

  correction: `You are the MerQuant memory system recording agent correction feedback.
A human has corrected an agent's output. Record exactly what was wrong and what
the correct value was. This helps agents improve future extractions.
Focus on: what field was wrong, original value, corrected value, and why the
agent likely made the mistake.`,
};

// ---------------------------------------------------------------------------
// Event → memory type + entity mapping
// ---------------------------------------------------------------------------

const EVENT_CONFIG: Record<string, {
  memory_type: string;
  entity_type: string;
  importance_boost: number;
}> = {
  // Buyer events
  po_confirmed:           { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 0 },
  po_rejected:            { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 1 },
  buyer_email_sent:       { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 0 },
  complaint_logged:       { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 1 },
  payment_received:       { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 0 },
  sample_rejected:        { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 1 },
  // Supplier events
  fabric_order_delayed:   { memory_type: "supplier",   entity_type: "supplier", importance_boost: 1 },
  qc_failed:              { memory_type: "supplier",   entity_type: "supplier", importance_boost: 2 },
  supplier_late:          { memory_type: "supplier",   entity_type: "supplier", importance_boost: 1 },
  supplier_on_time:       { memory_type: "supplier",   entity_type: "supplier", importance_boost: 0 },
  // Order/article events
  tna_milestone_delayed:  { memory_type: "order",      entity_type: "article",  importance_boost: 1 },
  shipment_delayed:       { memory_type: "order",      entity_type: "po",       importance_boost: 1 },
  order_completed:        { memory_type: "order",      entity_type: "po",       importance_boost: 0 },
  // Agent corrections
  draft_corrected:        { memory_type: "correction", entity_type: "agent",    importance_boost: 1 },
  extraction_corrected:   { memory_type: "correction", entity_type: "agent",    importance_boost: 1 },
  classification_wrong:   { memory_type: "correction", entity_type: "agent",    importance_boost: 2 },
};

// ---------------------------------------------------------------------------
// Run Claude to extract memory
// ---------------------------------------------------------------------------

async function extractMemory(
  anthropicKey: string,
  memoryType: string,
  entityLabel: string,
  context: string
): Promise<Record<string, unknown> | null> {
  const systemPrompt = SYSTEM_PROMPTS[memoryType] ?? SYSTEM_PROMPTS.order;

  const messages = [{
    role: "user",
    content: `Extract a memory from this event for entity: "${entityLabel}"\n\nContext:\n${context}`,
  }];

  let result: Record<string, unknown> | null = null;
  let iterations = 0;

  while (iterations < 4) {
    iterations++;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 1024,
        system:     systemPrompt,
        tools:      MEMORY_TOOLS,
        messages,
      }),
    });

    if (!response.ok) throw new Error(`Anthropic error: ${await response.text()}`);
    const data = await response.json();

    messages.push({ role: "assistant", content: data.content });
    if (data.stop_reason !== "tool_use") break;

    const toolResults = [];
    for (const block of data.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "write_memory") result = block.input;
      toolResults.push({
        type:        "tool_result",
        tool_use_id: block.id,
        content:     JSON.stringify({ status: "ok" }),
      });
    }

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }
    if (result) break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Find and supersede previous memory for same entity (if applicable)
// ---------------------------------------------------------------------------

async function supersedePreviousMemory(
  supabase: ReturnType<typeof createClient>,
  entityType: string,
  entityId: string,
  memoryType: string,
  sourceEvent: string,
  newMemoryId: string
) {
  // Find the most recent active memory of same type/entity/event
  const { data: prev } = await supabase
    .from("agent_memories")
    .select("id")
    .eq("entity_type",  entityType)
    .eq("entity_id",    entityId)
    .eq("memory_type",  memoryType)
    .eq("source_event", sourceEvent)
    .eq("is_active",    true)
    .neq("id",          newMemoryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prev) {
    await supabase
      .from("agent_memories")
      .update({
        is_active:      false,
        superseded_by:  newMemoryId,
      })
      .eq("id", prev.id);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin":  "*",
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

  try {
    const body = await req.json();
    const {
      event_type,    // e.g. "po_confirmed"
      entity_type,   // e.g. "buyer"
      entity_id,     // e.g. "Bob's Discount Furniture"
      entity_label,  // human-readable
      context,       // the raw text context to extract memory from
      source_id,     // UUID of source record
      agent_name,    // which agent is writing this memory
    } = body;

    if (!event_type || !entity_type || !entity_id || !context) {
      return new Response(
        JSON.stringify({ error: "event_type, entity_type, entity_id, context required" }),
        { status: 400 }
      );
    }

    const config = EVENT_CONFIG[event_type] ?? {
      memory_type:      "order",
      entity_type:      entity_type,
      importance_boost: 0,
    };

    const supabase = createClient(supabaseUrl, serviceKey);

    // Extract memory via Claude
    const extracted = await extractMemory(
      anthropicKey,
      config.memory_type,
      entity_label ?? entity_id,
      context
    );

    if (!extracted) {
      return new Response(
        JSON.stringify({ success: false, reason: "Claude did not produce a memory" }),
        { status: 200 }
      );
    }

    // Clamp importance with boost
    const importance = Math.min(3, ((extracted.importance as number) ?? 2) + config.importance_boost);

    // Write to DB
    const { data: memory, error: writeError } = await supabase
      .from("agent_memories")
      .insert({
        memory_type:      config.memory_type,
        entity_type:      config.entity_type,
        entity_id,
        entity_label:     entity_label ?? entity_id,
        summary:          extracted.summary,
        detail:           extracted.detail ?? {},
        raw_context:      context.substring(0, 2000),
        source_event:     event_type,
        source_id:        source_id ?? null,
        confidence:       1.0,
        importance,
        sentiment:        extracted.sentiment ?? "neutral",
        tags:             extracted.tags ?? [],
        created_by_agent: agent_name ?? "system",
        is_active:        true,
      })
      .select()
      .single();

    if (writeError) throw writeError;

    // Supersede previous memory if flagged
    if (extracted.should_supersede_previous) {
      await supersedePreviousMemory(
        supabase,
        config.entity_type,
        entity_id,
        config.memory_type,
        event_type,
        memory.id
      );
    }

    return new Response(
      JSON.stringify({ success: true, memory_id: memory.id, summary: extracted.summary }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  } catch (err) {
    console.error("[memory-writer]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
