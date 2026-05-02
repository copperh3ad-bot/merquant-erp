import { supabase } from "@/api/supabaseClient";

/**
 * Thrown when the ai-proxy reports the API key is missing / AI is degraded.
 * Catch this specifically in the UI to render a friendly "AI is temporarily
 * unavailable" message instead of a generic error toast.
 */
export class AIUnavailableError extends Error {
  constructor(message) {
    super(message || "AI features are temporarily unavailable.");
    this.name = "AIUnavailableError";
    this.code = "AI_UNAVAILABLE";
  }
}

const RETRYABLE_STATUSES = new Set([429, 529]);
const MAX_RETRIES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call Claude via Supabase Edge Function proxy.
 * Avoids CORS issues — the API key lives server-side on Supabase.
 *
 * Retries automatically on 429 / 529 (rate limit / overloaded) up to twice
 * with linear backoff (1.5s, 3s). Other failures throw immediately.
 */
export async function callClaude({ system, messages, model = "claude-haiku-4-5", max_tokens = 2000, cacheSystem = false }) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

  // Convert system string to cacheable content blocks if requested
  const systemPayload = cacheSystem && typeof system === "string"
    ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
    : system;

  const body = JSON.stringify({ model, max_tokens, system: systemPayload, messages });

  let res;
  let lastErrText;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    res = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body,
    });

    if (!RETRYABLE_STATUSES.has(res.status)) break;
    if (attempt === MAX_RETRIES) break;

    const delay = (attempt + 1) * 1500;
    console.warn(`[callClaude] ${res.status} from ai-proxy, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
    await sleep(delay);
  }

  if (!res.ok) {
    lastErrText = await res.text();
    throw new Error(`AI proxy error ${res.status}: ${lastErrText}`);
  }

  const data = await res.json();
  if (data.error) {
    if (data.error.code === "AI_UNAVAILABLE") {
      throw new AIUnavailableError(data.error.message);
    }
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
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
