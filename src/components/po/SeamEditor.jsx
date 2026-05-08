/**
 * SeamEditor.jsx
 * Seam editor + thread BOM results components
 * These add a 3rd tab to BOMCalculator.jsx
 *
 * INTEGRATION:
 * In BOMCalculator.jsx:
 *   import { SeamEditorTab, ThreadBOMResultsPanel } from './SeamEditor';
 *   Add tab: { id: 'seams', label: 'Seams & Thread', count: seams.length }
 *   Render <SeamEditorTab ... /> and <ThreadBOMResultsPanel ... /> in that tab
 */

import { useState, useEffect } from 'react';
import {
  Scissors, Plus, Trash2, Edit3, Save, Loader2,
  Sparkles, ChevronDown, ChevronUp, AlertTriangle,
  Layers, CheckCircle2, Info
} from 'lucide-react';
// Note: lucide-react has no `Thread` icon — removed from imports (was unused).
import { supabase } from '@/api/supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Stitch type reference (mirrors stitch_library table)
// ---------------------------------------------------------------------------

const STITCH_PRESETS = [
  { iso: '301',   name: 'Lockstitch',             threads: 2,  ratio: 2.5,  use: 'Label, elastic casing, hem' },
  { iso: '401',   name: 'Chain Stitch',            threads: 2,  ratio: 5.0,  use: 'General seaming' },
  { iso: '504',   name: '3-Thread Overlock/Serge', threads: 3,  ratio: 15.0, use: 'Raw edge finishing' },
  { iso: '516',   name: '4-Thread Safety Stitch',  threads: 4,  ratio: 19.0, use: 'Top panel + skirt join' },
  { iso: '519',   name: '5-Thread Safety Stitch',  threads: 5,  ratio: 23.0, use: 'Heavy-duty joins' },
  { iso: '605',   name: 'Flatseam Cover Stitch',   threads: 5,  ratio: 22.0, use: 'Flat panel joins' },
  { iso: '103',   name: 'Blindstitch',             threads: 1,  ratio: 2.0,  use: 'Invisible hem on flat sheets' },
  { iso: '401x2', name: '2-Needle Chain Stitch',   threads: 4,  ratio: 10.0, use: 'Skirt top edge' },
];

const DIMENSION_OPTIONS = [
  { value: 'skirt_perimeter', label: 'Skirt Perimeter (with seam allowance)' },
  { value: 'perimeter',       label: 'Full Perimeter 2×(L+W)' },
  { value: 'length',          label: 'Length only' },
  { value: 'width',           label: 'Width only' },
  { value: 'skirt_depth',     label: 'Skirt Depth × multiplier' },
];

// ---------------------------------------------------------------------------
// Thread row editor within a seam
// ---------------------------------------------------------------------------

function ThreadRow({ thread, onChange, onDelete, index }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-6 shrink-0">T{thread.thread_number}</span>
      <input
        value={thread.colour ?? ''}
        onChange={(e) => onChange(index, 'colour', e.target.value)}
        placeholder="Colour e.g. Ecru"
        className="flex-1 px-2 py-1 text-xs rounded border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
      />
      <input
        value={thread.ticket ?? ''}
        onChange={(e) => onChange(index, 'ticket', e.target.value)}
        placeholder="Ticket e.g. 120/2"
        className="w-24 px-2 py-1 text-xs rounded border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
      />
      <button onClick={() => onDelete(index)} className="text-gray-300 hover:text-red-400 transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single seam row
// ---------------------------------------------------------------------------

function SeamRow({ seam, components, onSave, onDelete, isNew }) {
  const [editing, setEditing]   = useState(isNew);
  const [values, setValues]     = useState({ ...seam });
  const [saving, setSaving]     = useState(false);

  const stitch = STITCH_PRESETS.find((s) => s.iso === values.stitch_iso_code);

  const f = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const handleStitchSelect = (iso) => {
    const preset = STITCH_PRESETS.find((s) => s.iso === iso);
    if (!preset) return;
    // Auto-populate thread count when stitch type changes
    const currentThreadCount = (values.threads ?? []).length;
    let threads = values.threads ?? [];
    if (currentThreadCount !== preset.threads) {
      threads = Array.from({ length: preset.threads }, (_, i) => ({
        thread_number: i + 1,
        colour:        threads[i]?.colour ?? 'Ecru',
        ticket:        threads[i]?.ticket ?? '120/2',
      }));
    }
    setValues((v) => ({ ...v, stitch_iso_code: iso, threads }));
  };

  const handleThreadChange = (index, key, val) => {
    const threads = [...(values.threads ?? [])];
    threads[index] = { ...threads[index], [key]: val };
    f('threads', threads);
  };

  const handleAddThread = () => {
    const threads = [...(values.threads ?? [])];
    threads.push({
      thread_number: threads.length + 1,
      colour: 'Ecru', ticket: '120/2',
    });
    f('threads', threads);
  };

  const handleDeleteThread = (index) => {
    const threads = (values.threads ?? []).filter((_, i) => i !== index);
    f('threads', threads);
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(values); setEditing(false); }
    finally { setSaving(false); }
  };

  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${
      editing ? 'border-violet-300 shadow-sm' : 'border-gray-200'
    }`}>
      {/* Collapsed header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
        onClick={() => !editing && setEditing(true)}
      >
        <span className="text-xs font-mono font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded border border-violet-200">
          {values.stitch_iso_code}
        </span>
        <span className="text-sm font-medium text-gray-800 flex-1">{values.seam_name}</span>
        {stitch && (
          <span className="text-xs text-gray-400">{stitch.threads} threads · ratio {stitch.ratio}×</span>
        )}
        <span className="text-xs text-gray-400">{values.spi} SPI</span>
        {values.set_piece_name && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
            {values.set_piece_name}
          </span>
        )}
        <div className="flex gap-1 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); }}
            className="p-1 text-gray-400 hover:text-violet-600">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(values.id); }}
            className="p-1 text-gray-400 hover:text-red-500">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-4 bg-violet-50/20">
          {/* Row 1: Name + stitch + SPI + piece */}
          <div className="grid grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Seam Name</label>
              <input value={values.seam_name ?? ''} onChange={(e) => f('seam_name', e.target.value)}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Stitch Type</label>
              <select value={values.stitch_iso_code ?? ''} onChange={(e) => handleStitchSelect(e.target.value)}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                {STITCH_PRESETS.map((s) => (
                  <option key={s.iso} value={s.iso}>{s.iso} — {s.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">SPI</label>
              <input type="number" min="4" max="24" value={values.spi ?? 10}
                onChange={(e) => f('spi', parseInt(e.target.value))}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Set Piece</label>
              <input value={values.set_piece_name ?? ''} onChange={(e) => f('set_piece_name', e.target.value)}
                placeholder="e.g. Protector"
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
          </div>

          {/* Row 2: Length source */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Length Source</label>
              <select value={values.length_source ?? 'derived'} onChange={(e) => f('length_source', e.target.value)}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                <option value="derived">Derived from component</option>
                <option value="manual">Manual (fixed inches)</option>
              </select>
            </div>

            {values.length_source === 'derived' ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Linked Component</label>
                  <select
                    value={values.derived_from_component_id ?? ''}
                    onChange={(e) => f('derived_from_component_id', e.target.value || null)}
                    className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                  >
                    <option value="">None (use size directly)</option>
                    {(components ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.component_name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Dimension</label>
                  <select value={values.derived_dimension ?? ''} onChange={(e) => f('derived_dimension', e.target.value)}
                    className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                    {DIMENSION_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Fixed Length (inches)</label>
                <input type="number" step="0.5" value={values.manual_length_inches ?? ''}
                  onChange={(e) => f('manual_length_inches', parseFloat(e.target.value))}
                  className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
            )}
          </div>

          {/* Row 3: Multiplier + add inches + wastage */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Multiplier</label>
              <input type="number" step="0.5" value={values.derived_multiplier ?? 1}
                onChange={(e) => f('derived_multiplier', parseFloat(e.target.value))}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
              <span className="text-xs text-gray-400">e.g. 4 for 4 corner seams</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Extra Inches</label>
              <input type="number" step="0.5" value={values.derived_add_inches ?? 0}
                onChange={(e) => f('derived_add_inches', parseFloat(e.target.value))}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
              <span className="text-xs text-gray-400">tie-off allowance</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Wastage %</label>
              <input type="number" step="0.5" value={values.wastage_pct ?? 5}
                onChange={(e) => f('wastage_pct', parseFloat(e.target.value))}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
          </div>

          {/* Thread definitions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Threads ({(values.threads ?? []).length} — one per spool/cone)
              </label>
              <button onClick={handleAddThread}
                className="text-xs text-violet-600 flex items-center gap-1 hover:text-violet-800">
                <Plus className="w-3.5 h-3.5" /> Add thread
              </button>
            </div>
            {stitch && (
              <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
                <Info className="w-3 h-3" />
                {stitch.name} uses {stitch.threads} threads. Typical use: {stitch.use}.
              </div>
            )}
            <div className="space-y-1.5">
              {(values.threads ?? []).map((t, i) => (
                <ThreadRow
                  key={i} thread={t} index={i}
                  onChange={handleThreadChange}
                  onDelete={handleDeleteThread}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Seam
            </button>
            <button onClick={() => setEditing(false)}
              className="px-4 py-2 border border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread BOM results panel
// ---------------------------------------------------------------------------

export function ThreadBOMResultsPanel({ articleId, sizes }) {
  const [totals, setTotals]     = useState([]);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    if (!articleId) return;
    setLoading(true);
    supabase
      .from('thread_bom_totals')
      .select('*')
      .eq('article_id', articleId)
      .order('size_code')
      .order('thread_colour')
      .then(({ data }) => { setTotals(data ?? []); setLoading(false); });
  }, [articleId]);

  if (loading) return (
    <div className="flex items-center justify-center h-24 text-gray-400">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading thread BOM…
    </div>
  );

  if (!totals.length) return (
    <div className="text-center py-8 text-gray-400 text-sm space-y-1">
      <p>No thread BOM calculated yet.</p>
      <p className="text-xs">Define seams above then click "Run BOM".</p>
    </div>
  );

  // Group by size
  const uniqueSizes  = [...new Set(totals.map((t) => t.size_code))];
  const uniqueThread = [...new Set(totals.map((t) => `${t.thread_colour} / ${t.thread_ticket}`))];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <Scissors className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-semibold text-gray-700">Thread Consumption — Metres per Piece</span>
        <span className="ml-auto text-xs text-gray-400">Grouped by colour + ticket</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">
                Thread
              </th>
              {uniqueSizes.map((s) => (
                <th key={s} className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {uniqueThread.map((threadKey) => {
              const [colour, ticket] = threadKey.split(' / ');
              return (
                <tr key={threadKey} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-800 text-sm">{colour}</div>
                    <div className="text-xs text-gray-400 font-mono">{ticket}</div>
                  </td>
                  {uniqueSizes.map((size) => {
                    const row = totals.find(
                      (t) => t.size_code === size &&
                             t.thread_colour === colour &&
                             t.thread_ticket === ticket
                    );
                    return (
                      <td key={size} className="px-3 py-2.5 text-right font-mono font-bold text-gray-900">
                        {row ? `${row.total_metres_with_wastage.toFixed(1)}m` : '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seam Editor Tab — main export for BOMCalculator.jsx
// ---------------------------------------------------------------------------

export function SeamEditorTab({ articleId, components, onRunBOM }) {
  const [seams, setSeams]             = useState([]);
  const [loading, setLoading]         = useState(false);
  const [suggesting, setSuggesting]   = useState(false);
  const [error, setError]             = useState(null);

  useEffect(() => {
    if (!articleId) return;
    loadSeams();
  }, [articleId]);

  async function loadSeams() {
    setLoading(true);
    const { data } = await supabase
      .from('article_seams')
      .select('*')
      .eq('article_id', articleId)
      .order('display_order');
    setSeams(data ?? []);
    setLoading(false);
  }

  const handleSuggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bom-calculator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ mode: 'suggest_seams', article_id: articleId }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadSeams();
    } catch (e) {
      setError(e.message);
    } finally {
      setSuggesting(false);
    }
  };

  const handleSaveSeam = async (seam) => {
    const isNew = !seam.id || seam.id.startsWith('new-');
    if (isNew) {
      const { data, error } = await supabase.from('article_seams')
        .insert({ ...seam, article_id: articleId, id: undefined }).select().single();
      if (error) throw error;
      setSeams((s) => [...s.filter((x) => x.id !== seam.id), data]);
    } else {
      const { error } = await supabase.from('article_seams').update(seam).eq('id', seam.id);
      if (error) throw error;
      setSeams((s) => s.map((x) => x.id === seam.id ? seam : x));
    }
  };

  const handleDeleteSeam = async (id) => {
    await supabase.from('article_seams').delete().eq('id', id);
    setSeams((s) => s.filter((x) => x.id !== id));
  };

  const handleAddSeam = () => {
    setSeams((s) => [...s, {
      id: `new-${Date.now()}`,
      article_id: articleId,
      seam_name: 'New Seam',
      stitch_iso_code: '301',
      spi: 10,
      threads: [
        { thread_number: 1, colour: 'Ecru', ticket: '120/2' },
        { thread_number: 2, colour: 'Ecru', ticket: '120/2' },
      ],
      length_source: 'derived',
      derived_dimension: 'perimeter',
      derived_multiplier: 1.0,
      derived_add_inches: 2,
      wastage_pct: 5,
      display_order: seams.length + 1,
    }]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Define each seam with stitch type and SPI.
          Seam lengths auto-derive from component dimensions.
        </p>
        <div className="flex gap-2">
          {seams.length === 0 && components?.length > 0 && (
            <button onClick={handleSuggest} disabled={suggesting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-violet-700 border border-violet-200 rounded-xl hover:bg-violet-50 disabled:opacity-40 transition-colors">
              {suggesting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Suggesting…</>
                : <><Sparkles className="w-4 h-4" /> AI Suggest Seams</>
              }
            </button>
          )}
          <button onClick={handleAddSeam}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-violet-700 border border-violet-200 rounded-xl hover:bg-violet-50 transition-colors">
            <Plus className="w-4 h-4" /> Add Seam
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-24 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading seams…
        </div>
      ) : seams.length === 0 ? (
        <div className="text-center py-10 text-gray-400 space-y-2">
          <Scissors className="w-8 h-8 mx-auto opacity-30" />
          <p className="text-sm">No seams defined yet.</p>
          <p className="text-xs">
            Add manually or use "AI Suggest Seams" to auto-generate
            from your component setup.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {seams.map((seam) => (
            <SeamRow
              key={seam.id}
              seam={seam}
              components={components}
              onSave={handleSaveSeam}
              onDelete={handleDeleteSeam}
              isNew={seam.id?.startsWith('new-')}
            />
          ))}
        </div>
      )}

      {/* Thread BOM results */}
      {seams.length > 0 && (
        <ThreadBOMResultsPanel articleId={articleId} />
      )}
    </div>
  );
}
