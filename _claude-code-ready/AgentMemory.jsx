/**
 * AgentMemory.jsx
 * Browse, search, and manage all agent memories
 * Route: /agent-memory
 * Roles: Owner, Manager
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Brain, Search, Filter, CheckCircle2, XCircle,
  AlertTriangle, Clock, Tag, Loader2, ChevronDown,
  ChevronUp, Trash2, Star, RefreshCw, Eye, Building2,
  Truck, Package, Bot, ThumbsUp, ThumbsDown
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// ---------------------------------------------------------------------------
// Memory type config
// ---------------------------------------------------------------------------
const MEMORY_TYPES = {
  buyer:      { label: 'Buyer',      icon: Building2, color: 'blue'   },
  supplier:   { label: 'Supplier',   icon: Truck,     color: 'purple' },
  order:      { label: 'Order',      icon: Package,   color: 'green'  },
  correction: { label: 'Correction', icon: Bot,       color: 'orange' },
};

const COLOR_MAP = {
  blue:   { badge: 'bg-blue-50 text-blue-700 border-blue-200',   dot: 'bg-blue-400'   },
  purple: { badge: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-400' },
  green:  { badge: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-400'  },
  orange: { badge: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-400' },
};

const SENTIMENT_ICONS = {
  positive: { icon: '✓', cls: 'text-green-600' },
  negative: { icon: '⚠', cls: 'text-red-500'   },
  neutral:  { icon: '·', cls: 'text-gray-400'   },
};

const IMPORTANCE_STARS = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

function getRelativeAge(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ---------------------------------------------------------------------------
// Memory card
// ---------------------------------------------------------------------------
function MemoryCard({ memory, onVerify, onDeactivate }) {
  const [expanded, setExpanded] = useState(false);
  const config  = MEMORY_TYPES[memory.memory_type] ?? MEMORY_TYPES.order;
  const colors  = COLOR_MAP[config.color];
  const sent    = SENTIMENT_ICONS[memory.sentiment ?? 'neutral'];
  const Icon    = config.icon;

  return (
    <div className={`bg-white rounded-2xl border border-gray-200 overflow-hidden transition-all ${
      !memory.is_active ? 'opacity-40' : ''
    }`}>
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Type icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${colors.badge} border`}>
          <Icon className="w-4 h-4" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colors.badge}`}>
              {config.label}
            </span>
            <span className="text-xs font-medium text-gray-600">{memory.entity_label}</span>
            <span className="text-xs text-gray-400">{memory.source_event}</span>
            <span className={`text-xs font-bold ${sent.cls}`}>{sent.icon}</span>
            {memory.verified_at && (
              <span className="text-xs text-green-600 flex items-center gap-0.5">
                <CheckCircle2 className="w-3 h-3" /> Verified
              </span>
            )}
          </div>
          <p className="text-sm text-gray-800 leading-snug">{memory.summary}</p>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
            <span className="text-yellow-500 font-bold text-xs">{IMPORTANCE_STARS(memory.importance)}</span>
            <span>{getRelativeAge(memory.created_at)}</span>
            <span>{memory.created_by_agent}</span>
            {memory.tags?.slice(0, 3).map((t) => (
              <span key={t} className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {!memory.verified_at && (
            <button
              onClick={(e) => { e.stopPropagation(); onVerify(memory.id); }}
              className="p-1.5 text-gray-300 hover:text-green-500 transition-colors"
              title="Verify this memory"
            >
              <ThumbsUp className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDeactivate(memory.id); }}
            className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
            title="Deactivate memory"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-300" />
            : <ChevronDown className="w-4 h-4 text-gray-300" />
          }
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && memory.detail && Object.keys(memory.detail).length > 0 && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-50">
          <div className="bg-gray-50 rounded-xl p-3 mt-2 grid grid-cols-2 gap-2">
            {Object.entries(memory.detail)
              .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
              .map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-400 uppercase tracking-wide">
                    {k.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-gray-700 font-medium">
                    {Array.isArray(v) ? v.join(', ') : String(v)}
                  </span>
                </div>
              ))
            }
          </div>
          {memory.raw_context && (
            <details className="mt-2">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                Show source context
              </summary>
              <pre className="mt-1 text-xs text-gray-500 bg-gray-50 rounded-lg p-2 overflow-auto max-h-32 whitespace-pre-wrap">
                {memory.raw_context}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------
function MemoryStats({ memories }) {
  const counts = memories.reduce((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="grid grid-cols-4 gap-3">
      {Object.entries(MEMORY_TYPES).map(([type, config]) => {
        const colors = COLOR_MAP[config.color];
        const Icon   = config.icon;
        return (
          <div key={type} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${colors.badge}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{counts[type] ?? 0}</div>
              <div className="text-xs text-gray-500">{config.label} memories</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AgentMemory() {
  const [memories, setMemories]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterSent, setFilterSent] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError]           = useState(null);

  useEffect(() => { loadMemories(); }, [showInactive]);

  async function loadMemories() {
    setLoading(true);
    try {
      let query = supabase
        .from('agent_memories')
        .select('*')
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

      if (!showInactive) query = query.eq('is_active', true);

      const { data, error } = await query;
      if (error) throw error;
      setMemories(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const handleVerify = async (id) => {
    await supabase.from('agent_memories').update({
      verified_at: new Date().toISOString(),
    }).eq('id', id);
    setMemories((m) => m.map((x) => x.id === id
      ? { ...x, verified_at: new Date().toISOString() } : x));
  };

  const handleDeactivate = async (id) => {
    await supabase.from('agent_memories').update({ is_active: false }).eq('id', id);
    setMemories((m) => showInactive
      ? m.map((x) => x.id === id ? { ...x, is_active: false } : x)
      : m.filter((x) => x.id !== id));
  };

  const filtered = memories.filter((m) => {
    if (filterType !== 'all' && m.memory_type !== filterType) return false;
    if (filterSent !== 'all' && m.sentiment !== filterSent) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        m.summary?.toLowerCase().includes(s) ||
        m.entity_label?.toLowerCase().includes(s) ||
        m.tags?.some((t) => t.includes(s))
      );
    }
    return true;
  });

  const activeMemories = memories.filter((m) => m.is_active);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Brain className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">Agent Memory</h1>
              <p className="text-xs text-gray-500">
                {activeMemories.length} active memories across {
                  new Set(activeMemories.map((m) => m.entity_id)).size
                } entities
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded"
              />
              Show inactive
            </label>
            <button
              onClick={loadMemories}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">
        {/* Stats */}
        <MemoryStats memories={activeMemories} />

        {/* Search + filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memories, entities, tags…"
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
            />
          </div>

          {/* Type filter */}
          <div className="flex gap-1">
            {[{ id: 'all', label: 'All' }, ...Object.entries(MEMORY_TYPES).map(([id, c]) => ({ id, label: c.label }))].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterType === f.id
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-200 text-gray-600 hover:border-gray-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Sentiment filter */}
          <div className="flex gap-1">
            {[
              { id: 'all',      label: 'All' },
              { id: 'positive', label: '✓ Positive' },
              { id: 'negative', label: '⚠ Negative' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterSent(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterSent === f.id
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-200 text-gray-600 hover:border-gray-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Memory list */}
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading memories…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-2 text-gray-400">
            <Brain className="w-10 h-10 mx-auto opacity-20" />
            <p className="text-sm">
              {search ? `No memories matching "${search}"` : 'No memories yet.'}
            </p>
            <p className="text-xs">
              Memories are created automatically as agents process emails, POs, and T&A milestones.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">{filtered.length} memories</p>
            {filtered.map((m) => (
              <MemoryCard
                key={m.id}
                memory={m}
                onVerify={handleVerify}
                onDeactivate={handleDeactivate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
