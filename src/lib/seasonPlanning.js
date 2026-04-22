// Season Planning analytics helpers
// Pure functions — no side effects, no DB calls.

/** Compute YoY % change between two values. Returns null if prev is 0 or missing. */
export function yoyPct(current, previous) {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Simple moving average over the last N values. */
export function movingAvg(values, window = 3) {
  if (!values?.length) return 0;
  const slice = values.slice(-window);
  return slice.reduce((a, b) => a + Number(b || 0), 0) / slice.length;
}

/**
 * Group quarter rows ({ order_year, order_quarter, total_value, ... }) by customer
 * and compute YoY for each quarter vs same quarter previous year.
 */
export function computeCustomerYoY(rows) {
  const byCustomer = {};
  for (const r of rows) {
    const key = r.customer_name || "Unknown";
    (byCustomer[key] ||= []).push(r);
  }
  const result = [];
  for (const [customer, list] of Object.entries(byCustomer)) {
    const sorted = [...list].sort((a, b) =>
      a.order_year - b.order_year || a.order_quarter - b.order_quarter
    );
    const totalValue = sorted.reduce((s, r) => s + Number(r.total_value || 0), 0);
    const totalQty = sorted.reduce((s, r) => s + Number(r.total_quantity || 0), 0);
    const poCount = sorted.reduce((s, r) => s + Number(r.po_count || 0), 0);

    // YoY latest quarter vs same quarter prior year
    const latest = sorted[sorted.length - 1];
    let yoy = null, yoyQty = null;
    if (latest) {
      const priorYear = sorted.find(
        r => r.order_year === latest.order_year - 1 && r.order_quarter === latest.order_quarter
      );
      if (priorYear) {
        yoy = yoyPct(Number(latest.total_value), Number(priorYear.total_value));
        yoyQty = yoyPct(Number(latest.total_quantity), Number(priorYear.total_quantity));
      }
    }

    // Moving average of value across last 3 quarters
    const ma3 = movingAvg(sorted.map(r => Number(r.total_value || 0)), 3);

    result.push({ customer, quarters: sorted, totalValue, totalQty, poCount, yoy, yoyQty, ma3, latestQuarter: latest });
  }
  return result.sort((a, b) => b.totalValue - a.totalValue);
}

/** Pivot quarter rows into chart-friendly series: [{ quarter_label, <customer1>: value, <customer2>: value }] */
export function pivotByQuarter(rows, valueKey = "total_value", groupKey = "customer_name") {
  const byQuarter = {};
  const groups = new Set();
  for (const r of rows) {
    const q = r.quarter_label;
    const g = r[groupKey] || "Unknown";
    groups.add(g);
    if (!byQuarter[q]) byQuarter[q] = { quarter_label: q, order_year: r.order_year, order_quarter: r.order_quarter };
    byQuarter[q][g] = (byQuarter[q][g] || 0) + Number(r[valueKey] || 0);
  }
  const sorted = Object.values(byQuarter).sort((a, b) =>
    a.order_year - b.order_year || a.order_quarter - b.order_quarter
  );
  return { series: sorted, groups: [...groups] };
}

/** Season-over-season: compare this quarter vs same quarter last year across all customers. */
export function seasonOverSeason(rows) {
  const byQuarter = {};
  for (const r of rows) {
    const key = `${r.order_year}-Q${r.order_quarter}`;
    if (!byQuarter[key]) byQuarter[key] = { year: r.order_year, quarter: r.order_quarter, value: 0, qty: 0 };
    byQuarter[key].value += Number(r.total_value || 0);
    byQuarter[key].qty += Number(r.total_quantity || 0);
  }
  const list = Object.values(byQuarter).sort((a, b) => a.year - b.year || a.quarter - b.quarter);
  return list.map(cur => {
    const prior = list.find(p => p.year === cur.year - 1 && p.quarter === cur.quarter);
    return {
      ...cur,
      label: `Q${cur.quarter} ${cur.year}`,
      valueYoY: prior ? yoyPct(cur.value, prior.value) : null,
      qtyYoY: prior ? yoyPct(cur.qty, prior.qty) : null,
    };
  });
}

/** Forecast next quarter using moving avg + YoY growth rate. */
export function forecastNextQuarter(sosList) {
  if (sosList.length < 2) return null;
  const recentValues = sosList.slice(-4).map(s => s.value);
  const ma = movingAvg(recentValues, 4);
  const yoys = sosList.slice(-4).map(s => s.valueYoY).filter(v => v != null);
  const avgYoY = yoys.length ? yoys.reduce((a, b) => a + b, 0) / yoys.length : 0;
  return {
    maForecast: ma,
    yoyAdjusted: ma * (1 + avgYoY / 100),
    avgYoY,
  };
}

