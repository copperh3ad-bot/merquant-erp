/**
 * MerQuant — memory-consolidation-agent Edge Function
 *
 * Runs weekly via pg_cron (Sunday 1 AM PKT).
 * Reads all correction memories + retrieval logs,
 * identifies patterns, and writes consolidated insights
 * back as high-importance memories that all agents inherit.
 *
 * Also: prunes low-importance old memories, deduplicates,
 * and generates a weekly intelligence report.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL             = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

const CONSOLIDATION_TOOLS = [
  {
    name: "write_consolidated_insight",
    description:
      "Write a high-importance consolidated insight distilled from multiple correction memories. " +
      "This becomes a permanent agent instruction for the specified entity.",
    input_schema: {
      type: "object",
      required: ["entity_type", "entity_id", "insight", "tags", "importance"],
      properties: {
        entity_type:  { type: "string" },
        entity_id:    { type: "string" },
        entity_label: { type: "string" },
        insight:      {
          type: "string",
          description: "The consolidated lesson. Written as an instruction to future agents. "
            + "Example: 'Always use LC 60-day payment terms for this buyer — TT corrections appear 4 times.'",
        },
        pattern_evidence: {
          type: "string",
          description: "Brief evidence summary e.g. 'Corrected 4 times in 3 months'",
        },
        tags:       { type: "array", items: { type: "string" } },
        importance: { type: "number", enum: [2, 3] },
      },
    },
  },
  {
    name: "flag_for_pruning",
    description: "Flag old low-value memories for deactivation to keep the memory store clean.",
    input_schema: {
      type: "object",
      required: ["memory_ids", "reason"],
      properties: {
        memory_ids: { type: "array", items: { type: "string" } },
        reason:     { type: "string" },
      },
    },
  },
  {
    name: "write_weekly_report",
    description: "Write a brief weekly intelligence report summarising agent performance.",
    input_schema: {
      type: "object",
      required: ["summary", "top_corrections", "buyer_insights", "supplier_insights"],
      properties: {
        summary:           { type: "string" },
        top_corrections:   { type: "array", items: { type: "string" } },
        buyer_insights:    { type: "array", items: { type: "string" } },
        supplier_insights: { type: "array", items: { type: "string" } },
        recommended_actions: { type: "array", items: { type: "string" } },
      },
    },
  },
];

const CONSOLIDATION_SYSTEM = `You are the MerQuant Memory Consolidation Agent.
Your job is to analyse a week's worth of agent correction memories and extract 
durable lessons that will improve all future agent runs.

For each pattern you find:
1. If an agent made the same mistake 2+ times for the same entity → write_consolidated_insight
2. If memories are redundant or low-value → flag_for_pruning  
3. Synthesise everything into a weekly report via write_weekly_report

Focus on:
- Systematic extraction errors (wrong field, wrong value pattern)
- Buyer-specific preferences agents keep missing
- Supplier reliability patterns
- Anything that would make agents smarter next week`;

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
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch this week's correction memories
    const { data: corrections } = await supabase
      .from("agent_memories")
      .select("*")
      .eq("memory_type", "correction")
      .gte("created_at", oneWeekAgo)
      .eq("is_active", true)
      .order("entity_id");

    // Fetch all buyer + supplier memories (for insight synthesis)
    const { data: entityMemories } = await supabase
      .from("agent_memories")
      .select("id, memory_type, entity_id, entity_label, summary, importance, created_at, tags")
      .in("memory_type", ["buyer", "supplier"])
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(200);

    // Fetch retrieval log (which memories were used + how often)
    const { data: retrievalLog } = await supabase
      .from("memory_retrieval_log")
      .select("memory_ids, agent_name")
      .gte("retrieved_at", oneWeekAgo);

    // Build context for Claude
    const correctionSummary = (corrections ?? [])
      .map((c) => `[${c.entity_id}] ${c.summary} (detail: ${JSON.stringify(c.detail)})`)
      .join("\n");

    const entitySummary = (entityMemories ?? [])
      .slice(0, 50)
      .map((m) => `[${m.memory_type}:${m.entity_id}] ${m.summary}`)
      .join("\n");

    // Count most-retrieved memories
    const retrievalCounts: Record<string, number> = {};
    for (const log of retrievalLog ?? []) {
      for (const id of log.memory_ids ?? []) {
        retrievalCounts[id] = (retrievalCounts[id] ?? 0) + 1;
      }
    }

    const context = `
CORRECTION MEMORIES THIS WEEK (${corrections?.length ?? 0}):
${correctionSummary || "None"}

EXISTING ENTITY MEMORIES (sample):
${entitySummary || "None"}

MOST RETRIEVED MEMORIES THIS WEEK:
${Object.entries(retrievalCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .map(([id, count]) => `${id}: ${count} retrievals`).join("\n") || "None"}
`.trim();

    // Run consolidation loop
    const messages = [{ role: "user", content: context }];
    const toDeactivate: string[]    = [];
    const insights: Record<string, unknown>[]   = [];
    let weeklyReport: Record<string, unknown> | null = null;
    let iterations  = 0;

    while (iterations < 8) {
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
          max_tokens: 3000,
          system:     CONSOLIDATION_SYSTEM,
          tools:      CONSOLIDATION_TOOLS,
          messages,
        }),
      });

      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      messages.push({ role: "assistant", content: data.content });

      if (data.stop_reason !== "tool_use") break;

      const toolResults = [];
      for (const block of data.content) {
        if (block.type !== "tool_use") continue;

        if (block.name === "write_consolidated_insight") {
          insights.push(block.input);
        } else if (block.name === "flag_for_pruning") {
          toDeactivate.push(...(block.input.memory_ids ?? []));
        } else if (block.name === "write_weekly_report") {
          weeklyReport = block.input;
        }

        toolResults.push({
          type:        "tool_result",
          tool_use_id: block.id,
          content:     JSON.stringify({ status: "ok" }),
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    // Write consolidated insights to agent_memories
    for (const insight of insights) {
      await supabase.from("agent_memories").insert({
        memory_type:      "buyer",
        entity_type:      insight.entity_type,
        entity_id:        insight.entity_id,
        entity_label:     insight.entity_label ?? insight.entity_id,
        summary:          insight.insight,
        detail:           { pattern_evidence: insight.pattern_evidence, consolidated: true },
        raw_context:      "Consolidated by memory-consolidation-agent",
        source_event:     "weekly_consolidation",
        confidence:       0.9,
        importance:       insight.importance ?? 3,
        tags:             [...(insight.tags ?? []), "consolidated", "weekly"],
        created_by_agent: "memory-consolidation-agent",
        is_active:        true,
      });
    }

    // Prune flagged memories
    if (toDeactivate.length) {
      await supabase
        .from("agent_memories")
        .update({ is_active: false })
        .in("id", toDeactivate);
    }

    // Save weekly report
    if (weeklyReport) {
      await supabase.from("agent_memories").insert({
        memory_type:      "order",
        entity_type:      "agent",
        entity_id:        "merquant-system",
        entity_label:     "MerQuant Weekly Intelligence",
        summary:          weeklyReport.summary as string,
        detail:           weeklyReport,
        source_event:     "weekly_consolidation",
        importance:       2,
        tags:             ["weekly-report", "intelligence"],
        created_by_agent: "memory-consolidation-agent",
        is_active:        true,
      });

      // Notify owners
      const { data: owners } = await supabase
        .from("user_profiles")
        .select("id")
        .eq("role", "Owner");

      if (owners?.length) {
        await supabase.from("notifications").insert(
          owners.map((u) => ({
            user_id:    u.id,
            type:       "weekly_intelligence",
            title:      "Weekly Agent Intelligence Report",
            message:    weeklyReport!.summary,
            link:       "/agent-memory?filter=weekly",
            read:       false,
            created_at: new Date().toISOString(),
          }))
        );
      }
    }

    // Log the run
    await supabase.from("agent_run_log").insert({
      agent_name: "memory-consolidation-agent",
      run_at:     new Date().toISOString(),
      summary: {
        corrections_analysed: corrections?.length ?? 0,
        insights_written:     insights.length,
        memories_pruned:      toDeactivate.length,
        weekly_report:        !!weeklyReport,
      },
      status: "success",
    });

    return new Response(
      JSON.stringify({
        success:      true,
        insights:     insights.length,
        pruned:       toDeactivate.length,
        weekly_report: !!weeklyReport,
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("[memory-consolidation-agent]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
