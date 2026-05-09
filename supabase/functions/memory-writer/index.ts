// supabase/functions/memory-writer/index.ts
//
// MerQuant — memory-writer edge function (v1).
//
// Called whenever a significant event occurs in MerQuant. Uses Claude
// to summarise the event into a structured memory record stored in
// agent_memories.
//
// POST /functions/v1/memory-writer
// Body: { event_type, entity_type, entity_id, entity_label, context, source_id?, agent_name? }
//
// CORS adapted to ERP convention (regex-allow any localhost dev port +
// production allowlist, per commit 811f2e6).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL             = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

// ── CORS (ERP convention) ────────────────────────────────────────────
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

// ── Memory extraction tool schema ────────────────────────────────────
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
        summary: { type: "string", description: "1-2 sentence factual summary." },
        importance: { type: "number", enum: [1, 2, 3], description: "1=low, 2=medium, 3=high" },
        sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
        tags: { type: "array", items: { type: "string" }, maxItems: 8 },
        detail: {
          type: "object",
          properties: {
            preferred_payment_terms:   { type: "string" },
            preferred_incoterms:       { type: "string" },
            typical_order_size_range:  { type: "string" },
            communication_style:       { type: "string" },
            complaint_tendency:        { type: "string" },
            key_contacts:              { type: "array", items: { type: "string" } },
            average_delay_days:        { type: "number" },
            quality_failure_rate:      { type: "string" },
            reliability_score:         { type: "string" },
            pricing_trend:             { type: "string" },
            typical_lead_time_days:    { type: "number" },
            common_delay_reasons:      { type: "array", items: { type: "string" } },
            seasonal_patterns:         { type: "string" },
            what_was_wrong:            { type: "string" },
            what_was_corrected_to:     { type: "string" },
            correction_field:          { type: "string" },
            notes:                     { type: "string" },
          },
        },
        should_supersede_previous: { type: "boolean" },
      },
    },
  },
];

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
characteristics that help agents plan more accurately.`,
  correction: `You are the MerQuant memory system recording agent correction feedback.
A human has corrected an agent's output. Record exactly what was wrong and what
the correct value was so future agents avoid the same mistake.`,
};

const EVENT_CONFIG: Record<string, { memory_type: string; entity_type: string; importance_boost: number }> = {
  po_confirmed:           { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 0 },
  po_rejected:            { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 1 },
  buyer_email_sent:       { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 0 },
  complaint_logged:       { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 1 },
  payment_received:       { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 0 },
  sample_rejected:        { memory_type: "buyer",      entity_type: "buyer",    importance_boost: 1 },
  fabric_order_delayed:   { memory_type: "supplier",   entity_type: "supplier", importance_boost: 1 },
  qc_failed:              { memory_type: "supplier",   entity_type: "supplier", importance_boost: 2 },
  supplier_late:          { memory_type: "supplier",   entity_type: "supplier", importance_boost: 1 },
  supplier_on_time:       { memory_type: "supplier",   entity_type: "supplier", importance_boost: 0 },
  tna_milestone_delayed:  { memory_type: "order",      entity_type: "article",  importance_boost: 1 },
  shipment_delayed:       { memory_type: "order",      entity_type: "po",       importance_boost: 1 },
  order_completed:        { memory_type: "order",      entity_type: "po",       importance_boost: 0 },
  draft_corrected:        { memory_type: "correction", entity_type: "agent",    importance_boost: 1 },
  extraction_corrected:   { memory_type: "correction", entity_type: "agent",    importance_boost: 1 },
  classification_wrong:   { memory_type: "correction", entity_type: "agent",    importance_boost: 2 },
};

async function extractMemory(
  anthropicKey: string,
  memoryType: string,
  entityLabel: string,
  context: string,
): Promise<Record<string, unknown> | null> {
  const systemPrompt = SYSTEM_PROMPTS[memoryType] ?? SYSTEM_PROMPTS.order;
  const messages: Array<Record<string, unknown>> = [{
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
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: systemPrompt, tools: MEMORY_TOOLS, messages }),
    });
    if (!response.ok) throw new Error(`Anthropic error: ${await response.text()}`);
    const data = await response.json();
    messages.push({ role: "assistant", content: data.content });
    if (data.stop_reason !== "tool_use") break;

    const toolResults: Array<Record<string, unknown>> = [];
    for (const block of data.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "write_memory") result = block.input;
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ status: "ok" }) });
    }
    if (toolResults.length > 0) messages.push({ role: "user", content: toolResults });
    if (result) break;
  }
  return result;
}

async function supersedePreviousMemory(
  supabase: ReturnType<typeof createClient>,
  entityType: string, entityId: string, memoryType: string, sourceEvent: string, newMemoryId: string,
) {
  const { data: prev } = await supabase
    .from("agent_memories")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("memory_type", memoryType)
    .eq("source_event", sourceEvent)
    .eq("is_active", true)
    .neq("id", newMemoryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prev) {
    await supabase.from("agent_memories").update({ is_active: false, superseded_by: newMemoryId }).eq("id", prev.id);
  }
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

  const supabaseUrl  = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { event_type, entity_type, entity_id, entity_label, context, source_id, agent_name } = body;
    if (!event_type || !entity_type || !entity_id || !context) {
      return new Response(JSON.stringify({ error: "event_type, entity_type, entity_id, context required" }), {
        status: 400,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const config = EVENT_CONFIG[event_type] ?? { memory_type: "order", entity_type, importance_boost: 0 };
    const supabase = createClient(supabaseUrl, serviceKey);

    const extracted = await extractMemory(anthropicKey, config.memory_type, entity_label ?? entity_id, context);
    if (!extracted) {
      return new Response(JSON.stringify({ success: false, reason: "Claude did not produce a memory" }), {
        status: 200,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const importance = Math.min(3, ((extracted.importance as number) ?? 2) + config.importance_boost);

    const { data: memory, error: writeError } = await supabase
      .from("agent_memories")
      .insert({
        memory_type:      config.memory_type,
        entity_type:      config.entity_type,
        entity_id,
        entity_label:     entity_label ?? entity_id,
        summary:          extracted.summary,
        detail:           extracted.detail ?? {},
        raw_context:      String(context).substring(0, 2000),
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

    if (extracted.should_supersede_previous) {
      await supersedePreviousMemory(supabase, config.entity_type, entity_id, config.memory_type, event_type, memory.id);
    }

    return new Response(JSON.stringify({ success: true, memory_id: memory.id, summary: extracted.summary }), {
      status: 200,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[memory-writer]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
