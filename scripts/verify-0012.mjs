// Sanity-check that migration 0012 applied correctly: helpers exist and
// behave as expected, and explode_po_bom signature is callable.

import { readFileSync } from "node:fs";

const PROJECTS = [
  ["tokyo",  "jcbxmpgjirxqszodotmx"],
  ["mumbai", "ecjqdyruwqlesfthgphv"],
];

const token = readFileSync(".supabase-token", "utf8").trim();

const TESTS = [
  // Helpers exist and pick first non-empty
  `SELECT public.jsonb_first_text(
    '{"a": null, "b": "", "c": "  ", "d": "hit"}'::jsonb,
    'a','b','c','d'
  ) AS got;`,
  `SELECT public.jsonb_first_numeric(
    '{"a": "not a number", "b": "", "c": "1.5"}'::jsonb,
    'a','b','c'
  ) AS got;`,
  // explode_po_bom signature exists
  `SELECT pg_get_functiondef('public.explode_po_bom(uuid, boolean)'::regprocedure) IS NOT NULL AS exists;`,
];

for (const [label, ref] of PROJECTS) {
  console.log(`\n→ ${label} (${ref})`);
  for (const sql of TESTS) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const out = await res.text();
    console.log(`  ${res.ok ? "✓" : "✗"} ${sql.replace(/\s+/g, " ").slice(0, 80)}…  → ${out.slice(0, 80)}`);
    if (!res.ok) process.exitCode = 1;
  }
}
