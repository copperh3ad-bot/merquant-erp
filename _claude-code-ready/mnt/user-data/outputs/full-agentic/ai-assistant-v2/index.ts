/**
 * MerQuant — ai-assistant-v2 Edge Function
 * Replaces / extends the existing ai-proxy for the AIAssistant page.
 *
 * Upgrades over ai-proxy v18:
 *   - Full tool-calling (not just exec_sql)
 *   - Write tools gated by agent_action_policy
 *   - Memory context injected automatically
 *   - Actions that need approval queued to agent_action_queue
 *   - All writes audited
 *
 * POST /functions/v1/ai-assistant-v2
 * Body: { messages: [...], context?: { po_id, buyer_name, page } }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL             = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// Tool definitions — READ tools always available, WRITE tools policy-gated
// ---------------------------------------------------------------------------

const READ_TOOLS = [
  {
    name: "query_database",
    description:
      "Run a SELECT query against the MerQuant database. " +
      "Use this to answer questions about POs, milestones, shipments, costs, etc. " +
      "Always SELECT only the fields you need.",
    input_schema: {
      type: "object",
      required: ["sql"],
      properties: {
        sql: {
          type: "string",
          description: "Valid PostgreSQL SELECT statement. No INSERT/UPDATE/DELETE.",
        },
        explanation: {
          type: "string",
          description: "One sentence: what this query finds",
        },
      },
    },
  },
  {
    name: "search_memories",
    description: "Search agent memories for buyer/supplier/order intelligence.",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query:       { type: "string" },
        memory_type: { type: "string", enum: ["buyer", "supplier", "order", "correction"] },
      },
    },
  },
  {
    name: "get_po_summary",
    description: "Get a full summary of a purchase order including all related data.",
    input_schema: {
      type: "object",
      required: ["po_id"],
      properties: {
        po_id: { type: "string" },
      },
    },
  },
];

const WRITE_TOOLS = [
  {
    name: "update_po_field",
    description:
      "Update a single field on a purchase order. " +
      "Will be queued for human approval if policy requires it.",
    input_schema: {
      type: "object",
      required: ["po_id", "field", "value", "reason"],
      properties: {
        po_id:  { type: "string" },
        field:  { type: "string", description: "Field name to update" },
        value:  { type: "string" },
        reason: { type: "string", description: "Why this update is needed" },
      },
    },
  },
  {
    name: "shift_tna_milestones",
    description: "Shift all pending T&A milestones for a calendar by N days.",
    input_schema: {
      type: "object",
      required: ["calendar_id", "shift_days", "reason"],
      properties: {
        calendar_id: { type: "string" },
        shift_days:  { type: "number", description: "Positive = push later, negative = pull earlier" },
        reason:      { type: "string" },
      },
    },
  },
  {
    name: "generate_report",
    description:
      "Generate a structured report (auto-executes, read-only). " +
      "Types: overdue_milestones, at_risk_pos, shipment_summary, buyer_performance.",
    input_schema: {
      type: "object",
      required: ["report_type"],
      properties: {
        report_type: {
          type: "string",
          enum: ["overdue_milestones", "at_risk_pos", "shipment_summary", "buyer_performance"],
        },
        filters: { type: "object" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<{ result: unknown; queued?: boolean; queue_id?: string }> {

  // ---- READ TOOLS ----

  if (toolName === "query_database") {
    const sql = toolInput.sql as string;
    // Enforce SELECT only
    const clean = sql.trim().toUpperCase();
    if (!clean.startsWith("SELECT") || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/.test(clean)) {
      return { result: { error: "Only SELECT queries are allowed." } };
    }
    const { data, error } = await supabase.rpc("exec_sql", { query: sql });
    return { result: error ? { error: error.message } : data };
  }

  if (toolName === "search_memories") {
    const { data, error } = await supabase.rpc("search_memories_by_keyword", {
      p_query:       toolInput.query,
      p_memory_type: toolInput.memory_type ?? null,
      p_limit:       10,
    });
    return { result: error ? { error: error.message } : data };
  }

  if (toolName === "get_po_summary") {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(`
        *,
        po_items(*),
        tna_calendars(*, tna_milestones(*)),
        shipments(*),
        costing_sheets(*)
      `)
      .eq("id", toolInput.po_id as string)
      .maybeSingle();
    return { result: error ? { error: error.message } : data };
  }

  // ---- WRITE TOOLS — policy-gated ----

  const TOOL_TO_ACTION: Record<string, string> = {
    update_po_field:       "po.update_field",
    shift_tna_milestones:  "tna_milestones.bulk_shift",
    generate_report:       "report.generate",
  };

  const actionType = TOOL_TO_ACTION[toolName];
  if (!actionType) return { result: { error: `Unknown tool: ${toolName}` } };

  // Check policy
  const { data: policy } = await supabase
    .from("agent_action_policy")
    .select("auto_execute, enabled")
    .eq("agent_name", "ai-assistant")
    .eq("action_type", actionType)
    .maybeSingle();

  if (!policy?.enabled) {
    return { result: { error: `Action ${actionType} is disabled.` } };
  }

  if (toolName === "generate_report") {
    // Reports always auto-execute (read-only)
    const reportData = await generateReport(supabase, toolInput.report_type as string, toolInput.filters as Record<string, unknown>);
    return { result: reportData };
  }

  if (policy?.auto_execute) {
    // Execute directly via RPC
    const { data: actionResult } = await supabase
      .from("agent_action_queue")
      .insert({
        agent_name:    "ai-assistant",
        action_type:   actionType,
        payload:       { ...toolInput },
        description:   buildActionDescription(toolName, toolInput),
        triggered_by:  "ai-assistant-chat",
        status:        "approved",  // auto-approve
        approved_by:   userId,
        approved_at:   new Date().toISOString(),
      })
      .select()
      .single();

    if (actionResult) {
      await supabase.rpc("execute_agent_action", { p_action_id: actionResult.id });
    }
    return { result: { success: true, executed: true } };
  } else {
    // Queue for human approval
    const { data: queued } = await supabase
      .from("agent_action_queue")
      .insert({
        agent_name:   "ai-assistant",
        action_type:  actionType,
        payload:      { ...toolInput },
        description:  buildActionDescription(toolName, toolInput),
        triggered_by: "ai-assistant-chat",
        status:       "pending",
      })
      .select()
      .single();

    return {
      result: {
        queued: true,
        queue_id: queued?.id,
        message: `Action queued for approval: ${buildActionDescription(toolName, toolInput)}`,
      },
      queued:    true,
      queue_id:  queued?.id,
    };
  }
}

function buildActionDescription(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "update_po_field") {
    return `Update PO ${input.po_id}: set ${input.field} = "${input.value}". Reason: ${input.reason}`;
  }
  if (toolName === "shift_tna_milestones") {
    const dir = (input.shift_days as number) > 0 ? "push" : "pull";
    return `${dir} all T&A milestones by ${Math.abs(input.shift_days as number)} days. Reason: ${input.reason}`;
  }
  return `${toolName}: ${JSON.stringify(input).substring(0, 100)}`;
}

async function generateReport(supabase, reportType: string, filters: Record<string, unknown> = {}) {
  switch (reportType) {
    case "overdue_milestones": {
      const { data } = await supabase
        .from("tna_milestones")
        .select("*, tna_calendars(po_id, season_name)")
        .in("risk_level", ["overdue", "critical"])
        .order("days_relative", { ascending: false })
        .limit(50);
      return { report_type: reportType, data, generated_at: new Date().toISOString() };
    }
    case "at_risk_pos": {
      const { data } = await supabase
        .from("purchase_orders")
        .select("id, po_number, buyer_name, delivery_date, approval_status")
        .neq("approval_status", "rejected")
        .order("delivery_date", { ascending: true })
        .limit(30);
      return { report_type: reportType, data, generated_at: new Date().toISOString() };
    }
    case "buyer_performance": {
      const { data } = await supabase.rpc("search_memories_by_keyword", {
        p_query: "buyer", p_memory_type: "buyer", p_limit: 50,
      });
      return { report_type: reportType, data, generated_at: new Date().toISOString() };
    }
    default:
      return { error: "Unknown report type" };
  }
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the MerQuant AI Assistant — an intelligent agent for a textile 
manufacturing ERP. You have access to the full database and can answer questions, 
generate reports, and perform approved write actions.

Capabilities:
- Query any data: POs, milestones, shipments, costs, buyers, suppliers
- Search agent memories for historical intelligence
- Update PO fields (queued for approval)
- Shift T&A milestone dates (queued for approval)
- Generate instant reports (auto-executes)

Rules:
- Always query before answering factual questions — never guess from training data
- For write actions, explain what you're about to do before doing it
- When an action is queued for approval, tell the user clearly
- Be concise — this is a professional ERP tool, not a chatbot
- If asked about something outside your tools, say so directly`;

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

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  try {
    const body     = await req.json();
    const messages = body.messages ?? [];
    const context  = body.context ?? {};

    // Get user from JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anonClient.auth.getUser();
    const userId = user?.id ?? "anonymous";

    const supabase = createClient(supabaseUrl, serviceKey);

    // Inject memory context if PO/buyer context provided
    let enrichedSystem = SYSTEM_PROMPT;
    if (context.buyer_name) {
      const { data: memories } = await supabase.rpc("retrieve_memories_for_agent", {
        p_entity_type: "buyer",
        p_entity_id:   context.buyer_name,
        p_limit:       5,
      });
      if (memories?.length) {
        const memBlock = memories.map((m) => `• ${m.summary}`).join("\n");
        enrichedSystem += `\n\nBuyer Memory — ${context.buyer_name}:\n${memBlock}`;
      }
    }

    // Agentic loop
    const allTools = [...READ_TOOLS, ...WRITE_TOOLS];
    let currentMessages = [...messages];
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (iterations < MAX_ITERATIONS) {
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
          max_tokens: 2048,
          system:     enrichedSystem,
          tools:      allTools,
          messages:   currentMessages,
        }),
      });

      if (!response.ok) throw new Error(`Anthropic error: ${await response.text()}`);
      const data = await response.json();

      currentMessages.push({ role: "assistant", content: data.content });

      if (data.stop_reason === "end_turn") {
        // Extract final text response
        const text = data.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");

        return new Response(
          JSON.stringify({ success: true, response: text, messages: currentMessages }),
          { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }

      if (data.stop_reason !== "tool_use") break;

      // Execute tool calls
      const toolResults = [];
      for (const block of data.content) {
        if (block.type !== "tool_use") continue;

        const { result, queued, queue_id } = await executeTool(
          block.name,
          block.input,
          supabase,
          userId
        );

        toolResults.push({
          type:        "tool_result",
          tool_use_id: block.id,
          content:     JSON.stringify(result),
        });
      }

      currentMessages.push({ role: "user", content: toolResults });
    }

    return new Response(
      JSON.stringify({ success: false, error: "Max iterations reached" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
