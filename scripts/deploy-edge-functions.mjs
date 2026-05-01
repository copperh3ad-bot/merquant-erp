// Deploys all edge functions in supabase/functions/ to the target project
// via the Supabase Management API. Reuses .supabase-token for auth.
//
// verify_jwt is read from a per-function map below — must match the source
// project's settings (output of list_edge_functions).
//
// Usage: node scripts/deploy-edge-functions.mjs <target-project-ref>

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/deploy-edge-functions.mjs <target-project-ref>");
  process.exit(1);
}

const token = readFileSync(".supabase-token", "utf8").trim();

// Map name → verify_jwt. Mirror current production settings on source.
const VERIFY_JWT = {
  "ai-proxy":               true,
  "extract-document":       true,
  "extract-barcodes":       true,
  "classify-components":    true,
  "backup-hourly":          false,  // gated by BACKUP_SECRET
  "gmail-oauth":            false,  // OAuth callback, no JWT yet
  "gmail-crawl":            false,  // triggered by gmail-oauth
  "notify-pricing-pending": false,  // currently public (audit Finding 6)
  "user-approval":          false,  // signup flow, public
};

async function readFunctionFiles(dir) {
  // Walk function dir recursively, return list of { name, content } where
  // name is the path relative to the function dir.
  const files = [];
  function walk(curr, rel) {
    for (const entry of readdirSync(curr)) {
      const full = join(curr, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, relPath);
      else files.push({ name: relPath, content: readFileSync(full, "utf8") });
    }
  }
  walk(dir, "");
  return files;
}

async function deploy(name, files, verifyJwt) {
  const url = `https://api.supabase.com/v1/projects/${target}/functions/deploy?slug=${encodeURIComponent(name)}`;
  const fd = new FormData();
  fd.append("metadata", JSON.stringify({
    name,
    verify_jwt: verifyJwt,
    entrypoint_path: "index.ts",
  }));
  for (const f of files) {
    fd.append("file", new Blob([f.content], { type: "application/typescript" }), f.name);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  return { ok: true, body };
}

async function main() {
  const baseDir = "supabase/functions";
  const dirs = readdirSync(baseDir).filter((d) => statSync(join(baseDir, d)).isDirectory());

  console.log(`Deploying ${dirs.length} edge functions to ${target}\n`);

  let ok = 0;
  let fail = 0;
  for (const d of dirs) {
    const verifyJwt = VERIFY_JWT[d];
    if (verifyJwt === undefined) {
      console.log(`[${d}] skipping — no verify_jwt setting in script`);
      continue;
    }
    const files = await readFunctionFiles(join(baseDir, d));
    process.stdout.write(`[${d}] ${files.length} files, verify_jwt=${verifyJwt} ... `);
    const t0 = Date.now();
    const r = await deploy(d, files, verifyJwt);
    const dt = Date.now() - t0;
    if (r.ok) {
      console.log(`✓ ${dt} ms`);
      ok++;
    } else {
      console.log(`✗ ${r.status} (${dt} ms)`);
      console.log("  ", r.body.slice(0, 400));
      fail++;
    }
  }
  console.log(`\nDone. ${ok} ok, ${fail} failed.`);
  if (fail > 0) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
