/**
 * BOMCalculator.jsx
 * Bill of Materials calculator page for MerQuant ERP
 * Route: /bom-calculator
 * Roles: Owner, Manager, Merchandiser
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Calculator, FileText, Layers, Plus, Trash2, Edit3,
  Save, Play, CheckCircle2, AlertTriangle, Loader2,
  ChevronDown, ChevronUp, Package, Ruler, Weight,
  Sparkles, RefreshCw, Download, Info
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPONENT_TYPES = [
  { value: 'top_panel',  label: 'Top Panel',  color: 'blue'   },
  { value: 'skirt',      label: 'Skirt',      color: 'violet' },
  { value: 'reverse',    label: 'Reverse',    color: 'green'  },
  { value: 'fill',       label: 'Fill',       color: 'yellow' },
  { value: 'border',     label: 'Border',     color: 'pink'   },
  { value: 'elastic',    label: 'Elastic',    color: 'orange' },
  { value: 'binding',    label: 'Binding',    color: 'red'    },
  { value: 'label',      label: 'Label',      color: 'gray'   },
  { value: 'other',      label: 'Other',      color: 'gray'   },
];

const FORMULA_TYPES = [
  { value: 'perimeter_skirt', label: 'Perimeter Skirt',  desc: '4-side drop around mattress' },
  { value: 'flat_panel',      label: 'Flat Panel',        desc: 'Top/reverse/flat sheet' },
  { value: 'fill_weight',     label: 'Fill Weight (GSM)', desc: 'Batting/wadding in grams' },
  { value: 'trim_length',     label: 'Trim Length',       desc: 'Elastic/binding in metres' },
  { value: 'fixed_quantity',  label: 'Fixed Qty',         desc: 'Labels, tags (1 per piece)' },
  { value: 'manual',          label: 'Manual',            desc: 'Enter manually' },
];

const TYPE_COLORS = {
  blue:   'bg-blue-50 text-blue-700 border-blue-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  green:  'bg-green-50 text-green-700 border-green-200',
  yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  pink:   'bg-pink-50 text-pink-700 border-pink-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  red:    'bg-red-50 text-red-700 border-red-200',
  gray:   'bg-gray-50 text-gray-700 border-gray-200',
};

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function callBOMCalculator(body, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/bom-calculator`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        ANON_KEY,
      Authorization:  `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ---------------------------------------------------------------------------
// Component editor row
// ---------------------------------------------------------------------------

function ComponentRow({ comp, onSave, onDelete, isNew }) {
  const [editing, setEditing]   = useState(isNew);
  const [values, setValues]     = useState(comp);
  const [saving, setSaving]     = useState(false);

  const typeConfig = COMPONENT_TYPES.find((t) => t.value === values.component_type);
  const colorClass = TYPE_COLORS[typeConfig?.color ?? 'gray'];

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(values);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const f = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${editing ? 'border-violet-300 shadow-sm' : 'border-gray-200'}`}>
      {/* Collapsed header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => !editing && setEditing(true)}
      >
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
          {typeConfig?.label ?? values.component_type}
        </span>
        <span className="text-sm font-medium text-gray-800 flex-1">{values.component_name}</span>
        {values.set_piece_name && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
            {values.set_piece_name}
          </span>
        )}
        <span className="text-xs text-gray-400">{values.formula_type}</span>
        {values.material_description && (
          <span className="text-xs text-gray-500 truncate max-w-32">{values.material_description}</span>
        )}
        {values.confidence < 0.8 && (
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" title="Low confidence extraction" />
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); }}
            className="p-1 text-gray-400 hover:text-violet-600">
            <Edit3 className="w-4 h-4" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(values.id); }}
            className="p-1 text-gray-400 hover:text-red-500">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3 bg-violet-50/30">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Component Name</label>
              <input value={values.component_name ?? ''} onChange={(e) => f('component_name', e.target.value)}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Component Type</label>
              <select value={values.component_type ?? ''} onChange={(e) => f('component_type', e.target.value)}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                {COMPONENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Set Piece</label>
              <input value={values.set_piece_name ?? ''} onChange={(e) => f('set_piece_name', e.target.value)}
                placeholder="e.g. Protector, Fitted Sheet"
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Formula Type</label>
              <select value={values.formula_type ?? ''} onChange={(e) => f('formula_type', e.target.value)}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                {FORMULA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Material</label>
              <input value={values.material_description ?? ''} onChange={(e) => f('material_description', e.target.value)}
                placeholder="e.g. 200GSM Microfibre Brushed"
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Composition</label>
              <input value={values.composition ?? ''} onChange={(e) => f('composition', e.target.value)}
                placeholder="e.g. 100% Polyester"
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3">
            {[
              { key: 'fabric_width_inches', label: 'Width (")' },
              { key: 'gsm',                 label: 'GSM' },
              { key: 'skirt_depth_inches',  label: 'Skirt Depth (")' },
              { key: 'seam_allowance_inches', label: 'Seam Allow (")' },
              { key: 'hem_allowance_inches',  label: 'Hem Allow (")' },
            ].map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
                <input type="number" step="0.01" value={values[key] ?? ''}
                  onChange={(e) => f(key, parseFloat(e.target.value) || null)}
                  className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'wastage_pct',   label: 'Wastage %' },
              { key: 'shrinkage_pct', label: 'Shrinkage %' },
              { key: 'overlap_inches', label: 'Overlap (")' },
            ].map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
                <input type="number" step="0.01" value={values[key] ?? ''}
                  onChange={(e) => f(key, parseFloat(e.target.value) || 0)}
                  className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
            <button onClick={() => setEditing(false)}
              className="px-4 py-2 border border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BOM results table
// ---------------------------------------------------------------------------

function BOMResultsTable({ results, setTotals }) {
  const [expandedComp, setExpandedComp] = useState(null);

  if (!results?.length) return null;

  const sizes    = [...new Set(results.map((r) => r.size_code))];
  const compMap  = {};
  for (const r of results) {
    if (!compMap[r.component_name]) compMap[r.component_name] = {};
    compMap[r.component_name][r.size_code] = r;
  }

  return (
    <div className="space-y-4">
      {/* Component × Size matrix */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Ruler className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">Consumption by Component × Size</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Component</th>
                {sizes.map((s) => (
                  <th key={s} className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {Object.entries(compMap).map(([name, sizeData]) => {
                const firstResult = Object.values(sizeData)[0];
                const isExpanded  = expandedComp === name;
                return (
                  <>
                    <tr key={name}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedComp(isExpanded ? null : name)}>
                      <td className="px-4 py-2.5 font-medium text-gray-800 flex items-center gap-2">
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                                    : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                        {name}
                        <span className="text-xs text-gray-400">{firstResult?.consumption_unit}</span>
                      </td>
                      {sizes.map((s) => {
                        const r = sizeData[s];
                        const val = r?.consumption_unit === 'grams'
                          ? r.consumption_grams
                          : r?.consumption_yards;
                        return (
                          <td key={s} className={`px-3 py-2.5 text-right font-mono text-sm ${
                            r?.error ? 'text-red-500' : 'text-gray-900'
                          }`}>
                            {r?.error ? '—' : val?.toFixed(3) ?? '—'}
                          </td>
                        );
                      })}
                    </tr>
                    {isExpanded && firstResult && (
                      <tr key={`${name}-steps`}>
                        <td colSpan={sizes.length + 1} className="px-6 pb-3 bg-gray-50/50">
                          <div className="text-xs font-mono text-gray-500 space-y-0.5 pt-2">
                            <div className="font-semibold text-gray-600 mb-1">{firstResult.formula_used}</div>
                            {firstResult.calculation_steps?.map((step) => (
                              <div key={step.step}>
                                {step.step}. {step.description} = <span className="font-bold text-gray-700">{step.value} {step.unit}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Set totals by material */}
      {setTotals && Object.keys(setTotals).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">Total Fabric Required by Material × Size</span>
            <span className="text-xs text-gray-400 ml-auto">Consolidated across all set pieces</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Material</th>
                  {sizes.map((s) => (
                    <th key={s} className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase">{s} (yds)</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {/* Collect all unique materials */}
                {(() => {
                  const materials = new Set();
                  for (const sizeData of Object.values(setTotals)) {
                    for (const mat of Object.keys(sizeData)) materials.add(mat);
                  }
                  return [...materials].map((mat) => (
                    <tr key={mat} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-800 font-medium">{mat}</td>
                      {sizes.map((s) => {
                        const total = setTotals[s]?.[mat]?.total_yards ?? null;
                        return (
                          <td key={s} className="px-3 py-2.5 text-right font-mono font-bold text-gray-900">
                            {total?.toFixed(3) ?? '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BOMCalculator() {
  const [articles, setArticles]       = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [components, setComponents]   = useState([]);
  const [techPacks, setTechPacks]     = useState([]);
  const [bomResults, setBomResults]   = useState([]);
  const [setTotals, setSetTotals]     = useState({});
  const [loading, setLoading]         = useState(false);
  const [parsing, setParsing]         = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError]             = useState(null);
  const [tab, setTab]                 = useState('components');
  const [selectedTechPack, setSelectedTechPack] = useState('');

  useEffect(() => {
    supabase.from('articles').select('id, sku, description').order('sku').limit(200)
      .then(({ data }) => setArticles(data ?? []));
  }, []);

  const loadArticleData = async (articleId) => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: comps }, { data: packs }, { data: results }, { data: totals }] =
        await Promise.all([
          supabase.from('article_components').select('*').eq('article_id', articleId).order('display_order'),
          supabase.from('tech_packs').select('id, style_name, description').eq('article_id', articleId).limit(10),
          supabase.from('bom_results').select('*').eq('article_id', articleId).order('component_id').order('size_code'),
          supabase.from('bom_set_totals').select('*').eq('article_id', articleId),
        ]);
      setComponents(comps ?? []);
      setTechPacks(packs ?? []);
      setBomResults(results ?? []);

      // Reshape totals to { size_code: { material: totals } }
      const totalsMap = {};
      for (const t of totals ?? []) {
        if (!totalsMap[t.size_code]) totalsMap[t.size_code] = {};
        totalsMap[t.size_code][t.material_description] = t;
      }
      setSetTotals(totalsMap);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleArticleSelect = (articleId) => {
    setSelectedArticle(articleId);
    if (articleId) loadArticleData(articleId);
  };

  const handleSaveComponent = async (comp) => {
    const isNew = !comp.id || comp.id.startsWith('new-');
    if (isNew) {
      const { data, error } = await supabase.from('article_components')
        .insert({ ...comp, article_id: selectedArticle, id: undefined }).select().single();
      if (error) throw error;
      setComponents((c) => [...c.filter((x) => x.id !== comp.id), data]);
    } else {
      const { error } = await supabase.from('article_components').update(comp).eq('id', comp.id);
      if (error) throw error;
      setComponents((c) => c.map((x) => x.id === comp.id ? comp : x));
    }
  };

  const handleDeleteComponent = async (id) => {
    await supabase.from('article_components').delete().eq('id', id);
    setComponents((c) => c.filter((x) => x.id !== id));
  };

  const handleAddComponent = () => {
    setComponents((c) => [...c, {
      id: `new-${Date.now()}`, article_id: selectedArticle,
      component_name: 'New Component', component_type: 'skirt',
      formula_type: 'perimeter_skirt', fabric_width_inches: 58,
      seam_allowance_inches: 0.5, hem_allowance_inches: 1.5,
      wastage_pct: 8, shrinkage_pct: 3, overlap_inches: 0,
      size_overrides: {}, confidence: 1.0, source: 'manual',
    }]);
  };

  const handleParseTechPack = async () => {
    if (!selectedTechPack) return;
    setParsing(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const result = await callBOMCalculator({
        mode: 'parse',
        tech_pack_id: selectedTechPack,
        article_id: selectedArticle,
      }, session?.access_token);
      await loadArticleData(selectedArticle);
    } catch (e) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  const handleCalculate = async () => {
    if (!selectedArticle) return;
    setCalculating(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const result = await callBOMCalculator({
        mode: 'calculate',
        article_id: selectedArticle,
      }, session?.access_token);
      setBomResults(result.results ?? []);
      setSetTotals(
        Object.fromEntries(
          Object.entries(result.setTotals ?? {}).map(([size, mats]) => [size, mats])
        )
      );
      setTab('results');
    } catch (e) {
      setError(e.message);
    } finally {
      setCalculating(false);
    }
  };

  const selectedArticleData = articles.find((a) => a.id === selectedArticle);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <Calculator className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">BOM Calculator</h1>
              <p className="text-xs text-gray-500">Fabric consumption for bedding — skirt, panel, fill, trim</p>
            </div>
          </div>
          {selectedArticle && (
            <button onClick={handleCalculate} disabled={calculating || !components.length}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
              {calculating
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Calculating…</>
                : <><Play className="w-4 h-4" /> Run BOM</>}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">
        {/* Article selector */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                Select Article / SKU
              </label>
              <select
                value={selectedArticle ?? ''}
                onChange={(e) => handleArticleSelect(e.target.value || null)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="">— Choose an article —</option>
                {articles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.sku} {a.description ? `— ${a.description}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Tech pack parse section */}
            {techPacks.length > 0 && (
              <div className="flex items-end gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                    Parse from Tech Pack
                  </label>
                  <select
                    value={selectedTechPack}
                    onChange={(e) => setSelectedTechPack(e.target.value)}
                    className="px-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                  >
                    <option value="">Select tech pack…</option>
                    {techPacks.map((t) => (
                      <option key={t.id} value={t.id}>{t.style_name ?? t.description ?? t.id}</option>
                    ))}
                  </select>
                </div>
                <button onClick={handleParseTechPack} disabled={parsing || !selectedTechPack}
                  className="flex items-center gap-1.5 px-4 py-2 border border-violet-300 text-violet-700 text-sm font-semibold rounded-xl hover:bg-violet-50 disabled:opacity-40 transition-colors">
                  {parsing
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Parsing…</>
                    : <><Sparkles className="w-4 h-4" /> AI Parse</>}
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {selectedArticle && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
              {[
                { id: 'components', label: 'Components', count: components.length },
                { id: 'results',    label: 'BOM Results', count: bomResults.length },
              ].map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {t.label}
                  {t.count > 0 && (
                    <span className="text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Components tab */}
            {tab === 'components' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Define each fabric zone. Click a component to edit. Use "AI Parse" to extract from tech pack.
                  </p>
                  <button onClick={handleAddComponent}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-violet-700 border border-violet-200 rounded-xl hover:bg-violet-50 transition-colors">
                    <Plus className="w-4 h-4" /> Add Component
                  </button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center h-32 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
                  </div>
                ) : components.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 space-y-2">
                    <Layers className="w-8 h-8 mx-auto opacity-30" />
                    <p className="text-sm">No components yet.</p>
                    <p className="text-xs">Add manually or use "AI Parse" to extract from a tech pack.</p>
                  </div>
                ) : (
                  components.map((comp) => (
                    <ComponentRow
                      key={comp.id}
                      comp={comp}
                      onSave={handleSaveComponent}
                      onDelete={handleDeleteComponent}
                      isNew={comp.id?.startsWith('new-')}
                    />
                  ))
                )}
              </div>
            )}

            {/* Results tab */}
            {tab === 'results' && (
              <div>
                {bomResults.length === 0 ? (
                  <div className="text-center py-16 text-gray-400 space-y-2">
                    <Calculator className="w-10 h-10 mx-auto opacity-20" />
                    <p className="text-sm">No BOM calculated yet.</p>
                    <p className="text-xs">Add components then click "Run BOM".</p>
                  </div>
                ) : (
                  <BOMResultsTable results={bomResults} setTotals={setTotals} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
