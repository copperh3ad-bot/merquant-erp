/**
 * MerQuant — bom-calculator Edge Function
 * Version: v1
 *
 * Two modes:
 *   MODE A — Parse: reads a tech pack PDF/text and extracts construction specs
 *   MODE B — Calculate: runs the formula engine against saved article_components
 *
 * POST /functions/v1/bom-calculator
 * Body (Parse):    { mode: "parse",    tech_pack_id, article_id? }
 * Body (Calculate): { mode: "calculate", article_id, size_codes?: string[] }
 * Body (Both):     { mode: "full",     tech_pack_id, article_id, size_codes? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateComponentConsumption,
  aggregateSetBOM,
  runEngineTests,
  type ComponentSpec,
  type SizeSpec,
} from "../_shared/bom-formula-engine.ts";
import { runThreadEngineTests } from "../_shared/thread-formula-engine.ts";
import { calculateThreadBOM, saveSuggestedSeams } from "./thread-patch.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL             = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// Tech pack construction extraction tools
// ---------------------------------------------------------------------------

const PARSE_TOOLS = [
  {
    name: "extract_construction_specs",
    description:
      "Extract fabric component specifications from a bedding tech pack. " +
      "Look for: fabric breakdown tables, material lists, construction diagrams, " +
      "spec sheets, and size charts. Map each fabric zone to a component_type.",
    input_schema: {
      type: "object",
      required: ["components", "size_chart"],
      properties: {
        product_category: {
          type: "string",
          enum: ["mattress_protector", "fitted_sheet", "flat_sheet", "pillowcase",
                 "duvet_cover", "mattress_pad", "mattress_topper", "custom"],
        },
        is_set: {
          type: "boolean",
          description: "True if this SKU is a multi-piece set",
        },
        set_pieces: {
          type: "array",
          items: { type: "string" },
          description: "Names of pieces in the set e.g. ['Protector','Fitted Sheet','Pillowcase × 2']",
        },
        components: {
          type: "array",
          description: "All fabric components found in the tech pack",
          items: {
            type: "object",
            required: ["component_name", "component_type", "formula_type"],
            properties: {
              component_name:        { type: "string" },
              component_type:        {
                type: "string",
                enum: ["top_panel","skirt","reverse","fill","border","elastic","binding","label","other"],
              },
              set_piece_name:        { type: "string", description: "Which piece this belongs to in a set" },
              formula_type:          {
                type: "string",
                enum: ["perimeter_skirt","flat_panel","fill_weight","trim_length","fixed_quantity","manual"],
              },
              material_description:  { type: "string" },
              composition:           { type: "string" },
              gsm:                   { type: "number" },
              fabric_width_inches:   { type: "number" },
              skirt_depth_inches:    { type: "number" },
              seam_allowance_inches: { type: "number" },
              hem_allowance_inches:  { type: "number" },
              wastage_pct:           { type: "number" },
              shrinkage_pct:         { type: "number" },
              colour_code:           { type: "string" },
              size_overrides:        {
                type: "object",
                description: "Per-size overrides e.g. {K: {skirt_depth_inches: 16}}",
              },
            },
          },
        },
        size_chart: {
          type: "array",
          description: "All sizes specified in the tech pack",
          items: {
            type: "object",
            required: ["size_code", "size_label"],
            properties: {
              size_code:      { type: "string" },
              size_label:     { type: "string" },
              length_inches:  { type: "number" },
              width_inches:   { type: "number" },
              depth_inches:   { type: "number" },
            },
          },
        },
        construction_notes: { type: "string" },
        confidence:         { type: "number", description: "Overall extraction confidence 0–1" },
        flags:              {
          type: "array",
          items: { type: "string" },
          description: "Anything ambiguous or missing that needs human review",
        },
      },
    },
  },
];

const PARSE_SYSTEM = `You are the MerQuant BOM Construction Spec Extractor — a specialist 
in bedding and mattress protector manufacturing tech packs.

Your job is to read tech pack content and extract every fabric component with its 
construction parameters. Be precise about:

COMPONENT TYPES — map carefully:
  top_panel    = main face fabric (microfibre, TPU laminate, cotton shell)
  skirt        = perimeter drop running around mattress (fitted sheet drop, protector gusset)
  reverse      = back/bottom panel if different material from top
  fill         = batting, wadding, 3D mesh, foam — anything inside
  border       = decorative border tape or contrast strip
  elastic      = elastic tape/band (note if full-perimeter or corner-only)
  binding      = binding tape on edges

FORMULA TYPES — assign correctly:
  perimeter_skirt = skirt runs ALL 4 sides (most fitted sheets/protectors)
  flat_panel      = top panels, reverse panels, flat sheets, pillowcase faces
  fill_weight     = fill/batting — output is grams not yards
  trim_length     = elastic, binding — linear measurement
  fixed_quantity  = labels, tags

FABRIC WIDTHS — critical:
  Always record in INCHES. Convert if given in cm (÷2.54).
  Common: 58", 60", 72", 94", 96", 108"

MULTI-PIECE SETS — handle carefully:
  If this is a set (protector + fitted sheet + 2 pillowcases):
    - Set is_set=true
    - List all pieces in set_pieces
    - For each component, set set_piece_name to which piece it belongs
    - Components in different pieces may share the same material

SKIRT DEPTH:
  Usually stated as "drop" or "depth" — this is the finished depth
  Common values: 12", 14", 15", 16", 18" (deep pocket)
  May vary by size (King may be deeper than Twin)

SIZE OVERRIDES:
  If skirt depth differs by size, populate size_overrides:
  {"K": {"skirt_depth_inches": 16}, "CK": {"skirt_depth_inches": 16}}

If a value is not stated in the tech pack, use these defaults:
  seam_allowance: 0.5", hem_allowance: 1.5", wastage_pct: 8, shrinkage_pct: 3

Flag anything ambiguous for human review.`;

// ---------------------------------------------------------------------------
// Mode A: Parse tech pack → extract construction specs
// ---------------------------------------------------------------------------

async function parseTechPack(
  supabase: ReturnType<typeof createClient>,
  anthropicKey: string,
  techPackId: string,
  articleId: string | null
): Promise<{ specs: Record<string, unknown>; componentsCreated: number }> {

  // Fetch tech pack content
  const { data: techPack, error: tpError } = await supabase
    .from("tech_packs")
    .select("*")
    .eq("id", techPackId)
    .maybeSingle();

  if (tpError || !techPack) throw new Error(`Tech pack ${techPackId} not found`);

  // Build content string from tech pack data
  // tech_packs table has various text fields — concatenate all available
  const contentParts: string[] = [];
  if (techPack.style_name)        contentParts.push(`Style: ${techPack.style_name}`);
  if (techPack.description)       contentParts.push(`Description: ${techPack.description}`);
  if (techPack.fabric_content)    contentParts.push(`Fabric: ${techPack.fabric_content}`);
  if (techPack.construction_notes) contentParts.push(`Construction: ${techPack.construction_notes}`);
  if (techPack.raw_text)          contentParts.push(`Tech Pack Content:\n${techPack.raw_text}`);
  if (techPack.extracted_data)    contentParts.push(`Extracted Data:\n${JSON.stringify(techPack.extracted_data, null, 2)}`);

  const content = contentParts.join("\n\n") || JSON.stringify(techPack, null, 2);

  // Run Claude extraction loop
  const messages = [{
    role: "user",
    content: `Extract construction specs from this tech pack:\n\n${content.substring(0, 15000)}`,
  }];

  let extracted: Record<string, unknown> | null = null;
  let iterations = 0;

  while (iterations < 5) {
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
        max_tokens: 4096,
        system:     PARSE_SYSTEM,
        tools:      PARSE_TOOLS,
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
      if (block.name === "extract_construction_specs") extracted = block.input;
      toolResults.push({
        type: "tool_result", tool_use_id: block.id,
        content: JSON.stringify({ status: "ok" }),
      });
    }
    messages.push({ role: "user", content: toolResults });
    if (extracted) break;
  }

  if (!extracted) throw new Error("Claude did not produce construction specs");

  // Save raw specs to tech_pack_construction_specs
  const { data: savedSpec } = await supabase
    .from("tech_pack_construction_specs")
    .insert({
      tech_pack_id:          techPackId,
      article_id:            articleId,
      raw_fabric_table:      extracted.components,
      parsed_components:     extracted.components,
      size_chart:            extracted.size_chart,
      construction_notes:    extracted.construction_notes,
      set_composition:       extracted.is_set
        ? { pieces: extracted.set_pieces, is_set: true }
        : { is_set: false },
      extraction_confidence: extracted.confidence ?? 0.8,
    })
    .select()
    .single();

  // If article_id provided, write components to article_components
  let componentsCreated = 0;
  if (articleId && extracted.components) {
    const components = extracted.components as Array<Record<string, unknown>>;
    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const { error: compError } = await supabase
        .from("article_components")
        .insert({
          article_id:            articleId,
          component_name:        comp.component_name ?? `Component ${i + 1}`,
          component_type:        comp.component_type ?? "other",
          display_order:         i + 1,
          material_description:  comp.material_description ?? null,
          composition:           comp.composition ?? null,
          gsm:                   comp.gsm ?? null,
          fabric_width_inches:   comp.fabric_width_inches ?? 58,
          colour_code:           comp.colour_code ?? null,
          formula_type:          comp.formula_type ?? "manual",
          seam_allowance_inches: comp.seam_allowance_inches ?? 0.5,
          hem_allowance_inches:  comp.hem_allowance_inches ?? 1.5,
          skirt_depth_inches:    comp.skirt_depth_inches ?? null,
          wastage_pct:           comp.wastage_pct ?? 8.0,
          shrinkage_pct:         comp.shrinkage_pct ?? 3.0,
          overlap_inches:        0,
          size_overrides:        comp.size_overrides ?? {},
          set_piece_name:        comp.set_piece_name ?? null,
          set_piece_index:       (comp.set_piece_name ? i + 1 : 1),
          source:                "tech_pack",
          tech_pack_id:          techPackId,
          confidence:            extracted.confidence ?? 0.8,
        });
      if (!compError) componentsCreated++;
    }
  }

  return { specs: extracted, componentsCreated };
}

// ---------------------------------------------------------------------------
// Mode B: Calculate BOM for an article across all sizes
// ---------------------------------------------------------------------------

async function calculateBOM(
  supabase: ReturnType<typeof createClient>,
  articleId: string,
  sizeCodes: string[] | null
): Promise<{
  results:    Record<string, unknown>[];
  setTotals:  Record<string, unknown>;
  sizeCount:  number;
  compCount:  number;
}> {

  // Fetch article components
  const { data: components, error: compError } = await supabase
    .from("article_components")
    .select("*")
    .eq("article_id", articleId)
    .neq("formula_type", "manual")
    .order("display_order");

  if (compError || !components?.length) {
    throw new Error("No components found for article. Add components first or parse a tech pack.");
  }

  // Fetch article to get product category — ERP columns: article_code, article_name, product_category.
  const { data: article } = await supabase
    .from("articles")
    .select("id, article_code, article_name, product_category")
    .eq("id", articleId)
    .maybeSingle();

  // Determine product category from article
  const category = inferCategory(article?.product_category ?? article?.article_name ?? "");

  // Fetch size masters
  let sizesQuery = supabase
    .from("size_masters")
    .select("*")
    .eq("category", category)
    .is("buyer_id", null);

  if (sizeCodes?.length) {
    sizesQuery = sizesQuery.in("size_code", sizeCodes);
  }

  const { data: sizes } = await sizesQuery;

  if (!sizes?.length) {
    throw new Error(`No sizes found for category '${category}'. Check size_masters table.`);
  }

  // Fetch wastage memory for smarter defaults
  const wastageMap = await fetchWastageMemory(supabase, components);

  // Run calculations
  const allResults = [];

  for (const size of sizes as SizeSpec[]) {
    for (const comp of components) {
      // Apply wastage override from memory if available
      const memWastage = wastageMap[`${comp.material_description}:${comp.component_type}`];
      const enrichedComp: ComponentSpec = {
        ...comp,
        wastage_pct: memWastage ?? comp.wastage_pct ?? 8.0,
      };

      const result = calculateComponentConsumption(enrichedComp, size);
      allResults.push(result);

      // Save to bom_results
      if (!result.error) {
        await supabase
          .from("bom_results")
          .upsert({
            article_id:        articleId,
            component_id:      comp.id,
            size_code:         size.size_code,
            size_label:        size.size_label,
            consumption_yards: result.consumption_yards,
            consumption_metres: result.consumption_metres,
            consumption_grams: result.consumption_grams,
            consumption_unit:  result.consumption_unit,
            calculation_steps: result.calculation_steps,
            formula_used:      result.formula_used,
            inputs_snapshot:   result.inputs_snapshot,
            calculated_by:     "bom-calculator-v1",
            calculated_at:     new Date().toISOString(),
          }, { onConflict: "article_id,component_id,size_code,version" });
      }
    }
  }

  // Aggregate set totals per size
  const setTotalsAll: Record<string, unknown> = {};

  for (const size of sizes as SizeSpec[]) {
    const sizeResults = allResults.filter((r) => r.size_code === size.size_code);
    const aggregated  = aggregateSetBOM(sizeResults, components as ComponentSpec[]);

    setTotalsAll[size.size_code] = aggregated;

    // Save set totals
    for (const [material, totals] of Object.entries(aggregated)) {
      const compForMat = components.find(
        (c) => c.material_description === material
      );
      await supabase
        .from("bom_set_totals")
        .upsert({
          article_id:           articleId,
          size_code:            size.size_code,
          material_description: material,
          composition:          compForMat?.composition ?? null,
          gsm:                  compForMat?.gsm ?? null,
          fabric_width_inches:  compForMat?.fabric_width_inches ?? null,
          total_yards:          totals.total_yards,
          total_metres:         totals.total_metres,
          total_grams:          totals.total_grams,
          consumption_unit:     totals.consumption_unit,
          component_ids:        totals.component_ids,
          piece_breakdown:      totals.piece_breakdown,
          calculated_at:        new Date().toISOString(),
        }, { onConflict: "article_id,size_code,material_description" });
    }
  }

  // Phase 9 thread BOM: after fabric BOM is written, also calc thread.
  // calculateThreadBOM gracefully returns suggestions if no seams defined.
  const threadResult = await calculateThreadBOM(supabase, articleId, sizes, components);

  return {
    results:   allResults,
    setTotals: setTotalsAll,
    sizeCount: sizes.length,
    compCount: components.length,
    thread:    threadResult,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferCategory(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("protector"))   return "mattress_protector";
  if (t.includes("fitted"))      return "fitted_sheet";
  if (t.includes("flat sheet"))  return "flat_sheet";
  if (t.includes("pillowcase") || t.includes("pillow case")) return "pillowcase";
  if (t.includes("duvet"))       return "duvet_cover";
  return "mattress_protector"; // sensible default for this product range
}

async function fetchWastageMemory(
  supabase: ReturnType<typeof createClient>,
  components: Record<string, unknown>[]
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const comp of components) {
    if (!comp.material_description) continue;
    const { data } = await supabase
      .from("wastage_memory")
      .select("observed_wastage_pct, confidence")
      .ilike("material_description", `%${comp.material_description}%`)
      .eq("component_type", comp.component_type)
      .order("confidence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && data.confidence > 0.7) {
      const key = `${comp.material_description}:${comp.component_type}`;
      result[key] = data.observed_wastage_pct;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// CORS — ERP convention (regex-allowed localhost + named-allowlist).
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
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { mode, tech_pack_id, article_id, size_codes, run_tests } = body;

    // Run engine self-tests if requested (both fabric + thread engines)
    if (run_tests) {
      const fabric = runEngineTests();
      const thread = runThreadEngineTests();
      return new Response(JSON.stringify({ fabric, thread }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Mode "suggest_seams" — generate seam suggestions for an article
    if (mode === "suggest_seams") {
      if (!article_id) throw new Error("article_id required for suggest_seams");
      const { data: components } = await supabase
        .from("article_components")
        .select("*")
        .eq("article_id", article_id);
      const result = await saveSuggestedSeams(supabase, article_id, components ?? []);
      return new Response(JSON.stringify({ success: true, ...result }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (mode === "parse" || mode === "full") {
      if (!tech_pack_id) throw new Error("tech_pack_id required for parse mode");
      const parseResult = await parseTechPack(supabase, anthropicKey, tech_pack_id, article_id ?? null);

      if (mode === "parse") {
        return new Response(JSON.stringify({ success: true, ...parseResult }), {
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      // Fall through to calculate if mode === "full"
    }

    if (mode === "calculate" || mode === "full") {
      if (!article_id) throw new Error("article_id required for calculate mode");
      const calcResult = await calculateBOM(supabase, article_id, size_codes ?? null);

      return new Response(JSON.stringify({ success: true, ...calcResult }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    throw new Error("mode must be: parse | calculate | full");

  } catch (err) {
    console.error("[bom-calculator]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err), success: false }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
