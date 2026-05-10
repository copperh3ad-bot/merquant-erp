/**
 * POFabricRequirements.jsx
 * Fabric requirement panel for a specific PO
 *
 * Usage: embed inside the existing PODetail.jsx page
 *
 * INTEGRATION in PODetail.jsx:
 *   import POFabricRequirements from '../components/po/POFabricRequirements';
 *   Add a "Fabric Requirements" tab to the PO detail tabs.
 *   Render: <POFabricRequirements poId={po.id} poNumber={po.po_number} />
 *
 * OR use as a standalone panel below the line items table.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Layers, RefreshCw, AlertTriangle, CheckCircle2,
  Loader2, ChevronDown, ChevronUp, Package,
  Ruler, Weight, Info, Download
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n) { return Math.round((n ?? 0) * 100) / 100; }
function round4(n) { return Math.round((n ?? 0) * 10000) / 10000; }

function UnitBadge({ unit }) {
  const map = {
    yards:  { label: 'yds', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
    metres: { label: 'm',   cls: 'bg-green-50 text-green-600 border-green-200' },
    grams:  { label: 'g',   cls: 'bg-yellow-50 text-yellow-600 border-yellow-200' },
  };
  const { label, cls } = map[unit] ?? map.yards;
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Material row — shows breakdown per material
// ---------------------------------------------------------------------------

function MaterialRow({ material, bufferPct }) {
  const [expanded, setExpanded] = useState(false);
  const isGrams = material.consumption_unit === 'grams';

  const netValue  = isGrams ? round2(material.total_grams_net)
                            : round4(material.total_yards_net);
  const bufValue  = isGrams ? round2(material.total_grams_net * (1 + bufferPct / 100))
                            : round4(material.total_yards_with_buffer);
  const bufMetres = round4(material.total_metres_with_buffer);

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center gap-4 px-4 py-3 bg-white cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Material info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">
              {material.material_description}
            </span>
            {material.composition && (
              <span className="text-xs text-gray-400">{material.composition}</span>
            )}
            {material.gsm && (
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                {material.gsm} GSM
              </span>
            )}
            {material.fabric_width_inches && (
              <span className="text-xs text-gray-500">
                {material.fabric_width_inches}"
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {material.line_items?.length ?? 0} line item(s)
          </div>
        </div>

        {/* Net quantity */}
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Net</div>
          <div className="text-sm font-mono font-bold text-gray-700">
            {netValue} <UnitBadge unit={material.consumption_unit} />
          </div>
        </div>

        {/* With buffer */}
        <div className="text-right shrink-0 border-l border-gray-100 pl-4">
          <div className="text-xs text-violet-500 uppercase tracking-wide font-semibold">
            +{bufferPct}% buffer
          </div>
          <div className="text-base font-mono font-bold text-violet-700">
            {bufValue} <UnitBadge unit={material.consumption_unit} />
          </div>
          {!isGrams && (
            <div className="text-xs text-gray-400 font-mono">
              {bufMetres} m
            </div>
          )}
        </div>

        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-300 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" />
        }
      </div>

      {/* Expanded line item breakdown */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-2 text-gray-400 font-medium uppercase tracking-wide">SKU</th>
                <th className="text-left px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">Size</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">Qty</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">Yds/Piece</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium uppercase tracking-wide">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(material.line_items ?? []).map((item, i) => (
                <tr key={i} className="hover:bg-white transition-colors">
                  <td className="px-4 py-2 font-mono text-gray-700 font-medium">{item.sku}</td>
                  <td className="px-3 py-2 text-gray-600">{item.size_code}</td>
                  <td className="px-3 py-2 text-right text-gray-700 font-medium">
                    {item.quantity.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-600">
                    {item.yards_per_piece?.toFixed(4)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-gray-800">
                    {item.subtotal_yards?.toFixed(4)} yds
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-white">
                <td colSpan={4} className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">
                  Subtotal net
                </td>
                <td className="px-4 py-2 text-right font-mono font-bold text-gray-900">
                  {round4(material.total_yards_net)} yds
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Missing BOM items warning
// ---------------------------------------------------------------------------

function MissingBOMWarning({ items }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 space-y-2">
      <div className="flex items-center gap-2 text-yellow-800 text-sm font-semibold">
        <AlertTriangle className="w-4 h-4" />
        {items.length} line item(s) missing BOM data
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="text-xs text-yellow-700 flex items-center gap-2">
            <span className="font-mono font-semibold">{item.sku}</span>
            <span className="text-yellow-500">({item.size_code})</span>
            <span>— {item.reason}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-yellow-600">
        Go to Materials → BOM Calculator → select each article → Run BOM to fix.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function SummaryCards({ summary, bufferPct, poNumber }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-xs text-gray-400 uppercase tracking-wide">Materials</div>
        <div className="text-2xl font-bold text-gray-900 mt-1">
          {summary.material_count}
        </div>
        <div className="text-xs text-gray-400">distinct fabric types</div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-xs text-gray-400 uppercase tracking-wide">Net Yards</div>
        <div className="text-2xl font-bold text-gray-700 mt-1 font-mono">
          {round2(summary.total_yards_net).toLocaleString()}
        </div>
        <div className="text-xs text-gray-400">before buffer</div>
      </div>
      <div className="bg-violet-50 rounded-xl border border-violet-200 p-4">
        <div className="text-xs text-violet-600 uppercase tracking-wide font-semibold">
          Order Quantity (+{bufferPct}%)
        </div>
        <div className="text-2xl font-bold text-violet-700 mt-1 font-mono">
          {round2(summary.total_yards_with_buffer).toLocaleString()} yds
        </div>
        <div className="text-xs text-gray-400">
          {round2(summary.total_metres_with_buffer).toLocaleString()} metres
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function POFabricRequirements({ poId, poNumber }) {
  const [requirements, setRequirements] = useState([]);
  const [summary,      setSummary]      = useState(null);
  const [missing,      setMissing]      = useState([]);
  const [bufferPct,    setBufferPct]    = useState(5);
  const [loading,      setLoading]      = useState(false);
  const [calculating,  setCalculating]  = useState(false);
  const [error,        setError]        = useState(null);
  const [lastCalcAt,   setLastCalcAt]   = useState(null);

  // Load existing requirements from DB
  const loadExisting = useCallback(async () => {
    if (!poId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('po_fabric_requirements')
        .select('*')
        .eq('po_id', poId)
        .order('material_description');

      if (data?.length) {
        setRequirements(data);
        const totalYardsNet  = data.reduce((s, r) => s + (r.total_yards_net ?? 0), 0);
        const totalYardsBuf  = data.reduce((s, r) => s + (r.total_yards_with_buffer ?? 0), 0);
        const totalMetresBuf = data.reduce((s, r) => s + (r.total_metres_with_buffer ?? 0), 0);
        setSummary({
          material_count:           data.length,
          total_yards_net:          round4(totalYardsNet),
          total_yards_with_buffer:  round4(totalYardsBuf),
          total_metres_with_buffer: round4(totalMetresBuf),
        });
        setBufferPct(data[0]?.buffer_pct ?? 5);
        setLastCalcAt(data[0]?.calculated_at);

        // Aggregate missing items
        const allMissing = data.flatMap((r) => r.missing_bom_items ?? []);
        setMissing(allMissing);
      }
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => { loadExisting(); }, [loadExisting]);

  const handleCalculate = async () => {
    setCalculating(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/po-fabric-calculator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          po_id:      poId,
          mode:       'calculate',
          buffer_pct: bufferPct,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      if (!data.success) throw new Error(data.error ?? 'Calculation failed');

      // Reload from DB to get saved rows
      await loadExisting();
    } catch (e) {
      setError(e.message);
    } finally {
      setCalculating(false);
    }
  };

  const handleExportCSV = () => {
    if (!requirements.length) return;
    const rows = [
      ['Material', 'Composition', 'GSM', 'Width (in)', 'Net Yards', 'With Buffer Yards', 'With Buffer Metres'],
      ...requirements.map((r) => [
        r.material_description,
        r.composition ?? '',
        r.gsm ?? '',
        r.fabric_width_inches ?? '',
        r.total_yards_net,
        r.total_yards_with_buffer,
        r.total_metres_with_buffer,
      ]),
    ];
    const csv     = rows.map((r) => r.join(',')).join('\n');
    const blob    = new Blob([csv], { type: 'text/csv' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `fabric-requirements-${poNumber ?? poId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Buffer %
          </span>
          <input
            type="number"
            min="0"
            max="20"
            step="0.5"
            value={bufferPct}
            onChange={(e) => setBufferPct(parseFloat(e.target.value) || 0)}
            className="w-16 px-2 py-1 text-sm text-center rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        <button
          onClick={handleCalculate}
          disabled={calculating}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
        >
          {calculating
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Calculating…</>
            : <><Layers className="w-4 h-4" /> Calculate Requirements</>
          }
        </button>

        {requirements.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        )}

        {lastCalcAt && (
          <span className="text-xs text-gray-400 ml-auto">
            Last calculated: {new Date(lastCalcAt).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Missing BOM warning */}
      <MissingBOMWarning items={missing} />

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : requirements.length === 0 ? (
        <div className="text-center py-12 text-gray-400 space-y-2">
          <Layers className="w-8 h-8 mx-auto opacity-20" />
          <p className="text-sm font-medium">No fabric requirements calculated yet.</p>
          <p className="text-xs">
            Click "Calculate Requirements" to compute total fabric needed for this PO.
          </p>
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-xs max-w-sm mx-auto mt-2 text-left">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            Requires BOM to be calculated first for each article in this PO.
            Go to Materials → BOM Calculator.
          </div>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <SummaryCards
            summary={summary}
            bufferPct={bufferPct}
            poNumber={poNumber}
          />

          {/* Material rows */}
          <div className="space-y-2">
            {requirements.map((req) => (
              <MaterialRow
                key={req.id}
                material={{
                  ...req,
                  line_items: req.line_item_breakdown ?? [],
                }}
                bufferPct={bufferPct}
              />
            ))}
          </div>

          {/* Footer note */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-500">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Net yards = BOM consumption per piece × ordered quantity.
              Buffer ({bufferPct}%) added for shrinkage, rejects, and wastage.
              Recommended order quantity shown in purple.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
