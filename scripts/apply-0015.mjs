// Apply migration 0015 + set GMAIL_TOKEN_KEY secret on both projects.
// Generates a fresh 32-byte hex passphrase if --regenerate is passed,
// otherwise reuses an existing key from GMAIL_TOKEN_KEY env var.
//
// IMPORTANT: existing gmail_oauth rows will keep their plaintext
// refresh_token column populated until the edge functions are updated
// to encrypt-on-write. Re-running won't lose data — the encrypted
// columns are added without dropping the plaintext ones.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const PROJECTS = {
  tokyo:  "jcbxmpgjirxqszodotmx",
  mumbai: "ecjqdyruwqlesfthgphv",
};

const args = new Set(process.argv.slice(2));
const regenerate = args.has("--regenerate");
const targetArg = [...args].find((a) => !a.startsWith("--"));
const refs = targetArg ? [PROJECTS[targetArg]].filter(Boolean) : Object.values(PROJECTS);

const token = readFileSync(".supabase-token", "utf8").trim();
const sql = readFileSync("migrations/up/0015_encrypt_gmail_refresh_token.sql", "utf8");

const key = regenerate || !process.env.GMAIL_TOKEN_KEY
  ? randomBytes(32).toString("hex")
  : process.env.GMAIL_TOKEN_KEY;

if (regenerate) {
  console.log(`\nGenerated new GMAIL_TOKEN_KEY: ${key}`);
  console.log(`(Save this somewhere safe — you'll need it to re-deploy edge functions.)\n`);
}

for (const ref of refs) {
  const label = Object.entries(PROJECTS).find(([, v]) => v === ref)?.[0] ?? ref;
  console.log(`\n→ ${label} (${ref})`);

  // 1. Apply the migration SQL
  console.log(`  Applying 0015 migration…`);
  const sqlRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!sqlRes.ok) {
    console.error(`  ✗ migration failed: ${await sqlRes.text()}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`  ✓ migration applied`);

  // 2. Set the GMAIL_TOKEN_KEY secret
  console.log(`  Setting GMAIL_TOKEN_KEY secret…`);
  const secRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ name: "GMAIL_TOKEN_KEY", value: key }]),
  });
  if (!secRes.ok) {
    console.error(`  ✗ secret set failed: ${await secRes.text()}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`  ✓ secret set`);
}

if (!regenerate) {
  console.log(`\nNote: GMAIL_TOKEN_KEY value applied to projects.`);
  console.log(`If you didn't pass --regenerate and didn't have GMAIL_TOKEN_KEY in env,`);
  console.log(`a fresh key was generated for this run. Re-run with --regenerate to roll the key.`);
}
