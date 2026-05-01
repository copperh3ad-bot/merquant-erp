// Applies migration 0009 to both Supabase projects via Management API.

import { readFileSync } from "node:fs";

const TOKEN = readFileSync(".supabase-token", "utf8").trim();
const sql = readFileSync("scripts/clean-migrations-tmp/0009_fix_price_list_pricing_status_cast.sql", "utf8");

for (const ref of ["ecjqdyruwqlesfthgphv", "jcbxmpgjirxqszodotmx"]) {
  process.stdout.write(`Applying to ${ref}... `);
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (res.ok) {
    console.log("✓ done");
  } else {
    console.log(`✗ ${res.status}`);
    console.log("  ", body.slice(0, 400));
  }
}
