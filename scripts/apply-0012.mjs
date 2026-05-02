// One-off applier for migration 0012 — explode_po_bom field fallbacks.
// Reads .supabase-token, posts the SQL via Management API to BOTH Tokyo
// (parent ERP) and Mumbai (MAS) so both projects pick up the fix.
//
// Usage:
//   node scripts/apply-0012.mjs           # apply to both
//   node scripts/apply-0012.mjs tokyo     # apply to Tokyo only
//   node scripts/apply-0012.mjs mumbai    # apply to Mumbai only

import { readFileSync } from "node:fs";

const PROJECTS = {
  tokyo:  "jcbxmpgjirxqszodotmx",   // parent ERP
  mumbai: "ecjqdyruwqlesfthgphv",   // MAS
};

const target = process.argv[2];
const refs = target ? [PROJECTS[target]].filter(Boolean) : Object.values(PROJECTS);
if (refs.length === 0) {
  console.error("Unknown target. Use 'tokyo', 'mumbai', or omit for both.");
  process.exit(1);
}

const token = readFileSync(".supabase-token", "utf8").trim();
if (!token.startsWith("sbp_")) {
  console.error("Token in .supabase-token doesn't look right (should start sbp_)");
  process.exit(2);
}

const sql = readFileSync("migrations/up/0012_explode_po_bom_field_fallbacks.sql", "utf8");

for (const ref of refs) {
  const label = Object.entries(PROJECTS).find(([, v]) => v === ref)?.[0] ?? ref;
  console.log(`\nApplying 0012 → ${label} (${ref})…`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`  FAILED (${res.status}): ${text}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`  ✓ applied (${text.length} bytes returned)`);
}
