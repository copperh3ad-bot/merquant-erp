// Generic background worker for any table bulk upsert or insert.
//
// Input:
//   { type: 'bulk', supabaseUrl, anonKey, accessToken,
//     jobs: [{ table, rows, mode: 'upsert'|'insert', onConflict?, chunkSize? }] }
// Output:
//   { type: 'progress', jobIdx, table, done, total }
//   { type: 'done', totalIns, failures }
//   { type: 'error', message }

import { createClient } from "@supabase/supabase-js";

self.onmessage = async (ev) => {
  const { type, supabaseUrl, anonKey, accessToken, jobs } = ev.data;
  if (type !== "bulk") return;

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const failures = [];
  let totalIns = 0;

  try {
    for (let j = 0; j < jobs.length; j++) {
      const { table, rows, mode = "upsert", onConflict, chunkSize = 500 } = jobs[j];
      if (!rows?.length) continue;

      const chunks = [];
      for (let i = 0; i < rows.length; i += chunkSize) chunks.push(rows.slice(i, i + chunkSize));

      let done = 0;
      self.postMessage({ type: "progress", jobIdx: j, table, done: 0, total: rows.length });

      const results = await Promise.all(chunks.map(chunk => {
        const q = supabase.from(table);
        const op = mode === "insert"
          ? q.insert(chunk).select("id")
          : q.upsert(chunk, { onConflict, ignoreDuplicates: false }).select("id");
        return op.then(r => {
          done += chunk.length;
          self.postMessage({ type: "progress", jobIdx: j, table, done, total: rows.length });
          return r;
        });
      }));

      for (const { error, data } of results) {
        if (error) failures.push(`${table}: ${error.message}`);
        else totalIns += data?.length || 0;
      }
    }
    self.postMessage({ type: "done", totalIns, failures });
  } catch (e) {
    self.postMessage({ type: "error", message: e.message || "Worker failed" });
  }
};
