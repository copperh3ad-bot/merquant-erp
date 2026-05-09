/**
 * MerQuant — agent-orchestrator Edge Function
 * Version: v1
 *
 * The central nervous system of MerQuant's agentic layer.
 * Receives events from DB triggers and decides which agents to invoke.
 *
 * Event routing table:
 *   po.approved          → seed-tna-calendar, write-memory(buyer)
 *   po.created           → write-memory(buyer)
 *   email_draft.confirmed → seed-tna-calendar, write-memory(buyer)
 *   milestone.risk_escalated → tna-risk-agent (targeted run)
 *   milestone.completed  → check-calendar-completion
 *   shipment.delayed     → tna-risk-agent, write-memory(supplier)
 *   qc.failed            → write-memory(supplier), notify-team
 *   tna_draft.sent       → write-memory(buyer)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL             = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// Event routing map
// Each event maps to an ordered list of actions
// ---------------------------------------------------------------------------

type ActionFn = (ctx: OrchestratorContext) => Promise<void>;

interface OrchestratorContext {
  supabase:      ReturnType<typeof createClient>;
  supabaseUrl:   string;
  serviceKey:    string;
  anthropicKey:  string;
  event:         AgentEvent;
}

interface AgentEvent {
  event_id:    string;
  event_type:  string;
  entity_type: string;
  entity_id:   string;
  payload:     Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

// Action: Seed T&A calendar from approved PO
async function seedTnaCalendar(ctx: OrchestratorContext) {
  const poId = ctx.event.payload.po_id as string ?? ctx.event.entity_id;

  // Check if calendar already exists
  const { data: existing } = await ctx.supabase
    .from("tna_calendars")
    .select("id")
    .eq("po_id", poId)
    .maybeSingle();

  if (existing) return; // Already has a calendar

  // Fetch PO details
  const { data: po } = await ctx.supabase
    .from("purchase_orders")
    .select("id, po_number, buyer_name, delivery_date, order_date")
    .eq("id", poId)
    .maybeSingle();

  if (!po?.delivery_date) return;

  // Fetch global T&A template milestones
  const { data: templates } = await ctx.supabase
    .from("tna_templates")
    .select("*")
    .order("offset_days", { ascending: false });

  if (!templates?.length) return;

  // Create calendar
  const { data: calendar, error: calError } = await ctx.supabase
    .from("tna_calendars")
    .insert({
      po_id:        poId,
      season_name:  `${po.buyer_name} — ${po.po_number}`,
      active:       true,
      created_by:   "orchestrator",
    })
    .select()
    .single();

  if (calError || !calendar) return;

  // Seed milestones from template (offset from delivery date)
  const deliveryDate = new Date(po.delivery_date);
  const milestones = templates.map((t) => {
    const dueDate = new Date(deliveryDate);
    dueDate.setDate(dueDate.getDate() - (t.offset_days ?? 0));
    return {
      calendar_id:    calendar.id,
      milestone_name: t.milestone_name,
      due_date:       dueDate.toISOString().split("T")[0],
      status:         "pending",
      risk_level:     "on_track",
    };
  });

  await ctx.supabase.from("tna_milestones").insert(milestones);

  // Notify team
  await notifyTeam(ctx, {
    type:    "tna_calendar_created",
    title:   "T&A Calendar Created",
    message: `T&A calendar auto-created for PO ${po.po_number} — ${milestones.length} milestones seeded.`,
    link:    `/tna-calendar?po=${poId}`,
  });

  // Write memory
  await writeMemoryEvent(ctx, {
    event_type:   "po_confirmed",
    entity_type:  "buyer",
    entity_id:    po.buyer_name,
    entity_label: po.buyer_name,
    context:      `PO ${po.po_number} approved. Delivery: ${po.delivery_date}. T&A calendar auto-created with ${milestones.length} milestones.`,
    source_id:    poId,
  });
}

// Action: Run T&A risk check for a specific calendar
async function runTargetedTnaRisk(ctx: OrchestratorContext) {
  const calendarId = ctx.event.payload.calendar_id as string;
  if (!calendarId) return;

  // Call tna-risk-agent with targeted calendar_id
  await fetch(`${ctx.supabaseUrl}/functions/v1/tna-risk-agent`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${ctx.serviceKey}`,
    },
    body: JSON.stringify({ calendar_id: calendarId }), // targeted run
  });
}

// Action: Write memory from event context
async function writeMemoryEvent(
  ctx: OrchestratorContext,
  override?: {
    event_type:   string;
    entity_type:  string;
    entity_id:    string;
    entity_label: string;
    context:      string;
    source_id?:   string;
  }
) {
  const payload = ctx.event.payload;
  const data    = override ?? {
    event_type:   ctx.event.event_type,
    entity_type:  ctx.event.entity_type,
    entity_id:    String(ctx.event.entity_id),
    entity_label: (payload.buyer_name ?? payload.supplier_name ?? ctx.event.entity_id) as string,
    context:      JSON.stringify(payload).substring(0, 1000),
    source_id:    ctx.event.entity_id,
  };

  // Fire-and-forget
  fetch(`${ctx.supabaseUrl}/functions/v1/memory-writer`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${ctx.serviceKey}`,
    },
    body: JSON.stringify({ ...data, agent_name: "orchestrator" }),
  }).catch(() => {});
}

// Action: Write supplier memory on QC fail / shipment delay
async function writeSupplierMemory(ctx: OrchestratorContext) {
  const payload = ctx.event.payload;

  // Fetch supplier name from PO
  const poId = payload.po_id as string;
  if (!poId) return;

  const { data: po } = await ctx.supabase
    .from("purchase_orders")
    .select("po_number, buyer_name")
    .eq("id", poId)
    .maybeSingle();

  if (!po) return;

  const contextMap: Record<string, string> = {
    "qc.failed":        `QC inspection failed on PO ${po.po_number}. Defects: ${payload.defect_count ?? "unknown"}. Types: ${JSON.stringify(payload.defect_types ?? [])}.`,
    "shipment.delayed": `Shipment delayed on PO ${po.po_number}. Original ETD: ${payload.original_etd}. New ETD: ${payload.new_etd}. Reason: ${payload.delay_reason ?? "not specified"}.`,
  };

  await writeMemoryEvent(ctx, {
    event_type:   ctx.event.event_type,
    entity_type:  "supplier",
    entity_id:    po.buyer_name, // using buyer as supplier proxy (update if suppliers tracked separately)
    entity_label: po.buyer_name,
    context:      contextMap[ctx.event.event_type] ?? JSON.stringify(payload),
    source_id:    poId,
  });
}

// Action: Notify all Merchandisers/Managers
async function notifyTeam(
  ctx: OrchestratorContext,
  notification: { type: string; title: string; message: string; link?: string }
) {
  const { data: users } = await ctx.supabase
    .from("user_profiles")
    .select("id")
    .in("role", ["Owner", "Manager", "Merchandiser"]);

  if (!users?.length) return;

  await ctx.supabase.from("notifications").insert(
    users.map((u) => ({
      user_id:    u.id,
      type:       notification.type,
      title:      notification.title,
      message:    notification.message,
      link:       notification.link ?? null,
      read:       false,
      created_at: new Date().toISOString(),
    }))
  );
}

// Action: Check if all milestones complete → mark calendar done
async function checkCalendarCompletion(ctx: OrchestratorContext) {
  const calendarId = ctx.event.payload.calendar_id as string;
  if (!calendarId) return;

  const { count: total }     = await ctx.supabase
    .from("tna_milestones")
    .select("id", { count: "exact", head: true })
    .eq("calendar_id", calendarId);

  const { count: completed } = await ctx.supabase
    .from("tna_milestones")
    .select("id", { count: "exact", head: true })
    .eq("calendar_id", calendarId)
    .in("status", ["completed", "approved"]);

  if (total && completed && completed >= total) {
    await ctx.supabase
      .from("tna_calendars")
      .update({ active: false, completed_at: new Date().toISOString() })
      .eq("id", calendarId);

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
  "qc.failed":                [writeSupplierMemory, notifyTeam.bind(null, {
    type: "qc_failed", title: "QC Inspection Failed",
    message: "A QC inspection has failed — review required.", link: "/qc-inspections",
  } as unknown)],
  "tna_draft.sent":           [writeMemoryEvent],
};

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

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const event: AgentEvent = await req.json();

    // Mark event as processing
    await supabase
      .from("agent_events")
      .update({ status: "processing" })
      .eq("id", event.event_id);

    const actions = EVENT_ROUTES[event.event_type];

    if (!actions?.length) {
      await supabase
        .from("agent_events")
        .update({ status: "skipped" })
        .eq("id", event.event_id);
      return new Response(JSON.stringify({ skipped: true, event_type: event.event_type }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ctx: OrchestratorContext = {
      supabase, supabaseUrl, serviceKey, anthropicKey, event,
    };

    const errors: string[] = [];

    // Run all actions in sequence
    for (const action of actions) {
      try {
        await action(ctx);
      } catch (err) {
        console.error(`[orchestrator] action failed for ${event.event_type}:`, err);
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    // Mark event done
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
        success: !errors.length,
        event_type: event.event_type,
        actions_run: actions.length,
        errors,
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("[orchestrator] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
