// PO extraction in a worker — survives tab backgrounding.
//
// Input: { type:'extract', files: [{name, kind, b64|text}], systemPrompt, extractPrompt, supabaseUrl, accessToken, model }
// Output:
//   { type:'progress', idx, status } where status = 'extracting'|'done'|'error'
//   { type:'result', idx, data }
//   { type:'fail', idx, message }
//   { type:'allDone' }

self.onmessage = async (ev) => {
  const { type, files, systemPrompt, extractPrompt, supabaseUrl, accessToken, model } = ev.data;
  if (type !== "extract") return;

  const CONCURRENCY = 3;
  let cursor = 0;

  const extractOne = async (f, idx) => {
    self.postMessage({ type: "progress", idx, status: "extracting" });
    try {
      let messages;
      if (f.kind === "pdf") {
        messages = [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.b64 } },
            { type: "text", text: extractPrompt, cache_control: { type: "ephemeral" } }
          ]
        }];
      } else {
        messages = [{ role: "user", content: `${extractPrompt}\n\nFile content (${f.name}):\n${(f.text || "").substring(0, 12000)}` }];
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
        body: JSON.stringify({
          model: model || "claude-haiku-4-5",
          max_tokens: 8000,
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
          messages,
        }),
      });

      if (!res.ok) throw new Error(`AI proxy ${res.status}: ${await res.text()}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      const raw = data.content?.find(b => b.type === "text")?.text || "{}";
      self.postMessage({ type: "result", idx, raw });
    } catch (e) {
      self.postMessage({ type: "fail", idx, message: e.message || "Extraction failed" });
    }
  };

  const workers = Array(Math.min(CONCURRENCY, files.length)).fill(null).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= files.length) break;
      await extractOne(files[idx], idx);
    }
  });
  await Promise.all(workers);
  self.postMessage({ type: "allDone" });
};
