// src/components/po/PriceVerification.jsx
// Price + CBM verification panel for PO items.
// Session 9 rewrite — pulls authoritative data from price_list via priceService,
// uses case-insensitive codes (DB trigger normalizes), and handles both
// qty_per_carton (price_list) and pieces_per_carton (master_articles) field names
// so it keeps working even if a legacy row is compared.
//
// CBM fix: po_items.cbm stores the LINE TOTAL (num_cartons * cbm_per_carton),
// while price_list.cbm_per_carton is PER CARTON. We now derive actual-per-carton
// from the stored total and compare like-for-like, and display per-carton values.

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Circle, XCircle } from 'lucide-react';
import {
  fetchPricesByCodes,
  classifyPriceStatus,
  classifyCbmStatus,
} from '@/api/priceService';
import {
  normalizeItemCode,
  toNumber,
  readPiecesPerCarton,
} from '@/lib/codes';

const STATUS_STYLES = {
  match:     { label: 'Matched',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  mismatch:  { label: 'Mismatch',  cls: 'bg-rose-100 text-rose-700 border-rose-200',         Icon: XCircle },
  missing:   { label: 'Missing',   cls: 'bg-amber-100 text-amber-700 border-amber-200',      Icon: AlertCircle },
  'no-ref':  { label: 'No price ref', cls: 'bg-slate-100 text-slate-600 border-slate-200',   Icon: Circle },
};

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['no-ref'];
  const { Icon } = s;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

function fmtUSD(n) {
  const v = toNumber(n);
  return v === null ? '—' : `$${v.toFixed(2)}`;
}

function fmtCbm(n) {
  const v = toNumber(n);
  return v === null ? '—' : v.toFixed(4);
}

export default function PriceVerification({ items = [] }) {
  const [priceMap, setPriceMap] = useState(() => new Map());
  const [loading, setLoading] = useState(false);

  // Canonicalize codes once so we both normalize display AND fetch.
  const normalizedItems = useMemo(
    () =>
      (items || []).map((it) => ({
        ...it,
        item_code: normalizeItemCode(it?.item_code),
      })),
    [items]
  );

  const codes = useMemo(
    () => Array.from(new Set(normalizedItems.map((i) => i.item_code).filter(Boolean))),
    [normalizedItems]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (codes.length === 0) {
        setPriceMap(new Map());
        return;
      }
      setLoading(true);
      const map = await fetchPricesByCodes(codes);
      if (!cancelled) {
        setPriceMap(map);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [codes]);

  const rows = useMemo(() => {
    return normalizedItems.map((it) => {
      const ref = priceMap.get(it.item_code);
      const expectedPrice = toNumber(ref?.price_usd);
      const expectedCbm   = toNumber(ref?.cbm_per_carton);
      const expectedPpc   = readPiecesPerCarton(ref); // handles qty_per_carton OR pieces_per_carton

      const priceStatus = classifyPriceStatus(it, expectedPrice);

      // po_items.cbm is the LINE TOTAL (num_cartons * cbm_per_carton).
      // price_list.cbm_per_carton is PER CARTON.
      // Derive actual-per-carton so the comparison is like-for-like and the
      // UI shows consistent units in both Actual and Expected columns.
      const totalCbm   = toNumber(it.cbm);
      const numCartons = toNumber(it.num_cartons);
      const actualCbmPerCarton =
        totalCbm !== null && numCartons && numCartons > 0
          ? Number((totalCbm / numCartons).toFixed(4))
          : null;

      const cbmStatus = classifyCbmStatus(
        { cbm: actualCbmPerCarton },
        expectedCbm
      );

      const actualPpc = readPiecesPerCarton(it);
      const ppcStatus =
        expectedPpc === null ? 'no-ref'
        : actualPpc === null ? 'missing'
        : actualPpc === expectedPpc ? 'match'
        : 'mismatch';

      return {
        key: it.id || `${it.item_code}-${it.po_number || ''}`,
        itemCode: it.item_code,
        description: it.item_description || ref?.description || '',
        actualPrice: toNumber(it.unit_price),
        expectedPrice,
        priceStatus,
        actualCbm: actualCbmPerCarton,
        expectedCbm,
        cbmStatus,
        actualPpc,
        expectedPpc,
        ppcStatus,
        hasRef: !!ref,
      };
    });
  }, [normalizedItems, priceMap]);

  const summary = useMemo(() => {
    const acc = { match: 0, mismatch: 0, missing: 0, 'no-ref': 0 };
    rows.forEach((r) => { acc[r.priceStatus] = (acc[r.priceStatus] || 0) + 1; });
    return acc;
  }, [rows]);

  if (!normalizedItems.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Price & Carton Verification</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-500">No items to verify.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Price &amp; Carton Verification</CardTitle>
        <div className="flex gap-2">
          <Badge variant="outline" className="bg-emerald-50">{summary.match} matched</Badge>
          {summary.mismatch > 0 && <Badge variant="outline" className="bg-rose-50">{summary.mismatch} mismatch</Badge>}
          {summary.missing > 0 && <Badge variant="outline" className="bg-amber-50">{summary.missing} missing</Badge>}
          {summary['no-ref'] > 0 && <Badge variant="outline" className="bg-slate-50">{summary['no-ref']} no-ref</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {loading && <div className="mb-2 text-xs text-slate-500">Loading price list…</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3 text-left">Item code</th>
                <th className="py-2 pr-3 text-left">Description</th>
                <th className="py-2 pr-3 text-right">Actual $</th>
                <th className="py-2 pr-3 text-right">Expected $</th>
                <th className="py-2 pr-3 text-center">Price</th>
                <th className="py-2 pr-3 text-right">Actual PPC</th>
                <th className="py-2 pr-3 text-right">Expected PPC</th>
                <th className="py-2 pr-3 text-center">PPC</th>
                <th className="py-2 pr-3 text-right">Actual CBM/ctn</th>
                <th className="py-2 pr-3 text-right">Expected CBM/ctn</th>
                <th className="py-2 text-center">CBM</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b last:border-0 hover:bg-slate-50/50">
                  <td className="py-2 pr-3 font-mono text-xs">{r.itemCode || '—'}</td>
                  <td className="py-2 pr-3 text-slate-600">{r.description || '—'}</td>
                  <td className="py-2 pr-3 text-right">{fmtUSD(r.actualPrice)}</td>
                  <td className="py-2 pr-3 text-right">{fmtUSD(r.expectedPrice)}</td>
                  <td className="py-2 pr-3 text-center"><StatusPill status={r.priceStatus} /></td>
                  <td className="py-2 pr-3 text-right">{r.actualPpc ?? '—'}</td>
                  <td className="py-2 pr-3 text-right">{r.expectedPpc ?? '—'}</td>
                  <td className="py-2 pr-3 text-center"><StatusPill status={r.ppcStatus} /></td>
                  <td className="py-2 pr-3 text-right">{fmtCbm(r.actualCbm)}</td>
                  <td className="py-2 pr-3 text-right">{fmtCbm(r.expectedCbm)}</td>
                  <td className="py-2 text-center"><StatusPill status={r.cbmStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
