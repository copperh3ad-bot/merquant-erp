// One-off: parse the MFRM Stretch Cool Modal XLSX directly (no AI) to
// populate articles.components for PO 711167-001 with the correct
// per-part product_size + direction + component_type + fabric details
// the AI extraction missed.

import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import postgres from "postgres";

const TOKEN = readFileSync(".supabase-token", "utf8").trim();
const PROJECT = "ecjqdyruwqlesfthgphv";
const PO_NEEDLE = "%711167%";

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// Step 1 — parse the XLSX.
const buf = readFileSync("scripts/mfrm.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
const ws = wb.Sheets["SKU Fabric Consumption"];
if (!ws) throw new Error("'SKU Fabric Consumption' sheet not found");

const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
console.log(`Parsed ${rows.length} rows from SKU Fabric Consumption`);
console.log(`Sample headers: ${Object.keys(rows[0]).join(", ")}`);

// Group rows by item_code.
const byItemCode = new Map();
for (const r of rows) {
  const code = String(r.item_code || "").trim().toUpperCase();
  if (!code) continue;
  if (!byItemCode.has(code)) byItemCode.set(code, []);
  byItemCode.get(code).push({
    component_type: String(r.component_type || "").trim(),
    product_size:   String(r.product_size || "").trim(),
    direction:      String(r.direction || "").trim(),
    fabric_type:    String(r.fabric_type || "").trim(),
    construction:   String(r.construction || "").trim(),
    color:          String(r.color || "").trim(),
    gsm:            Number(r.gsm) || null,
    width_cm:       Number(r.width_cm || r.width) || null,
    consumption_per_unit: Number(r.consumption_per_unit) || 0,
    wastage_percent:      Number(r.wastage_percent) || 0.2,
  });
}
console.log(`Got ${byItemCode.size} distinct item_codes from XLSX`);

// Step 2 — fetch the 6 PO articles.
const articles = await sql(`
  SELECT id, article_code, order_quantity
  FROM public.articles
  WHERE po_number ILIKE '${PO_NEEDLE}' OR po_id IN (
    SELECT id FROM public.purchase_orders WHERE po_number ILIKE '${PO_NEEDLE}'
  )
  ORDER BY article_code
`);
console.log(`PO articles: ${articles.length}`);

// Step 3 — for each PO article, build a components array from the XLSX
// rows for that item_code, set product_size + direction + everything,
// and update.
let totalUpdated = 0;
for (const a of articles) {
  const xlsxRows = byItemCode.get(a.article_code);
  if (!xlsxRows) {
    console.log(`  ✗ ${a.article_code}: no XLSX rows`);
    continue;
  }
  const components = xlsxRows.map((r) => {
    const cpu = r.consumption_per_unit;
    const wast = r.wastage_percent;
    const net = cpu * (a.order_quantity || 0);
    return {
      component_type:       r.component_type,
      kind:                 "fabric",
      fabric_type:          r.fabric_type,
      gsm:                  r.gsm,
      width:                r.width_cm,
      color:                r.color,
      construction:         r.construction,
      product_size:         r.product_size,
      direction:            r.direction,
      dimensions:           r.product_size,    // also surface as Layer-0 dimension override
      consumption_per_unit: cpu,
      wastage_percent:      wast,
      net_total:            +net.toFixed(4),
      total_required:       +(net * (1 + wast / 100)).toFixed(4),
    };
  });
  const totalReq = +components.reduce((s, c) => s + (c.total_required || 0), 0).toFixed(4);
  const escaped = JSON.stringify(components).replaceAll("'", "''");
  await sql(`
    UPDATE public.articles
    SET components = '${escaped}'::jsonb,
        total_fabric_required = ${totalReq}
    WHERE id = '${a.id}'
  `);
  console.log(`  ✓ ${a.article_code}: ${components.length} components, total ${totalReq} m`);
  totalUpdated++;
}

console.log(`\nDone. Updated ${totalUpdated} / ${articles.length} articles.`);
