/**
 * EmailCrawlerAgentPanel.jsx
 * 
 * Add this component to your existing EmailCrawler.jsx page
 * OR include it in EmailPOAgent.jsx as a settings panel.
 *
 * Shows:
 * - Gmail connection status
 * - Connect / disconnect Gmail button (OAuth flow)
 * - Agent run history (from agent_run_log)
 * - Live draft queue (pending_review drafts)
 * - Manual trigger button (for testing)
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, Wifi, WifiOff, Play, RefreshCw, Clock,
  CheckCircle2, AlertTriangle, XCircle, Loader2,
  Sparkles, ArrowRight, Eye
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getEmailPODrafts } from '../api/emailPoAgent';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Google OAuth config — set these in your .env
const GOOGLE_CLIENT_ID    = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI = `${window.location.origin}/gmail-callback`;
const GMAIL_SCOPES        = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',  // needed to mark as read
].join(' ');

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

export function initiateGmailOAuth() {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         GMAIL_SCOPES,
    access_type:   'offline',   // gets refresh_token
    prompt:        'consent',   // force consent to always get refresh_token
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Call this from a /gmail-callback route after OAuth redirect
export async function handleGmailOAuthCallback(code) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-oauth-exchange`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        ANON_KEY,
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify({ code, redirect_uri: GOOGLE_REDIRECT_URI }),
  });
  if (!res.ok) throw new Error(`OAuth exchange failed: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Trigger agent manually
// ---------------------------------------------------------------------------

async function triggerAgentManually() {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/email-crawler-agent`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        ANON_KEY,
      Authorization:  `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Agent trigger failed: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ status }) {
  const map = {
    success: { icon: CheckCircle2, cls: 'text-green-600 bg-green-50 border-green-200',  label: 'Success'  },
    partial: { icon: AlertTriangle, cls: 'text-yellow-600 bg-yellow-50 border-yellow-200', label: 'Partial' },
    error:   { icon: XCircle,       cls: 'text-red-600 bg-red-50 border-red-200',       label: 'Error'    },
  };
  const { icon: Icon, cls, label } = map[status] ?? map.error;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main panel component
// ---------------------------------------------------------------------------
export default function EmailCrawlerAgentPanel() {
  const navigate = useNavigate();
  const [gmailToken, setGmailToken]   = useState(null);
  const [runLog, setRunLog]           = useState([]);
  const [drafts, setDrafts]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [triggering, setTriggering]   = useState(false);
  const [triggerResult, setTriggerResult] = useState(null);
  const [error, setError]             = useState(null);

  // Load data
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Check Gmail connection
        const { data: token } = await supabase
          .from('gmail_tokens')
          .select('id, email, active, updated_at')
          .eq('active', true)
          .maybeSingle();
        setGmailToken(token);

        // Recent agent runs
        const { data: runs } = await supabase
          .from('agent_run_log')
          .select('*')
          .eq('agent_name', 'email-crawler-agent')
          .order('run_at', { ascending: false })
          .limit(10);
        setRunLog(runs ?? []);

        // Pending drafts
        const pending = await getEmailPODrafts({ status: 'pending_review', limit: 20 });
        setDrafts(pending ?? []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleManualTrigger = async () => {
    setTriggering(true);
    setTriggerResult(null);
    setError(null);
    try {
      const result = await triggerAgentManually();
      setTriggerResult(result);
      // Refresh drafts
      const pending = await getEmailPODrafts({ status: 'pending_review', limit: 20 });
      setDrafts(pending ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setTriggering(false);
    }
  };

  const handleDisconnect = async () => {
    if (!gmailToken) return;
    await supabase.from('gmail_tokens').update({ active: false }).eq('id', gmailToken.id);
    setGmailToken(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading agent status…
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ---- Gmail connection status ---- */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              gmailToken ? 'bg-green-100' : 'bg-gray-100'
            }`}>
              {gmailToken ? (
                <Wifi className="w-5 h-5 text-green-600" />
              ) : (
                <WifiOff className="w-5 h-5 text-gray-400" />
              )}
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-800">
                {gmailToken ? 'Gmail Connected' : 'Gmail Not Connected'}
              </div>
              <div className="text-xs text-gray-500">
                {gmailToken
                  ? `${gmailToken.email} · Agent runs every 15 min`
                  : 'Connect Gmail to enable autonomous PO extraction'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {gmailToken ? (
              <>
                <button
                  onClick={handleManualTrigger}
                  disabled={triggering}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {triggering
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
                    : <><Play className="w-4 h-4" /> Run Now</>
                  }
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-3 py-2 text-sm font-medium text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition-colors"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={initiateGmailOAuth}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors"
              >
                <Mail className="w-4 h-4" /> Connect Gmail
              </button>
            )}
          </div>
        </div>

        {/* Manual trigger result */}
        {triggerResult && (
          <div className="mt-4 p-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-700">
            <span className="font-semibold">Run complete — </span>
            {triggerResult.emails_checked} emails checked,{' '}
            <span className="font-bold">{triggerResult.drafts_created} PO draft(s) created</span>,{' '}
            {triggerResult.skipped} skipped
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* ---- Pending draft queue ---- */}
      {drafts.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-semibold text-gray-700">Pending Review</span>
            <span className="ml-1 text-xs font-medium text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
              {drafts.length}
            </span>
            <span className="ml-auto text-xs text-gray-400">AI-extracted, awaiting confirmation</span>
          </div>

          <div className="divide-y divide-gray-50">
            {drafts.map((draft) => {
              const conf = Math.round((draft.overall_confidence ?? 0) * 100);
              const confColor = conf >= 85 ? 'text-green-600' : conf >= 60 ? 'text-yellow-600' : 'text-red-600';
              return (
                <div key={draft.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {draft.buyer_name ?? 'Unknown buyer'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {draft.po_number
                        ? `PO ${draft.po_number} · `
                        : ''
                      }
                      {draft.items?.length ?? 0} items ·{' '}
                      {new Date(draft.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className={`text-sm font-bold ${confColor}`}>{conf}%</div>
                  {draft.unmatched_items?.length > 0 && (
                    <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      {draft.unmatched_items.length} unmatched
                    </span>
                  )}
                  <button
                    onClick={() => navigate(`/email-po-agent?draft=${draft.id}`)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" /> Review
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- Agent run history ---- */}
      {runLog.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">Agent Run History</span>
          </div>
          <div className="divide-y divide-gray-50">
            {runLog.map((run) => (
              <div key={run.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <StatusBadge status={run.status} />
                <span className="text-gray-500 text-xs">
                  {new Date(run.run_at).toLocaleString()}
                </span>
                {run.summary && (
                  <span className="text-xs text-gray-400 ml-auto">
                    {run.summary.emails_checked ?? 0} checked ·{' '}
                    <span className="text-gray-600 font-medium">
                      {run.summary.drafts_created ?? 0} drafts
                    </span>
                    {run.summary.errors > 0 && (
                      <span className="text-red-500"> · {run.summary.errors} errors</span>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Empty state ---- */}
      {!gmailToken && runLog.length === 0 && drafts.length === 0 && (
        <div className="text-center py-12 text-gray-400 space-y-2">
          <Sparkles className="w-8 h-8 mx-auto opacity-30" />
          <p className="text-sm">Connect Gmail above to start the autonomous agent.</p>
          <p className="text-xs">The agent will run every 15 minutes, classify emails, and create PO drafts automatically.</p>
        </div>
      )}
    </div>
  );
}
