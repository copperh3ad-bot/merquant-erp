/**
 * AgentActions.jsx
 * Agent action approval queue and policy configuration
 * Route: /agent-actions
 * Roles: Owner, Manager, Merchandiser
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap, CheckCircle2, XCircle, Clock, AlertTriangle,
  Loader2, RefreshCw, Shield, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, Info, Play, Ban
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

const STATUS_STYLES = {
  pending:   { dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700 border-yellow-200', label: 'Pending'   },
  approved:  { dot: 'bg-blue-400',   badge: 'bg-blue-50 text-blue-700 border-blue-200',       label: 'Approved'  },
  executing: { dot: 'bg-violet-400', badge: 'bg-violet-50 text-violet-700 border-violet-200', label: 'Running'   },
  done:      { dot: 'bg-green-400',  badge: 'bg-green-50 text-green-700 border-green-200',    label: 'Done'      },
  rejected:  { dot: 'bg-red-400',    badge: 'bg-red-50 text-red-700 border-red-200',          label: 'Rejected'  },
  expired:   { dot: 'bg-gray-300',   badge: 'bg-gray-50 text-gray-500 border-gray-200',       label: 'Expired'   },
};

const AGENT_COLORS = {
  'orchestrator':    'text-blue-600 bg-blue-50',
  'tna-risk-agent':  'text-orange-600 bg-orange-50',
  'email-po-agent':  'text-violet-600 bg-violet-50',
  'ai-assistant':    'text-indigo-600 bg-indigo-50',
};

function getRelativeTime(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getExpiryLabel(isoDate) {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1)   return 'Expires < 1h';
  if (hrs < 24)  return `Expires in ${hrs}h`;
  return `Expires in ${Math.floor(hrs / 24)}d`;
}

// ---------------------------------------------------------------------------
// Action queue item
// ---------------------------------------------------------------------------

function ActionQueueItem({ action, onApprove, onReject, isOwner }) {
  const [expanded, setExpanded]     = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [loading, setLoading]       = useState(false);

  const style    = STATUS_STYLES[action.status] ?? STATUS_STYLES.pending;
  const agentCls = AGENT_COLORS[action.agent_name] ?? 'text-gray-600 bg-gray-50';
  const isPending = action.status === 'pending';

  const handleApprove = async () => {
    setLoading(true);
    try { await onApprove(action.id); }
    finally { setLoading(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setLoading(true);
    try { await onReject(action.id, rejectReason); }
    finally { setLoading(false); }
  };

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-all ${
      isPending ? 'border-yellow-200 shadow-sm' : 'border-gray-200'
    }`}>
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />

        {/* Agent name */}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${agentCls}`}>
          {action.agent_name}
        </span>

        {/* Action type */}
        <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
          {action.action_type}
        </span>

        {/* Description */}
        <span className="text-sm text-gray-800 flex-1 truncate">
          {action.description ?? 'No description'}
        </span>

        {/* Status badge */}
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${style.badge}`}>
          {style.label}
        </span>

        {/* Timing */}
        <span className="text-xs text-gray-400 shrink-0">
          {getRelativeTime(action.created_at)}
        </span>

        {/* Expiry warning */}
        {isPending && (
          <span className="text-xs text-orange-500 shrink-0">
            {getExpiryLabel(action.expires_at)}
          </span>
        )}

        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-300 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" />
        }
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          {/* Payload */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Action Payload</p>
            <pre className="text-xs text-gray-700 bg-gray-50 rounded-lg p-3 overflow-auto max-h-32 font-mono">
              {JSON.stringify(action.payload, null, 2)}
            </pre>
          </div>

          {/* Triggered by */}
          {action.triggered_by && (
            <div className="text-xs text-gray-500">
              <span className="font-medium">Triggered by:</span> {action.triggered_by}
            </div>
          )}

          {/* Error if any */}
          {action.execution_error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {action.execution_error}
            </div>
          )}

          {/* Rejection reason input */}
          {showReject && (
            <div className="flex gap-2">
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection…"
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-red-200 focus:outline-none focus:ring-2 focus:ring-red-300"
              />
              <button
                onClick={handleReject}
                disabled={loading || !rejectReason.trim()}
                className="px-4 py-1.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
              </button>
            </div>
          )}

          {/* Action buttons — pending only */}
          {isPending && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleApprove}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {loading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <CheckCircle2 className="w-4 h-4" />
                }
                Approve & Execute
              </button>
              <button
                onClick={() => setShowReject((v) => !v)}
                className="flex items-center gap-1.5 px-4 py-2 border border-red-200 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-50 transition-colors"
              >
                <XCircle className="w-4 h-4" /> Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policy row
// ---------------------------------------------------------------------------

function PolicyRow({ policy, onToggle, isOwner }) {
  const [saving, setSaving] = useState(false);

  const handleToggle = async (field) => {
    if (!isOwner) return;
    setSaving(true);
    try { await onToggle(policy.id, field, !policy[field]); }
    finally { setSaving(false); }
  };

  const agentCls = AGENT_COLORS[policy.agent_name] ?? 'text-gray-600 bg-gray-50';

  return (
    <div className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${agentCls}`}>
        {policy.agent_name}
      </span>
      <span className="text-xs font-mono text-gray-600 flex-1">{policy.action_type}</span>
      {policy.notes && (
        <span className="text-xs text-gray-400 flex-1 truncate">{policy.notes}</span>
      )}

      {/* Auto-execute toggle */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-gray-500">Auto</span>
        <button
          onClick={() => handleToggle('auto_execute')}
          disabled={!isOwner || saving}
          className={`transition-colors ${!isOwner ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          {policy.auto_execute
            ? <ToggleRight className="w-5 h-5 text-green-500" />
            : <ToggleLeft className="w-5 h-5 text-gray-300" />
          }
        </button>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-gray-500">On</span>
        <button
          onClick={() => handleToggle('enabled')}
          disabled={!isOwner || saving}
          className={`transition-colors ${!isOwner ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          {policy.enabled
            ? <ToggleRight className="w-5 h-5 text-blue-500" />
            : <ToggleLeft className="w-5 h-5 text-gray-300" />
          }
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

function StatsBar({ actions }) {
  const pending  = actions.filter((a) => a.status === 'pending').length;
  const approved = actions.filter((a) => a.status === 'done' && wasToday(a.executed_at)).length;
  const rejected = actions.filter((a) => a.status === 'rejected' && wasToday(a.updated_at)).length;
  const expired  = actions.filter((a) => a.status === 'expired').length;

  function wasToday(iso) {
    if (!iso) return false;
    const d = new Date(iso);
    const t = new Date();
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth();
  }

  return (
    <div className="grid grid-cols-4 gap-3">
      {[
        { label: 'Pending',        value: pending,  color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' },
        { label: 'Approved Today', value: approved, color: 'text-green-600',  bg: 'bg-green-50 border-green-200'  },
        { label: 'Rejected Today', value: rejected, color: 'text-red-600',    bg: 'bg-red-50 border-red-200'      },
        { label: 'Expired',        value: expired,  color: 'text-gray-500',   bg: 'bg-gray-50 border-gray-200'    },
      ].map((s) => (
        <div key={s.label} className={`rounded-2xl border p-4 ${s.bg}`}>
          <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AgentActions() {
  const { userProfile }     = useAuth();
  const isOwner             = userProfile?.role === 'Owner';
  const canApprove          = ['Owner', 'Manager'].includes(userProfile?.role);

  const [tab, setTab]           = useState('queue');
  const [actions, setActions]   = useState([]);
  const [policies, setPolicies] = useState([]);
  const [filter, setFilter]     = useState('pending');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const refreshRef              = useRef(null);

  const load = useCallback(async () => {
    try {
      const [{ data: acts }, { data: pols }] = await Promise.all([
        supabase
          .from('agent_action_queue')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('agent_action_policy')
          .select('*')
          .order('agent_name')
          .order('action_type'),
      ]);
      setActions(acts ?? []);
      setPolicies(pols ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 30 seconds
    refreshRef.current = setInterval(load, 30_000);
    return () => clearInterval(refreshRef.current);
  }, [load]);

  const handleApprove = async (id) => {
    // Mark approved
    const { error: updateErr } = await supabase
      .from('agent_action_queue')
      .update({
        status:      'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (updateErr) throw updateErr;

    // Execute via RPC
    const { error: execErr } = await supabase
      .rpc('execute_agent_action', { p_action_id: id });
    if (execErr) {
      setError(`Execution failed: ${execErr.message}`);
    }
    await load();
  };

  const handleReject = async (id, reason) => {
    await supabase
      .from('agent_action_queue')
      .update({
        status:        'rejected',
        reject_reason: reason,
      })
      .eq('id', id);
    await load();
  };

  const handlePolicyToggle = async (id, field, value) => {
    await supabase
      .from('agent_action_policy')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', id);
    setPolicies((p) => p.map((x) => x.id === id ? { ...x, [field]: value } : x));
  };

  const filtered = filter === 'all'
    ? actions
    : actions.filter((a) => a.status === filter);

  const pendingCount = actions.filter((a) => a.status === 'pending').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-yellow-100 flex items-center justify-center">
              <Zap className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">Agent Actions</h1>
              <p className="text-xs text-gray-500">
                Review and approve queued agent write actions
              </p>
            </div>
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-bold text-yellow-700 bg-yellow-100 border border-yellow-300 px-2.5 py-1 rounded-full animate-pulse">
                {pendingCount} pending
              </span>
            )}
          </div>
          <button
            onClick={load}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">
        {/* Stats */}
        <StatsBar actions={actions} />

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {[
            { id: 'queue',  label: 'Action Queue', count: pendingCount },
            { id: 'policy', label: 'Policy Settings' },
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
                <span className="text-xs font-bold text-yellow-600 bg-yellow-100 px-1.5 py-0.5 rounded-full">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Queue tab */}
        {tab === 'queue' && (
          <div className="space-y-4">
            {/* Filter */}
            <div className="flex gap-1">
              {['pending', 'approved', 'done', 'rejected', 'all'].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    filter === f
                      ? 'bg-gray-900 text-white'
                      : 'border border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {!canApprove && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-xs">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                You can view actions but only Owners and Managers can approve or reject.
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 space-y-2 text-gray-400">
                <CheckCircle2 className="w-10 h-10 mx-auto opacity-20" />
                <p className="text-sm">No {filter === 'all' ? '' : filter} actions.</p>
                <p className="text-xs">
                  Agent actions appear here when auto_execute=false in policy settings.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((action) => (
                  <ActionQueueItem
                    key={action.id}
                    action={action}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    isOwner={isOwner}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Policy tab */}
        {tab === 'policy' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-700">Agent Action Policy</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <ToggleRight className="w-4 h-4 text-green-500" /> Auto = runs without approval
                </span>
                <span className="flex items-center gap-1">
                  <ToggleRight className="w-4 h-4 text-blue-500" /> On = action is enabled
                </span>
                {!isOwner && (
                  <span className="text-orange-500">Owner role required to edit</span>
                )}
              </div>
            </div>

            <div className="px-5 py-2">
              {loading ? (
                <div className="flex items-center justify-center h-24 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
                </div>
              ) : policies.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No policies found. Run migration 36 in Supabase SQL editor.
                </p>
              ) : (
                policies.map((p) => (
                  <PolicyRow
                    key={p.id}
                    policy={p}
                    onToggle={handlePolicyToggle}
                    isOwner={isOwner}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
