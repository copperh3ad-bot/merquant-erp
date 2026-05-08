/**
 * memory-reader.ts
 * Shared memory retrieval module for all MerQuant agents.
 * Place at: supabase/functions/_shared/memory-reader.ts
 *
 * Usage in any agent edge function:
 *
 *   import { recallMemories, buildMemoryContext } from "../_shared/memory-reader.ts";
 *
 *   // Before Claude call:
 *   const memories = await recallMemories(supabase, {
 *     entityType: "buyer",
 *     entityId:   "Bob's Discount Furniture",
 *     limit:      8,
 *   });
 *   const memoryContext = buildMemoryContext(memories);
 *
 *   // Inject into Claude system prompt:
 *   const systemPrompt = `${basePrompt}\n\n${memoryContext}`;
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface Memory {
  id: string;
  memory_type: string;
  entity_label: string;
  summary: string;
  detail: Record<string, unknown>;
  source_event: string;
  importance: number;
  sentiment: string | null;
  confidence: number;
  created_at: string;
}

export interface RecallOptions {
  entityType:   string;
  entityId:     string;
  memoryTypes?: string[];   // filter to specific types
  limit?:       number;     // default 8
  query?:       string;     // optional keyword filter
}

// ---------------------------------------------------------------------------
// Retrieve relevant memories for an entity
// ---------------------------------------------------------------------------

export async function recallMemories(
  supabase: ReturnType<typeof createClient>,
  options: RecallOptions
): Promise<Memory[]> {
  const { entityType, entityId, memoryTypes, limit = 8, query } = options;

  const { data, error } = await supabase.rpc("retrieve_memories_for_agent", {
    p_entity_type:  entityType,
    p_entity_id:    entityId,
    p_memory_types: memoryTypes ?? null,
    p_limit:        limit,
    p_query:        query ?? null,
  });

  if (error) {
    console.error("[memory-reader] recall error:", error);
    return [];
  }

  return (data ?? []) as Memory[];
}

// ---------------------------------------------------------------------------
// Recall memories for multiple entities at once
// (e.g. both buyer AND supplier for a PO)
// ---------------------------------------------------------------------------

export async function recallMultipleEntities(
  supabase: ReturnType<typeof createClient>,
  entities: RecallOptions[]
): Promise<Record<string, Memory[]>> {
  const results: Record<string, Memory[]> = {};

  await Promise.all(
    entities.map(async (opts) => {
      const key = `${opts.entityType}:${opts.entityId}`;
      results[key] = await recallMemories(supabase, opts);
    })
  );

  return results;
}

// ---------------------------------------------------------------------------
// Build a formatted memory context block for Claude system prompts
// ---------------------------------------------------------------------------

export function buildMemoryContext(
  memories: Memory[],
  label = "Relevant Memory Context"
): string {
  if (!memories.length) return "";

  const sections: Record<string, Memory[]> = {};
  for (const m of memories) {
    const key = m.memory_type;
    if (!sections[key]) sections[key] = [];
    sections[key].push(m);
  }

  const typeLabels: Record<string, string> = {
    buyer:      "Buyer History",
    supplier:   "Supplier Patterns",
    order:      "Order & Production Patterns",
    correction: "Previous Agent Corrections",
  };

  const sentimentIcon: Record<string, string> = {
    positive: "✓",
    negative: "⚠",
    neutral:  "·",
  };

  const importancePrefix: Record<number, string> = {
    3: "[HIGH] ",
    2: "",
    1: "[LOW] ",
  };

  let context = `--- ${label} ---\n`;
  context += `(${memories.length} memories retrieved — use these to inform your response)\n\n`;

  for (const [type, mems] of Object.entries(sections)) {
    context += `## ${typeLabels[type] ?? type}\n`;
    for (const m of mems) {
      const icon   = sentimentIcon[m.sentiment ?? "neutral"] ?? "·";
      const prefix = importancePrefix[m.importance] ?? "";
      const age    = getRelativeAge(m.created_at);
      context += `${icon} ${prefix}${m.summary} (${age})\n`;
    }
    context += "\n";
  }

  context += "--- End Memory Context ---\n";
  return context;
}

// ---------------------------------------------------------------------------
// Build memory context for a full PO — buyer + supplier + order memories
// ---------------------------------------------------------------------------

export async function buildPOMemoryContext(
  supabase: ReturnType<typeof createClient>,
  po: {
    buyer_name: string;
    supplier_name?: string;
    article_sku?: string;
  }
): Promise<string> {
  const entities: RecallOptions[] = [
    { entityType: "buyer",    entityId: po.buyer_name,       limit: 6 },
  ];

  if (po.supplier_name) {
    entities.push({ entityType: "supplier", entityId: po.supplier_name, limit: 4 });
  }
  if (po.article_sku) {
    entities.push({ entityType: "article",  entityId: po.article_sku,   limit: 4 });
  }
  // Always include recent agent corrections
  entities.push({ entityType: "agent", entityId: "email-po-agent",    limit: 3 });
  entities.push({ entityType: "agent", entityId: "tna-risk-agent",     limit: 3 });

  const all: Memory[] = [];
  for (const opts of entities) {
    const mems = await recallMemories(supabase, opts);
    all.push(...mems);
  }

  // Sort: importance desc, then recency
  all.sort((a, b) =>
    b.importance - a.importance ||
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return buildMemoryContext(all.slice(0, 15), "PO Context Memory");
}

// ---------------------------------------------------------------------------
// Log which memories were used (for audit + improvement)
// ---------------------------------------------------------------------------

export async function logMemoryRetrieval(
  supabase: ReturnType<typeof createClient>,
  agentName: string,
  queryContext: string,
  memories: Memory[]
) {
  if (!memories.length) return;

  await supabase.from("memory_retrieval_log").insert({
    agent_name:     agentName,
    query_context:  queryContext.substring(0, 500),
    memories_found: memories.length,
    memory_ids:     memories.map((m) => m.id),
    retrieved_at:   new Date().toISOString(),
  }).then(() => {}).catch(() => {}); // non-fatal
}

// ---------------------------------------------------------------------------
// Utility: human-readable age
// ---------------------------------------------------------------------------

function getRelativeAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
