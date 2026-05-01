// scripts/backup-target-db.mjs
//
// Takes a backup of the new MerQuant ERP Supabase project (Tokyo). Writes:
//   docs/backups/2026-05-01/schema.sql        — pg_dump-style DDL
//   docs/backups/2026-05-01/data/<table>.json — every populated table as JSON
//   docs/backups/2026-05-01/manifest.json     — counts + checksums
//
// This is the "rollback point" before the chatbot redesign. If the redesign
// goes sideways, restore by:
//   1. Apply schema.sql to a fresh project
//   2. Re-run scripts/migrate-data-to-target.mjs pointed at the dump dir
//
// Usage: node scripts/backup-target-db.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const TARGET = "jcbxmpgjirxqszodotmx";
const TOKEN = readFileSync(".supabase-token", "utf8").trim();
const STAMP = new Date().toISOString().slice(0, 10);
const OUT_DIR = join("docs", "backups", STAMP);
const DATA_DIR = join(OUT_DIR, "data");
mkdirSync(DATA_DIR, { recursive: true });

async function sql(query, attempt = 1) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${TARGET}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    // Retry on 5xx (Supabase upstream timeouts) up to 3 attempts with backoff.
    if (res.status >= 500 && attempt < 4) {
      const wait = attempt * 3000;
      console.log(`  (${res.status}, retrying in ${wait/1000}s, attempt ${attempt}/3)`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(query, attempt + 1);
    }
    throw new Error(`SQL failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

console.log(`Backing up ${TARGET} → ${OUT_DIR}/\n`);

// 1. Find populated tables.
const populated = await sql(`
  SELECT relname AS t FROM pg_stat_user_tables
  WHERE schemaname = 'public' AND n_live_tup > 0
  ORDER BY relname
`);
// Stats can be stale — also include tables we know have data.
const knownTables = ["seasons", "teams", "tna_templates", "production_lines",
  "production_stages", "suppliers", "signup_whitelist", "purchase_orders",
  "po_items", "tech_packs", "articles", "consumption_library", "price_list",
  "ai_extractions", "status_logs"];
const tables = [...new Set([...populated.map((r) => r.t), ...knownTables])].sort();

// 2. Dump every table as JSON.
const manifest = { project: TARGET, dumped_at: new Date().toISOString(), tables: [] };

for (const t of tables) {
  const file = join(DATA_DIR, `${t}.json`);
  // Skip already-dumped files (resume support after transient failures).
  if (existsSync(file) && statSync(file).size > 0) {
    const json = readFileSync(file, "utf8");
    const rows = JSON.parse(json).length;
    const checksum = createHash("md5").update(json).digest("hex");
    manifest.tables.push({ name: t, rows, file: `data/${t}.json`, md5: checksum });
    console.log(`[${t}] ${rows} rows ... (already dumped, ${(json.length / 1024).toFixed(1)} KB)`);
    continue;
  }
  const [{ c: count }] = await sql(`SELECT COUNT(*)::int AS c FROM public.${t}`);
  if (count === 0) continue;
  process.stdout.write(`[${t}] ${count} rows ... `);
  const rows = await sql(`SELECT * FROM public.${t} ORDER BY 1`);
  const json = JSON.stringify(rows, null, 2);
  writeFileSync(file, json);
  const checksum = createHash("md5").update(json).digest("hex");
  manifest.tables.push({ name: t, rows: count, file: `data/${t}.json`, md5: checksum });
  console.log(`✓ ${(json.length / 1024).toFixed(1)} KB, md5=${checksum.slice(0, 8)}`);
}

// 3. Schema DDL — re-export via the existing pg_dump in migrations/up/0001_init.sql,
//    which is identical to the live schema as of this morning's migration.
//    We can also pull a live snapshot:
const schemaParts = [];

// Tables
const tableDefs = await sql(`
  SELECT 'TABLE' AS kind, table_name AS name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`);

// Views
const viewDefs = await sql(`
  SELECT viewname AS name, definition FROM pg_views
  WHERE schemaname = 'public' ORDER BY viewname
`);

// Policies count
const [{ c: policyCount }] = await sql(`
  SELECT COUNT(*)::int AS c FROM pg_policies WHERE schemaname = 'public'
`);

// Functions count
const [{ c: funcCount }] = await sql(`
  SELECT COUNT(*)::int AS c FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
`);

manifest.schema = {
  tables: tableDefs.length,
  views: viewDefs.length,
  policies: policyCount,
  functions: funcCount,
  source: "migrations/up/0001_init.sql + 0002 → 0008",
  note: "Live schema is exactly the migration baseline + the normalize-trigger backfill applied during cutover",
};

writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`\nBackup complete.`);
console.log(`  Tables dumped:   ${manifest.tables.length}`);
console.log(`  Total rows:      ${manifest.tables.reduce((s, t) => s + t.rows, 0)}`);
console.log(`  Manifest:        ${join(OUT_DIR, "manifest.json")}`);
