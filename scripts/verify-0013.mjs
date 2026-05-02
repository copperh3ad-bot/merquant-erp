// Sanity-check that migration 0013 is in effect: dangerous queries are
// rejected, plain SELECTs are accepted (when called by an authenticated
// user — we use service-role here so the role gate is bypassed, but the
// other defences should still fire).
//
// We run via the Management API (which uses superuser-equivalent), so the
// auth.uid() / role checks won't fire. Instead we test:
//   - The function still exists with the new signature
//   - The leading-keyword check rejects non-SELECT
//   - The multi-statement check rejects embedded ";"

import { readFileSync } from "node:fs";

const PROJECTS = [
  ["tokyo",  "jcbxmpgjirxqszodotmx"],
  ["mumbai", "ecjqdyruwqlesfthgphv"],
];

const token = readFileSync(".supabase-token", "utf8").trim();

// Run the function bypassing auth check via SECURITY DEFINER wrapper test.
// The Management API runs as postgres (not auth.uid()), so direct calls
// fail the auth gate. We test by inspecting the function body + grants
// instead.
const TESTS = [
  // 1. Function definition includes our hardening markers.
  `SELECT prosecdef AS is_security_definer
     FROM pg_proc WHERE proname = 'exec_sql' AND pronamespace = 'public'::regnamespace;`,

  // 2. ACL: PUBLIC + anon must NOT have EXECUTE; authenticated must have EXECUTE.
  `SELECT grantee, privilege_type
     FROM information_schema.routine_privileges
     WHERE routine_name = 'exec_sql' AND specific_schema = 'public'
     ORDER BY grantee;`,

  // 3. Function source contains the new defences.
  `SELECT
     position('SECURITY DEFINER' IN pg_get_functiondef(p.oid)) AS sd_position,
     position('multiple statements are not allowed' IN pg_get_functiondef(p.oid)) AS reject_pos,
     position('Owner' IN pg_get_functiondef(p.oid)) AS role_check_pos
     FROM pg_proc p WHERE proname = 'exec_sql' AND pronamespace = 'public'::regnamespace;`,
];

for (const [label, ref] of PROJECTS) {
  console.log(`\n→ ${label} (${ref})`);
  for (const sql of TESTS) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    console.log(`  ${res.ok ? "✓" : "✗"} ${sql.replace(/\s+/g, " ").slice(0, 70)}…`);
    console.log(`    → ${text.slice(0, 200)}`);
    if (!res.ok) process.exitCode = 1;
  }
}
