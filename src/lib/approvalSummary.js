// Formats the JSONB summary returned by fn_approve_po_with_automation
// (migration 0029) into a single multi-line string for alert() display.
//
// The RPC shape:
//   {
//     approval_status: 'approved',
//     po_id, po_number,
//     costing_succeeded, costing_skipped, costing_failed,
//     tna_status: 'created' | 'skipped:exists' | 'skipped:no_default'
//                 | 'skipped:no_ship_date' | 'failed',
//     warnings: [{ article_id?, article_code?, reason: '...' }, ...]
//   }
//
// This module is pure so it can be unit-tested without spinning up the
// React tree.

const TNA_STATUS_LABEL = {
  created: "T&A calendar generated",
  "skipped:exists": "T&A calendar already existed (skipped)",
  "skipped:no_default": "T&A calendar skipped — no default template configured",
  "skipped:no_ship_date": "T&A calendar skipped — PO has no ship-by date",
  failed: "T&A calendar failed to generate",
};

export function formatApprovalSummary(result) {
  if (!result || typeof result !== "object") {
    return "PO approved.";
  }
  const lines = [`PO ${result.po_number || ""} approved.`.trim()];

  const succeeded = Number(result.costing_succeeded || 0);
  const skipped   = Number(result.costing_skipped   || 0);
  const failed    = Number(result.costing_failed    || 0);
  const parts = [];
  if (succeeded) parts.push(`${succeeded} costing sheet${succeeded === 1 ? "" : "s"} created`);
  if (skipped)   parts.push(`${skipped} skipped (already existed)`);
  if (failed)    parts.push(`${failed} failed`);
  if (parts.length === 0) parts.push("no costing sheets to create");
  lines.push(`Costing: ${parts.join(", ")}.`);

  const tnaLabel = TNA_STATUS_LABEL[result.tna_status] || `T&A: ${result.tna_status || "unknown"}`;
  lines.push(tnaLabel + ".");

  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  if (warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of warnings) {
      const tag = w.article_code ? `  • [${w.article_code}] ` : "  • ";
      lines.push(`${tag}${w.reason || "(no reason given)"}`);
    }
  }
  return lines.join("\n");
}
