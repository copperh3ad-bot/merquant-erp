/**
 * ImapCredentialsForm.jsx
 * 
 * IMAP connection setup form for the EmailCrawlerAgentPanel.
 * Supports Outlook, Yahoo, Zoho, and custom IMAP servers.
 * Password is encrypted via Supabase Vault — never stored in plaintext.
 * 
 * Usage: drop inside EmailCrawlerAgentPanel.jsx as a tab alongside Gmail.
 */

import { useState, useEffect } from 'react';
import {
  Server, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, AlertTriangle, Info, Trash2, Lock
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Known provider presets
// ---------------------------------------------------------------------------

const PRESETS = [
  {
    id: 'outlook',
    label: 'Outlook / Hotmail',
    icon: '📧',
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    hint: 'Use your Microsoft account email and password. For work accounts, an app password may be required.',
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    icon: '📨',
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    hint: 'You must generate an App Password in Yahoo Security settings.',
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    icon: '📬',
    host: 'imap.zoho.com',
    port: 993,
    secure: true,
    hint: 'Use your Zoho email and password. Enable IMAP in Zoho Mail settings first.',
  },
  {
    id: 'custom',
    label: 'Custom / Corporate',
    icon: '🏢',
    host: '',
    port: 993,
    secure: true,
    hint: 'Enter your mail server details. Ask your IT team for IMAP settings.',
  },
];

// ---------------------------------------------------------------------------
// Save IMAP credentials via edge function (never send password to frontend DB directly)
// ---------------------------------------------------------------------------

async function saveImapCredentials({ host, port, secure, username, password, provider }) {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/imap-credentials-save`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        ANON_KEY,
      Authorization:  `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ host, port, secure, username, password, provider }),
  });
  if (!res.ok) throw new Error(`Save failed: ${await res.text()}`);
  return res.json();
}

async function testImapConnection({ host, port, secure, username, password }) {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/imap-test-connection`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        ANON_KEY,
      Authorization:  `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ host, port, secure, username, password }),
  });
  if (!res.ok) throw new Error(`Test failed: ${await res.text()}`);
  return res.json();
}

async function deleteImapCredentials(credId) {
  const { error } = await supabase
    .from('imap_credentials')
    .update({ active: false })
    .eq('id', credId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ImapCredentialsForm() {
  const [existingCred, setExistingCred] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [form, setForm] = useState({
    host: '', port: 993, secure: true, username: '', password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, message }
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);

  // Load existing credential
  useEffect(() => {
    supabase
      .from('imap_credentials')
      .select('id, host, port, secure, username, provider, last_test_status, last_tested_at, email_label')
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => {
        setExistingCred(data ?? null);
        setLoading(false);
      });
  }, []);

  const applyPreset = (preset) => {
    setSelectedPreset(preset.id);
    setForm((f) => ({
      ...f,
      host:   preset.host,
      port:   preset.port,
      secure: preset.secure,
    }));
    setTestResult(null);
    setError(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await testImapConnection(form);
      setTestResult({ ok: true, message: result.message ?? 'Connection successful' });
    } catch (e) {
      setTestResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!testResult?.ok) {
      setError('Please test the connection successfully before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveImapCredentials({ ...form, provider: selectedPreset ?? 'imap' });
      // Reload existing cred
      const { data } = await supabase
        .from('imap_credentials')
        .select('id, host, port, secure, username, provider, last_test_status, last_tested_at')
        .eq('active', true)
        .maybeSingle();
      setExistingCred(data);
      setTestResult(null);
      setSelectedPreset(null);
      setForm({ host: '', port: 993, secure: true, username: '', password: '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingCred) return;
    try {
      await deleteImapCredentials(existingCred.id);
      setExistingCred(null);
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  // ---- Connected state ----
  if (existingCred && !selectedPreset) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Server className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-800">IMAP Connected</div>
                <div className="text-xs text-gray-500">
                  {existingCred.username} · {existingCred.host}:{existingCred.port}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {existingCred.last_test_status === 'ok' && (
                <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Last check OK
                </span>
              )}
              {existingCred.last_test_status === 'failed' && (
                <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                  <XCircle className="w-3 h-3" /> Last check failed
                </span>
              )}
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-3 py-2 text-sm text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          IMAP credentials are encrypted with Supabase Vault. Your password is never stored in plaintext.
        </div>
      </div>
    );
  }

  // ---- Setup form ----
  return (
    <div className="space-y-5">

      {/* Provider presets */}
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Choose provider</p>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors text-left ${
                selectedPreset === p.id
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
              }`}
            >
              <span className="text-lg">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hint for selected preset */}
      {selectedPreset && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          {PRESETS.find((p) => p.id === selectedPreset)?.hint}
        </div>
      )}

      {/* Form fields */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        {/* Host + port */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">IMAP Host</label>
            <input
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="imap.outlook.com"
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Port</label>
            <input
              type="number"
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value) }))}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            />
          </div>
        </div>

        {/* SSL toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setForm((f) => ({ ...f, secure: !f.secure }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              form.secure ? 'bg-gray-900' : 'bg-gray-200'
            }`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              form.secure ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
          <span className="text-sm text-gray-700">
            {form.secure ? 'SSL/TLS (port 993 — recommended)' : 'STARTTLS (port 143)'}
          </span>
        </div>

        {/* Username */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email / Username</label>
          <input
            type="email"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="you@company.com"
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          />
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <Lock className="w-3 h-3" /> Password / App Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="••••••••••••"
              className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            />
            <button
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
            <Lock className="w-3 h-3" /> Encrypted with Supabase Vault — never stored in plaintext
          </p>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm border ${
            testResult.ok
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {testResult.ok
              ? <CheckCircle2 className="w-4 h-4" />
              : <XCircle className="w-4 h-4" />
            }
            {testResult.message}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleTest}
            disabled={testing || !form.host || !form.username || !form.password}
            className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {testing
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Testing…</>
              : <><Server className="w-4 h-4" /> Test Connection</>
            }
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !testResult?.ok}
            className="flex-1 bg-gray-900 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors flex items-center justify-center gap-2"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : <><CheckCircle2 className="w-4 h-4" /> Save & Activate</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
