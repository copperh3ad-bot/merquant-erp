import { supabase } from "@/api/supabaseClient";

/**
 * Call Claude via Supabase Edge Function proxy.
 * Avoids CORS issues — the API key lives server-side on Supabase.
 */
export async function callClaude({ system, messages, model = "claude-haiku-4-5", max_tokens = 2000, cacheSystem = false }) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

  // Convert system string to cacheable content blocks if requested
  const systemPayload = cacheSystem && typeof system === "string"
    ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
    : system;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ model, max_tokens, system: systemPayload, messages }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI proxy error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

/** Convenience: extract text from response */
export async function askClaude(prompt, system) {
  const data = await callClaude({
    system: system || "You are a helpful assistant. Respond concisely.",
    messages: [{ role: "user", content: prompt }],
  });
  return data.content?.[0]?.text || "";
}

