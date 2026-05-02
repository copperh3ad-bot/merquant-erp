import { readFileSync } from "node:fs";

const PROJECTS = {
  tokyo:  "jcbxmpgjirxqszodotmx",
  mumbai: "ecjqdyruwqlesfthgphv",
};

const target = process.argv[2];
const refs = target ? [PROJECTS[target]].filter(Boolean) : Object.values(PROJECTS);

const token = readFileSync(".supabase-token", "utf8").trim();
const sql = readFileSync("migrations/up/0014_storage_per_user_scoping.sql", "utf8");

for (const ref of refs) {
  const label = Object.entries(PROJECTS).find(([, v]) => v === ref)?.[0] ?? ref;
  console.log(`\nApplying 0014 → ${label} (${ref})…`);
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
