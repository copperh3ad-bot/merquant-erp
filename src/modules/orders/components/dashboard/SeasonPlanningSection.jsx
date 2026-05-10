import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { callClaude } from "@/lib/claude";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, Sparkles, Calendar, Users, Package } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  computeCustomerYoY, pivotByQuarter, seasonOverSeason, forecastNextQuarter,
} from "@/lib/seasonPlanning";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];

const fmtUSD = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (n) => n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const fmtNum = (n) => Number(n || 0).toLocaleString();

export default function SeasonPlanningSection() {
  const [loading, setLoading] = useState(true);
  const [custQuarter, setCustQuarter] = useState([]);
  const [catQuarter, setCatQuarter] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("__all");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCommentary, setAiCommentary] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [cq, catq, m] = await Promise.all([
        supabase.from("season_by_customer_quarter").select("*"),
        supabase.from("season_by_category_quarter").select("*"),
        supabase.from("season_by_month").select("*"),
      ]);
      if (cq.error) throw cq.error;
      if (catq.error) throw catq.error;
      if (m.error) throw m.error;
      setCustQuarter(cq.data || []);
      setCatQuarter(catq.data || []);
      setMonthly(m.data || []);
    } catch (e) {
      setError(e.message || "Failed to load season data");
    } finally {
      setLoading(false);
    }
  }

  const customerStats = useMemo(() => computeCustomerYoY(custQuarter), [custQuarter]);
  const allCustomers = useMemo(() => customerStats.map(c => c.customer), [customerStats]);

  const filteredCustQ = useMemo(
    () => selectedCustomer === "__all" ? custQuarter : custQuarter.filter(r => r.customer_name === selectedCustomer),
    [custQuarter, selectedCustomer]
  );

  const customerPivot = useMemo(() => pivotByQuarter(custQuarter, "total_value", "customer_name"), [custQuarter]);
  const categoryPivot = useMemo(() => pivotByQuarter(catQuarter, "total_value", "category"), [catQuarter]);
  const sos = useMemo(() => seasonOverSeason(filteredCustQ), [filteredCustQ]);
  const forecast = useMemo(() => forecastNextQuarter(sos), [sos]);

  const monthlySeries = useMemo(
    () => monthly.map(m => ({
      month_label: m.month_label,
      value: Number(m.total_value || 0),
      qty: Number(m.total_quantity || 0),
      pos: Number(m.po_count || 0),
    })),
    [monthly]
  );

  // Top-line metrics
  const topMetrics = useMemo(() => {
    const totalValue = sos.reduce((s, q) => s + q.value, 0);
    const totalQty = sos.reduce((s, q) => s + q.qty, 0);
    const latest = sos[sos.length - 1];
    const latestYoY = latest?.valueYoY;
    return { totalValue, totalQty, latest, latestYoY };
  }, [sos]);

  async function getAiCommentary() {
    setAiLoading(true);
    setAiCommentary("");
    try {
      const ctx = {
        customer_scope: selectedCustomer === "__all" ? "All customers" : selectedCustomer,
        quarters: sos.map(q => ({ label: q.label, value: Math.round(q.value), qty: q.qty, yoy: q.valueYoY?.toFixed(1) })),
        top_customers: customerStats.slice(0, 5).map(c => ({
          name: c.customer,
          total_value: Math.round(c.totalValue),
          po_count: c.poCount,
          yoy: c.yoy?.toFixed(1),
        })),
        forecast_next_quarter: forecast ? {
          moving_avg: Math.round(forecast.maForecast),
          yoy_adjusted: Math.round(forecast.yoyAdjusted),
          avg_yoy_pct: forecast.avgYoY?.toFixed(1),
        } : null,
      };
      const prompt = `You are a textile export merchandising analyst. Given these aggregated purchase-order stats, write a concise narrative forecast and insights (4-6 sentences). Mention: trend direction, notable YoY changes, top customers, any concerns, and what to expect next quarter. Be specific with numbers. Do NOT use markdown headers — plain prose only.

DATA:
${JSON.stringify(ctx, null, 2)}`;
      const resp = await callClaude({
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
      });
      const text = resp?.content?.[0]?.text || resp?.text || "No response.";
      setAiCommentary(text);
    } catch (e) {
      setAiCommentary(`Failed to generate commentary: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading season planning data…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-red-600 text-sm">{error}</CardContent>
      </Card>
    );
  }

  if (!custQuarter.length) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" /> Season Planning</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No order history yet. Create POs with order dates to see trend analysis.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Calendar className="h-5 w-5" /> Season Planning & Forecast
          </h2>
          <p className="text-xs text-muted-foreground">Calendar quarters · Trend analysis across customer order history</p>
        </div>
        <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All customers</SelectItem>
            {allCustomers.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard icon={<Package className="h-4 w-4" />} label="Total Order Value" value={fmtUSD(topMetrics.totalValue)} />
        <MetricCard icon={<Package className="h-4 w-4" />} label="Total Quantity" value={fmtNum(topMetrics.totalQty)} />
        <MetricCard
          icon={topMetrics.latestYoY >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
          label={`Latest Quarter YoY${topMetrics.latest ? ` (${topMetrics.latest.label})` : ""}`}
          value={fmtPct(topMetrics.latestYoY)}
          valueClass={topMetrics.latestYoY >= 0 ? "text-emerald-600" : "text-red-600"}
        />
        <MetricCard
          icon={<Sparkles className="h-4 w-4 text-indigo-600" />}
          label="Next Qtr Forecast (YoY adj)"
          value={forecast ? fmtUSD(forecast.yoyAdjusted) : "—"}
          sub={forecast ? `Avg YoY ${fmtPct(forecast.avgYoY)}` : ""}
        />
      </div>

      {/* Charts row 1: customer + category trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Order Value by Customer (by Quarter)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={customerPivot.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="quarter_label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmtUSD(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {customerPivot.groups.slice(0, 6).map((g, i) => (
                  <Line key={g} type="monotone" dataKey={g} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Package className="h-4 w-4" /> Order Value by Product Category</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryPivot.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="quarter_label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmtUSD(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {categoryPivot.groups.slice(0, 6).map((g, i) => (
                  <Bar key={g} dataKey={g} stackId="a" fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2: monthly + season over season */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Order Value</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month_label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmtUSD(v)} />
                <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Season-over-Season YoY %</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sos.filter(s => s.valueYoY != null)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                <Bar dataKey="valueYoY" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Customer leaderboard */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Customer Performance (Top 8)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b text-muted-foreground">
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 px-3 text-right">POs</th>
                  <th className="py-2 px-3 text-right">Total Value</th>
                  <th className="py-2 px-3 text-right">Total Qty</th>
                  <th className="py-2 px-3 text-right">3Q MA</th>
                  <th className="py-2 px-3 text-right">Latest Qtr YoY</th>
                </tr>
              </thead>
              <tbody>
                {customerStats.slice(0, 8).map(c => (
                  <tr key={c.customer} className="border-b hover:bg-muted/30">
                    <td className="py-2 pr-3 font-medium">{c.customer}</td>
                    <td className="py-2 px-3 text-right">{c.poCount}</td>
                    <td className="py-2 px-3 text-right">{fmtUSD(c.totalValue)}</td>
                    <td className="py-2 px-3 text-right">{fmtNum(c.totalQty)}</td>
                    <td className="py-2 px-3 text-right">{fmtUSD(c.ma3)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${c.yoy == null ? "text-muted-foreground" : c.yoy >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtPct(c.yoy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* AI commentary */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-600" /> AI Forecast & Commentary</CardTitle>
          <Button size="sm" variant="outline" onClick={getAiCommentary} disabled={aiLoading}>
            {aiLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Generating…</> : "Generate"}
          </Button>
        </CardHeader>
        <CardContent>
          {aiCommentary ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{aiCommentary}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Click Generate to get an AI-written narrative forecast based on the stats above.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, valueClass = "" }) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 text-muted-foreground text-[11px] mb-1">{icon} {label}</div>
        <div className={`text-lg font-semibold ${valueClass}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

