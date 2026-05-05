// src/lib/logger.js
//
// Structured error logging. Logs to the browser console in dev, to the
// `error_log` table in production. Best-effort: a logger failure must
// never throw or block the calling code path.

export async function logError(error, context = {}) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error("[MerQuant]", error, context);
    return;
  }
  try {
    const { supabase } = await import("../api/supabaseClient.js");
    await supabase.from("error_log").insert({
      message: error?.message ?? String(error ?? "unknown"),
      stack: error?.stack?.slice(0, 2000) ?? null,
      context: context && Object.keys(context).length ? JSON.stringify(context) : null,
      url: typeof window !== "undefined" ? window.location.pathname : null,
    });
  } catch {
    // Swallow — logger errors must not propagate.
  }
}
