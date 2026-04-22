// Runs master data batch upserts in a dedicated thread.
// Posts progress messages back to the main UI. Keeps running when tab is backgrounded.
//
// Input message shape:
//   { type: 'import', supabaseUrl, anonKey, accessToken, rowsBySheet, conflictCols, order, tpByCode }
// Output messages:
//   { type: 'progress', sheet, done, total }
//   { type: 'log', message }
//   { type: 'done', totalIns, failures }
//   { type: 'error', message }

import { createClient } from "@supabase/supabase-js";

self.onmessage = async (ev) => {
  const { type, supabaseUrl, anonKey, accessToken, rowsBySheet, conflictCols, order, tpByCode } = ev.data;
  if (type !== "import") return;

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const failures = [];
  let totalIns = 0;

  try {
    for (const sheetName of order) {
      const sheet = rowsBySheet[sheetName];
      if (!sheet || !sheet.rows.length) continue;

      const table = sheet.table;
      const tpMap = new Map(tpByCode || []);
      const payloads = sheet.rows.map((data) => {
        const out = { ...data };
        if (table === "consumption_library" && tpMap.has(out.item_code)) {
          out.tech_pack_id = tpMap.get(out.item_code);
        }
        return out;
      });

      const chunkSize = 500;
      const chunks = [];
      for (let i = 0; i < payloads.length; i += chunkSize) {
        chunks.push(payloads.slice(i, i + chunkSize));
      }

      let done = 0;
      self.postMessage({ type: "progress", sheet: sheetName, done: 0, total: payloads.length });

      // Parallel chunks
      const results = await Promise.all(chunks.map(chunk =>
        supabase.from(table)
          .upsert(chunk, { onConflict: conflictCols[table], ignoreDuplicates: false })
          .select("id")
          .then(r => { done += chunk.length; self.postMessage({ type: "progress", sheet: sheetName, done, total: payloads.length }); return r; })
      ));

      for (const { error, data } of results) {
        if (error) failures.push(`${sheetName}: ${error.message}`);
        else totalIns += data?.length || 0;
      }
    }

    // Denormalize articles.components[] from consumption_library
    const affected = new Set();
    for (const s of ["2. SKU Fabric Consumption", "3. SKU Accessory Consumption"]) {
      for (const r of (rowsBySheet[s]?.rows || [])) affected.add(r.item_code);
    }
    if (affected.size) {
      self.postMessage({ type: "progress", sheet: "Denormalizing articles", done: 0, total: affected.size });
      const codes = Array.from(affected);
      const { data: cl } = await supabase.from("consumption_library")
        .select("*").in("item_code", codes).eq("kind", "fabric");
      const byCode = {};
      for (const c of cl || []) {
        (byCode[c.item_code] = byCode[c.item_code] || []).push({
          component_type: c.component_type, fabric_type: c.fabric_type,
          gsm: c.gsm, width: c.width_cm, color: c.color,
          construction: c.construction, finish: c.treatment,
          consumption_per_unit: c.consumption_per_unit || 0,
          wastage_percent: c.wastage_percent || 0,
        });
      }
      const entries = Object.keys(byCode);
      let i = 0;
      for (const code of entries) {
        await supabase.from("articles").update({ components: byCode[code] }).eq("article_code", code);
        i++;
        if (i % 10 === 0) self.postMessage({ type: "progress", sheet: "Denormalizing articles", done: i, total: entries.length });
      }
    }

    self.postMessage({ type: "done", totalIns, failures });
  } catch (e) {
    self.postMessage({ type: "error", message: e.message || "Worker failed" });
  }
};
