/**
 * MerQuant — fabric-order-generator Edge Function
 * Version: v1
 *
 * Generates fabric order drafts from po_fabric_requirements.
 * Routing logic:
 *   1. Check facility_capabilities for in-house match
 *   2. If full capacity available → inhouse order
 *   3. If partial capacity → split order (inhouse + external shortfall)
 *   4. If no capability → outsourced order (to best available supplier)
 *   5. All results land as draft status in fabric_order_drafts
 *
 * POST /functions/v1/fabric-order-generator
 * Body: { po_id, mode?: "generate" | "preview", overwrite?: boolean }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const METRES_PER_YARD = 0.9144;
const YARDS_PER_METRE = 1.09361;

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FabricRequirement {
  id:                       string;
  material_description:     string;
  composition:              string | null;
  gsm:                      number | null;
  fabric_width_inches:      number | null;
  colour_code:              string | null;
  total_yards_net:          number;
  total_metres_net:         number;
  total_grams_net:          number;
  total_yards_with_buffer:  number;
  total_metres_with_buffer: number;
  buffer_pct:               number;
  consumption_unit:         string;
  line_item_breakdown:      unknown[];
  bom_complete:             boolean;
}

interface FacilityMatch {
  facility_id:          string;
  facility_name:        string;
  facility_type:        string;
  available_capacity_m: number;
  lead_time_days:       number;
  cost_per_metre:       number | null;
  match_reason:         string;
  can_fulfill_fully:    boolean;
}

interface Supplier {
  id:   string;
  name: string;
}

interface GeneratedDraft {
  fulfillment_type:       string;
  facility_name:          string | null;
  supplier_name:          string | null;
  material_description:   string;
  quantity_metres:        number;
  quantity_yards:         number;
  quantity_kg:            number | null;
  primary_unit:           string;
  routing_reason:         string;
  required_by_date:       string | null;
  split_inhouse_metres?:  number;
  split_outsourced_metres?: number;
}

// ---------------------------------------------------------------------------
// Unit conversion helpers
// ---------------------------------------------------------------------------

function metresToYards(m: number): number { return round4(m * YARDS_PER_METRE); }
function yardsToMetres(y: number): number { return round4(y * METRES_PER_YARD); }

function metresToKg(
  metres:       number,
  gsm:          number | null,
  widthInches:  number | null
): number | null {
  if (!gsm || !widthInches) return null;
  const widthMetres   = widthInches * 0.0254;
  const sqMetres      = metres * widthMetres;
  const grams         = sqMetres * gsm;
  return round4(grams / 1000);
}

// Determine primary ordering unit based on material type
function inferPrimaryUnit(
  materialDesc: string,
  compositionDesc: string | null,
  fulfillmentType: string
): string {
  const text = [materialDesc, compositionDesc ?? ""].join(" ").toLowerCase();

  // Weight-based materials
  if (text.includes("fill") || text.includes("batting") ||
      text.includes("wadding") || text.includes("hollow") ||
      text.includes("fibre") || text.includes("fiber")) {
    return "kg";
  }

  // Processing orders often in metres
  if (fulfillmentType === "processing" || fulfillmentType === "inhouse") {
    return "metres";
  }

  // External mill orders — most common in yards for US/UK buyers, metres for EU
  return "metres";
}

// ---------------------------------------------------------------------------
// Find best external supplier for a material
// ---------------------------------------------------------------------------

async function findExternalSupplier(
  supabase:    ReturnType<typeof createClient>,
  materialDesc: string
): Promise<Supplier | null> {
  // Look in suppliers table for fabric/mill type suppliers
  // Use keyword match on supplier name or type
  // ERP suppliers has `category` but no `type` column.
  const { data } = await supabase
    .from("suppliers")
    .select("id, name")
    .or("category.ilike.%mill%,category.ilike.%fabric%,category.ilike.%textile%")
    .eq("status", "active")
    .limit(5);

  if (!data?.length) {
    // Fallback: any active supplier
    const { data: fallback } = await supabase
      .from("suppliers")
      .select("id, name")
      .limit(1)
      .maybeSingle();
    return fallback ?? null;
  }

  // Return first match (in production, this would be smarter — price history, rating etc.)
  return data[0];
}

// ---------------------------------------------------------------------------
// Calculate required-by date from PO delivery date minus lead time
// ---------------------------------------------------------------------------

async function calculateRequiredByDate(
  supabase:      ReturnType<typeof createClient>,
  poId:          string,
  leadTimeDays:  number
): Promise<string | null> {
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("delivery_date, ex_factory_date")
    .eq("id", poId)
    .maybeSingle();

  const baseDate = po?.ex_factory_date ?? po?.delivery_date;
  if (!baseDate) return null;

  const d = new Date(baseDate);
  // Subtract lead time + 14 days production buffer
  d.setDate(d.getDate() - leadTimeDays - 14);
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Core routing function for a single material requirement
// ---------------------------------------------------------------------------

async function routeMaterialRequirement(
  supabase:    ReturnType<typeof createClient>,
  req:         FabricRequirement,
  poId:        string,
  componentType: string | null
): Promise<GeneratedDraft> {

  const quantityMetres  = req.total_metres_with_buffer;
  const quantityYards   = req.total_yards_with_buffer;
  const leadTimeDefault = 21; // days if no facility match

  // Step 1: Check in-house capability
  const { data: facilityMatches } = await supabase.rpc(
    "match_facility_for_material",
    {
      p_material_description: req.material_description,
      p_component_type:       componentType,
      p_quantity_metres:      quantityMetres,
    }
  );

  const facility = facilityMatches?.[0] as FacilityMatch | undefined;

  const reqByDate = await calculateRequiredByDate(
    supabase, poId, facility?.lead_time_days ?? leadTimeDefault
  );

  const kgAmount = metresToKg(quantityMetres, req.gsm, req.fabric_width_inches);

  // Step 2: No in-house capability → pure outsourced
  if (!facility) {
    const supplier = await findExternalSupplier(supabase, req.material_description);
    const primaryUnit = inferPrimaryUnit(req.material_description, req.composition, "outsourced");

    return {
      fulfillment_type:    "outsourced",
      facility_name:       null,
      supplier_name:       supplier?.name ?? null,
      material_description: req.material_description,
      quantity_metres:     quantityMetres,
      quantity_yards:      quantityYards,
      quantity_kg:         kgAmount,
      primary_unit:        primaryUnit,
      routing_reason:      `No in-house capability found for "${req.material_description}" — routing to external supplier`,
      required_by_date:    reqByDate,
    };
  }

  // Step 3: In-house can fully fulfill
  if (facility.can_fulfill_fully) {
    const primaryUnit = inferPrimaryUnit(req.material_description, req.composition, "inhouse");
    return {
      fulfillment_type:    "inhouse",
      facility_name:       facility.facility_name,
      supplier_name:       null,
      material_description: req.material_description,
      quantity_metres:     quantityMetres,
      quantity_yards:      quantityYards,
      quantity_kg:         kgAmount,
      primary_unit:        primaryUnit,
      routing_reason:
        `${facility.match_reason} — ${facility.facility_name} has capacity ` +
        `(${facility.available_capacity_m}m/week). Full in-house production.`,
      required_by_date:    reqByDate,
    };
  }

  // Step 4: In-house partial capacity → split order
  const inhouseCapacity  = facility.available_capacity_m ?? 0;
  const outsourcedNeeded = round4(quantityMetres - inhouseCapacity);

  if (inhouseCapacity > 0 && outsourcedNeeded > 0) {
    const supplier = await findExternalSupplier(supabase, req.material_description);
    const primaryUnit = inferPrimaryUnit(req.material_description, req.composition, "inhouse");

    const inhouseKg  = metresToKg(inhouseCapacity, req.gsm, req.fabric_width_inches);
    const externalKg = metresToKg(outsourcedNeeded, req.gsm, req.fabric_width_inches);

    return {
      fulfillment_type:         "split",
      facility_name:            facility.facility_name,
      supplier_name:            supplier?.name ?? null,
      material_description:     req.material_description,
      quantity_metres:          quantityMetres,
      quantity_yards:           quantityYards,
      quantity_kg:              kgAmount,
      primary_unit:             primaryUnit,
      routing_reason:
        `${facility.facility_name} capacity: ${inhouseCapacity}m/week — ` +
        `covers ${inhouseCapacity}m in-house. ` +
        `Shortfall ${outsourcedNeeded}m routed to external supplier.`,
      required_by_date:         reqByDate,
      split_inhouse_metres:     inhouseCapacity,
      split_outsourced_metres:  outsourcedNeeded,
    };
  }

  // Fallback: facility matched but zero capacity → outsource
  const supplier   = await findExternalSupplier(supabase, req.material_description);
  const primaryUnit = inferPrimaryUnit(req.material_description, req.composition, "outsourced");
  return {
    fulfillment_type:    "outsourced",
    facility_name:       null,
    supplier_name:       supplier?.name ?? null,
    material_description: req.material_description,
    quantity_metres:     quantityMetres,
    quantity_yards:      quantityYards,
    quantity_kg:         kgAmount,
    primary_unit:        primaryUnit,
    routing_reason:
      `${facility.facility_name} matched but has no available capacity this period — routing to external supplier`,
    required_by_date:    reqByDate,
  };
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

async function generateFabricOrderDrafts(
  supabase: ReturnType<typeof createClient>,
  poId:     string,
  overwrite: boolean
): Promise<{
  drafts_created:  number;
  inhouse_count:   number;
  outsourced_count: number;
  split_count:     number;
  drafts:          unknown[];
  po_number:       string | null;
}> {

  // Fetch PO details
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("po_number, buyer_name")
    .eq("id", poId)
    .maybeSingle();

  // Check if drafts already exist
  if (!overwrite) {
    const { data: existing } = await supabase
      .from("fabric_order_drafts")
      .select("id")
      .eq("po_id", poId)
      .eq("status", "draft")
      .limit(1);

    if (existing?.length) {
      throw new Error(
        `Fabric order drafts already exist for PO ${po?.po_number ?? poId}. ` +
        `Pass overwrite:true to regenerate.`
      );
    }
  } else {
    // Delete existing drafts for this PO
    await supabase
      .from("fabric_order_drafts")
      .delete()
      .eq("po_id", poId)
      .eq("status", "draft");
  }

  // Fetch all fabric requirements for this PO
  const { data: requirements, error: reqError } = await supabase
    .from("po_fabric_requirements")
    .select("*")
    .eq("po_id", poId)
    .gt("total_metres_with_buffer", 0);

  if (reqError) throw new Error(`Failed to fetch requirements: ${reqError.message}`);
  if (!requirements?.length) {
    throw new Error(
      "No fabric requirements found for this PO. " +
      "Run the PO Fabric Calculator first."
    );
  }

  // Fetch component types per material (for better facility matching)
  // Join through bom_set_totals → article_components to get component_type
  const materialToComponentType = new Map<string, string>();
  for (const req of requirements as FabricRequirement[]) {
    const { data: comp } = await supabase
      .from("article_components")
      .select("component_type")
      .ilike("material_description", `%${req.material_description.substring(0, 15)}%`)
      .limit(1)
      .maybeSingle();
    if (comp?.component_type) {
      materialToComponentType.set(req.material_description, comp.component_type);
    }
  }

  // Generate a draft for each material requirement
  const createdDrafts = [];
  let inhouseCount = 0, outsourcedCount = 0, splitCount = 0;

  for (const req of requirements as FabricRequirement[]) {
    const componentType = materialToComponentType.get(req.material_description) ?? null;

    const draft = await routeMaterialRequirement(supabase, req, poId, componentType);

    // Write to fabric_order_drafts
    const { data: saved, error: saveErr } = await supabase
      .from("fabric_order_drafts")
      .insert({
        po_id:                    poId,
        requirement_id:           req.id,
        fulfillment_type:         draft.fulfillment_type,
        facility_name:            draft.facility_name,
        supplier_name:            draft.supplier_name,
        material_description:     draft.material_description,
        composition:              req.composition,
        gsm:                      req.gsm,
        fabric_width_inches:      req.fabric_width_inches,
        quantity_yards:           draft.quantity_yards,
        quantity_metres:          draft.quantity_metres,
        quantity_kg:              draft.quantity_kg,
        primary_unit:             draft.primary_unit,
        quantity_net_yards:       req.total_yards_net,
        quantity_net_metres:      req.total_metres_net,
        buffer_pct_applied:       req.buffer_pct,
        required_by_date:         draft.required_by_date,
        split_inhouse_metres:     draft.split_inhouse_metres ?? null,
        split_outsourced_metres:  draft.split_outsourced_metres ?? null,
        routing_reason:           draft.routing_reason,
        status:                   "draft",
        generated_by:             "fabric-order-generator-v1",
      })
      .select()
      .single();

    if (saveErr) {
      console.error("[fabric-order-generator] save error:", saveErr);
      continue;
    }

    createdDrafts.push(saved);
    if (draft.fulfillment_type === "inhouse")    inhouseCount++;
    if (draft.fulfillment_type === "outsourced") outsourcedCount++;
    if (draft.fulfillment_type === "split")      splitCount++;
  }

  // Notify Merchandisers
  const { data: recipients } = await supabase
    .from("user_profiles")
    .select("id")
    .in("role", ["Owner", "Manager", "Merchandiser"]);

  if (recipients?.length && createdDrafts.length > 0) {
    await supabase.from("notifications").insert(
      recipients.map((u) => ({
        user_id:    u.id,
        type:       "fabric_order_drafts",
        title:      "Fabric Order Drafts Ready",
        message:
          `${createdDrafts.length} fabric order draft(s) generated for PO ${po?.po_number ?? ""}. ` +
          `${inhouseCount} in-house, ${outsourcedCount} outsourced` +
          (splitCount > 0 ? `, ${splitCount} split` : "") +
          `. Review and confirm.`,
        link:       `/fabric-orders?po=${poId}&tab=drafts`,
        read:       false,
        created_at: new Date().toISOString(),
      }))
    );
  }

  return {
    drafts_created:   createdDrafts.length,
    inhouse_count:    inhouseCount,
    outsourced_count: outsourcedCount,
    split_count:      splitCount,
    drafts:           createdDrafts,
    po_number:        po?.po_number ?? null,
  };
}

// ---------------------------------------------------------------------------
// Confirm a draft → create actual fabric_order
// ---------------------------------------------------------------------------

async function confirmDraft(
  supabase: ReturnType<typeof createClient>,
  draftId:  string,
  userId:   string
): Promise<{ fabric_order_id: string }> {

  const { data: draft, error: draftErr } = await supabase
    .from("fabric_order_drafts")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();

  if (draftErr || !draft) throw new Error(`Draft ${draftId} not found`);
  if (draft.status !== "draft" && draft.status !== "reviewed") {
    throw new Error(`Draft is already ${draft.status}`);
  }

  // Create fabric_order in existing table
  // Map to whatever columns the existing fabric_orders table uses
  // (Claude Code will adapt these field names during integration)
  const { data: order, error: orderErr } = await supabase
    .from("fabric_orders")
    .insert({
      po_id:               draft.po_id,
      supplier_id:         draft.supplier_id,
      supplier_name:       draft.supplier_name,
      material_description: draft.material_description,
      composition:         draft.composition,
      gsm:                 draft.gsm,
      fabric_width:        draft.fabric_width_inches,
      // Quantity fields — use whichever column exists in fabric_orders
      quantity:            draft.primary_unit === "kg"
                             ? draft.quantity_kg
                             : draft.primary_unit === "yards"
                             ? draft.quantity_yards
                             : draft.quantity_metres,
      unit:                draft.primary_unit,
      quantity_metres:     draft.quantity_metres,
      quantity_yards:      draft.quantity_yards,
      quantity_kg:         draft.quantity_kg,
      primary_unit:        draft.primary_unit,
      required_by_date:    draft.required_by_date,
      order_date:          new Date().toISOString().split("T")[0],
      status:              "pending",
      fulfillment_type:    draft.fulfillment_type,
      facility_id:         draft.facility_id,
      source_po_id:        draft.po_id,
      source_requirement_id: draft.requirement_id,
      source_draft_id:     draft.id,
      routing_reason:      draft.routing_reason,
      currency:            draft.currency ?? "USD",
      unit_price:          draft.unit_price,
      total_amount:        draft.total_amount,
    })
    .select()
    .single();

  if (orderErr) throw new Error(`Failed to create fabric_order: ${orderErr.message}`);

  // Update draft status
  await supabase
    .from("fabric_order_drafts")
    .update({
      status:           "confirmed",
      confirmed_by:     userId,
      confirmed_at:     new Date().toISOString(),
      fabric_order_id:  order.id,
    })
    .eq("id", draftId);

  return { fabric_order_id: order.id };
}

// ---------------------------------------------------------------------------
// CORS — ERP convention.
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { po_id, mode = "generate", overwrite = false, draft_id, user_id } = body;

    // Confirm a specific draft
    if (mode === "confirm_draft") {
      if (!draft_id) throw new Error("draft_id required for confirm_draft mode");
      const result = await confirmDraft(supabase, draft_id, user_id ?? "system");
      return new Response(JSON.stringify({ success: true, ...result }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Generate drafts for a PO
    if (!po_id) throw new Error("po_id required");
    const result = await generateFabricOrderDrafts(supabase, po_id, overwrite);

    return new Response(
      JSON.stringify({ success: true, mode, ...result }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[fabric-order-generator]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err), success: false }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
