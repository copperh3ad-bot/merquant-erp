/**
 * MerQuant — tna-risk-agent Edge Function
 * Version: v1
 *
 * Runs autonomously via pg_cron once daily (configurable).
 * For every active T&A calendar:
 *   1. Scans all milestones against their due dates + risk thresholds
 *   2. Classifies each as: on_track | at_risk | overdue | critical
 *   3. For at_risk/overdue/critical → uses Claude to draft a buyer email
 *   4. Saves draft to tna_risk_drafts
 *   5. Creates in-app notifications for Merchandisers/Managers
 *   6. Logs run to agent_run_log
 *
 * Triggered by pg_cron:
 *   SELECT cron.schedule('tna-risk-agent', '0 7 * * *', $$...$$);
 *   (runs at 7 AM daily — before the workday starts)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL  = "https://api.anthropic.com/v1/messages";
const MODEL              = "claude-sonnet-4-5";
const ANTHROPIC_VERSION  = "2023-06-01";

// ---------------------------------------------------------------------------
// Default risk thresholds per milestone type (days before/after due date)
// Negative = days BEFORE due date to flag as at-risk (early warning)
// Zero     = flag on the due date itself
// Positive = days AFTER due date (tolerance before escalating)
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS: Record<string, {
  at_risk: number;   // days relative to due date
  overdue: number;
  critical: number;
  priority: number;  // 1=low, 2=medium, 3=high (affects email urgency)
}> = {
  // Pre-production
  "Tech Pack Approval":      { at_risk: -3, overdue: 0,  critical: 3,  priority: 2 },
  "Fabric Approval":         { at_risk: -5, overdue: 0,  critical: 5,  priority: 3 },
  "Lab Dip Approval":        { at_risk: -3, overdue: 0,  critical: 3,  priority: 2 },
  "Trim Approval":           { at_risk: -2, overdue: 0,  critical: 2,  priority: 2 },
  "PP Sample Approval":      { at_risk: -5, overdue: 0,  critical: 5,  priority: 3 },
  "Size Set Approval":       { at_risk: -3, overdue: 0,  critical: 3,  priority: 2 },
  // Production
  "Fabric In-House":         { at_risk: -2, overdue: 0,  critical: 3,  priority: 3 },
  "Cutting Start":           { at_risk: -1, overdue: 0,  critical: 2,  priority: 2 },
  "Sewing Start":            { at_risk: -1, overdue: 0,  critical: 3,  priority: 2 },
  "Sewing Complete":         { at_risk: -2, overdue: 0,  critical: 5,  priority: 3 },
  "QC Inspection":           { at_risk: -2, overdue: 0,  critical: 3,  priority: 3 },
  "Final Inspection":        { at_risk: -3, overdue: 0,  critical: 5,  priority: 3 },
  // Shipment
  "Ex-Factory Date":         { at_risk: -5, overdue: 0,  critical: 3,  priority: 3 },
  "ETD (Port Departure)":    { at_risk: -3, overdue: 0,  critical: 2,  priority: 3 },
  "ETA (Port Arrival)":      { at_risk: -2, overdue: 0,  critical: 2,  priority: 2 },
  "Delivery to Warehouse":   { at_risk: -3, overdue: 0,  critical: 5,  priority: 3 },
  // Default fallback
  "default":                 { at_risk: -2, overdue: 0,  critical: 3,  priority: 2 },
};

type RiskLevel = "on_track" | "at_risk" | "overdue" | "critical";

interface MilestoneRisk {
  milestone: Record<string, unknown>;
  riskLevel: RiskLevel;
  daysRelative: number;  // negative = before due, positive = after due
  threshold: typeof DEFAULT_THRESHOLDS["default"];
}

// ---------------------------------------------------------------------------
// Claude tools for email drafting
// ---------------------------------------------------------------------------

const EMAIL_DRAFT_TOOLS = [
  {
    name: "draft_buyer_email",
    description:
      "Draft a professional buyer notification email about a T&A milestone delay or risk. " +
      "The tone should be professional but direct. Acknowledge the situation, " +
      "state the revised timeline if known, and offer next steps. " +
      "Do NOT be overly apologetic — be factual and solution-oriented.",
    input_schema: {
      type: "object",
      required: ["subject", "body", "urgency", "suggested_action"],
      properties: {
        subject: {
          type: "string",
          description: "Email subject line — include PO number and milestone name",
        },
        body: {
          type: "string",
          description: "Full email body in plain text. Include greeting, situation summary, impact, and next steps.",
        },
        urgency: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Urgency level that determines email styling in UI",
        },
        suggested_action: {
          type: "string",
          description: "One-line suggested action for the Merchandiser e.g. 'Request revised delivery confirmation from fabric mill'",
        },
        revised_date_suggestion: {
          type: "string",
          description: "If a revised date can be inferred, suggest it (ISO 8601). Otherwise null.",
        },
      },
    },
  },
];

const EMAIL_SYSTEM_PROMPT = `You are the MerQuant T&A Risk Agent, drafting professional buyer 
communications for a textile/garment manufacturing company in Pakistan.

Context:
- You are writing on behalf of the manufacturer (supplier) to the buyer
- Tone: professional, factual, solution-oriented. Never panicked or overly apologetic.
- Keep emails concise: 3-4 short paragraphs maximum
- Always include: what the issue is, what the impact is, what the plan is
- Use formal salutation if buyer name is known ("Dear [Name]"), otherwise "Dear Team"
- Sign off as "The MerQuant Team" unless a specific contact name is provided
- For critical delays: be direct about the impact on ship date
- For at-risk items: frame as proactive notice, not confirmed delay`;

// ---------------------------------------------------------------------------
// Assess risk level for a single milestone
// ---------------------------------------------------------------------------

function assessMilestoneRisk(
  milestone: Record<string, unknown>,
  customThresholds: Record<string, Record<string, number>> | null,
  today: Date
): MilestoneRisk {
  const milestoneName = (milestone.milestone_name ?? milestone.name ?? "default") as string;
  const dueDate       = milestone.target_date ?? milestone.due_date ?? milestone.planned_date;

  if (!dueDate) {
    return {
      milestone,
      riskLevel: "on_track",
      daysRelative: 0,
      threshold: DEFAULT_THRESHOLDS["default"],
    };
  }

  // If already completed — always on track
  if (milestone.actual_date || milestone.completed_date || milestone.status === "completed" || milestone.status === "approved") {
    return {
      milestone,
      riskLevel: "on_track",
      daysRelative: 0,
      threshold: DEFAULT_THRESHOLDS["default"],
    };
  }

  const due          = new Date(dueDate as string);
  const daysRelative = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  // daysRelative > 0 means past due, < 0 means days remaining

  // Get thresholds — custom overrides default
  const customKey = customThresholds?.[milestoneName];
  const defaults  = DEFAULT_THRESHOLDS[milestoneName] ?? DEFAULT_THRESHOLDS["default"];
  const threshold = customKey
    ? { ...defaults, ...customKey }
    : defaults;

  let riskLevel: RiskLevel = "on_track";

  if (daysRelative >= threshold.critical) {
    riskLevel = "critical";
  } else if (daysRelative >= threshold.overdue) {
    riskLevel = "overdue";
  } else if (daysRelative >= threshold.at_risk) {
    riskLevel = "at_risk";
  }

  return { milestone, riskLevel, daysRelative, threshold };
}

// ---------------------------------------------------------------------------
// Draft email via Claude tool-calling
// ---------------------------------------------------------------------------

async function draftBuyerEmail(
  anthropicKey: string,
  context: {
    poNumber: string;
    buyerName: string;
    milestoneName: string;
    dueDate: string;
    daysRelative: number;
    riskLevel: RiskLevel;
    otherAtRiskMilestones: string[];
    deliveryDate: string | null;
    seasonName: string | null;
  }
): Promise<Record<string, unknown> | null> {
  const urgencyMap: Record<RiskLevel, string> = {
    on_track: "low",
    at_risk:  "medium",
    overdue:  "high",
    critical: "critical",
  };

  const daysDesc = context.daysRelative > 0
    ? `${context.daysRelative} day(s) overdue`
    : `due in ${Math.abs(context.daysRelative)} day(s)`;

  const otherIssues = context.otherAtRiskMilestones.length > 0
    ? `\nOther at-risk milestones on this order: ${context.otherAtRiskMilestones.join(", ")}`
    : "";

  const prompt = `Draft a buyer notification email for the following T&A situation:

PO Number: ${context.poNumber}
Buyer: ${context.buyerName}
Season/Description: ${context.seasonName ?? "N/A"}
Final Delivery Date: ${context.deliveryDate ?? "N/A"}

At-Risk Milestone: ${context.milestoneName}
Due Date: ${context.dueDate}
Status: ${context.riskLevel.toUpperCase()} (${daysDesc})
${otherIssues}

Draft a professional email notifying the buyer of this situation.`;

  const messages = [{ role: "user", content: prompt }];
  let result: Record<string, unknown> | null = null;
  let iterations = 0;

  while (iterations < 4) {
    iterations++;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 1500,
        system:     EMAIL_SYSTEM_PROMPT,
        tools:      EMAIL_DRAFT_TOOLS,
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
      if (block.name === "draft_buyer_email") {
        result = { ...block.input, urgency: block.input.urgency ?? urgencyMap[context.riskLevel] };
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
    if (result) break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Process a single T&A calendar
// ---------------------------------------------------------------------------

async function processCalendar(
  supabase: ReturnType<typeof createClient>,
  anthropicKey: string,
  calendar: Record<string, unknown>,
  today: Date
): Promise<{ flagged: number; drafted: number; errors: number }> {
  const stats = { flagged: 0, drafted: 0, errors: 0 };
  const calendarId = calendar.id as string;
  const poId       = calendar.po_id as string;

  // Fetch milestones for this calendar
  const { data: milestones, error: msError } = await supabase
    .from("tna_milestones")
    .select("*")
    .eq("tna_id", calendarId)  // ERP convention: tna_milestones.tna_id (not calendar_id)
    .order("target_date", { ascending: true });

  if (msError || !milestones?.length) return stats;

  // Fetch custom thresholds for this calendar (if set)
  const { data: thresholdConfig } = await supabase
    .from("tna_risk_thresholds")
    .select("milestone_name, at_risk_days, overdue_days, critical_days")
    .eq("calendar_id", calendarId);

  const customThresholds: Record<string, Record<string, number>> = {};
  for (const t of thresholdConfig ?? []) {
    customThresholds[t.milestone_name] = {
      at_risk:  t.at_risk_days,
      overdue:  t.overdue_days,
      critical: t.critical_days,
    };
  }

  // Fetch PO details for email context
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("po_number, buyer_name, delivery_date")
    .eq("id", poId)
    .maybeSingle();

  // Fetch buyer contact email
  const { data: buyerContact } = po?.buyer_name
    ? await supabase
        .from("buyer_contacts")
        .select("email, full_name")
        .ilike("customer_name", `%${po.buyer_name}%`)
        .limit(1)
        .maybeSingle()
    : { data: null };

  // Assess risk for all milestones
  const risks = milestones.map((m) =>
    assessMilestoneRisk(m, customThresholds, today)
  );

  const actionable = risks.filter((r) =>
    r.riskLevel === "at_risk" || r.riskLevel === "overdue" || r.riskLevel === "critical"
  );

  if (!actionable.length) return stats;

  // Check which ones already have a draft today (avoid duplicates)
  const { data: existingDrafts } = await supabase
    .from("tna_risk_drafts")
    .select("milestone_id")
    .eq("calendar_id", calendarId)
    .gte("created_at", new Date(today.setHours(0, 0, 0, 0)).toISOString());

  const alreadyDrafted = new Set((existingDrafts ?? []).map((d) => d.milestone_id));

  const otherAtRiskNames = actionable
    .map((r) => (r.milestone.milestone_name ?? r.milestone.name) as string)
    .filter(Boolean);

  // Process each actionable milestone
  for (const risk of actionable) {
    const msId       = risk.milestone.id as string;
    const msName     = (risk.milestone.milestone_name ?? risk.milestone.name ?? "Milestone") as string;
    const dueDate    = (risk.milestone.target_date ?? risk.milestone.due_date ?? risk.milestone.planned_date) as string;

    try {
      // Update milestone risk_level in DB
      await supabase
        .from("tna_milestones")
        .update({
          risk_level:    risk.riskLevel,
          days_relative: risk.daysRelative,
          last_flagged:  new Date().toISOString(),
        })
        .eq("id", msId);

      stats.flagged++;

      // Skip drafting if already done today
      if (alreadyDrafted.has(msId)) continue;

      // Draft email via Claude
      const emailDraft = await draftBuyerEmail(anthropicKey, {
        poNumber:              po?.po_number ?? "N/A",
        buyerName:             po?.buyer_name ?? "Buyer",
        milestoneName:         msName,
        dueDate,
        daysRelative:          risk.daysRelative,
        riskLevel:             risk.riskLevel,
        otherAtRiskMilestones: otherAtRiskNames.filter((n) => n !== msName),
        deliveryDate:          po?.delivery_date ?? null,
        seasonName:            null,  // ERP tna_calendars has no season_name field
      });

      if (!emailDraft) continue;

      // Save draft
      const { data: draft, error: draftErr } = await supabase
        .from("tna_risk_drafts")
        .insert({
          calendar_id:       calendarId,
          milestone_id:      msId,
          po_id:             poId,
          po_number:         po?.po_number ?? null,
          buyer_name:        po?.buyer_name ?? null,
          buyer_email:       buyerContact?.email ?? null,
          milestone_name:    msName,
          due_date:          dueDate,
          days_relative:     risk.daysRelative,
          risk_level:        risk.riskLevel,
          email_subject:     emailDraft.subject,
          email_body:        emailDraft.body,
          urgency:           emailDraft.urgency,
          suggested_action:  emailDraft.suggested_action,
          revised_date:      emailDraft.revised_date_suggestion ?? null,
          status:            "pending_review",
          agent_version:     "tna-v1",
        })
        .select()
        .single();

      if (draftErr) throw draftErr;
      stats.drafted++;

      // In-app notifications
      const { data: recipients } = await supabase
        .from("user_profiles")
        .select("id")
        .in("role", ["Owner", "Manager", "Merchandiser"]);

      if (recipients?.length) {
        const urgencyLabel: Record<string, string> = {
          critical: "🔴 CRITICAL",
          high:     "🟠 Overdue",
          medium:   "🟡 At Risk",
          low:      "🟢 Notice",
        };
        await supabase.from("notifications").insert(
          recipients.map((u) => ({
            user_id:    u.id,
            type:       "tna_risk",
            title:      `${urgencyLabel[emailDraft.urgency as string] ?? "⚠️"} T&A: ${msName}`,
            message:    `PO ${po?.po_number ?? ""} — ${msName} is ${risk.riskLevel}. Buyer email drafted for review.`,
            link:       `/tna-risk-agent?draft=${draft.id}`,
            read:       false,
            created_at: new Date().toISOString(),
          }))
        );
      }
    } catch (err) {
      console.error(`[tna-risk-agent] error on milestone ${msId}:`, err);
      stats.errors++;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

// CORS — ERP convention.
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
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const today    = new Date();

  const runSummary = {
    calendars_scanned: 0,
    milestones_checked: 0,
    milestones_flagged: 0,
    emails_drafted: 0,
    errors: 0,
  };

  try {
    // Fetch all active T&A calendars linked to open POs
    const { data: calendars, error: calError } = await supabase
      .from("tna_calendars")
      .select(`
        *,
        purchase_orders!inner (
          id, po_number, buyer_name, delivery_date,
          approval_status
        )
      `)
      .neq("purchase_orders.approval_status", "rejected");
      // Note: ERP tna_calendars has no `active` column — all rows considered active.

    if (calError) throw calError;

    for (const calendar of calendars ?? []) {
      try {
        // Count milestones for this calendar
        const { count } = await supabase
          .from("tna_milestones")
          .select("id", { count: "exact", head: true })
          .eq("calendar_id", calendar.id);

        runSummary.calendars_scanned++;
        runSummary.milestones_checked += count ?? 0;

        const result = await processCalendar(supabase, anthropicKey, calendar, today);

        runSummary.milestones_flagged += result.flagged;
        runSummary.emails_drafted     += result.drafted;
        runSummary.errors             += result.errors;
      } catch (calErr) {
        console.error(`[tna-risk-agent] calendar ${calendar.id} failed:`, calErr);
        runSummary.errors++;
      }
    }

    // Log the run
    await supabase.from("agent_run_log").insert({
      agent_name: "tna-risk-agent",
      run_at:     new Date().toISOString(),
      summary:    runSummary,
      status:     runSummary.errors > 0 ? "partial" : "success",
    });

    return new Response(JSON.stringify({ success: true, ...runSummary }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("[tna-risk-agent] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err), success: false }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
