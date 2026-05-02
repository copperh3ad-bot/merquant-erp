// One-off applier for migration 0013 — harden exec_sql.
// Pattern mirrors apply-0012.mjs.

import { readFileSync } from "node:fs";

const PROJECTS = {
  tokyo:  "jcbxmpgjirxqszodotmx",
  mumbai: "ecjqdyruwqlesfthgphv",
};

const target = process.argv[2];
const refs = target ? [PROJECTS[target]].filter(Boolean) : Object.values(PROJECTS);
if (refs.length === 0) {
  console.error("Unknown target. Use 'tokyo', 'mumbai', or omit for both.");
  process.exit(1);
}

const token = readFileSync(".supabase-token", "utf8").trim();
const sql = readFileSync("migrations/up/0013_harden_exec_sql.sql", "utf8");

for (const ref of refs) {
  const label = Object.entries(PROJECTS).find(([, v]) => v === ref)?.[0] ?? ref;
  console.log(`\nApplying 0013 → ${label} (${ref})…`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
