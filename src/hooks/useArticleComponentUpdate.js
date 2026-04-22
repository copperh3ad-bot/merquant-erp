import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mfg, supabase } from "@/api/supabaseClient";
import { getBaseCode, recalcComponents, sumTotalFabric } from "@/lib/articleUtils";

/**
 * Unified article-component update hook.
 *
 * Encapsulates FOUR things that MUST happen on every fabric-components save
 * so that Articles and FabricWorking stay identical in behavior, and so the
 * two master libraries (fabric_templates + style_consumption) stay in sync:
 *
 *   1. Update the primary article with fresh `total_fabric_required`
 *   2. Propagate component specs to sibling articles (same base code,
 *      different colorway) — each sibling gets its own `total_required`
 *      recomputed against its own order_quantity
 *   3. Upsert the master `fabric_templates` row keyed by article_code,
 *      so repeat orders of this SKU auto-fill from the library
 *   4. Bridge fabric specs into `style_consumption` (the unified consumption
 *      library used by Trims "From Library" and the Consumption Library page)
 *      so that fabric edits in FabricWorking/Articles don't leave the
 *      consumption library stale.
 *
 * Callers only need to supply:
 *   - id:           the article being edited
 *   - data:         the full article payload (with components[])
 *   - allArticles:  the broader pool of articles to look for siblings in
 *                   (typically all articles on the current PO, or the
 *                   full global list from the Articles page)
 *
 * Example:
 *   const update = useArticleComponentUpdate({
 *     onSuccess: () => setEditingArticle(null),
 *     invalidateKeys: [["articles", poId], ["allArticles"]],
 *   });
 *   update.mutate({ id, data, allArticles });
 */
export function useArticleComponentUpdate({ onSuccess, invalidateKeys = [] } = {}) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data, allArticles = [] }) => {
      // 1. Primary article
      const total_fabric_required = sumTotalFabric(data.components);
      await mfg.articles.update(id, { ...data, total_fabric_required });

      // 2. Sibling propagation — same base code, different colorway
      const baseCode = getBaseCode(data);
      if (baseCode) {
        const siblings = allArticles.filter(
          (a) => a.id !== id && getBaseCode(a) === baseCode
        );
        for (const sib of siblings) {
          const sibComps = recalcComponents(data.components, sib.order_quantity);
          await mfg.articles.update(sib.id, {
            components: sibComps,
            total_fabric_required: sumTotalFabric(sibComps),
          });
        }
      }

      // 3. Fabric template master (repeat-order lookup)
      if (data.article_code) {
        // Strip per-PO computed fields — templates store spec only
        const masterComponents = (data.components || []).map(
          // eslint-disable-next-line no-unused-vars
          ({ total_required, net_total, ...rest }) => rest
        );
        await mfg.fabricTemplates.upsert({
          article_code: data.article_code,
          article_name: data.article_name,
          components: masterComponents,
        });

        // 4. Bridge each fabric component into style_consumption so the
        //    unified library reflects the latest specs. Composite key is
        //    (article_code, component_type, component_key). Two components
        //    on the same article can share component_type (e.g. two "Binding"
        //    pieces), so we de-duplicate the component_key with a suffix.
        const seenKeys = new Map(); // component_type → occurrence count
        const consumptionRows = (data.components || [])
          .filter((c) => c.component_type) // skip incomplete rows
          .map((c) => {
            const baseKey = c.component_type;
            const occurrence = (seenKeys.get(baseKey) || 0) + 1;
            seenKeys.set(baseKey, occurrence);
            const key = occurrence > 1 ? `${baseKey} #${occurrence}` : baseKey;

            // Compose a readable description: fabric_type + gsm + width
            const descBits = [c.fabric_type, c.gsm ? `${c.gsm}gsm` : null, c.width ? `${c.width}cm` : null]
              .filter(Boolean)
              .join(" · ");

            return {
              article_code: data.article_code,
              article_name: data.article_name,
              component_type: "fabric",
              component_key: key,
              component_description: descBits || c.component_type,
              unit: "meters",
              consumption_per_unit: parseFloat(c.consumption_per_unit) || 0,
              wastage_percent: parseFloat(c.wastage_percent) || 0,
              data_source: "fabric_templates",
              is_active: true,
              last_updated: new Date().toISOString(),
            };
          });

        if (consumptionRows.length) {
          // Upsert in one call using the composite unique constraint
          const { error } = await supabase
            .from("style_consumption")
            .upsert(consumptionRows, {
              onConflict: "article_code,component_type,component_key",
            });
          if (error) {
            // Non-fatal: the bridge is an enhancement, not a blocker.
            // Log it so failures surface in the console without breaking saves.
            console.warn("[useArticleComponentUpdate] style_consumption bridge failed:", error.message);
          }
        }
      }

      return { ok: true };
    },
    onSuccess: (result, variables) => {
      invalidateKeys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
      // Also refresh library caches so Trims "From Library" reflects the change
      qc.invalidateQueries({ queryKey: ["styleConsumption"] });
      qc.invalidateQueries({ queryKey: ["trimLibraryByCode"] });
      onSuccess?.(result, variables);
    },
  });
}
