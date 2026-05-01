// Applies every cleaned migration in scripts/clean-migrations-tmp/ to the
// target Supabase project via the Management API. Reads token from
// .supabase-token in the project root.
//
// Usage: node scripts/apply-migrations-via-api.mjs <project-ref>

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const projectRef = process.argv[2];
if (!projectRef) {
  console.error("Usage: node scripts/apply-migrations-via-api.mjs <project-ref>");
  process.exit(1);
}

const token = readFileSync(".supabase-token", "utf8").trim();
if (!token.startsWith("sbp_")) {
  console.error("Token in .supabase-token doesn't look right (should start sbp_)");
  process.exit(2);
}

const dir = "scripts/clean-migrations-tmp";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

console.log(`Applying ${files.length} migrations to project ${projectRef}\n`);

let totalKB = 0;
for (const f of files) {
  const path = join(dir, f);
  const sql = readFileSync(path, "utf8");
  const kb = (sql.length / 1024).toFixed(1);
  totalKB += sql.length / 1024;

  process.stdout.write(`[${f}] ${kb} KB ... `);

  const t0 = Date.now();
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const dt = Date.now() - t0;

  const body = await res.text();
  if (!res.ok) {
    console.log(`✗ FAIL (${res.status}, ${dt} ms)`);
    console.log("  Response:", body.slice(0, 800));
    process.exit(3);
  }
  console.log(`✓ ${dt} ms`);
}

console.log(`\nDone. Applied ${files.length} files, ${totalKB.toFixed(1)} KB total.`);
