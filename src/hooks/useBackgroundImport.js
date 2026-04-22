import { useState, useRef } from "react";
import { supabase } from "@/api/supabaseClient";

/**
 * useBackgroundImport
 *
 * Runs bulk upserts/inserts in a Web Worker so the tab can be backgrounded.
 *
 * Usage:
 *   const { run, stage, message, progress } = useBackgroundImport();
 *   await run([
 *     { table: "po_items",  rows: [...], mode: "insert" },
 *     { table: "articles",  rows: [...], mode: "upsert", onConflict: "article_code" },
 *   ]);
 */
export function useBackgroundImport() {
  const [stage, setStage] = useState("idle"); // idle | running | done | error
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState({ table: null, done: 0, total: 0 });
  const wakeLockRef = useRef(null);

  const run = async (jobs) => {
    if (!jobs?.length) return { totalIns: 0, failures: [] };

    setStage("running");
    setMessage("Starting…");
    setProgress({ table: null, done: 0, total: 0 });

    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen").catch(() => null);
      }
    } catch {}

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const worker = new Worker(new URL("../workers/bulkImportWorker.js", import.meta.url), { type: "module" });

      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === "progress") {
            setProgress({ table: m.table, done: m.done, total: m.total });
            setMessage(`${m.table}: ${m.done} / ${m.total}`);
          } else if (m.type === "done") {
            resolve({ totalIns: m.totalIns, failures: m.failures });
          } else if (m.type === "error") {
            reject(new Error(m.message));
          }
        };
        worker.onerror = (e) => reject(new Error(e.message || "Worker error"));
        worker.postMessage({
          type: "bulk",
          supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
          anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          accessToken: session?.access_token,
          jobs,
        });
      });

      worker.terminate();
      setStage("done");
      setMessage(result.failures.length
        ? `Done — ${result.failures.length} chunk(s) failed`
        : `Imported ${result.totalIns} rows`);
      if (result.failures.length) console.warn("Background import warnings:", result.failures);
      return result;
    } catch (e) {
      setStage("error"); setMessage(e.message || "Import failed");
      throw e;
    } finally {
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  const reset = () => {
    setStage("idle"); setMessage(""); setProgress({ table: null, done: 0, total: 0 });
  };

  return { run, stage, message, progress, reset };
}
