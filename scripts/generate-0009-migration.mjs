// Generates migrations/up/0009_fix_price_list_pricing_status_cast.sql by
// reading 0004 (the canonical source of fn_apply_master_data_extraction)
// and patching only the line where the INSERT side passes a bare text
// literal to the pricing_status enum column. The UPDATE side at lines
// 374-375 already casts correctly.

import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("migrations/up/0004_add_dry_run_to_apply_master_data.sql", "utf8");

// The buggy line is the bare text literal in the VALUES clause of the
// price_list INSERT. Match exactly to avoid touching anything else.
const buggy = `                    CASE WHEN NULLIF(v_row ->> 'price_usd','') IS NOT NULL THEN 'active' ELSE 'pending' END,`;
const fixed = `                    (CASE WHEN NULLIF(v_row ->> 'price_usd','') IS NOT NULL THEN 'active'::public.pricing_status_t ELSE 'pending'::public.pricing_status_t END),`;

if (!src.includes(buggy)) {
  console.error("ERROR: could not find the buggy line in 0004 — has it been edited?");
  process.exit(1);
}
if (src.indexOf(buggy) !== src.lastIndexOf(buggy)) {
  console.error("ERROR: the buggy line appears more than once — patch is ambiguous.");
  process.exit(2);
}

const patched = src.replace(buggy, fixed);

// Strip the original header, prepend a new one explaining the patch.
const stripPrefixUntil = patched.indexOf("DROP FUNCTION");
const body = patched.slice(stripPrefixUntil);

const header = `-- migrations/up/0009_fix_price_list_pricing_status_cast.sql
--
-- Bug fix: fn_apply_master_data_extraction failed with
--   ERROR: 42804 column "pricing_status" is of type pricing_status_t
--          but expression is of type text
-- when a master-data extraction included rows for the price_list section.
-- The INSERT-side CASE expression returned a bare 'active'/'pending' text
-- literal; the UPDATE-side already cast to public.pricing_status_t.
-- This migration recreates the function with the cast applied to the
-- VALUES clause as well, preserving every other line of 0004 verbatim.
--
-- Discovered 2026-05-01 during File Feeder Phase 2 testing on a master
-- data sheet with price_list rows for the SLPCSS (Stretch Cool Modal
-- Sheet Set) family. See: docs/migration-* for surrounding context.

`;

writeFileSync("migrations/up/0009_fix_price_list_pricing_status_cast.sql", header + body);
console.log("✓ wrote migrations/up/0009_fix_price_list_pricing_status_cast.sql");
console.log("  size:", (header.length + body.length), "bytes");
