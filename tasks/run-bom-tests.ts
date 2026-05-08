// tasks/run-bom-tests.ts
//
// Phase 9 self-test runner — runs all 5 BOM tests + all 5 thread tests
// directly against the formula engines (no DB, no AI). Pure deterministic
// arithmetic verification.
//
// Run with:
//   node --experimental-strip-types tasks/run-bom-tests.ts
// (Node 22+ has --experimental-strip-types built-in.)

import { runEngineTests } from "../supabase/functions/_shared/bom-formula-engine.ts";
import { runThreadEngineTests } from "../supabase/functions/_shared/thread-formula-engine.ts";

const bom    = runEngineTests();
const thread = runThreadEngineTests();

console.log("\n=== BOM formula engine tests ===");
for (const r of bom.results) console.log("  " + r);
console.log(`  ${bom.passed} passed, ${bom.failed} failed`);

console.log("\n=== Thread formula engine tests ===");
for (const r of thread.results) console.log("  " + r);
console.log(`  ${thread.passed} passed, ${thread.failed} failed`);

const totalPassed = bom.passed + thread.passed;
const totalFailed = bom.failed + thread.failed;

console.log(`\n=== Total: ${totalPassed} passed, ${totalFailed} failed (10 expected) ===`);

if (totalFailed > 0) process.exit(1);
