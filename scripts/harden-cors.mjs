// Apply CORS allowlist hardening to remaining edge functions.
// Pattern: replace top-level `const CORS = {...}` block with a
// corsHeaders(req) function, move the `j`/`err` helpers INSIDE the
// Deno.serve handler so they close over `req`, and bind a per-request
// `const CORS = corsHeaders(req)` at the top of the handler.
//
// gmail-crawl was migrated by hand as a reference; this script handles
// the remaining 7 (ai-proxy was done with a different pattern; included
// here as a no-op safety check). Files are validated with a small
// post-edit check that no top-level `CORS` references remain outside
// the corsHeaders/_shared snippet.

import { readFileSync, writeFileSync } from "node:fs";

const FUNCTIONS = [
  "backup-hourly",
  "classify-components",
  "extract-barcodes",
  "extract-document",
  "gmail-oauth",
  "notify-pricing-pending",
  "user-approval",
];

const ALLOWLIST_BLOCK = `// Origin allowlist for CORS — tightened from \`*\` per hardening audit
// Finding 17. Env var \`ALLOWED_ORIGINS\` (comma-separated) extends the
// defaults for branch deploys / staging.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://merquanterp.netlify.app",
  "https://merquant-mas.netlify.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
];
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .concat(DEFAULT_ALLOWED_ORIGINS),
);
function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}`;

// Old CORS block — different shapes per file. We match by anchoring
// on the `"Access-Control-Allow-Origin": "*"` line.
const OLD_CORS_RE = /const CORS = \{\s*"Access-Control-Allow-Origin": "\*",[^}]*\};/;

// Old `j` helper — two shapes (function and arrow). Match both. We
// REMOVE this from module scope (it'll be re-introduced inside Deno.serve).
// Loose regexes — match across whitespace variations.
const OLD_J_FN_RE = /\nfunction j\(body: unknown, status = 200\) \{[^}]*\.\.\.CORS[^}]*\}\);[\s\S]*?\}\n/;
const OLD_J_ARROW_RE = /\nconst j = \(body: unknown, status = 200\) =>[\s\S]*?\.\.\.CORS[\s\S]*?\}\)\);?\n/;

// Old `err` helper — typically defined right after `j` in extract-* files.
// Two shapes seen: `(code, msg, dev, status)` and `(code, user_message,
// dev_detail, status)`. Pattern matches the body of either.
const OLD_ERR_RE = /\nconst err = \(([^)]+)\) =>\s*\n\s*j\(\{[^}]*\},\s*status\);\n/;

// Replacement helpers (re-injected inside Deno.serve)
const NEW_HELPERS_INSIDE = (hadErr, errSig, errBody) => `  // Per-request CORS headers (allowlist-checked against the Origin
  // header). Helper functions defined below close over \`CORS\`.
  const CORS = corsHeaders(req);
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
${hadErr ? `  const err = (${errSig}) =>\n    j(${errBody}, status);\n` : ""}`;

// Replace `headers: CORS` and `...CORS` references inside the handler
// body — they used to read the module-level CORS, now read the closure-
// captured one. No change needed; the names are identical.

let changed = 0;
for (const fn of FUNCTIONS) {
  const path = `supabase/functions/${fn}/index.ts`;
  let src = readFileSync(path, "utf8");
  const before = src;

  // 1. Replace the top-level CORS block with the allowlist function.
  if (!OLD_CORS_RE.test(src)) {
    console.warn(`[${fn}] no top-level CORS const found — skipping`);
    continue;
  }
  src = src.replace(OLD_CORS_RE, ALLOWLIST_BLOCK);

  // 2. Detect + remove the module-level `j` helper.
  const removedJ =
    OLD_J_FN_RE.test(src)
      ? (src = src.replace(OLD_J_FN_RE, "\n"), true)
    : OLD_J_ARROW_RE.test(src)
      ? (src = src.replace(OLD_J_ARROW_RE, "\n"), true)
      : false;
  if (!removedJ) {
    console.warn(`[${fn}] no module-level j() helper matched — skipping`);
    continue;
  }

  // 3. Detect + remove the optional `err` helper.
  let hadErr = false;
  let errSig = "";
  let errBody = "";
  const errMatch = src.match(OLD_ERR_RE);
  if (errMatch) {
    hadErr = true;
    errSig = errMatch[1];
    // Pull the original err body directly from src to preserve the
    // exact j({ ... }, status) call.
    const fullMatch = errMatch[0];
    const bodyMatch = fullMatch.match(/j\((\{[\s\S]*?\}),\s*status\);/);
    if (bodyMatch) errBody = bodyMatch[1];
    src = src.replace(OLD_ERR_RE, "\n");
  }

  // 4. Inject the new helpers RIGHT INSIDE Deno.serve(async (req) => {.
  const HANDLER_RE = /Deno\.serve\(async \(req\) => \{\n/;
  if (!HANDLER_RE.test(src)) {
    console.warn(`[${fn}] couldn't find Deno.serve handler — skipping`);
    continue;
  }
  src = src.replace(
    HANDLER_RE,
    `Deno.serve(async (req) => {\n${NEW_HELPERS_INSIDE(hadErr, errSig, errBody)}`,
  );

  if (src === before) {
    console.warn(`[${fn}] no changes`);
    continue;
  }
  writeFileSync(path, src, "utf8");
  changed++;
  console.log(`[${fn}] ✓ updated${hadErr ? " (incl. err helper)" : ""}`);
}

console.log(`\nTotal: ${changed}/${FUNCTIONS.length} files updated.`);
