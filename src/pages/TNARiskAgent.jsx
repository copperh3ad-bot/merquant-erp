/**
 * TNARiskAgent.jsx
 * T&A Risk Agent — review queue and threshold configurator
 *
 * Place at: src/pages/TNARiskAgent.jsx
 * Route:    /tna-risk-agent
 * Roles:    Owner, Manager, Merchandiser
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Clock, CheckCircle2, XCircle, Send,
  Settings, ChevronDown, ChevronUp, Loader2, Play,
  RotateCcw, Mail, Calendar, Package, Sparkles,
  Flag, Info, Edit3, Eye, EyeOff, Trash2, Save
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Risk level styling
// ---------------------------------------------------------------------------
const RISK_STYLES = {
  critical: {
    badge:  'bg-red-100 text-red-700 border border-red-300',
    row:    'border-l-4 border-l-red-500 bg-red-50/30',
    dot:    'bg-red-500',
    label:  '🔴 Critical',
  },
  overdue: {
    badge:  'bg-orange-100 text-orange-700 border border-orange-300',
    row:    'border-l-4 border-l-orange-400 bg-orange-50/20',
    dot:    'bg-orange-400',
    label:  '🟠 Overdue',
  },
  at_risk: {
    badge:  'bg-yellow-100 text-yellow-700 border border-yellow-300',
    row:    'border-l-4 border-l-yellow-400 bg-yellow-50/20',
    dot:    'bg-yellow-400',
    label:  '🟡 At Risk',
  },
};

const URGENCY_COLORS = {
  critical: 'text-red-600',
  high:     'text-orange-600',
  medium:   'text-yellow-600',
  low:      'text-gray-500',
};

// ---------------------------------------------------------------------------
// Trigger agent manually
// ---------------------------------------------------------------------------
async function triggerTNAAgent(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/tna-risk-agent`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        ANON_KEY,
      Authorization:  `Bearer ${accessToken}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ---------------------------------------------------------------------------
// Send email (logs to comms_log)
// ---------------------------------------------------------------------------
async function sendDraftEmail(draft, editedSubject, editedBody, toEmail) {
  // Update draft status
  const { error } = await supabase
    .from('tna_risk_drafts')
    .update({
      status:         'sent',
      sent_at:        new Date().toISOString(),
      sent_to_email:  toEmail,
      email_subject:  editedSubject,
      email_body:     editedBody,
    })
    .eq('id', draft.id);
  if (error) throw error;

  // Log to comms_log
  await supabase.from('comms_log').insert({
    po_id:      draft.po_id,
    type:       'email',
    direction:  'outbound',
    subject:    editedSubject,
    body:       editedBody,
    to_email:   toEmail,
    sent_at:    new Date().toISOString(),
    source:     'tna_risk_agent',
  });
}

// ---------------------------------------------------------------------------
// Draft card component
// ---------------------------------------------------------------------------
function DraftCard({ draft, onSent, onDismissed, isSelected, onSelect }) {
  const [editing, setEditing]         = useState(false);
  const [subject, setSubject]         = useState(draft.email_subject ?? '');
  const [body, setBody]               = useState(draft.email_body ?? '');
  const [toEmail, setToEmail]         = useState(draft.buyer_email ?? '');
  const [sending, setSending]         = useState(false);
  const [dismissing, setDismissing]   = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [showDismiss, setShowDismiss] = useState(false);
  const [error, setError]             = useState(null);

  const risk    = RISK_STYLES[draft.risk_level] ?? RISK_STYLES.at_risk;
  const daysAbs = Math.abs(draft.days_relative ?? 0);
  const daysLabel = draft.days_relative > 0
    ? `${daysAbs}d overdue`
    : draft.days_relative < 0
    ? `${daysAbs}d remaining`
    : 'due today';

  const handleSend = async () => {
    if (!toEmail) { setError('Enter recipient email first.'); return; }
    setSending(true);
    setError(null);
    try {
      await sendDraftEmail(draft, subject, body, toEmail);
      onSent(draft.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await supabase.from('tna_risk_drafts').update({
        status:       'dismissed',
        dismissed_at: new Date().toISOString(),
        dismiss_reason: dismissReason || 'Resolved',
      }).eq('id', draft.id);
      onDismissed(draft.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className={`rounded-2xl bg-white overflow-hidden shadow-sm ${risk.row}`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer"
        onClick={() => onSelect(isSelected ? null : draft.id)}
      >
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${risk.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-900">{draft.milestone_name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${risk.badge}`}>
              {risk.label}
            </span>
            <span className="text-xs text-gray-400">{daysLabel}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Package className="w-3 h-3" /> {draft.po_number ?? 'N/A'}
            </span>
            <span>{draft.buyer_name}</span>
            {draft.due_date && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Due {new Date(draft.due_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        {draft.suggested_action && (
          <div className="hidden lg:flex items-center gap-1 text-xs text-gray-500 max-w-xs truncate">
            <Flag className="w-3 h-3 shrink-0 text-gray-400" />
            {draft.suggested_action}
          </div>
        )}
        <div className={`text-xs font-semibold uppercase ${URGENCY_COLORS[draft.urgency]}`}>
          {draft.urgency}
        </div>
        {isSelected ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </div>

      {/* Expanded email editor */}
      {isSelected && (
        <div className="px-5 pb-5 border-t border-gray-100 space-y-4 pt-4">
          {/* Suggested action */}
          {draft.suggested_action && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-xs">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span><strong>Suggested action:</strong> {draft.suggested_action}</span>
            </div>
          )}

          {/* Recipient */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
              <Mail className="w-3 h-3" /> Send To
            </label>
            <input
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="buyer@company.com"
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
            />
          </div>

          {/* Subject */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Subject</label>
              <button
                onClick={() => setEditing((v) => !v)}
                className="text-xs text-violet-600 flex items-center gap-1 hover:text-violet-800"
              >
                <Edit3 className="w-3 h-3" /> {editing ? 'Lock' : 'Edit'}
              </button>
            </div>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              readOnly={!editing}
              className={`px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-violet-300 ${
                editing ? 'border-violet-300 bg-white' : 'border-gray-200 bg-gray-50'
              }`}
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-violet-500" /> AI-Drafted Email Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              readOnly={!editing}
              rows={10}
              className={`px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none leading-relaxed ${
                editing ? 'border-violet-300 bg-white' : 'border-gray-200 bg-gray-50'
              }`}
            />
          </div>

          {/* Revised date suggestion */}
          {draft.revised_date && (
            <div className="text-xs text-gray-500">
              💡 Agent suggests revised date:{' '}
              <span className="font-semibold text-gray-700">
                {new Date(draft.revised_date).toLocaleDateString()}
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}

          {/* Dismiss reason */}
          {showDismiss && (
            <div className="flex gap-2">
              <input
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="Reason for dismissing (e.g. issue resolved, buyer aware)"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <button
                onClick={handleDismiss}
                disabled={dismissing}
                className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {dismissing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleSend}
              disabled={sending}
              className="flex-1 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              {sending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                : <><Send className="w-4 h-4" /> Send to Buyer</>
              }
            </button>
            <button
              onClick={() => setShowDismiss((v) => !v)}
              className="px-5 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors flex items-center gap-1.5"
            >
              <XCircle className="w-4 h-4" /> Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Threshold configurator row
// ---------------------------------------------------------------------------
function ThresholdRow({ threshold, onChange, onSave }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues]   = useState({
    at_risk_days:  threshold.at_risk_days,
    overdue_days:  threshold.overdue_days,
    critical_days: threshold.critical_days,
  });

  const handleSave = async () => {
    await onSave(threshold.id, values);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700 flex-1">{threshold.milestone_name}</span>
      <div className="flex items-center gap-2">
        {['at_risk_days', 'overdue_days', 'critical_days'].map((key, i) => (
          <div key={key} className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-400">{['At Risk', 'Overdue', 'Critical'][i]}</span>
            <input
              type="number"
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: parseInt(e.target.value) }))}
              disabled={!editing}
              className={`w-14 px-2 py-1 text-xs text-center rounded border ${
                editing ? 'border-violet-300 bg-white' : 'border-gray-100 bg-gray-50 text-gray-500'
              } focus:outline-none focus:ring-1 focus:ring-violet-300`}
            />
          </div>
        ))}
        {editing ? (
          <button onClick={handleSave} className="ml-1 text-green-600 hover:text-green-700">
            <Save className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={() => setEditing(true)} className="ml-1 text-gray-400 hover:text-gray-600">
            <Edit3 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function TNARiskAgent() {
  const { userProfile } = useAuth();
  const [searchParams]  = useSearchParams();
  const navigate        = useNavigate();
  const focusDraftId    = searchParams.get('draft');

  const [tab, setTab]                 = useState('queue');
  const [drafts, setDrafts]           = useState([]);
  const [thresholds, setThresholds]   = useState([]);
  const [runLog, setRunLog]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [triggering, setTriggering]   = useState(false);
  const [triggerResult, setTriggerResult] = useState(null);
  const [selectedDraftId, setSelectedDraftId] = useState(focusDraftId ?? null);
  const [filterRisk, setFilterRisk]   = useState('all');
  const [error, setError]             = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [draftsRes, thresholdsRes, logsRes] = await Promise.all([
        supabase
          .from('tna_risk_drafts')
          .select('*')
          .eq('status', 'pending_review')
          .order('risk_level', { ascending: true })  // critical first
          .order('days_relative', { ascending: false }),
        supabase
          .from('tna_risk_thresholds')
          .select('*')
          .is('calendar_id', null)  // global defaults
          .order('milestone_name'),
        supabase
          .from('agent_run_log')
          .select('*')
          .eq('agent_name', 'tna-risk-agent')
          .order('run_at', { ascending: false })
          .limit(7),
      ]);
      setDrafts(draftsRes.data ?? []);
      setThresholds(thresholdsRes.data ?? []);
      setRunLog(logsRes.data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const handleManualTrigger = async () => {
    setTriggering(true);
    setTriggerResult(null);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const result  = await triggerTNAAgent(session?.access_token);
      setTriggerResult(result);
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setTriggering(false);
    }
  };

  const handleSaveThreshold = async (id, values) => {
    const { error } = await supabase
      .from('tna_risk_thresholds')
      .update(values)
      .eq('id', id);
    if (error) setError(error.message);
  };

  const handleSent       = (id) => setDrafts((d) => d.filter((x) => x.id !== id));
  const handleDismissed  = (id) => setDrafts((d) => d.filter((x) => x.id !== id));

  const filtered = filterRisk === 'all'
    ? drafts
    : drafts.filter((d) => d.risk_level === filterRisk);

  const counts = {
    critical: drafts.filter((d) => d.risk_level === 'critical').length,
    overdue:  drafts.filter((d) => d.risk_level === 'overdue').length,
    at_risk:  drafts.filter((d) => d.risk_level === 'at_risk').length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">T&A Risk Agent</h1>
              <p className="text-xs text-gray-500">Autonomous milestone monitoring · Runs daily at 7 AM PKT</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {counts.critical > 0 && (
              <span className="flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 border border-red-300 px-2.5 py-1 rounded-full animate-pulse">
                🔴 {counts.critical} critical
              </span>
            )}
            <button
              onClick={handleManualTrigger}
              disabled={triggering}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {triggering
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
                : <><Play className="w-4 h-4" /> Run Now</>
              }
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">
        {/* Trigger result */}
        {triggerResult && (
          <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-sm text-green-700">
            <span className="font-semibold">Run complete — </span>
            {triggerResult.calendars_scanned} calendars scanned,{' '}
            {triggerResult.milestones_flagged} flagged,{' '}
            <span className="font-bold">{triggerResult.emails_drafted} email(s) drafted</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {[
            { id: 'queue', label: `Review Queue`, count: drafts.length },
            { id: 'thresholds', label: 'Thresholds' },
            { id: 'history', label: 'Run History' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ---- QUEUE TAB ---- */}
        {tab === 'queue' && (
          <div className="space-y-4">
            {/* Risk filter */}
            <div className="flex items-center gap-2">
              {[
                { id: 'all',      label: `All (${drafts.length})` },
                { id: 'critical', label: `🔴 Critical (${counts.critical})` },
                { id: 'overdue',  label: `🟠 Overdue (${counts.overdue})` },
                { id: 'at_risk',  label: `🟡 At Risk (${counts.at_risk})` },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterRisk(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filterRisk === f.id
                      ? 'bg-gray-900 text-white'
                      : 'border border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading drafts…
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 space-y-2 text-gray-400">
                <CheckCircle2 className="w-10 h-10 mx-auto opacity-30" />
                <p className="text-sm font-medium">All clear — no at-risk milestones</p>
                <p className="text-xs">Agent runs daily at 7 AM PKT. Use "Run Now" to check immediately.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((draft) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    onSent={handleSent}
                    onDismissed={handleDismissed}
                    isSelected={selectedDraftId === draft.id}
                    onSelect={setSelectedDraftId}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- THRESHOLDS TAB ---- */}
        {tab === 'thresholds' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Global Risk Thresholds</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Days relative to due date. Negative = early warning before due date. Positive = tolerance after due date.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> At Risk</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" /> Overdue</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Critical</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-2">
              {thresholds.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No thresholds configured. Run migration 33 first.</p>
              ) : (
                thresholds.map((t) => (
                  <ThresholdRow
                    key={t.id}
                    threshold={t}
                    onChange={() => {}}
                    onSave={handleSaveThreshold}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* ---- HISTORY TAB ---- */}
        {tab === 'history' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">Agent Run History</h3>
            </div>
            {runLog.length === 0 ? (
              <p className="text-sm text-gray-400 p-5 text-center">No runs yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {runLog.map((run) => (
                  <div key={run.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                    <span className={`w-2 h-2 rounded-full ${
                      run.status === 'success' ? 'bg-green-400'
                      : run.status === 'partial' ? 'bg-yellow-400'
                      : 'bg-red-400'
                    }`} />
                    <span className="text-xs text-gray-500 w-40">
                      {new Date(run.run_at).toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-600">
                      {run.summary?.calendars_scanned ?? 0} calendars ·{' '}
                      {run.summary?.milestones_flagged ?? 0} flagged ·{' '}
                      <span className="font-semibold">{run.summary?.emails_drafted ?? 0} drafted</span>
                    </span>
                    {run.summary?.errors > 0 && (
                      <span className="text-xs text-red-500 ml-auto">
                        {run.summary.errors} errors
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
