// src/components/shared/AIVoiceEntry.jsx
//
// F6 — Reusable voice-entry mic. Captures speech via Web Speech API,
// passes the transcript to ai-proxy with a "structured-data extractor"
// system prompt, and yields the parsed JSON to the caller's onValue
// callback.
//
// Feature gates (CRITICAL — never render a broken mic):
//   - Page must be served over HTTPS or via localhost — SpeechRecognition
//     only works in a secure context.
//   - Browser must expose SpeechRecognition or webkitSpeechRecognition.
//
// If either gate fails, render a plain text input instead. Same onValue
// contract: caller doesn't need to special-case fallback mode.
//
// Failure modes:
//   - AI returns malformed JSON → onValue(transcript) — passes raw text
//   - AI call throws → onValue(transcript) — same
//   - User cancels speech → onValue(null) so caller can ignore

import React, { useState, useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { callClaude } from "@/lib/aiProxy";

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isSecureContext() {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:" || window.location.hostname === "localhost";
}

/**
 * @param {object} props
 * @param {(value: any) => void} props.onValue
 *   Receives the parsed JSON object on success, or the raw transcript
 *   string on AI failure / fallback. Null means user cancelled.
 * @param {object} [props.fieldSchema]
 *   Optional schema hint passed to the AI to bias extraction.
 *   e.g. {pieces_in: number, pieces_out: number, operators: number}.
 *   When omitted, the AI returns its best-guess JSON.
 * @param {string} [props.placeholder]
 *   Placeholder text for the fallback text input.
 */
export default function AIVoiceEntry({ onValue, fieldSchema, placeholder = "Type or speak…" }) {
  const SR = getSpeechRecognition();
  const secure = isSecureContext();
  const supported = !!SR && secure;

  // Fallback path: plain text input + Enter to submit raw text.
  if (!supported) {
    return <FallbackText onValue={onValue} placeholder={placeholder} />;
  }
  return <MicControl SR={SR} fieldSchema={fieldSchema} onValue={onValue} placeholder={placeholder} />;
}

function FallbackText({ onValue, placeholder }) {
  const [text, setText] = useState("");
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onValue(v);
    setText("");
  };
  return (
    <input
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter") submit(); }}
      placeholder={placeholder}
      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
    />
  );
}

function MicControl({ SR, fieldSchema, onValue, placeholder }) {
  const [state, setState] = useState("idle"); // idle | listening | processing
  const [transcript, setTranscript] = useState("");
  const recRef = useRef(null);

  const start = () => {
    if (state !== "idle") return;
    let rec;
    try {
      rec = new SR();
    } catch {
      // Constructor errored → fall back to text inline by passing the
      // current transcript through onValue (or noop if empty).
      onValue(null);
      return;
    }
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (ev) => {
      const t = Array.from(ev.results).map(r => r[0]?.transcript || "").join(" ").trim();
      setTranscript(t);
    };
    rec.onerror = () => { setState("idle"); };
    rec.onend = () => {
      // Move to processing if we got a transcript; else back to idle.
      setState(prev => {
        if (prev === "listening") return transcriptRef.current ? "processing" : "idle";
        return prev;
      });
    };
    recRef.current = rec;
    setState("listening");
    try { rec.start(); } catch { setState("idle"); }
  };

  const stop = () => {
    try { recRef.current?.stop(); } catch { /* noop */ }
  };

  // Keep a ref to the current transcript so the onend handler can read
  // the latest value without stale closures.
  const transcriptRef = useRef("");
  React.useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  React.useEffect(() => {
    if (state !== "processing") return;
    const t = transcriptRef.current;
    if (!t) { setState("idle"); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await callClaude({
          system: "You are a data entry assistant for a garment ERP. Extract structured field values from the user's voice input. Return ONLY valid JSON matching the field schema provided. No other text.",
          messages: [{
            role: "user",
            content: JSON.stringify({ transcript: t, fieldSchema: fieldSchema || null }),
          }],
          max_tokens: 400,
        });
        const text = data?.content?.[0]?.text || data?.text || "";
        const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        let parsed;
        try { parsed = JSON.parse(cleaned); } catch { parsed = null; }
        if (cancelled) return;
        onValue(parsed ?? t);
      } catch {
        if (!cancelled) onValue(t);
      } finally {
        if (!cancelled) {
          setState("idle");
          setTranscript("");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [state, onValue, fieldSchema]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={state === "listening" ? stop : start}
        disabled={state === "processing"}
        className={`h-8 w-8 rounded-full inline-flex items-center justify-center border ${
          state === "listening" ? "bg-red-50 text-red-600 border-red-200 animate-pulse" :
          state === "processing" ? "bg-blue-50 text-blue-600 border-blue-200" :
          "bg-white text-foreground border-gray-300 hover:bg-gray-50"
        }`}
        title={state === "listening" ? "Stop recording" : state === "processing" ? "Processing…" : "Start recording"}
      >
        {state === "processing" ? <Loader2 className="h-4 w-4 animate-spin" /> :
         state === "listening" ? <MicOff className="h-4 w-4" /> :
         <Mic className="h-4 w-4" />}
      </button>
      {transcript && (
        <span className="text-[11px] text-muted-foreground truncate max-w-[300px]">{transcript}</span>
      )}
      {state === "idle" && !transcript && (
        <span className="text-[11px] text-muted-foreground italic">{placeholder}</span>
      )}
    </div>
  );
}
