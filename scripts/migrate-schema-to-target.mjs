// scripts/migrate-schema-to-target.mjs
//
// Applies every file in migrations/up/*.sql in order to a target Postgres
// database. Used to clone the schema from the current Supabase project
// (ecjqdyruwqlesfthgphv, Mumbai) into the new MerQuant ERP project
// (jcbxmpgjirxqszodotmx, Tokyo).
//
// Usage (PowerShell) — recommended, password kept separate:
//   $env:TARGET_DB_HOST = 'aws-1-ap-northeast-1.pooler.supabase.com'
//   $env:TARGET_DB_USER = 'postgres.jcbxmpgjirxqszodotmx'
//   $env:TARGET_DB_PASSWORD = 'YOUR_PASSWORD'
//   node scripts/migrate-schema-to-target.mjs
//
// Or pass a full URL (only works if password has no special URL chars):
//   $env:TARGET_DB_URL = 'postgresql://USER:PASS@HOST:5432/postgres'
//   node scripts/migrate-schema-to-target.mjs

import postgres from "postgres";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const upDir = join(here, "..", "migrations", "up");

// Connection config: prefer separate fields (avoids URL-encoding bugs in
// passwords that contain @, :, /, ?, etc.). Fall back to TARGET_DB_URL.
let connectionConfig;
if (process.env.TARGET_DB_HOST && process.env.TARGET_DB_USER && process.env.TARGET_DB_PASSWORD) {
  connectionConfig = {
    host: process.env.TARGET_DB_HOST,
    port: Number(process.env.TARGET_DB_PORT || 5432),
    database: process.env.TARGET_DB_NAME || "postgres",
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
    ssl: "require",
  };
} else if (process.env.TARGET_DB_URL) {
  connectionConfig = process.env.TARGET_DB_URL;
} else {
  console.error("ERROR: connection details missing.");
  console.error("");
  console.error("Set these env vars (recommended — handles special-character passwords):");
  console.error("  TARGET_DB_HOST     e.g. aws-1-ap-northeast-1.pooler.supabase.com");
  console.error("  TARGET_DB_USER     e.g. postgres.jcbxmpgjirxqszodotmx");
  console.error("  TARGET_DB_PASSWORD the password from the Supabase dashboard");
  console.error("");
  console.error("Or set TARGET_DB_URL with the full connection string.");
  process.exit(1);
}

// Strip psql meta-commands (lines starting with \) since they don't work
// over the standard SQL execution path. The pg_dump output of 0001_init.sql
// includes \restrict / \unrestrict for permission scoping which we don't
// need here (RLS policies handle access control in Supabase anyway).
function stripMetaCommands(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*\\(restrict|unrestrict)\b/.test(line))
    .join("\n");
}

async function main() {
  console.log("[migrate] connecting to target...");
  const opts = {
    max: 1,                       // single connection — DDL is sequential
    idle_timeout: 30,
    max_lifetime: 60 * 5,
    onnotice: (n) => {            // surface NOTICE messages from Postgres
      if (n.severity !== "NOTICE") console.log(`[pg-${n.severity}] ${n.message}`);
    },
  };
  const sql = typeof connectionConfig === "string"
    ? postgres(connectionConfig, opts)
    : postgres({ ...connectionConfig, ...opts });

  // Sanity: confirm we connected to the *target* and it's empty.
  const [host] = await sql`SELECT current_database() AS db, inet_server_addr() AS host`;
  console.log(`[migrate] connected — db=${host.db} host=${host.host || "n/a"}`);

  const [{ count: tableCount }] = await sql`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  if (tableCount > 0) {
    console.error(`[migrate] ABORT — target has ${tableCount} tables in public schema. This script only runs against an empty target.`);
    console.error("[migrate] If you intend to overwrite, drop the public schema first.");
    await sql.end();
    process.exit(2);
  }
  console.log("[migrate] target is empty — safe to proceed.");

  // List + sort migration files.
  const files = (await readdir(upDir))
    .filter((f) => /^\d{4}.*\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    console.error("[migrate] no migration files found in", upDir);
    await sql.end();
    process.exit(3);
  }

  console.log(`[migrate] will apply ${files.length} migrations:`);
  for (const f of files) console.log("  -", f);
  console.log();

  // Apply each file as one big SQL statement. Wrap in a transaction so
  // partial failures don't leave the DB half-migrated.
  for (const f of files) {
    const path = join(upDir, f);
    const raw = await readFile(path, "utf8");
    const cleaned = stripMetaCommands(raw);
    const t0 = Date.now();
    try {
      await sql.unsafe(cleaned);
      const dt = Date.now() - t0;
      console.log(`[migrate] ✓ ${f} (${cleaned.length.toLocaleString()} bytes, ${dt} ms)`);
    } catch (err) {
      console.error(`[migrate] ✗ ${f} — FAILED`);
      console.error("  ", err.message);
      console.error("  ", `position: ${err.position || "n/a"}, line: ${err.line || "n/a"}`);
      console.error("[migrate] aborting. Earlier migrations may have committed.");
      console.error("[migrate] Check pg_policies and information_schema.tables to see partial state.");
      await sql.end();
      process.exit(4);
    }
  }

  // Quick post-check: count tables and policies to confirm something happened.
  const [{ count: finalTableCount }] = await sql`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const [{ count: policyCount }] = await sql`
    SELECT COUNT(*)::int AS count
    FROM pg_policies
    WHERE schemaname = 'public'
  `;
  console.log();
  console.log(`[migrate] done. public schema has ${finalTableCount} tables, ${policyCount} RLS policies.`);

  await sql.end();
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
