// scripts/migrate-storage-files.mjs
//
// Copies every file in every Supabase storage bucket from source to target.
// Fetches service_role keys via the Management API (using .supabase-token),
// then uses the @supabase/supabase-js client for both download and upload.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SOURCE_REF = "ecjqdyruwqlesfthgphv";
const TARGET_REF = "jcbxmpgjirxqszodotmx";
const TOKEN = readFileSync(".supabase-token", "utf8").trim();

async function getServiceRoleKey(ref) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const keys = await res.json();
  const k = keys.find((x) => x.name === "service_role");
  if (!k) throw new Error(`No service_role key found for ${ref}`);
  return k.api_key;
}

async function listAllFiles(supabase, bucket, prefix = "") {
  const out = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const item of data) {
      // Supabase: folders have id===null AND metadata===null. Files have a UUID id and metadata object.
      const isFolder = item.id === null && (item.metadata === null || item.metadata === undefined);
      if (isFolder) {
        const sub = prefix ? `${prefix}/${item.name}` : item.name;
        const nested = await listAllFiles(supabase, bucket, sub);
        out.push(...nested);
      } else {
        out.push(prefix ? `${prefix}/${item.name}` : item.name);
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function copyFile(srcClient, tgtClient, bucket, path) {
  const t0 = Date.now();
  const { data: blob, error: dlErr } = await srcClient.storage.from(bucket).download(path);
  if (dlErr) throw new Error(`download ${path}: ${dlErr.message}`);

  const { error: upErr } = await tgtClient.storage
    .from(bucket)
    .upload(path, blob, { upsert: true, cacheControl: "3600" });
  if (upErr) throw new Error(`upload ${path}: ${upErr.message}`);

  return { size: blob.size, ms: Date.now() - t0 };
}

async function main() {
  console.log(`Fetching service-role keys ...`);
  const [srcKey, tgtKey] = await Promise.all([
    getServiceRoleKey(SOURCE_REF),
    getServiceRoleKey(TARGET_REF),
  ]);

  const srcClient = createClient(`https://${SOURCE_REF}.supabase.co`, srcKey);
  const tgtClient = createClient(`https://${TARGET_REF}.supabase.co`, tgtKey);

  const buckets = ["ai-extraction-sources", "backups", "po-item-files"];

  let totalFiles = 0;
  let totalBytes = 0;

  for (const bucket of buckets) {
    process.stdout.write(`\n[${bucket}] listing ...`);
    const files = await listAllFiles(srcClient, bucket);
    console.log(` ${files.length} files`);
    if (files.length === 0) continue;

    let ok = 0;
    let fail = 0;
    let bytes = 0;
    for (const path of files) {
      try {
        const r = await copyFile(srcClient, tgtClient, bucket, path);
        bytes += r.size;
        ok++;
        if (ok % 10 === 0 || ok === files.length) {
          process.stdout.write(`\r  ${ok}/${files.length} copied, ${(bytes/1024).toFixed(1)} KB        `);
        }
      } catch (e) {
        fail++;
        console.log(`\n  ✗ ${path}: ${e.message}`);
      }
    }
    console.log(`\n  done — ${ok} ok, ${fail} failed, ${(bytes/1024/1024).toFixed(2)} MB`);
    totalFiles += ok;
    totalBytes += bytes;
  }

  console.log(`\nTotal: ${totalFiles} files, ${(totalBytes/1024/1024).toFixed(2)} MB`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
