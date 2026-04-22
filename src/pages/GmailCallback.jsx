import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function GmailCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("processing");
  const [message, setMessage] = useState("Exchanging authorization code…");
  const [email, setEmail] = useState("");

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const error = params.get("error");

      if (error) {
        setStatus("error");
        setMessage(`Google returned error: ${error}`);
        return;
      }
      if (!code) {
        setStatus("error");
        setMessage("No authorization code in callback URL.");
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setStatus("error");
          setMessage("You must be logged into MerQuant first.");
          return;
        }

        const redirectUri = window.location.origin + "/auth/gmail-callback";
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-oauth`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: "exchange_code", code, redirect_uri: redirectUri }),
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
          setStatus("error");
          setMessage(`${data.error || "HTTP " + resp.status}: ${data.details || data.message || JSON.stringify(data)}`);
          return;
        }

        setEmail(data.email || "");
        setStatus("success");
        setMessage(`Gmail connected: ${data.email}`);
        setTimeout(() => navigate("/settings"), 2000);
      } catch (e) {
        setStatus("error");
        setMessage(e?.message || String(e));
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full border rounded-xl p-6 text-center space-y-3 bg-card">
        {status === "processing" && <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />}
        {status === "success" && <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600" />}
        {status === "error" && <XCircle className="h-10 w-10 mx-auto text-red-600" />}
        <h1 className="text-lg font-semibold">{
          status === "processing" ? "Connecting Gmail…" :
          status === "success" ? "Connected" :
          "Connection Failed"
        }</h1>
        <p className="text-sm text-muted-foreground break-words">{message}</p>
        {status === "error" && <button onClick={() => navigate("/settings")} className="text-sm text-primary underline">Back to Settings</button>}
      </div>
    </div>
  );
}
