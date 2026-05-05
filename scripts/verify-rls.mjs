#!/usr/bin/env node
// scripts/verify-rls.mjs
//
// Per-role × per-table × per-command RLS verifier for Finding 5.
//
// What it does
// ────────────
// 1. Signs in as four pre-seeded test users — one per role we care
//    about: Owner, Manager, Merchandiser, QC Inspector. (Viewer and
//    Supplier roles are intentionally NOT tested — Viewer is being
//    eliminated by 0018; Supplier scoping is deferred.)
// 2. For each role × each table × each command (S/I/U/D), runs a probe
//    query and classifies allow/deny.
// 3. Compares classification against the expected matrix encoded
//    below, prints a green/red grid, exits 0 on all-pass / 1 on any
//    fail.
//
// Probe strategy
// ──────────────
// Read probes (SELECT) work by counting rows visible to the role
// versus rows visible to the service role for the same table:
//   • role count == service count and service count > 0 → allowed
//   • role count == 0 and service count > 0            → denied
//   • service count == 0                               → can't tell;
//     reported as 'unknown' (empty table). Seed a row in the target
//     project to convert to a definitive answer.
//
// Write probes (INSERT/UPDATE/DELETE) try the operation and look at
// the resulting error code:
//   • PostgREST 42501 (RLS violation)                  → denied
//   • no error, OR a NOT NULL / FK / CHECK violation   → allowed
//     (RLS let the row through; the failure is a different layer).
// UPDATE/DELETE probes target a sentinel UUID that doesn't exist in
// the table; if the role were allowed, the operation succeeds with
// 0 rows. If RLS denies, PostgREST returns a 42501 error.
//   ⚠ Caveat: a permissive UPDATE/DELETE policy whose USING/WITH
//     CHECK silently filters rows (returns 0 instead of 42501) shows
//     as "allowed" in this probe. The migrations in this branch all
//     use binary `public.has_role(...)` checks, so a denied role
//     hits 42501 reliably.
//
// Required env (read from process.env or a .env.verify file):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   RLS_TEST_OWNER_EMAIL,        RLS_TEST_OWNER_PASSWORD
//   RLS_TEST_MANAGER_EMAIL,      RLS_TEST_MANAGER_PASSWORD
//   RLS_TEST_MERCHANDISER_EMAIL, RLS_TEST_MERCHANDISER_PASSWORD
//   RLS_TEST_QC_EMAIL,           RLS_TEST_QC_PASSWORD
//
// IMPORTANT — never point this at production. The script signs in as
// real test users and probes 50+ tables; running against prod will
// log activity in audit/log tables. Use a non-prod project.
//
// Usage:
//   node scripts/verify-rls.mjs                 # run full matrix
//   node scripts/verify-rls.mjs --tables=foo,bar # restrict to subset
//   node scripts/verify-rls.mjs --roles=Owner   # restrict to roles
//   node scripts/verify-rls.mjs --quiet         # only print failures

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

// ─── env loading ─────────────────────────────────────────────────────
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}
loadDotEnv(".env.verify");

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const required = { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY };
for (const [k, v] of Object.entries(required)) {
  if (!v) {
    console.error(`Missing required env: ${k}`);
    process.exit(2);
  }
}

const ROLE_USERS = {
  Owner: {
    email:    process.env.RLS_TEST_OWNER_EMAIL,
    password: process.env.RLS_TEST_OWNER_PASSWORD,
  },
  Manager: {
    email:    process.env.RLS_TEST_MANAGER_EMAIL,
    password: process.env.RLS_TEST_MANAGER_PASSWORD,
  },
  Merchandiser: {
    email:    process.env.RLS_TEST_MERCHANDISER_EMAIL,
    password: process.env.RLS_TEST_MERCHANDISER_PASSWORD,
  },
  "QC Inspector": {
    email:    process.env.RLS_TEST_QC_EMAIL,
    password: process.env.RLS_TEST_QC_PASSWORD,
  },
};

// ─── arg parsing ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argTables = (args.find((a) => a.startsWith("--tables="))?.split("=")[1] ?? "")
  .split(",").filter(Boolean);
const argRoles = (args.find((a) => a.startsWith("--roles="))?.split("=")[1] ?? "")
  .split(",").filter(Boolean);
const QUIET = args.includes("--quiet");

// ─── matrix ──────────────────────────────────────────────────────────
// expected[role][table] = { S: bool, I: bool, U: bool, D: bool }
//
// Allow lists derived from migrations 0011-0017:
//   Group A (master_reference): SELECT=auth, INS/UPD=O+M, DEL=O
//   Group B (transactional):    SELECT=auth, INS/UPD=O+M+Mer, DEL=O
//   Group B narrow:             lab_dips, samples — INS/UPD=O+M
//   Group C (production):       SELECT=auth, INS/UPD=O+M+Mer, DEL=O
//   Group C qc_inspections:     INS/UPD=O+M+QC
//   Group D (financial):        SELECT/INS/UPD=O+M, DEL=O
//   Group E (audit):            SELECT=O+M; INS varies; UPD denied;
//                               DEL=O
//   Group G (user_settings):    own row only + Owner override

const GROUP_A = [
  "master_articles", "accessory_templates", "fabric_templates",
  "tna_templates", "seasons", "teams", "customer_team_assignments",
  "app_users", "buyer_contacts", "suppliers", "supplier_performance",
  "compliance_docs",
];

const GROUP_B = [
  "purchase_orders", "po_items", "po_batches", "po_change_log",
  "articles", "article_packaging", "tech_packs", "sku_review_queue",
  "quotations", "quotation_items", "rfqs", "complaints",
  "crosscheck_discrepancies", "tna_calendars", "tna_milestones",
  "style_consumption", "print_layouts",
];

const GROUP_B_NARROW = ["lab_dips", "samples"];

const GROUP_C = [
  "job_cards", "job_card_steps", "batch_items", "batch_split_snapshots",
  "fabric_orders", "accessory_items", "accessory_purchase_orders",
  "trim_items", "yarn_requirements", "shipments", "packing_lists",
  "rm_stock",
];

const GROUP_C_QC = ["qc_inspections"];

const GROUP_D = [
  "payments", "commercial_invoices", "costing_sheets",
  "shipping_documents", "shipping_doc_register", "sample_invoices",
];

// audit/log tables — INSERT allow-lists vary; encoded individually
const GROUP_E_OPEN_INSERT = ["status_logs", "comms_log", "permission_denials"];
const GROUP_E_OM_MER_INSERT = ["master_article_changes", "bom_explosion_log"];
const GROUP_E_OM_INSERT = ["gcal_sync_log", "email_crawl_log", "whatsapp_crawl"];

// build the matrix
function row(S, I, U, D) { return { S, I, U, D }; }
const expected = {
  Owner: {}, Manager: {}, Merchandiser: {}, "QC Inspector": {},
};

for (const t of GROUP_A) {
  expected.Owner[t]          = row(true,  true,  true,  true);
  expected.Manager[t]        = row(true,  true,  true,  false);
  expected.Merchandiser[t]   = row(true,  false, false, false);
  expected["QC Inspector"][t]= row(true,  false, false, false);
}
for (const t of GROUP_B) {
  expected.Owner[t]          = row(true,  true,  true,  true);
  expected.Manager[t]        = row(true,  true,  true,  false);
  expected.Merchandiser[t]   = row(true,  true,  true,  false);
  expected["QC Inspector"][t]= row(true,  false, false, false);
}
for (const t of GROUP_B_NARROW) {
  expected.Owner[t]          = row(true,  true,  true,  true);
  expected.Manager[t]        = row(true,  true,  true,  false);
  expected.Merchandiser[t]   = row(true,  false, false, false);
  expected["QC Inspector"][t]= row(true,  false, false, false);
}
for (const t of GROUP_C) {
  expected.Owner[t]          = row(true,  true,  true,  true);
  expected.Manager[t]        = row(true,  true,  true,  false);
  expected.Merchandiser[t]   = row(true,  true,  true,  false);
  expected["QC Inspector"][t]= row(true,  false, false, false);
}
for (const t of GROUP_C_QC) {
  expected.Owner[t]          = row(true,  true,  true,  true);
  expected.Manager[t]        = row(true,  true,  true,  false);
  expected.Merchandiser[t]   = row(true,  false, false, false);
  expected["QC Inspector"][t]= row(true,  true,  true,  false);
}
for (const t of GROUP_D) {
  expected.Owner[t]          = row(true,  true,  true,  true);
  expected.Manager[t]        = row(true,  true,  true,  false);
  expected.Merchandiser[t]   = row(false, false, false, false);
  expected["QC Inspector"][t]= row(false, false, false, false);
}
for (const t of GROUP_E_OPEN_INSERT) {
  expected.Owner[t]          = row(true,  true,  false, true);
  expected.Manager[t]        = row(true,  true,  false, false);
  expected.Merchandiser[t]   = row(false, true,  false, false);
  expected["QC Inspector"][t]= row(false, true,  false, false);
}
for (const t of GROUP_E_OM_MER_INSERT) {
  expected.Owner[t]          = row(true,  true,  false, true);
  expected.Manager[t]        = row(true,  true,  false, false);
  expected.Merchandiser[t]   = row(false, true,  false, false);
  expected["QC Inspector"][t]= row(false, false, false, false);
}
for (const t of GROUP_E_OM_INSERT) {
  expected.Owner[t]          = row(true,  true,  true,  true);
  expected.Manager[t]        = row(true,  true,  true,  false);
  expected.Merchandiser[t]   = row(false, false, false, false);
  expected["QC Inspector"][t]= row(false, false, false, false);
}
// user_settings — own row only + Owner override on read/update/delete
expected.Owner.user_settings           = row(true,  true,  true,  true);
expected.Manager.user_settings         = row("own", true,  "own", "own");
expected.Merchandiser.user_settings    = row("own", true,  "own", "own");
expected["QC Inspector"].user_settings = row("own", true,  "own", "own");

const ALL_TABLES = Object.keys(expected.Owner);

// ─── probe helpers ───────────────────────────────────────────────────
const RLS_ERROR_CODES = new Set(["42501", "PGRST301", "PGRST116"]);
const SENTINEL_UUID   = "00000000-0000-0000-0000-000000000000";

function isRlsDenial(error) {
  if (!error) return false;
  if (error.code && RLS_ERROR_CODES.has(error.code)) return true;
  const msg = (error.message || "").toLowerCase();
  return msg.includes("row-level security") || msg.includes("violates row-level security policy");
}

async function probeSelect(client, service, table) {
  const { count: serviceCount, error: sErr } =
    await service.from(table).select("*", { head: true, count: "exact" });
  if (sErr) return { ok: false, note: `service: ${sErr.message}` };
  if ((serviceCount ?? 0) === 0) return { ok: "unknown", note: "table empty" };

  const { count: roleCount, error: rErr } =
    await client.from(table).select("*", { head: true, count: "exact" });
  if (rErr && isRlsDenial(rErr)) return { ok: false };
  if (rErr) return { ok: false, note: rErr.message };
  if ((roleCount ?? 0) === 0) return { ok: false };
  return { ok: true };
}

async function probeInsert(client, table) {
  // minimum payload — most tables accept an empty insert and rely on
  // defaults; for those with NOT NULLs we'll see a 23502 error which
  // means RLS allowed the insert (we don't care about the constraint).
  const { error } = await client.from(table).insert({}).select();
  if (!error) return { ok: true };
  if (isRlsDenial(error)) return { ok: false };
  // Other errors (NOT NULL, FK, CHECK) mean RLS let the row through.
  return { ok: true, note: `non-RLS error: ${error.code || error.message?.slice(0, 60)}` };
}

async function probeUpdate(client, table) {
  const { error } = await client.from(table)
    .update({}).eq("id", SENTINEL_UUID).select();
  if (!error) return { ok: true };
  if (isRlsDenial(error)) return { ok: false };
  return { ok: true, note: `non-RLS error: ${error.code || error.message?.slice(0, 60)}` };
}

async function probeDelete(client, table) {
  const { error } = await client.from(table)
    .delete().eq("id", SENTINEL_UUID).select();
  if (!error) return { ok: true };
  if (isRlsDenial(error)) return { ok: false };
  return { ok: true, note: `non-RLS error: ${error.code || error.message?.slice(0, 60)}` };
}

// ─── runner ──────────────────────────────────────────────────────────
function pickTables(all) {
  if (argTables.length === 0) return all;
  const set = new Set(argTables);
  return all.filter((t) => set.has(t));
}
function pickRoles() {
  const all = Object.keys(ROLE_USERS);
  if (argRoles.length === 0) return all;
  const set = new Set(argRoles);
  return all.filter((r) => set.has(r));
}

function fmtCell(expected, actual) {
  if (expected === "own") {
    // user_settings own-row semantics — actual probes treat
    // service-role and self-row as the same; we mark "own" cells as
    // 'skip' here and rely on a manual check.
    return "·";
  }
  if (actual.ok === "unknown") return "?";
  const pass = actual.ok === expected;
  return pass ? "✓" : "✗";
}

async function probeOne(client, service, role, table) {
  const exp = expected[role]?.[table];
  if (!exp) return null;

  const [s, i, u, d] = await Promise.all([
    exp.S === "own" ? Promise.resolve({ ok: "own"   }) : probeSelect(client, service, table),
    exp.I === "own" ? Promise.resolve({ ok: "own"   }) : probeInsert(client, table),
    exp.U === "own" ? Promise.resolve({ ok: "own"   }) : probeUpdate(client, table),
    exp.D === "own" ? Promise.resolve({ ok: "own"   }) : probeDelete(client, table),
  ]);

  return {
    role, table,
    S: { exp: exp.S, act: s, mark: fmtCell(exp.S, s) },
    I: { exp: exp.I, act: i, mark: fmtCell(exp.I, i) },
    U: { exp: exp.U, act: u, mark: fmtCell(exp.U, u) },
    D: { exp: exp.D, act: d, mark: fmtCell(exp.D, d) },
  };
}

async function signInAs(role) {
  const creds = ROLE_USERS[role];
  if (!creds.email || !creds.password) {
    console.warn(`Skipping ${role}: missing RLS_TEST_${role.toUpperCase()}_EMAIL/PASSWORD`);
    return null;
  }
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword(creds);
  if (error) {
    console.error(`Sign-in failed for ${role}: ${error.message}`);
    return null;
  }
  return client;
}

async function main() {
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const roles = pickRoles();
  const tables = pickTables(ALL_TABLES);
  console.log(`Verifying ${roles.length} roles × ${tables.length} tables × 4 commands\n`);

  const failures = [];
  for (const role of roles) {
    const client = await signInAs(role);
    if (!client) { failures.push(`${role}: sign-in failed`); continue; }

    if (!QUIET) console.log(`──── ${role} ────`);
    if (!QUIET) console.log("table".padEnd(36) + " S I U D");
    for (const table of tables) {
      const r = await probeOne(client, service, role, table);
      if (!r) continue;
      const cells = `${r.S.mark} ${r.I.mark} ${r.U.mark} ${r.D.mark}`;
      const failed = [r.S, r.I, r.U, r.D].some((c) => c.mark === "✗");
      if (failed) failures.push(`${role}/${table}: ${cells}`);
      if (!QUIET || failed) {
        console.log(`${table.padEnd(36)} ${cells}`);
      }
    }
    if (!QUIET) console.log("");
  }

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"}: ${failures.length} failures`);
  if (failures.length > 0) {
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-rls.mjs crashed:", err);
  process.exit(2);
});
