/**
 * Tech Pack Full Audit Engine
 *
 * Runs 7 of the 8 originally-scoped checks on a tech pack.
 * Step 5 (costing reconciliation) is deferred — costing pipeline not wired yet.
 *
 * Input:
 *   tp          — tech_packs row with extracted_* arrays
 *   articles    — Fabric Working articles (jsonb components on each)
 *   trims       — trim_items rows for the PO
 *   accessories — accessory_items rows for the PO
 *   poItems     — po_items rows (for size-breakdown vs order_quantity check)
 *
 * Output: { summary, findings }
 *   summary  — { total, critical, warning, info, byStep }
 *   findings — array of { step, step_label, severity, check_type, field_name,
 *                         techpack_value, working_value, message, fixable, fix }
 *
 * Each `fix` is a plain-object descriptor the UI can hand back to the server:
 *   { kind: "recalc_trim_qty" | "recalc_accessory_qty" | "backfill_tp_field",
 *     target_table, target_id, patch }
 *
 * Cost-related findings have `fixable: false` even if a fix is technically
 * possible — cost changes must route through owner approval, not bulk fix.
 */

import { classifyArticle, componentApplies } from "./articleTypes.js";

export const AUDIT_STEPS = {
  STEP_1: "Missing/incomplete tech pack records",
  STEP_2: "Fabric consumption vs Fabric Working",
  STEP_3: "Trim & accessory qty vs article components",
  STEP_4: "Size breakdown vs order quantity",
  // STEP_5 intentionally omitted
  STEP_6: "Required fields populated",
  STEP_7: "Reconciliation roll-up",
  STEP_8: "Bulk-fix eligibility",
};

const SEVERITY = { CRITICAL: "critical", WARNING: "warning", INFO: "info" };

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */
const num = (v) => (v == null || v === "" ? null : Number(v));
const nearly = (a, b, tol) =>
  a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;

function matchArticleToTP(tp, articles) {
  if (!articles?.length) return null;
  if (tp.article_code) {
    const byCode = articles.find((a) => a.article_code === tp.article_code);
    if (byCode) return byCode;
  }
  if (tp.po_id) {
    const byPo = articles.find((a) => a.po_id === tp.po_id);
    if (byPo) return byPo;
  }
  return null;
}

function fuzzyMatchComponent(tpType, workingType) {
  const a = (tpType || "").toLowerCase();
  const b = (workingType || "").toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  STEP 1 — Missing/incomplete extraction                                    */
/* ────────────────────────────────────────────────────────────────────────── */
function checkStep1(tp) {
  const findings = [];
  if (tp.extraction_status === "failed") {
    findings.push({
      step: 1, step_label: AUDIT_STEPS.STEP_1,
      severity: SEVERITY.CRITICAL, check_type: "extraction",
      field_name: "extraction_status",
      techpack_value: "failed",
      working_value: "extracted",
      message: tp.extraction_error || "AI extraction did not complete",
      fixable: false,
    });
    return findings;
  }
  if (tp.extraction_status === "partial" || tp.extraction_status === "pending") {
    findings.push({
      step: 1, step_label: AUDIT_STEPS.STEP_1,
      severity: SEVERITY.WARNING, check_type: "extraction",
      field_name: "extraction_status",
      techpack_value: tp.extraction_status,
      working_value: "extracted",
      message: "Extraction incomplete — re-upload or edit fields manually",
      fixable: false,
    });
  }
  const fabrics = tp.extracted_fabric_specs || [];
  if (fabrics.length === 0) {
    findings.push({
      step: 1, step_label: AUDIT_STEPS.STEP_1,
      severity: SEVERITY.WARNING, check_type: "extraction",
      field_name: "fabric_specs",
      techpack_value: "(empty)",
      working_value: "≥1 expected",
      message: "No fabric specs were extracted from this tech pack",
      fixable: false,
    });
  }
  return findings;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  STEP 2 — Fabric consumption vs Fabric Working                             */
/*  Surfaces both sides — user decides per row (per user preference)          */
/* ────────────────────────────────────────────────────────────────────────── */
function checkStep2(tp, articles) {
  const findings = [];
  const tpFabrics = tp.extracted_fabric_specs || [];
  const working = matchArticleToTP(tp, articles);

  if (!working && tpFabrics.length > 0) {
    findings.push({
      step: 2, step_label: AUDIT_STEPS.STEP_2,
      severity: SEVERITY.WARNING, check_type: "fabric",
      field_name: "article_link",
      techpack_value: tp.article_code || tp.article_name || "(none)",
      working_value: "(no matching article)",
      message: "Cannot compare — no Fabric Working article matches this tech pack",
      fixable: false,
    });
    return findings;
  }
  if (!working) return findings;

  // Classify the article so we only flag missing components that should exist
  const productType = classifyArticle({
    article_code: working.article_code || tp.article_code,
    article_name: working.article_name || tp.article_name,
    product_type: tp.extracted_data?.product_type_label || "",
  });

  const workingComps = working.components || [];

  for (const tpFab of tpFabrics) {
    // Skip components that don't apply to this product type (e.g. Skirt on pillow protector)
    if (!componentApplies(productType, tpFab.component_type)) continue;

    const match = workingComps.find((wc) =>
      fuzzyMatchComponent(tpFab.component_type, wc.component_type)
    );
    if (!match) {
      findings.push({
        step: 2, step_label: AUDIT_STEPS.STEP_2,
        severity: SEVERITY.WARNING, check_type: "fabric",
        field_name: tpFab.component_type || "(unknown component)",
        techpack_value: `${tpFab.fabric_type || "?"} @ ${tpFab.consumption_per_unit || "?"}m`,
        working_value: "(not in Fabric Working)",
        message: `Tech pack lists a ${tpFab.component_type} component that Fabric Working doesn't have`,
        fixable: false,
      });
      continue;
    }

    const tpCons = num(tpFab.consumption_per_unit);
    const wkCons = num(match.consumption_per_unit);
    if (tpCons != null && wkCons != null && !nearly(tpCons, wkCons, 0.05)) {
      const delta = Math.abs(tpCons - wkCons);
      findings.push({
        step: 2, step_label: AUDIT_STEPS.STEP_2,
        severity: delta > 0.2 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
        check_type: "fabric",
        field_name: `${tpFab.component_type} · consumption`,
        techpack_value: `${tpCons} m/pc`,
        working_value: `${wkCons} m/pc`,
        message: `Consumption differs by ${delta.toFixed(3)} m/pc`,
        fixable: false, // Per user: surface both sides, don't auto-fix
      });
    }

    const tpGsm = num(tpFab.gsm);
    const wkGsm = num(match.gsm);
    if (tpGsm != null && wkGsm != null && !nearly(tpGsm, wkGsm, 5)) {
      findings.push({
        step: 2, step_label: AUDIT_STEPS.STEP_2,
        severity: Math.abs(tpGsm - wkGsm) > 15 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
        check_type: "fabric",
        field_name: `${tpFab.component_type} · GSM`,
        techpack_value: `${tpGsm}`,
        working_value: `${wkGsm}`,
        message: "GSM differs",
        fixable: false,
      });
    }

    const tpWidth = num(tpFab.width_cm);
    const wkWidth = num(match.width);
    if (tpWidth != null && wkWidth != null && !nearly(tpWidth, wkWidth, 5)) {
      findings.push({
        step: 2, step_label: AUDIT_STEPS.STEP_2,
        severity: SEVERITY.INFO,
        check_type: "fabric",
        field_name: `${tpFab.component_type} · width`,
        techpack_value: `${tpWidth}cm`,
        working_value: `${wkWidth}cm`,
        message: "Fabric width differs",
        fixable: false,
      });
    }
  }
  return findings;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  STEP 3 — Trim & accessory quantities                                      */
/*  This CAN be auto-fixed: recalc trim.quantity_required from order_qty.     */
/* ────────────────────────────────────────────────────────────────────────── */
function checkStep3(tp, articles, trims, accessories) {
  const findings = [];
  const working = matchArticleToTP(tp, articles);
  const orderQty = working?.order_quantity || 0;
  if (!orderQty) return findings;

  // TP trim presence check
  const tpTrims = tp.extracted_trim_specs || [];
  const poTrims = trims.filter(
    (t) => (tp.po_id && t.po_id === tp.po_id) ||
           (tp.article_code && t.article_code === tp.article_code)
  );

  for (const tpTrim of tpTrims) {
    const match = poTrims.find((pt) =>
      fuzzyMatchComponent(
        pt.trim_category || pt.item_description,
        tpTrim.trim_type
      )
    );
    if (!match) {
      findings.push({
        step: 3, step_label: AUDIT_STEPS.STEP_3,
        severity: SEVERITY.WARNING, check_type: "trim",
        field_name: tpTrim.trim_type,
        techpack_value: `${tpTrim.quantity_per_unit || "?"} per pc`,
        working_value: "(not in Trims Planning)",
        message: "Trim listed in tech pack has no planning row",
        fixable: false, // Need article context to create — manual add
      });
      continue;
    }

    const tpQtyPerUnit = num(tpTrim.quantity_per_unit);
    if (tpQtyPerUnit != null && match.calc_type === "Per Piece") {
      const wkCons = num(match.consumption_per_unit);
      if (wkCons != null && !nearly(tpQtyPerUnit, wkCons, 0.01)) {
        const wastage = num(match.wastage_percent) || 0;
        const correctQty = Math.ceil(orderQty * tpQtyPerUnit * (1 + wastage / 100));
        findings.push({
          step: 3, step_label: AUDIT_STEPS.STEP_3,
          severity: SEVERITY.WARNING, check_type: "trim",
          field_name: `${match.trim_category} · consumption`,
          techpack_value: `${tpQtyPerUnit}/pc`,
          working_value: `${wkCons}/pc (total ${match.quantity_required})`,
          message: `Trim consumption mismatch — recalc would yield ${correctQty} ${match.unit || "pcs"}`,
          fixable: true,
          fix: {
            kind: "recalc_trim_qty",
            target_table: "trim_items",
            target_id: match.id,
            patch: {
              consumption_per_unit: tpQtyPerUnit,
              quantity_required: correctQty,
            },
          },
        });
      }
    }
  }

  // Accessory quantity sanity check — recalc from multiplier + wastage
  const poAcc = accessories.filter(
    (a) => (tp.po_id && a.po_id === tp.po_id) ||
           (tp.article_code && a.article_code === tp.article_code)
  );
  for (const acc of poAcc) {
    const mult = num(acc.multiplier) || 1;
    const wastage = num(acc.wastage_percent) || 0;
    const expected = Math.ceil(orderQty * mult * (1 + wastage / 100));
    const actual = num(acc.quantity_required);
    if (actual != null && expected !== actual && Math.abs(expected - actual) > 1) {
      findings.push({
        step: 3, step_label: AUDIT_STEPS.STEP_3,
        severity: SEVERITY.WARNING, check_type: "accessory",
        field_name: `${acc.category} · ${acc.item_description || "(no desc)"}`,
        techpack_value: `stored: ${actual}`,
        working_value: `should be: ${expected} (qty ${orderQty} × ${mult} × ${(1 + wastage / 100).toFixed(2)})`,
        message: "Accessory quantity doesn't match formula",
        fixable: true,
        fix: {
          kind: "recalc_accessory_qty",
          target_table: "accessory_items",
          target_id: acc.id,
          patch: { quantity_required: expected },
        },
      });
    }
  }

  return findings;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  STEP 4 — Size breakdown vs order quantity                                 */
/* ────────────────────────────────────────────────────────────────────────── */
function checkStep4(tp, articles, poItems) {
  const findings = [];
  const working = matchArticleToTP(tp, articles);
  if (!working) return findings;

  // TP side: extracted_data.measurements.size_breakdown (array of {size, qty})
  //          or extracted_data.sizes (array of strings)
  const d = tp.extracted_data || {};
  const breakdown = d.size_breakdown || d.measurements?.size_breakdown || null;

  if (Array.isArray(breakdown) && breakdown.length > 0) {
    const tpTotal = breakdown.reduce((s, b) => s + (num(b.qty) || 0), 0);
    const artQty = num(working.order_quantity);
    if (artQty != null && tpTotal !== artQty) {
      findings.push({
        step: 4, step_label: AUDIT_STEPS.STEP_4,
        severity: Math.abs(tpTotal - artQty) > artQty * 0.05 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
        check_type: "sizing",
        field_name: "size_breakdown_total",
        techpack_value: `${tpTotal} pcs (TP)`,
        working_value: `${artQty} pcs (article)`,
        message: "Sum of TP size breakdown doesn't match article order quantity",
        fixable: false, // Might be TP typo or article typo — manual
      });
    }
  }

  // Also check po_items for this PO if we have them
  if (poItems?.length && tp.po_id) {
    const itemsForPo = poItems.filter((i) => i.po_id === tp.po_id);
    const matchItem = itemsForPo.find(
      (i) => i.item_code === tp.article_code || i.item_description === tp.article_name
    );
    if (matchItem && num(matchItem.quantity) != null &&
        num(working.order_quantity) != null &&
        matchItem.quantity !== working.order_quantity) {
      findings.push({
        step: 4, step_label: AUDIT_STEPS.STEP_4,
        severity: SEVERITY.WARNING,
        check_type: "sizing",
        field_name: "po_item_vs_article_qty",
        techpack_value: `PO item: ${matchItem.quantity}`,
        working_value: `Article: ${working.order_quantity}`,
        message: "po_items quantity doesn't match articles.order_quantity",
        fixable: true,
        fix: {
          kind: "backfill_article_qty",
          target_table: "articles",
          target_id: working.id,
          patch: { order_quantity: matchItem.quantity },
        },
      });
    }
  }

  return findings;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  STEP 6 — Required fields populated                                        */
/*  Per user: fail if missing required. Required = article_code,              */
/*  at least one fabric spec, measurements.sizes non-empty.                   */
/* ────────────────────────────────────────────────────────────────────────── */
function checkStep6(tp) {
  const findings = [];
  const d = tp.extracted_data || {};

  if (!tp.article_code) {
    findings.push({
      step: 6, step_label: AUDIT_STEPS.STEP_6,
      severity: SEVERITY.CRITICAL, check_type: "required",
      field_name: "article_code",
      techpack_value: "(missing)",
      working_value: "required",
      message: "Tech pack has no article_code — cannot link to production data",
      fixable: true,
      fix: {
        kind: "backfill_tp_field",
        target_table: "tech_packs",
        target_id: tp.id,
        patch: null, // Requires user input — UI prompts
        requires_input: "article_code",
      },
    });
  }

  const fabrics = tp.extracted_fabric_specs || [];
  if (fabrics.length === 0) {
    findings.push({
      step: 6, step_label: AUDIT_STEPS.STEP_6,
      severity: SEVERITY.CRITICAL, check_type: "required",
      field_name: "fabric_specs",
      techpack_value: "(0 entries)",
      working_value: "≥1 required",
      message: "No fabric specs — tech pack is incomplete",
      fixable: false,
    });
  }

  const sizes = d.measurements?.sizes || d.sizes || [];
  if (!Array.isArray(sizes) || sizes.length === 0) {
    findings.push({
      step: 6, step_label: AUDIT_STEPS.STEP_6,
      severity: SEVERITY.WARNING, check_type: "required",
      field_name: "measurements.sizes",
      techpack_value: "(empty)",
      working_value: "≥1 size expected",
      message: "No size list — step 4 size-breakdown check will skip",
      fixable: false,
    });
  }

  return findings;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Public: run the full audit                                                */
/* ────────────────────────────────────────────────────────────────────────── */
export function runFullAudit({ tp, articles = [], trims = [], accessories = [], poItems = [] }) {
  const findings = [
    ...checkStep1(tp),
    ...checkStep2(tp, articles),
    ...checkStep3(tp, articles, trims, accessories),
    ...checkStep4(tp, articles, poItems),
    ...checkStep6(tp),
  ];

  const byStep = {};
  for (const f of findings) {
    byStep[f.step] = (byStep[f.step] || 0) + 1;
  }

  const summary = {
    total: findings.length,
    critical: findings.filter((f) => f.severity === SEVERITY.CRITICAL).length,
    warning: findings.filter((f) => f.severity === SEVERITY.WARNING).length,
    info: findings.filter((f) => f.severity === SEVERITY.INFO).length,
    fixable: findings.filter((f) => f.fixable).length,
    byStep,
  };

  // Master Data is the single source of truth for BOM; tech pack audit is reference-only.
  // UI should display findings with a "reference only" badge and never block PO creation.
  return { summary, findings, informational_mode: true };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Public: apply a single fix (returns promise from Supabase)                */
/*  UI bulk-fix button loops this over all fixable findings.                  */
/* ────────────────────────────────────────────────────────────────────────── */
export async function applyFix(fix, supabase) {
  if (!fix || !fix.target_table || !fix.target_id) {
    throw new Error("Invalid fix descriptor");
  }
  if (fix.requires_input && fix.patch == null) {
    throw new Error(`Fix requires input: ${fix.requires_input}`);
  }
  const { error } = await supabase
    .from(fix.target_table)
    .update(fix.patch)
    .eq("id", fix.target_id);
  if (error) throw error;
  return true;
}
