// supabase/functions/po-fabric-calculator/index.ts
//
// MerQuant ERP — po-fabric-calculator Edge Function
// Phase 11.
//
// Calculates total fabric required for a PO by joining:
//   po_items (size-fanned via size_breakdown jsonb) × bom_set_totals
//
// This is a thin wrapper around the SQL RPC `calculate_po_fabric_requirements`
// (mig 0039), which already encodes the ERP-aware logic (master_article_id,
// style_sku/item_code, item_description, size_breakdown jsonb).
//
// POST /functions/v1/po-fabric-calculator
// Body: { po_id: uuid, mode?: "calculate" | "preview", buffer_pct?: number }
//   - calculate: writes to po_fabric_requirements (default)
//   - preview:   calls the RPC then rolls back the write (useful for what-ifs)
//
// Auth: service-role internal call OR JWT-gated when called from UI.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase env vars");

    const body = await req.json().catch(() => ({}));
    const { po_id, mode = "calculate", buffer_pct = 5.0 } = body;

    if (!po_id) {
      return new Response(JSON.stringify({ error: "po_id required" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Snapshot existing rows for preview-rollback (preview mode).
    let snapshot: unknown[] | null = null;
    if (mode === "preview") {
      const { data } = await supabase
        .from("po_fabric_requirements")
        .select("*")
        .eq("po_id", po_id);
      snapshot = data ?? [];
    }

    // Call the RPC (mig 0039 handles all the size-breakdown fanout + aggregation).
    const { data: rows, error } = await supabase.rpc("calculate_po_fabric_requirements", {
      p_po_id:      po_id,
      p_buffer_pct: buffer_pct,
    });

    if (error) throw error;

    // Fetch full rows including line_item_breakdown for richer response.
    const { data: full } = await supabase
      .from("po_fabric_requirements")
      .select("*")
      .eq("po_id", po_id)
      .order("material_description");

    // PO header for the response.
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("po_number, buyer_name, delivery_date")
      .eq("id", po_id)
      .maybeSingle();

    // Preview rollback — restore snapshot.
    if (mode === "preview" && snapshot !== null) {
      await supabase.from("po_fabric_requirements").delete().eq("po_id", po_id);
      if (snapshot.length > 0) {
        await supabase.from("po_fabric_requirements").insert(snapshot);
      }
    }

    return new Response(JSON.stringify({
      success:     true,
      po_id,
      po_number:   po?.po_number ?? null,
      buyer_name:  po?.buyer_name ?? null,
      mode,
      summary:     rows ?? [],
      requirements: full ?? [],
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[po-fabric-calculator]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err), success: false }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
