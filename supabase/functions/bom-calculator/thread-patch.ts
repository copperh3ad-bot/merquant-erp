/**
 * bom-calculator-thread-patch.ts
 *
 * Add thread consumption calculation to bom-calculator/index.ts.
 * These functions slot into the existing calculateBOM() function
 * AFTER the fabric BOM is calculated.
 *
 * INTEGRATION INSTRUCTIONS:
 * In supabase/functions/bom-calculator/index.ts:
 *
 * 1. Add this import at the top:
 *    import {
 *      calculateSeamThreadConsumption,
 *      aggregateThreadBOM,
 *      suggestSeamsForArticle,
 *      runThreadEngineTests,
 *    } from "../_shared/thread-formula-engine.ts";
 *
 * 2. In the main handler, add "thread_test" to run_tests:
 *    if (run_tests) {
 *      const fabricTests = runEngineTests();
 *      const threadTests = runThreadEngineTests();
 *      return Response with { fabric: fabricTests, thread: threadTests }
 *    }
 *
 * 3. At the end of calculateBOM(), after writing bom_set_totals, call:
 *    const threadResult = await calculateThreadBOM(supabase, articleId, sizes, components);
 *    return { ...fabricResult, thread: threadResult };
 *
 * 4. Add mode "suggest_seams" to the main handler dispatch.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateSeamThreadConsumption,
  aggregateThreadBOM,
  suggestSeamsForArticle,
} from "../_shared/thread-formula-engine.ts";
import type { SeamSpec, StitchSpec } from "../_shared/thread-formula-engine.ts";
import type { SizeSpec, ComponentSpec } from "../_shared/bom-formula-engine.ts";

// ---------------------------------------------------------------------------
// Main thread BOM calculation function
// Called from calculateBOM() after fabric BOM is written
// ---------------------------------------------------------------------------

export async function calculateThreadBOM(
  supabase:   ReturnType<typeof createClient>,
  articleId:  string,
  sizes:      SizeSpec[],
  components: ComponentSpec[]
): Promise<{
  seamsProcessed:  number;
  threadResults:   Record<string, unknown>[];
  threadTotals:    Record<string, Record<string, unknown>>;
  suggestedSeams?: Record<string, unknown>[];
}> {

  // Fetch seams for this article
  const { data: seams, error: seamsError } = await supabase
    .from("article_seams")
    .select("*")
    .eq("article_id", articleId)
    .order("display_order");

  // If no seams defined yet — generate suggestions and return them
  // (don't calculate, just suggest — user needs to confirm seams first)
  if (seamsError || !seams?.length) {
    const category = await inferArticleCategory(supabase, articleId);
    const suggested = suggestSeamsForArticle(category, components);
    return {
      seamsProcessed: 0,
      threadResults:  [],
      threadTotals:   {},
      suggestedSeams: suggested,
    };
  }

  // Fetch stitch library entries for all stitches used in this article
  const stitchCodes = [...new Set(seams.map((s) => s.stitch_iso_code))];
  const { data: stitches } = await supabase
    .from("stitch_library")
    .select("iso_code, common_name, thread_count, thread_ratio")
    .in("iso_code", stitchCodes);

  const stitchMap = new Map<string, StitchSpec>(
    (stitches ?? []).map((s) => [s.iso_code, s])
  );

  // Build component map for seam length derivation
  const compMap = new Map<string, ComponentSpec>(
    components.map((c) => [c.id, c])
  );

  const allResults = [];
  const allTotals: Record<string, Record<string, unknown>> = {};

  for (const size of sizes) {
    const sizeResults = [];

    for (const seam of seams as SeamSpec[]) {
      const stitch = stitchMap.get(seam.stitch_iso_code);
      if (!stitch) {
        console.warn(`[bom-calculator] stitch ${seam.stitch_iso_code} not found in library`);
        continue;
      }

      const component = seam.derived_from_component_id
        ? compMap.get(seam.derived_from_component_id) ?? null
        : null;

      const result = calculateSeamThreadConsumption(seam, stitch, component, size);
      sizeResults.push(result);
      allResults.push(result);

      // Save to thread_bom_results
      if (!result.error) {
        await supabase
          .from("thread_bom_results")
          .upsert({
            article_id:         articleId,
            seam_id:            seam.id,
            size_code:          size.size_code,
            size_label:         size.size_label,
            seam_length_inches: result.seam_length_inches,
            total_stitches:     result.total_stitches,
            thread_consumption: result.thread_consumption,
            calculation_steps:  result.calculation_steps,
            formula_used:       result.formula_used,
            inputs_snapshot:    result.inputs_snapshot,
            calculated_by:      "bom-calculator-v1",
            calculated_at:      new Date().toISOString(),
          }, { onConflict: "article_id,seam_id,size_code" });
      }
    }

    // Aggregate thread totals for this size
    const aggregated = aggregateThreadBOM(sizeResults);
    allTotals[size.size_code] = aggregated;

    // Save thread totals
    for (const [, total] of Object.entries(aggregated)) {
      await supabase
        .from("thread_bom_totals")
        .upsert({
          article_id:                  articleId,
          size_code:                   size.size_code,
          thread_colour:               total.thread_colour,
          thread_ticket:               total.thread_ticket,
          total_metres_per_piece:      total.total_metres_per_piece,
          total_metres_with_wastage:   total.total_metres_with_wastage,
          total_metres_per_dozen:      total.total_metres_per_dozen,
          seam_ids:                    total.seam_ids,
          seam_breakdown:              total.seam_breakdown,
          calculated_at:               new Date().toISOString(),
        }, { onConflict: "article_id,size_code,thread_colour,thread_ticket" });
    }
  }

  return {
    seamsProcessed: seams.length,
    threadResults:  allResults,
    threadTotals:   allTotals,
  };
}

// ---------------------------------------------------------------------------
// Suggest seams and save them to article_seams
// Called when mode = "suggest_seams"
// ---------------------------------------------------------------------------

export async function saveSuggestedSeams(
  supabase:   ReturnType<typeof createClient>,
  articleId:  string,
  components: ComponentSpec[]
): Promise<{ saved: number }> {
  const category  = await inferArticleCategory(supabase, articleId);
  const suggested = suggestSeamsForArticle(category, components);

  let saved = 0;
  for (let i = 0; i < suggested.length; i++) {
    const seam = suggested[i];
    const { error } = await supabase
      .from("article_seams")
      .insert({
        article_id:                  articleId,
        seam_name:                   seam.seam_name,
        seam_description:            seam.seam_description,
        display_order:               seam.display_order ?? i + 1,
        stitch_iso_code:             seam.stitch_iso_code,
        spi:                         seam.spi ?? 10,
        threads:                     seam.threads ?? [],
        length_source:               seam.length_source ?? "derived",
        derived_from_component_id:   seam.derived_from_component_id ?? null,
        derived_dimension:           seam.derived_dimension ?? null,
        derived_multiplier:          seam.derived_multiplier ?? 1.0,
        derived_add_inches:          seam.derived_add_inches ?? 0,
        manual_length_inches:        seam.manual_length_inches ?? null,
        wastage_pct:                 seam.wastage_pct ?? 5.0,
        source:                      "agent",
      });
    if (!error) saved++;
  }
  return { saved };
}

// ---------------------------------------------------------------------------
// Helper: infer product category from article
// ---------------------------------------------------------------------------

async function inferArticleCategory(
  supabase:  ReturnType<typeof createClient>,
  articleId: string
): Promise<string> {
  // ERP columns: product_category, article_name, article_code.
  const { data: article } = await supabase
    .from("articles")
    .select("product_category, article_name, article_code")
    .eq("id", articleId)
    .maybeSingle();

  const text = [
    article?.product_category ?? "",
    article?.article_name     ?? "",
    article?.article_code     ?? "",
  ].join(" ").toLowerCase();

  if (text.includes("protector"))          return "mattress_protector";
  if (text.includes("fitted"))             return "fitted_sheet";
  if (text.includes("flat sheet"))         return "flat_sheet";
  if (text.includes("pillowcase") ||
      text.includes("pillow case"))        return "pillowcase";
  if (text.includes("duvet"))              return "duvet_cover";
  return "mattress_protector";
}
