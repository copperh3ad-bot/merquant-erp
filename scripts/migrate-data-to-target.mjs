// scripts/migrate-data-to-target.mjs
//
// Copies row data from the source Supabase project to the target via the
// Management API SQL endpoint. Uses a JSON-roundtrip approach: select rows
// as JSON on source, insert via jsonb_populate_recordset on target.
//
// SKIPS user-FK'd tables (user_profiles, user_settings, gmail_oauth) and
// audit_log — system is in development, no production users to migrate.
// User signs up fresh on the new project after cutover.
//
// Disables user triggers per-table during INSERT to avoid:
//   - audit_log spam from this bulk load
//   - duplicate triggered side effects
//
// Usage: node scripts/migrate-data-to-target.mjs

import { readFileSync } from "node:fs";

const SOURCE = "ecjqdyruwqlesfthgphv";
const TARGET = "jcbxmpgjirxqszodotmx";

const TOKEN = readFileSync(".supabase-token", "utf8").trim();

// Tables with data + their primary keys (used for ordering and verification).
// Order: independent → dependent. With no FK constraints between them this
// is just nice-to-have, but it makes verification clearer.
const TABLES = [
  "seasons",
  "teams",
  "signup_whitelist",
  "tna_templates",
  "production_lines",
  "production_stages",
  "suppliers",
  "price_list",
  "consumption_library",
  "purchase_orders",
  "po_items",
  "po_item_sizes",
  "tech_packs",
  "articles",
  "ai_extractions",
  "status_logs",
  // Explicitly skipped:
  //   user_profiles, user_settings, gmail_oauth (FK to auth.users)
  //   audit_log (history-only)
  //   _pre_cleanup_backup (leftover backup table)
];

async function runSql(projectRef, query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SQL on ${projectRef} failed (${res.status}): ${text.slice(0, 600)}`);
  }
  try { return JSON.parse(text); }
  catch { return text; }
}

async function migrateTable(name) {
  // 1. Count rows on source.
  const [{ c: srcCount }] = await runSql(SOURCE, `SELECT COUNT(*)::int AS c FROM public.${name}`);
  if (srcCount === 0) {
    console.log(`[${name}] empty — skip`);
    return { name, src: 0, tgt: 0 };
  }
  process.stdout.write(`[${name}] ${srcCount} rows ... `);

  // 2. Fetch rows as JSON array.
  const rows = await runSql(SOURCE, `SELECT * FROM public.${name}`);

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("(no rows returned, skipping)");
    return { name, src: srcCount, tgt: 0, error: "no rows returned" };
  }

  // 3. Insert into target. We use a single INSERT FROM jsonb_populate_recordset
  //    so types coerce cleanly (UUIDs, JSONB columns, timestamps, arrays).
  //    Triggers are disabled during the load to avoid audit-log noise.
  const json = JSON.stringify(rows);
  const escaped = json.replaceAll("'", "''"); // PG single-quote escape

  const insertSql = `
    BEGIN;
    ALTER TABLE public.${name} DISABLE TRIGGER USER;
    INSERT INTO public.${name}
    SELECT * FROM jsonb_populate_recordset(NULL::public.${name}, '${escaped}'::jsonb);
    ALTER TABLE public.${name} ENABLE TRIGGER USER;
    COMMIT;
  `;

  const t0 = Date.now();
  try {
    await runSql(TARGET, insertSql);
  } catch (e) {
    console.log(`✗ ${e.message.slice(0, 200)}`);
    return { name, src: srcCount, tgt: 0, error: e.message };
  }
  const dt = Date.now() - t0;

  // 4. Confirm count on target.
  const [{ c: tgtCount }] = await runSql(TARGET, `SELECT COUNT(*)::int AS c FROM public.${name}`);
  const ok = tgtCount === srcCount;
  console.log(`${ok ? "✓" : "⚠"} ${tgtCount}/${srcCount} (${dt} ms)`);
  return { name, src: srcCount, tgt: tgtCount };
}

async function main() {
  console.log(`Migrating data: ${SOURCE} → ${TARGET}\n`);

  const results = [];
  for (const t of TABLES) {
    try {
      results.push(await migrateTable(t));
    } catch (e) {
      console.log(`[${t}] FATAL: ${e.message.slice(0, 300)}`);
      results.push({ name: t, error: e.message });
    }
  }

  console.log("\n=== Summary ===");
  let okCount = 0;
  let mismatch = 0;
  let errors = 0;
  for (const r of results) {
    if (r.error) { errors++; continue; }
    if (r.tgt === r.src) okCount++;
    else mismatch++;
  }
  console.log(`Tables ok: ${okCount}, mismatched: ${mismatch}, errors: ${errors}`);
  if (mismatch > 0 || errors > 0) {
    console.log("\nProblems:");
    for (const r of results) {
      if (r.error) console.log(`  ${r.name}: ${r.error.slice(0, 200)}`);
      else if (r.tgt !== r.src) console.log(`  ${r.name}: ${r.tgt}/${r.src}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
