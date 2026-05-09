// supabase/functions/ai-assistant-v2/index.ts
//
// MerQuant — ai-assistant-v2 edge function (v1, ERP-adapted).
//
// Coexists with ai-proxy. Toggled via the VITE_USE_AI_V2 build env var
// in AIAssistant.jsx. When the flag is on, that page calls this fn
// instead of ai-proxy.
//
// Upgrades over ai-proxy:
//   - Multi-tool agentic loop (not just a single exec_sql round)
//   - Read tools always available: query_database, search_memories,
//     get_po_summary, generate_report
//   - Write tools policy-gated via agent_action_policy (when the
//     agent_action_queue is in place — mig 0035, currently pending).
//     Until then, write-tool calls fail gracefully with "Action
//     disabled" — surfaced back to Claude as a tool_result.
//   - Memory context injected automatically when context.buyer_name
//     is provided. Uses retrieve_memories_for_agent RPC (mig 0033).
//
// CORS: ERP convention (regex localhost + named origin allowlist).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL             = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

// ── CORS ────────────────────────────────────────────────────────────
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

// ── Tool definitions ────────────────────────────────────────────────
const READ_TOOLS = [
  {
    name: "query_database",
    description:
      "Run a SELECT query against the MerQuant database. Use this to answer questions " +
      "about POs, milestones, shipments, costs, etc. Always SELECT only the fields you need.",
    input_schema: {
      type: "object",
      required: ["sql"],
      properties: {
        sql: { type: "string", description: "Valid PostgreSQL SELECT statement. No INSERT/UPDATE/DELETE." },
        explanation: { type: "string", description: "One sentence: what this query finds" },
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
      properties: { po_id: { type: "string" } },
    },
  },
  {
    name: "generate_report",
    description:
      "Generate a structured report (auto-executes, read-only). " +
      "Types: overdue_milestones (needs mig 0032), at_risk_pos, buyer_performance.",
    input_schema: {
      type: "object",
      required: ["report_type"],
      properties: {
        report_type: {
          type: "string",
          enum: ["overdue_milestones", "at_risk_pos", "buyer_performance"],
        },
        filters: { type: "object" },
      },
    },
  },
];

const WRITE_TOOLS = [
  {
    name: "update_po_field",
    description:
      "Update a single field on a purchase order. Will be queued for human approval " +
      "if policy requires it. Currently DISABLED until agent_action_policy lands (mig 0035).",
    input_schema: {
      type: "object",
      required: ["po_id", "field", "value", "reason"],
      properties: {
        po_id:  { type: "string" },
        field:  { type: "string" },
        value:  { type: "string" },
        reason: { type: "string" },
      },
    },
  },
  {
    name: "shift_tna_milestones",
    description:
      "Shift all pending T&A milestones for a calendar by N days. " +
      "Currently DISABLED until agent_action_policy lands (mig 0035).",
    input_schema: {
      type: "object",
      required: ["calendar_id", "shift_days", "reason"],
      properties: {
        calendar_id: { type: "string" },
        shift_days:  { type: "number" },
        reason:      { type: "string" },
      },
    },
  },
];

const TOOL_TO_ACTION: Record<string, string> = {
  update_po_field:      "po.update_field",
  shift_tna_milestones: "tna_milestones.bulk_shift",
};

// ── Tool execution ──────────────────────────────────────────────────

type SBClient = ReturnType<typeof createClient>;

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  supabase: SBClient,
  userId: string,
): Promise<unknown> {
  // ── READ TOOLS ────────────────────────────────────────────────────
  if (toolName === "query_database") {
    const sql = String(toolInput.sql ?? "");
    const clean = sql.trim().toUpperCase();
    if (!clean.startsWith("SELECT") || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/.test(clean)) {
      return { error: "Only SELECT queries are allowed." };
    }
    const { data, error } = await supabase.rpc("exec_sql", { query: sql });
    return error ? { error: error.message } : data;
  }

  if (toolName === "search_memories") {
    const { data, error } = await supabase.rpc("search_memories_by_keyword", {
      p_query:       toolInput.query,
      p_memory_type: toolInput.memory_type ?? null,
      p_limit:       10,
    });
    return error ? { error: error.message } : data;
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
    return error ? { error: error.message } : data;
  }

  if (toolName === "generate_report") {
    return generateReport(supabase, toolInput.report_type as string, toolInput.filters as Record<string, unknown> | undefined);
  }

  // ── WRITE TOOLS — policy-gated ───────────────────────────────────
  const actionType = TOOL_TO_ACTION[toolName];
  if (!actionType) return { error: `Unknown tool: ${toolName}` };

  // Check policy. agent_action_policy table is created by mig 0035
  // (currently BLOCKED on pg_cron + pg_net extensions). Until then,
  // this read errors with "relation does not exist" and we fall
  // through to "disabled".
  let policy: { auto_execute?: boolean; enabled?: boolean } | null = null;
  try {
    const result = await supabase
      .from("agent_action_policy")
      .select("auto_execute, enabled")
      .eq("agent_name", "ai-assistant")
      .eq("action_type", actionType)
      .maybeSingle();
    policy = result.data;
  } catch {
    // Table doesn't exist yet — write tools are disabled until mig 0035
  }

  if (!policy?.enabled) {
    return { error: `Action ${actionType} is disabled (policy table not yet provisioned — mig 0035 pending).` };
  }

  if (policy.auto_execute) {
    const { data: actionResult } = await supabase
      .from("agent_action_queue")
      .insert({
        agent_name:   "ai-assistant",
        action_type:  actionType,
        payload:      { ...toolInput },
        description:  buildActionDescription(toolName, toolInput),
        triggered_by: "ai-assistant-chat",
        status:       "approved",
        approved_by:  userId,
        approved_at:  new Date().toISOString(),
      })
      .select()
      .single();
    if (actionResult) await supabase.rpc("execute_agent_action", { p_action_id: actionResult.id });
    return { success: true, executed: true };
  }

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
    queued:    true,
    queue_id:  queued?.id,
    message:   `Action queued for approval: ${buildActionDescription(toolName, toolInput)}`,
  };
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

async function generateReport(
  supabase: SBClient,
  reportType: string,
  _filters: Record<string, unknown> = {},
) {
  switch (reportType) {
    case "overdue_milestones": {
      // Requires mig 0032 (risk_level / days_relative columns added). Until
      // then, falls back to all overdue-by-target_date milestones.
      const { data, error } = await supabase
        .from("tna_milestones")
        .select("*, tna_calendars(po_id, po_number, customer_name)")
        .lt("target_date", new Date().toISOString().slice(0, 10))
        .neq("status", "done")
        .order("target_date", { ascending: true })
        .limit(50);
      return error
        ? { error: error.message }
        : { report_type: reportType, data, generated_at: new Date().toISOString() };
    }
    case "at_risk_pos": {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, po_number, buyer_name, customer_name, delivery_date, ex_factory_date, approval_status, status")
        .neq("approval_status", "rejected")
        .order("delivery_date", { ascending: true, nullsFirst: false })
        .limit(30);
      return error ? { error: error.message } : { report_type: reportType, data, generated_at: new Date().toISOString() };
    }
    case "buyer_performance": {
      const { data, error } = await supabase.rpc("search_memories_by_keyword", {
        p_query: "buyer", p_memory_type: "buyer", p_limit: 50,
      });
      return error ? { error: error.message } : { report_type: reportType, data, generated_at: new Date().toISOString() };
    }
    default:
      return { error: "Unknown report type" };
  }
}

// ── Main loop ───────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the MerQuant AI Assistant — an intelligent agent for a textile
manufacturing ERP. You have access to the database via tools and can answer
questions, generate reports, and (when policy permits) perform write actions.

Capabilities:
- Query any data: POs, milestones, shipments, costs, buyers, suppliers
- Search agent memories for historical intelligence
- Update PO fields (queued for approval — currently disabled)
- Shift T&A milestone dates (queued for approval — currently disabled)
- Generate instant reports (auto-executes)

Rules:
- Always query before answering factual questions — never guess from training data
- For write actions, explain what you're about to do before doing it
- When an action is queued for approval, tell the user clearly
- Be concise — this is a professional ERP tool, not a chatbot
- If asked about something outside your tools, say so directly`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  const supabaseUrl  = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const anonKey      = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  try {
    const body = await req.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const context  = body.context ?? {};

    // Resolve user from JWT (best-effort — anonymous if no header)
    const authHeader = req.headers.get("Authorization") ?? "";
    let userId = "anonymous";
    if (authHeader && anonKey) {
      const anonClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await anonClient.auth.getUser();
      userId = data?.user?.id ?? "anonymous";
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Inject memory context if buyer is in scope
    let enrichedSystem = SYSTEM_PROMPT;
    if (context.buyer_name) {
      const { data: memories } = await supabase.rpc("retrieve_memories_for_agent", {
        p_entity_type: "buyer",
        p_entity_id:   String(context.buyer_name),
        p_limit:       5,
      });
      if (memories?.length) {
        const memBlock = memories.map((m: { summary: string }) => `• ${m.summary}`).join("\n");
        enrichedSystem += `\n\nBuyer Memory — ${context.buyer_name}:\n${memBlock}`;
      }
    }

    const allTools = [...READ_TOOLS, ...WRITE_TOOLS];
    const currentMessages: Array<Record<string, unknown>> = [...messages];
    let iterations = 0;
    const MAX_ITERATIONS = 10;
    let queuedActionId: string | null = null;

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
        const text = (data.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n");
        return new Response(
          JSON.stringify({
            success: true,
            response: text,
            messages: currentMessages,
            queued_action_id: queuedActionId,
          }),
          { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
        );
      }

      if (data.stop_reason !== "tool_use") break;

      const toolResults: Array<Record<string, unknown>> = [];
      for (const block of data.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>) {
        if (block.type !== "tool_use") continue;
        const result = await executeTool(block.name!, block.input ?? {}, supabase, userId);
        if ((result as { queued?: boolean })?.queued) {
          queuedActionId = (result as { queue_id?: string }).queue_id ?? null;
        }
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
      { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
