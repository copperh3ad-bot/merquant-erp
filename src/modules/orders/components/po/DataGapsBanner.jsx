// DataGapsBanner — async completeness check for a PO.
//
// Runs on mount and checks three things:
//   1. Missing unit prices (po_items WHERE unit_price = 0 or null)
//   2. Missing consumption library entries (po_items whose item_code has no
//      consumption_library row)
//   3. Missing supplier name on the PO
//
// Non-blocking: the banner renders independently from the main PO form.
// If any Supabase call fails, the banner is silently hidden.
// Feature-flagged: parent checks ENABLE_DATA_GAPS_BANNER() before rendering.

import React, { useEffect, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { AlertTriangle, X } from "lucide-react";

export default function DataGapsBanner({ po, poId }) {
  const [gaps, setGaps]       = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!poId) return;
    let cancelled = false;

    async function check() {
      try {
        const found = [];

        // 1. PO items with missing or zero unit price
        const { data: missingPriceItems } = await supabase
          .from("po_items")
          .select("item_code")
          .eq("po_id", poId)
          .or("unit_price.is.null,unit_price.eq.0");

        if (!cancelled && missingPriceItems?.length > 0) {
          found.push({
            key: "missing_price",
            level: "warning",
            text: `${missingPriceItems.length} line item(s) have no unit price — costing sheet will be incomplete.`,
          });
        }

        // 2. PO items whose item_code has no consumption library entry
        const { data: allItems } = await supabase
          .from("po_items")
          .select("item_code")
          .eq("po_id", poId);

        if (!cancelled && allItems?.length > 0) {
          const codes = [...new Set(allItems.map(i => i.item_code?.trim()).filter(Boolean))];
          if (codes.length > 0) {
            const { data: clRows } = await supabase
              .from("consumption_library")
              .select("item_code")
              .in("item_code", codes);
            const found_codes = new Set((clRows || []).map(r => r.item_code?.trim()));
            const missing = codes.filter(c => !found_codes.has(c));
            if (missing.length > 0 && !cancelled) {
              found.push({
                key: "missing_consumption",
                level: "warning",
                text: `${missing.length} SKU(s) missing from Consumption Library — BOM explosion will be blocked: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` +${missing.length - 3} more` : ""}.`,
              });
            }
          }
        }

        // 3. Missing supplier name
        if (!cancelled && po && !po.supplier_name && !po.ship_to_name) {
          found.push({
            key: "missing_supplier",
            level: "info",
            text: "No supplier / ship-to name set on this PO.",
          });
        }

        if (!cancelled) {
          setGaps(found);
          setChecked(true);
        }
      } catch {
        // Silently hide on any error — never block the PO form
        if (!cancelled) setChecked(true);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [poId, po]);

  if (!checked || dismissed || gaps.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-800">Data gaps detected</div>
            {gaps.map(g => (
              <div key={g.key} className="text-xs text-amber-800">{g.text}</div>
            ))}
          </div>
        </div>
        <button
          className="shrink-0 text-amber-500 hover:text-amber-700"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
