/**
 * EventStreamPanel.jsx
 *
 * Live feed of agent_events (mig 0034). Subscribes to Postgres changes via
 * Supabase realtime and shows a rolling list of events with status, entity,
 * and elapsed time.
 *
 * Used as a tab inside AgentMemory.jsx (Phase 16).
 *
 * agent_events RLS allows read for Owner+Manager only — the page wraps
 * this in role-gating already (PAGE_VISIBILITY: AgentMemory → Owner+Manager).
 */

import { useState, useEffect, useRef } from 'react';
import {
  Activity, CheckCircle2, XCircle, Clock, AlertTriangle,
  Loader2, RefreshCw, Filter, Pause, Play
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  pending:    { label: 'Pending',    icon: Clock,           cls: 'text-gray-500 bg-gray-50 border-gray-200' },
  processing: { label: 'Processing', icon: Loader2,         cls: 'text-blue-700 bg-blue-50 border-blue-200', spin: true },
  done:       { label: 'Done',       icon: CheckCircle2,    cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  failed:     { label: 'Failed',     icon: XCircle,         cls: 'text-red-700 bg-red-50 border-red-200' },
  skipped:    { label: 'Skipped',    icon: AlertTriangle,   cls: 'text-amber-700 bg-amber-50 border-amber-200' },
};

const EVENT_TYPE_LABELS = {
  'po.created':              'PO Created',
  'po.approved':             'PO Approved',
  'po.rejected':             'PO Rejected',
  'po.pending':              'PO Pending',
  'milestone.completed':     'Milestone Completed',
  'milestone.risk_escalated':'Milestone Risk Escalated',
  'email_draft.confirmed':   'Email Draft Confirmed',
  'shipment.created':        'Shipment Created',
  'shipment.delayed':        'Shipment Delayed',
  'qc.failed':               'QC Failed',
  'tna_draft.sent':          'TNA Draft Sent',
};

function formatRelative(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------

function EventRow({ event }) {
  const cfg = STATUS_CONFIG[event.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const eventLabel = EVENT_TYPE_LABELS[event.event_type] ?? event.event_type;

  // Pull a useful preview from payload — buyer_name / po_number / milestone_name first.
  const payload = event.payload ?? {};
  const previewLines = [];
  if (payload.po_number)       previewLines.push(`PO ${payload.po_number}`);
  if (payload.buyer_name)      previewLines.push(payload.buyer_name);
  if (payload.milestone_name)  previewLines.push(payload.milestone_name);
  if (payload.new_status)      previewLines.push(`→ ${payload.new_status}`);
  if (payload.new_risk)        previewLines.push(`risk: ${payload.new_risk}`);
  if (payload.total_defects != null) previewLines.push(`${payload.total_defects} defects`);

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${cfg.cls}`}>
        <Icon className={`w-3.5 h-3.5 ${cfg.spin ? 'animate-spin' : ''}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-semibold text-gray-900">{eventLabel}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${cfg.cls}`}>
            {cfg.label}
          </span>
          <span className="text-[10px] text-gray-400 font-mono">{event.entity_type}</span>
        </div>
        {previewLines.length > 0 && (
          <p className="text-xs text-gray-600 truncate">{previewLines.join(' • ')}</p>
        )}
        {event.error && (
          <p className="text-xs text-red-600 mt-1 font-mono truncate" title={event.error}>
            ⚠ {event.error}
          </p>
        )}
        {event.agent_name && (
          <p className="text-[10px] text-gray-400 mt-0.5">handled by {event.agent_name}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-gray-400">{formatRelative(event.triggered_at)}</p>
        {event.processed_at && (
          <p className="text-[9px] text-gray-300">
            done in {Math.max(0, new Date(event.processed_at) - new Date(event.triggered_at))}ms
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function EventStreamPanel() {
  const [events, setEvents]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [filterStatus, setFilter] = useState('all');
  const [paused, setPaused]       = useState(false);
  const channelRef                = useRef(null);

  // Initial load (last 100 events).
  const load = async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('agent_events')
      .select('*')
      .order('triggered_at', { ascending: false })
      .limit(100);
    if (err) setError(err.message);
    setEvents(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Realtime subscription on agent_events.
  useEffect(() => {
    if (paused) return;

    const channel = supabase
      .channel('agent-events-stream')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_events' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setEvents((prev) => [payload.new, ...prev].slice(0, 200));
          } else if (payload.eventType === 'UPDATE') {
            setEvents((prev) => prev.map((e) => (e.id === payload.new.id ? payload.new : e)));
          } else if (payload.eventType === 'DELETE') {
            setEvents((prev) => prev.filter((e) => e.id !== payload.old.id));
          }
        }
      )
      .subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [paused]);

  // Filter + tick clock every 30s so "Xm ago" updates without realtime push.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const filtered = filterStatus === 'all'
    ? events
    : events.filter((e) => e.status === filterStatus);

  const counts = events.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
          <Activity className="w-4 h-4 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Agent Event Stream</h3>
          <p className="text-[10px] text-gray-500">
            {events.length} recent events • realtime {paused ? 'paused' : 'live'}
          </p>
        </div>
        <button
          onClick={() => setPaused((p) => !p)}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 hover:bg-gray-50 flex items-center gap-1.5"
          title={paused ? 'Resume realtime updates' : 'Pause realtime updates'}
        >
          {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button onClick={load} className="p-1.5 text-gray-400 hover:text-gray-600">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 bg-gray-50">
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        {['all', 'pending', 'processing', 'done', 'failed', 'skipped'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              filterStatus === s ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'all' ? `All (${events.length})` : `${s}${counts[s] ? ` (${counts[s]})` : ''}`}
          </button>
        ))}
      </div>

      {/* List */}
      {error && (
        <div className="p-3 text-xs text-red-700 bg-red-50 border-b border-red-200">{error}</div>
      )}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading events…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 space-y-1">
          <Activity className="w-8 h-8 mx-auto opacity-20" />
          <p className="text-sm">No events yet</p>
          <p className="text-xs">
            Events will appear here as POs are created, approved, milestones change, etc.
          </p>
        </div>
      ) : (
        <div className="max-h-[600px] overflow-y-auto">
          {filtered.map((e) => <EventRow key={e.id} event={e} />)}
        </div>
      )}
    </div>
  );
}
