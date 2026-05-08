// supabase/functions/agent-orchestrator/index.ts
//
// MerQuant ERP — agent-orchestrator Edge Function
// Phase 3.
//
// The central nervous system of the agentic layer. Receives events from
// DB triggers (mig 0034) and routes to handlers that:
//   - seed T&A calendars on PO approval
//   - run targeted TNA risk checks on milestone risk escalations
//   - write agent memories on key events
//   - notify the team
//
// ERP adaptations from the MAS source:
//   - tna_calendars: ERP columns are po_id/po_number/customer_name/ex_factory_date/
//     template_id. NO season_name/active/created_by/completed_at.
//   - tna_milestones: tna_id (not calendar_id), name (not milestone_name),
//     target_date (not due_date).
//   - tna_templates.milestones is a jsonb array (not separate rows).
//     Each entry has { name, category, days_before_exfactory }.
//   - notifications: link_page/link_params (not link), is_read (not read).
//   - CORS: ERP regex-allowlist convention.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionFn = (ctx: OrchestratorContext) => Promise<void>;

interface OrchestratorContext {
  supabase:     ReturnType<typeof createClient>;
  supabaseUrl:  string;
  serviceKey:   string;
  anthropicKey: string;
  event:        AgentEvent;
}

interface AgentEvent {
  event_id:    string;
  event_type:  string;
  entity_type: string;
  entity_id:   string;
  payload:     Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Action: Seed T&A calendar from approved PO
// ERP-rewrite: pulls milestone definitions from tna_templates.milestones
// (jsonb array of { name, category, days_before_exfactory }) and dates
// each one as `ex_factory_date - days_before_exfactory`.
// ---------------------------------------------------------------------------

async function seedTnaCalendar(ctx: OrchestratorContext) {
  const poId = (ctx.event.payload.po_id as string) ?? ctx.event.entity_id;
  if (!poId) return;

  const { data: existing } = await ctx.supabase
    .from("tna_calendars")
    .select("id")
    .eq("po_id", poId)
    .maybeSingle();
  if (existing) return; // idempotent

  // Fetch PO — ERP uses customer_name + ex_factory_date.
  const { data: po } = await ctx.supabase
    .from("purchase_orders")
    .select("id, po_number, buyer_name, customer_name, delivery_date, ex_factory_date")
    .eq("id", poId)
    .maybeSingle();

  const exFactoryDate = po?.ex_factory_date ?? po?.delivery_date;
  if (!po || !exFactoryDate) return;

  // Pick a template — preference order:
  //   1) buyer-specific default (default_for_customer_name match)
  //   2) is_default = true
  //   3) first row
  const customerName = po.customer_name ?? po.buyer_name ?? null;
  let template: Record<string, unknown> | null = null;

  if (customerName) {
    const { data } = await ctx.supabase
      .from("tna_templates")
      .select("*")
      .eq("default_for_customer_name", customerName)
      .limit(1)
      .maybeSingle();
    template = data;
  }
  if (!template) {
    const { data } = await ctx.supabase
      .from("tna_templates")
      .select("*")
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    template = data;
  }
  if (!template) {
    const { data } = await ctx.supabase
      .from("tna_templates")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    template = data;
  }
  if (!template) return;

  const milestonesArr = (template.milestones ?? []) as Array<{
    name: string;
    category?: string;
    days_before_exfactory?: number;
  }>;
  if (!Array.isArray(milestonesArr) || !milestonesArr.length) return;

  // Insert tna_calendars row with ERP columns only.
  const { data: calendar, error: calErr } = await ctx.supabase
    .from("tna_calendars")
    .insert({
      po_id:           poId,
      po_number:       po.po_number,
      customer_name:   customerName,
      ex_factory_date: exFactoryDate,
      template_id:     template.id,
    })
    .select()
    .single();
  if (calErr || !calendar) return;

  const exFactory = new Date(exFactoryDate);
  const milestoneRows = milestonesArr.map((m, i) => {
    const targetDate = new Date(exFactory);
    targetDate.setDate(targetDate.getDate() - (m.days_before_exfactory ?? 0));
    return {
      tna_id:       calendar.id,
      po_id:        poId,
      name:         m.name ?? `Milestone ${i + 1}`,
      category:     m.category ?? null,
      target_date:  targetDate.toISOString().split("T")[0],
      status:       "pending",
      risk_level:   "on_track",
      sort_order:   i,
    };
  });

  await ctx.supabase.from("tna_milestones").insert(milestoneRows);

  await notifyTeam(ctx, {
    type:       "tna_calendar_created",
    title:      "T&A Calendar Created",
    message:    `T&A calendar auto-created for PO ${po.po_number} — ${milestoneRows.length} milestones seeded.`,
    link_page:  "TNACalendar",
    link_params: { po_id: poId },
  });

  await writeMemoryEvent(ctx, {
    event_type:   "po_confirmed",
    entity_type:  "buyer",
    entity_id:    customerName ?? poId,
    entity_label: customerName ?? po.po_number,
    context:      `PO ${po.po_number} approved. Ex-factory: ${exFactoryDate}. T&A calendar auto-created with ${milestoneRows.length} milestones using template "${template.name}".`,
    source_id:    poId,
  });
}

// ---------------------------------------------------------------------------
// Action: Run T&A risk check for a specific calendar
// ---------------------------------------------------------------------------

async function runTargetedTnaRisk(ctx: OrchestratorContext) {
  const calendarId = ctx.event.payload.calendar_id as string;
  if (!calendarId) return;

  await fetch(`${ctx.supabaseUrl}/functions/v1/tna-risk-agent`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${ctx.serviceKey}`,
    },
    body: JSON.stringify({ calendar_id: calendarId }),
  }).catch((err) => console.warn("[orchestrator] tna-risk-agent call failed:", err));
}

// ---------------------------------------------------------------------------
// Action: Write a memory record via memory-writer edge fn
// ---------------------------------------------------------------------------

async function writeMemoryEvent(
  ctx: OrchestratorContext,
  override?: {
    event_type:   string;
    entity_type:  string;
    entity_id:    string;
    entity_label: string;
    context:      string;
    source_id?:   string;
  },
) {
  const payload = ctx.event.payload;
  const data = override ?? {
    event_type:   ctx.event.event_type,
    entity_type:  ctx.event.entity_type,
    entity_id:    String(ctx.event.entity_id),
    entity_label: (payload.buyer_name ?? payload.supplier_name ?? ctx.event.entity_id) as string,
    context:      JSON.stringify(payload).substring(0, 1000),
    source_id:    ctx.event.entity_id,
  };

  // Fire-and-forget; never block the orchestrator on memory writes.
  fetch(`${ctx.supabaseUrl}/functions/v1/memory-writer`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${ctx.serviceKey}`,
    },
    body: JSON.stringify({ ...data, agent_name: "orchestrator" }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Action: Write supplier memory on QC fail / shipment delay
// ---------------------------------------------------------------------------

async function writeSupplierMemory(ctx: OrchestratorContext) {
  const payload = ctx.event.payload;
  const poId    = payload.po_id as string;
  if (!poId) return;

  const { data: po } = await ctx.supabase
    .from("purchase_orders")
    .select("po_number, buyer_name, customer_name")
    .eq("id", poId)
    .maybeSingle();
  if (!po) return;

  // No dedicated supplier table refs in this event; fall back to buyer/customer.
  const entity = (po.customer_name ?? po.buyer_name ?? po.po_number) as string;

  const contextMap: Record<string, string> = {
    "qc.failed":        `QC inspection failed on PO ${po.po_number}. Verdict: ${payload.verdict ?? "n/a"}. Total defects: ${payload.total_defects ?? 0} (critical=${payload.critical_defects ?? 0}, major=${payload.major_defects ?? 0}, minor=${payload.minor_defects ?? 0}).`,
    "shipment.delayed": `Shipment delayed on PO ${po.po_number}. Original ETD: ${payload.original_etd}. New ETD: ${payload.new_etd}. Notes: ${payload.notes ?? "n/a"}.`,
  };

  await writeMemoryEvent(ctx, {
    event_type:   ctx.event.event_type,
    entity_type:  "supplier",
    entity_id:    entity,
    entity_label: entity,
    context:      contextMap[ctx.event.event_type] ?? JSON.stringify(payload),
    source_id:    poId,
  });
}

// ---------------------------------------------------------------------------
// Action: Notify all internal staff
// ERP notifications: link_page + link_params + is_read.
// ---------------------------------------------------------------------------

async function notifyTeam(
  ctx: OrchestratorContext,
  notification: {
    type:        string;
    title:       string;
    message:     string;
    link_page?:  string;
    link_params?: Record<string, unknown>;
  },
) {
  const { data: users } = await ctx.supabase
    .from("user_profiles")
    .select("id")
    .in("role", ["Owner", "Manager", "Merchandiser"]);
  if (!users?.length) return;

  await ctx.supabase.from("notifications").insert(
    users.map((u) => ({
      user_id:     u.id,
      type:        notification.type,
      title:       notification.title,
      message:     notification.message,
      link_page:   notification.link_page ?? null,
      link_params: notification.link_params ?? null,
      is_read:     false,
      created_at:  new Date().toISOString(),
    })),
  );
}

// Wraps notifyTeam so it's an ActionFn (single-arg) for the routing table.
function notifyTeamAction(notification: Parameters<typeof notifyTeam>[1]): ActionFn {
  return async (ctx) => { await notifyTeam(ctx, notification); };
}

// ---------------------------------------------------------------------------
// Action: Check if all milestones complete on a calendar
// ERP: tna_milestones uses tna_id (not calendar_id). tna_calendars has no
// `active` or `completed_at` columns — we only notify the team.
// ---------------------------------------------------------------------------

async function checkCalendarCompletion(ctx: OrchestratorContext) {
  const calendarId = ctx.event.payload.calendar_id as string;
  if (!calendarId) return;

  const { count: total } = await ctx.supabase
    .from("tna_milestones")
    .select("id", { count: "exact", head: true })
    .eq("tna_id", calendarId);

  const { count: completed } = await ctx.supabase
    .from("tna_milestones")
    .select("id", { count: "exact", head: true })
    .eq("tna_id", calendarId)
    .in("status", ["completed", "approved"]);

  if (total && completed && completed >= total) {
    await notifyTeam(ctx, {
      type:    "calendar_completed",
      title:   "T&A Calendar Complete",
      message: `All ${total} milestones completed for calendar ${calendarId}.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Event routing table
// ---------------------------------------------------------------------------

const EVENT_ROUTES: Record<string, ActionFn[]> = {
  "po.approved":              [seedTnaCalendar, writeMemoryEvent],
  "po.created":               [writeMemoryEvent],
  "email_draft.confirmed":    [seedTnaCalendar, writeMemoryEvent],
  "milestone.risk_escalated": [runTargetedTnaRisk],
  "milestone.completed":      [checkCalendarCompletion],
  "shipment.delayed":         [writeSupplierMemory, writeMemoryEvent],
  "shipment.created":         [writeMemoryEvent],
  "qc.failed":                [
    writeSupplierMemory,
    notifyTeamAction({
      type:       "qc_failed",
      title:      "QC Inspection Failed",
      message:    "A QC inspection has failed — review required.",
      link_page:  "QCInspections",
    }),
  ],
  "tna_draft.sent":           [writeMemoryEvent],
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const event: AgentEvent = await req.json();

    // Mark as processing
    await supabase
      .from("agent_events")
      .update({ status: "processing" })
      .eq("id", event.event_id);

    const actions = EVENT_ROUTES[event.event_type];

    if (!actions?.length) {
      await supabase
        .from("agent_events")
        .update({ status: "skipped", processed_at: new Date().toISOString() })
        .eq("id", event.event_id);
      return new Response(JSON.stringify({ skipped: true, event_type: event.event_type }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const ctx: OrchestratorContext = { supabase, supabaseUrl, serviceKey, anthropicKey, event };
    const errors: string[] = [];

    for (const action of actions) {
      try {
        await action(ctx);
      } catch (err) {
        console.error(`[orchestrator] action failed for ${event.event_type}:`, err);
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    await supabase
      .from("agent_events")
      .update({
        status:       errors.length ? "failed" : "done",
        processed_at: new Date().toISOString(),
        error:        errors.length ? errors.join("; ") : null,
        agent_name:   "orchestrator",
      })
      .eq("id", event.event_id);

    return new Response(
      JSON.stringify({
        success:     !errors.length,
        event_type:  event.event_type,
        actions_run: actions.length,
        errors,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[orchestrator] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
