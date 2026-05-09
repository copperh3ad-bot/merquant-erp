/**
 * FabricOrderDrafts.jsx
 * Review and confirm auto-generated fabric order drafts
 *
 * INTEGRATION — two options:
 *
 * Option A: Add as a tab inside existing FabricOrders.jsx page
 *   import FabricOrderDrafts from '../components/fabric/FabricOrderDrafts';
 *   Add tab: { id: 'drafts', label: 'Generated Drafts', count: draftCount }
 *   Render: <FabricOrderDrafts />
 *
 * Option B: Add "Generate Orders" button to POFabricRequirements.jsx
 *   After calculating requirements, show a "Generate Fabric Orders" button
 *   that calls the edge function then navigates to /fabric-orders?tab=drafts
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Factory, Building2, Shuffle, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Edit3, Save, RefreshCw,
  ChevronDown, ChevronUp, Info, Zap, Package,
  ArrowRight, Eye
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Fulfillment type config
// ---------------------------------------------------------------------------

const FULFILLMENT_CONFIG = {
  inhouse: {
    label:  'In-House',
    icon:   Factory,
    badge:  'bg-green-50 text-green-700 border-green-200',
    dot:    'bg-green-400',
  },
  outsourced: {
    label:  'External Supplier',
    icon:   Building2,
    badge:  'bg-blue-50 text-blue-700 border-blue-200',
    dot:    'bg-blue-400',
  },
  split: {
    label:  'Split Order',
    icon:   Shuffle,
    badge:  'bg-orange-50 text-orange-700 border-orange-200',
    dot:    'bg-orange-400',
  },
  processing: {
    label:  'Processing',
    icon:   Zap,
    badge:  'bg-purple-50 text-purple-700 border-purple-200',
    dot:    'bg-purple-400',
  },
};

const STATUS_CONFIG = {
  draft:     { label: 'Draft',     cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  reviewed:  { label: 'Reviewed',  cls: 'bg-blue-50 text-blue-700 border-blue-200'   },
  confirmed: { label: 'Confirmed', cls: 'bg-green-50 text-green-700 border-green-200' },
  rejected:  { label: 'Rejected',  cls: 'bg-red-50 text-red-700 border-red-200'      },
};

function round4(n) { return Math.round((n ?? 0) * 10000) / 10000; }
function round2(n) { return Math.round((n ?? 0) * 100) / 100; }

// ---------------------------------------------------------------------------
// Single draft card
// ---------------------------------------------------------------------------

function DraftCard({ draft, onConfirm, onReject, onUpdate }) {
  const [expanded,      setExpanded]      = useState(false);
  const [editing,       setEditing]       = useState(false);
  const [editValues,    setEditValues]    = useState({ ...draft });
  const [confirming,    setConfirming]    = useState(false);
  const [rejecting,     setRejecting]     = useState(false);
  const [rejectReason,  setRejectReason]  = useState('');
  const [showReject,    setShowReject]    = useState(false);
  const [saving,        setSaving]        = useState(false);

  const config  = FULFILLMENT_CONFIG[draft.fulfillment_type] ?? FULFILLMENT_CONFIG.outsourced;
  const status  = STATUS_CONFIG[draft.status] ?? STATUS_CONFIG.draft;
  const Icon    = config.icon;
  const isPending = draft.status === 'draft' || draft.status === 'reviewed';

  // Primary display quantity
  const displayQty = draft.primary_unit === 'kg'
    ? `${round2(draft.quantity_kg)} kg`
    : draft.primary_unit === 'yards'
    ? `${round4(draft.quantity_yards)} yds`
    : `${round4(draft.quantity_metres)} m`;

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await onUpdate(draft.id, editValues);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try { await onConfirm(draft.id); }
    finally { setConfirming(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setRejecting(true);
    try { await onReject(draft.id, rejectReason); }
    finally { setRejecting(false); }
  };

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${
      draft.status === 'confirmed' ? 'border-green-200 opacity-70'
      : draft.status === 'rejected' ? 'border-red-200 opacity-50'
      : 'border-gray-200 shadow-sm'
    }`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} />

        {/* Fulfillment type badge */}
        <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${config.badge}`}>
          <Icon className="w-3 h-3" /> {config.label}
        </span>

        {/* Material */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {draft.material_description}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
            {draft.composition && <span>{draft.composition}</span>}
            {draft.gsm && <span>{draft.gsm} GSM</span>}
            {draft.fabric_width_inches && <span>{draft.fabric_width_inches}"</span>}
          </div>
        </div>

        {/* Destination */}
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-400">
            {draft.fulfillment_type === 'inhouse'
              ? draft.facility_name ?? '—'
              : draft.supplier_name ?? 'No supplier assigned'
            }
          </div>
          {draft.required_by_date && (
            <div className="text-xs text-gray-500">
              By {new Date(draft.required_by_date).toLocaleDateString()}
            </div>
          )}
        </div>

        {/* Quantity */}
        <div className="text-right shrink-0 border-l border-gray-100 pl-3">
          <div className="text-base font-bold font-mono text-gray-900">{displayQty}</div>
          <div className="text-xs text-gray-400">
            {draft.primary_unit !== 'metres' && round4(draft.quantity_metres)} m
            {draft.primary_unit !== 'yards'  && ` / ${round4(draft.quantity_yards)} yds`}
          </div>
        </div>

        {/* Status */}
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${status.cls}`}>
          {status.label}
        </span>

        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-300 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" />
        }
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
          {/* Routing reason */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-xs">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{draft.routing_reason}</span>
          </div>

          {/* Split order breakdown */}
          {draft.fulfillment_type === 'split' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 rounded-xl p-3 border border-green-200">
                <div className="text-xs text-green-600 font-semibold uppercase">In-House</div>
                <div className="text-lg font-bold font-mono text-green-700">
                  {round4(draft.split_inhouse_metres)} m
                </div>
                <div className="text-xs text-green-600">{draft.facility_name}</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
                <div className="text-xs text-blue-600 font-semibold uppercase">External</div>
                <div className="text-lg font-bold font-mono text-blue-700">
                  {round4(draft.split_outsourced_metres)} m
                </div>
                <div className="text-xs text-blue-600">{draft.supplier_name ?? 'Assign supplier'}</div>
              </div>
            </div>
          )}

          {/* Editable fields */}
          {editing ? (
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: 'quantity_metres', label: 'Quantity (m)',     type: 'number' },
                { key: 'quantity_yards',  label: 'Quantity (yds)',   type: 'number' },
                { key: 'quantity_kg',     label: 'Quantity (kg)',    type: 'number' },
                { key: 'unit_price',      label: 'Unit Price',       type: 'number' },
                { key: 'currency',        label: 'Currency',         type: 'text'   },
                { key: 'required_by_date',label: 'Required By',      type: 'date'   },
              ].map(({ key, label, type }) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {label}
                  </label>
                  <input
                    type={type}
                    value={editValues[key] ?? ''}
                    onChange={(e) => setEditValues((v) => ({
                      ...v,
                      [key]: type === 'number' ? parseFloat(e.target.value) || null : e.target.value,
                    }))}
                    className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
              ))}

              {/* Supplier / facility override */}
              {draft.fulfillment_type !== 'inhouse' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Supplier Name
                  </label>
                  <input
                    type="text"
                    value={editValues.supplier_name ?? ''}
                    onChange={(e) => setEditValues((v) => ({ ...v, supplier_name: e.target.value }))}
                    className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Primary Unit
                </label>
                <select
                  value={editValues.primary_unit ?? 'metres'}
                  onChange={(e) => setEditValues((v) => ({ ...v, primary_unit: e.target.value }))}
                  className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  <option value="metres">Metres</option>
                  <option value="yards">Yards</option>
                  <option value="kg">Kilograms</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3 text-xs text-gray-600">
              <div>
                <div className="text-gray-400 uppercase tracking-wide">Net (no buffer)</div>
                <div className="font-mono font-medium mt-0.5">
                  {round4(draft.quantity_net_metres)} m
                </div>
              </div>
              <div>
                <div className="text-gray-400 uppercase tracking-wide">Buffer Applied</div>
                <div className="font-medium mt-0.5">{draft.buffer_pct_applied}%</div>
              </div>
              <div>
                <div className="text-gray-400 uppercase tracking-wide">Unit Price</div>
                <div className="font-medium mt-0.5">
                  {draft.unit_price ? `${draft.currency} ${draft.unit_price}` : '— not set'}
                </div>
              </div>
              <div>
                <div className="text-gray-400 uppercase tracking-wide">Total Amount</div>
                <div className="font-bold mt-0.5">
                  {draft.total_amount
                    ? `${draft.currency} ${round2(draft.total_amount).toLocaleString()}`
                    : '— set unit price first'
                  }
                </div>
              </div>
            </div>
          )}

          {/* Reject reason */}
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
                disabled={rejecting || !rejectReason.trim()}
                className="px-4 py-1.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                {rejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
              </button>
            </div>
          )}

          {/* Action buttons */}
          {isPending && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {confirming
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating order…</>
                  : <><CheckCircle2 className="w-4 h-4" /> Confirm & Create Order</>
                }
              </button>

              <button
                onClick={() => setEditing((v) => !v)}
                className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 text-sm text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
              >
                <Edit3 className="w-4 h-4" /> {editing ? 'Cancel Edit' : 'Edit'}
              </button>

              {editing && (
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2.5 border border-violet-200 text-violet-700 text-sm font-semibold rounded-xl hover:bg-violet-50 disabled:opacity-40 transition-colors"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              )}

              <button
                onClick={() => setShowReject((v) => !v)}
                className="flex items-center gap-1.5 px-4 py-2.5 border border-red-200 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-50 transition-colors ml-auto"
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
// Main component
// ---------------------------------------------------------------------------

export default function FabricOrderDrafts({ filterPoId = null }) {
  const { userProfile }   = useAuth();
  const [drafts, setDrafts]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState('pending'); // pending | all | confirmed
  const [error, setError]           = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('fabric_order_drafts')
        .select('*')
        .order('created_at', { ascending: false });

      if (filterPoId) query = query.eq('po_id', filterPoId);

      if (filter === 'pending') {
        query = query.in('status', ['draft', 'reviewed']);
      } else if (filter === 'confirmed') {
        query = query.eq('status', 'confirmed');
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      setDrafts(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterPoId, filter]);

  useEffect(() => { load(); }, [load]);

  const handleConfirm = async (draftId) => {
    const session = (await supabase.auth.getSession()).data.session;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/fabric-order-generator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        mode:     'confirm_draft',
        draft_id: draftId,
        user_id:  userProfile?.id,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    await load();
  };

  const handleReject = async (draftId, reason) => {
    await supabase.from('fabric_order_drafts').update({
      status:           'rejected',
      rejection_reason: reason,
    }).eq('id', draftId);
    await load();
  };

  const handleUpdate = async (draftId, values) => {
    const { error } = await supabase
      .from('fabric_order_drafts')
      .update({
        quantity_metres:  values.quantity_metres,
        quantity_yards:   values.quantity_yards,
        quantity_kg:      values.quantity_kg,
        unit_price:       values.unit_price,
        currency:         values.currency,
        required_by_date: values.required_by_date,
        supplier_name:    values.supplier_name,
        primary_unit:     values.primary_unit,
        status:           'reviewed',
      })
      .eq('id', draftId);
    if (error) setError(error.message);
    await load();
  };

  // Stats
  const pendingCount   = drafts.filter((d) => d.status === 'draft' || d.status === 'reviewed').length;
  const inhouseCount   = drafts.filter((d) => d.fulfillment_type === 'inhouse').length;
  const externalCount  = drafts.filter((d) => d.fulfillment_type === 'outsourced').length;
  const splitCount     = drafts.filter((d) => d.fulfillment_type === 'split').length;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Pending Review', value: pendingCount, cls: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
          { label: 'In-House',       value: inhouseCount, cls: 'text-green-600 bg-green-50 border-green-200'   },
          { label: 'External',       value: externalCount,cls: 'text-blue-600 bg-blue-50 border-blue-200'     },
          { label: 'Split',          value: splitCount,   cls: 'text-orange-600 bg-orange-50 border-orange-200'},
        ].map((s) => (
          <div key={s.label} className={`rounded-2xl border p-4 ${s.cls}`}>
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-xs mt-0.5 opacity-80">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {[
          { id: 'pending',   label: `Pending (${pendingCount})`  },
          { id: 'all',       label: 'All'                        },
          { id: 'confirmed', label: 'Confirmed'                  },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.id
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto p-1.5 text-gray-400 hover:text-gray-600">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading drafts…
        </div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-16 text-gray-400 space-y-2">
          <Package className="w-10 h-10 mx-auto opacity-20" />
          <p className="text-sm">No fabric order drafts.</p>
          <p className="text-xs">
            Go to a PO → Fabric Requirements → Generate Orders to auto-create drafts.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onConfirm={handleConfirm}
              onReject={handleReject}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
