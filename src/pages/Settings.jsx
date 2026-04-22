import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings as SettingsIcon, Mail, Save, Loader2, CheckCircle2, Link2, Unlink, AlertCircle } from "lucide-react";

const GOOGLE_CLIENT_ID = "1065030216386-m1odk5g9end0ltlc8vjg3cntuv323491.apps.googleusercontent.com";
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email";

export default function Settings() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [oauth, setOauth] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [settings, setSettings] = useState({
    crawler_email: "",
    crawler_query_default: "subject:(\"purchase order\" OR PO) has:attachment",
    crawler_max_emails: 50
  });

  const loadOAuthStatus = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: "status" }),
    });
    if (resp.ok) setOauth(await resp.json());
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        const { data } = await supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
        if (data) {
          setSettings({
            crawler_email: data.crawler_email || user.email || "",
            crawler_query_default: data.crawler_query_default || "subject:(\"purchase order\" OR PO) has:attachment",
            crawler_max_emails: data.crawler_max_emails || 50
          });
        } else {
          setSettings(s => ({ ...s, crawler_email: user.email || "" }));
        }
        await loadOAuthStatus();
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!user) return;
    setSaving(true); setSaved(false);
    const payload = {
      user_id: user.id,
      login_email: user.email,
      crawler_email: settings.crawler_email.trim().toLowerCase(),
      crawler_query_default: settings.crawler_query_default,
      crawler_max_emails: Number(settings.crawler_max_emails) || 50,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from("user_settings").upsert(payload, { onConflict: "user_id" });
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    setSaving(false);
  };

  const connectGmail = () => {
    const redirectUri = window.location.origin + "/auth/gmail-callback";
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES,
      access_type: "offline",
      prompt: "consent",
      ...(settings.crawler_email ? { login_hint: settings.crawler_email } : {}),
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  };

  const disconnectGmail = async () => {
    if (!confirm("Disconnect Gmail? MerQuant will lose access to your inbox.")) return;
    setDisconnecting(true);
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: "disconnect" }),
    });
    await loadOAuthStatus();
    setDisconnecting(false);
  };

  if (loading) return <div className="p-6 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><SettingsIcon className="h-6 w-6" />Settings</h1>
        <p className="text-sm text-muted-foreground">Configure your crawler preferences and email accounts.</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b">
            <Mail className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Email Crawler</h2>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Login Email (your account)</Label>
            <Input value={user?.email || ""} disabled className="bg-muted" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Crawler Email (Gmail to scan)</Label>
            <Input type="email" value={settings.crawler_email} onChange={e => setSettings(s => ({ ...s, crawler_email: e.target.value }))} placeholder="e.g. orders@yourcompany.com"/>
          </div>

          <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {oauth?.connected ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-amber-600" />}
                <span className="text-sm font-medium">{oauth?.connected ? `Connected: ${oauth.email}` : "Not connected to Gmail"}</span>
              </div>
              {oauth?.connected ? (
                <Button size="sm" variant="outline" onClick={disconnectGmail} disabled={disconnecting}><Unlink className="h-3.5 w-3.5 mr-1.5" />Disconnect</Button>
              ) : (
                <Button size="sm" onClick={connectGmail}><Link2 className="h-3.5 w-3.5 mr-1.5" />Connect Gmail</Button>
              )}
            </div>
            {oauth?.connected && oauth.last_crawl_at && <p className="text-xs text-muted-foreground">Last crawl: {new Date(oauth.last_crawl_at).toLocaleString()} — {oauth.last_crawl_status || "—"}</p>}
            {oauth?.connected && oauth.email && settings.crawler_email && oauth.email.toLowerCase() !== settings.crawler_email.toLowerCase() && <p className="text-xs text-amber-700">⚠ Connected account ({oauth.email}) does not match crawler email ({settings.crawler_email}). Disconnect and reconnect with the correct account.</p>}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Default Search Query</Label>
            <Input value={settings.crawler_query_default} onChange={e => setSettings(s => ({ ...s, crawler_query_default: e.target.value }))} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Max Emails Per Crawl</Label>
            <Input type="number" min="1" max="500" value={settings.crawler_max_emails} onChange={e => setSettings(s => ({ ...s, crawler_max_emails: e.target.value }))} className="w-32" />
          </div>

          <div className="flex items-center gap-3 pt-3 border-t">
            <Button onClick={save} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : <><Save className="h-4 w-4 mr-2" />Save Settings</>}</Button>
            {saved && <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-4 w-4" />Saved</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
