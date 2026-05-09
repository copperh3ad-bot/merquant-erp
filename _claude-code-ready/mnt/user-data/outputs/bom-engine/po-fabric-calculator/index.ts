/**
 * MerQuant — po-fabric-calculator Edge Function
 * Version: v1
 *
 * Calculates total fabric required for a PO by joining:
 *   po_items.quantity × bom_set_totals.total_yards per material
 *
 * Two modes:
 *   calculate  — runs calculation, writes to po_fabric_requirements
 *   preview    — returns result without writing to DB
 *
 * POST /functions/v1/po-fabric-calculator
 * Body: { po_id, mode?: "calculate" | "preview", buffer_pct?: number }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INCHES_PER_METRE = 39.3701;

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface POItem {
  id:           string;
  po_id:        string;
  article_id:   string | null;
  sku:          string | null;
  style_number: string | null;
  description:  string | null;
  size_code:    string | null;
  size:         string | null;
  quantity:     number;
  unit_price:   number | null;
}

interface BOMSetTotal {
  material_description:  string;
  composition:           string | null;
  gsm:                   number | null;
  fabric_width_inches:   number | null;
  total_yards:           number;
  total_metres:          number;
  total_grams:           number;
  consumption_unit:      string;
  piece_breakdown:       Record<string, number>;
}

interface MaterialTotal {
  material_description:  string;
  composition:           string | null;
  gsm:                   number | null;
  fabric_width_inches:   number | null;
  consumption_unit:      string;
  total_yards_net:       number;
  total_metres_net:      number;
  total_grams_net:       number;
  total_yards_with_buffer: number;
  total_metres_with_buffer: number;
  line_items: LineItemDetail[];
  component_breakdown:   Record<string, number>;
}

interface LineItemDetail {
  po_item_id:       string;
  sku:              string;
  size_code:        string;
  description:      string;
  quantity:         number;
  yards_per_piece:  number;
  subtotal_yards:   number;
}

interface MissingBOMItem {
  sku:       string;
  size_code: string;
  reason:    string;
}

// ---------------------------------------------------------------------------
// Resolve article_id from po_item
-- po_items may reference articles via article_id FK or via sku text match
// ---------------------------------------------------------------------------

async function resolveArticleId(
  supabase: ReturnType<typeof createClient>,
  item: POItem
): Promise<string | null> {
  // Direct FK — fastest path
  if (item.article_id) return item.article_id;

  // SKU text match — try sku, then style_number, then description prefix
  const skuRef = item.sku ?? item.style_number ?? item.description;
  if (!skuRef) return null;

  const { data } = await supabase
    .from("articles")
    .select("id")
    .ilike("sku", skuRef.trim())
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// Main calculation function
// ---------------------------------------------------------------------------

async function calculateFabricRequirements(
  supabase:   ReturnType<typeof createClient>,
  poId:       string,
  bufferPct:  number
): Promise<{
  materials:     MaterialTotal[];
  missing:       MissingBOMItem[];
  bom_complete:  boolean;
  po_number:     string | null;
  buyer_name:    string | null;
  total_line_items: number;
  items_with_bom:   number;
}> {

  // Fetch PO details
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("po_number, buyer_name")
    .eq("id", poId)
    .maybeSingle();

  // Fetch all PO line items with quantity > 0
  const { data: items, error: itemsError } = await supabase
    .from("po_items")
    .select("*")
    .eq("po_id", poId)
    .gt("quantity", 0);

  if (itemsError) throw new Error(`Failed to fetch po_items: ${itemsError.message}`);
  if (!items?.length) throw new Error("No line items found for this PO");

  const materialMap = new Map<string, MaterialTotal>();
  const missing: MissingBOMItem[] = [];
  let itemsWithBOM = 0;

  for (const item of items as POItem[]) {
    const sizeCode = item.size_code ?? item.size ?? "ONE SIZE";
    const skuRef   = item.sku ?? item.style_number ?? item.description ?? "Unknown";

    // Resolve article
    const articleId = await resolveArticleId(supabase, item);

    if (!articleId) {
      missing.push({ sku: skuRef, size_code: sizeCode, reason: "Article not found in master" });
      continue;
    }

    // Fetch BOM set totals for this article + size
    const { data: bomRows } = await supabase
      .from("bom_set_totals")
      .select("*")
      .eq("article_id", articleId)
      .eq("size_code", sizeCode);

    if (!bomRows?.length) {
      // Try fuzzy size match — "Q" vs "Queen" etc.
      const { data: bomFuzzy } = await supabase
        .from("bom_set_totals")
        .select("*")
        .eq("article_id", articleId)
        .ilike("size_code", `${sizeCode.substring(0, 1)}%`)
        .limit(3);

      if (!bomFuzzy?.length) {
        missing.push({
          sku:       skuRef,
          size_code: sizeCode,
          reason:    "BOM not calculated — run BOM Calculator for this article first",
        });
        continue;
      }

      // Use best fuzzy match
      bomRows?.push(...bomFuzzy.slice(0, 1));
    }

    itemsWithBOM++;

    for (const bom of (bomRows ?? []) as BOMSetTotal[]) {
      const matKey = bom.material_description;
      const subYards  = round4(bom.total_yards * item.quantity);
      const subMetres = round4(bom.total_metres * item.quantity);
      const subGrams  = round4(bom.total_grams  * item.quantity);

      const lineDetail: LineItemDetail = {
        po_item_id:      item.id,
        sku:             skuRef,
        size_code:       sizeCode,
        description:     item.description ?? skuRef,
        quantity:        item.quantity,
        yards_per_piece: bom.total_yards,
        subtotal_yards:  subYards,
      };

      if (materialMap.has(matKey)) {
        const existing = materialMap.get(matKey)!;
        existing.total_yards_net  += subYards;
        existing.total_metres_net += subMetres;
        existing.total_grams_net  += subGrams;
        existing.line_items.push(lineDetail);

        // Merge component breakdown
        for (const [comp, val] of Object.entries(bom.piece_breakdown ?? {})) {
          const compKey = `${comp} (${sizeCode} ×${item.quantity})`;
          existing.component_breakdown[compKey] =
            round4((existing.component_breakdown[compKey] ?? 0) + (val * item.quantity));
        }
      } else {
        const compBreakdown: Record<string, number> = {};
        for (const [comp, val] of Object.entries(bom.piece_breakdown ?? {})) {
          compBreakdown[`${comp} (${sizeCode} ×${item.quantity})`] =
            round4(val * item.quantity);
        }

        materialMap.set(matKey, {
          material_description:  bom.material_description,
          composition:           bom.composition,
          gsm:                   bom.gsm,
          fabric_width_inches:   bom.fabric_width_inches,
          consumption_unit:      bom.consumption_unit,
          total_yards_net:       subYards,
          total_metres_net:      subMetres,
          total_grams_net:       subGrams,
          total_yards_with_buffer: 0,  // calculated below
          total_metres_with_buffer: 0,
          line_items:            [lineDetail],
          component_breakdown:   compBreakdown,
        });
      }
    }
  }

  // Apply buffer and round all totals
  const materials: MaterialTotal[] = [];
  for (const mat of materialMap.values()) {
    mat.total_yards_net   = round4(mat.total_yards_net);
    mat.total_metres_net  = round4(mat.total_metres_net);
    mat.total_grams_net   = round4(mat.total_grams_net);
    mat.total_yards_with_buffer  = round4(mat.total_yards_net  * (1 + bufferPct / 100));
    mat.total_metres_with_buffer = round4(mat.total_metres_net * (1 + bufferPct / 100));
    materials.push(mat);
  }

  // Sort by material description
  materials.sort((a, b) => a.material_description.localeCompare(b.material_description));

  return {
    materials,
    missing,
    bom_complete:     missing.length === 0,
    po_number:        po?.po_number ?? null,
    buyer_name:       po?.buyer_name ?? null,
    total_line_items: items.length,
    items_with_bom:   itemsWithBOM,
  };
}

// ---------------------------------------------------------------------------
// Write results to DB
// ---------------------------------------------------------------------------

async function writeRequirements(
  supabase:  ReturnType<typeof createClient>,
  poId:      string,
  result:    Awaited<ReturnType<typeof calculateFabricRequirements>>,
  bufferPct: number
): Promise<void> {
  // Delete existing
  await supabase
    .from("po_fabric_requirements")
    .delete()
    .eq("po_id", poId);

  // Insert all materials
  if (result.materials.length === 0) return;

  const rows = result.materials.map((mat) => ({
    po_id:                    poId,
    material_description:     mat.material_description,
    composition:              mat.composition,
    gsm:                      mat.gsm,
    fabric_width_inches:      mat.fabric_width_inches,
    total_yards_net:          mat.total_yards_net,
    total_metres_net:         mat.total_metres_net,
    total_grams_net:          mat.total_grams_net,
    consumption_unit:         mat.consumption_unit,
    buffer_pct:               bufferPct,
    total_yards_with_buffer:  mat.total_yards_with_buffer,
    total_metres_with_buffer: mat.total_metres_with_buffer,
    line_item_breakdown:      mat.line_items,
    component_breakdown:      mat.component_breakdown,
    bom_complete:             result.bom_complete,
    missing_bom_items:        result.missing,
    calculated_by:            "po-fabric-calculator-v1",
    calculated_at:            new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("po_fabric_requirements")
    .insert(rows);

  if (error) throw new Error(`Failed to write requirements: ${error.message}`);
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { po_id, mode = "calculate", buffer_pct = 5.0 } = body;

    if (!po_id) throw new Error("po_id required");

    const result = await calculateFabricRequirements(supabase, po_id, buffer_pct);

    if (mode === "calculate") {
      await writeRequirements(supabase, po_id, result, buffer_pct);
    }

    // Build response summary
    const totalYardsNet    = result.materials.reduce((s, m) => s + m.total_yards_net, 0);
    const totalYardsBuf    = result.materials.reduce((s, m) => s + m.total_yards_with_buffer, 0);
    const totalMetresBuf   = result.materials.reduce((s, m) => s + m.total_metres_with_buffer, 0);

    return new Response(
      JSON.stringify({
        success:          true,
        mode,
        po_number:        result.po_number,
        buyer_name:       result.buyer_name,
        total_line_items: result.total_line_items,
        items_with_bom:   result.items_with_bom,
        bom_complete:     result.bom_complete,
        buffer_pct,
        summary: {
          material_count:          result.materials.length,
          total_yards_net:         round4(totalYardsNet),
          total_yards_with_buffer: round4(totalYardsBuf),
          total_metres_with_buffer: round4(totalMetresBuf),
        },
        materials:        result.materials,
        missing_bom_items: result.missing,
        saved:            mode === "calculate",
      }),
      {
        status:  200,
        headers: {
          "Content-Type":                "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    console.error("[po-fabric-calculator]", err);
    return new Response(
      JSON.stringify({
        error:   err instanceof Error ? err.message : String(err),
        success: false,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
