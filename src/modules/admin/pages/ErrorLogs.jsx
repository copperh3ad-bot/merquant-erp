import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Bug, BrainCircuit, Download, Search, RefreshCw, TrendingUp, CheckCircle2, XCircle } from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import StatCard from "@/components/shared/StatCard";

// ── helpers ─────────────────────────────────────────────────────────────────

const fmt = (iso) => { try { return iso ? format(parseISO(iso), "dd MMM yy HH:mm") : "—"; } catch { return "—"; } };
const fmtDay = (iso) => { try { return iso ? format(parseISO(iso), "dd MMM") : "—"; } catch { return "—"; } };

const SEV_COLORS = {
  critical: "bg-red-100 text-red-800 border-red-200",
  error:    "bg-orange-100 text-orange-800 border-orange-200",
  warning:  "bg-yellow-100 text-yellow-800 border-yellow-200",
  info:     "bg-blue-100 text-blue-800 border-blue-200",
};

const truncate = (s, n = 80) => (s && s.length > n ? s.slice(0, n) + "…" : s ?? "—");

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ErrorLogs() {
  const [tab, setTab] = useState("errors");
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("All");
  const [srcFilter, setSrcFilter] = useState("All");

  // ── data fetching ──────────────────────────────────────────────────────────

  const { data: errors = [], isLoading: errLoading, refetch: refetchErrors } = useQuery({
    queryKey: ["error_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("error_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  const { data: feedback = [], isLoading: fbLoading, refetch: refetchFb } = useQuery({
    queryKey: ["ml_feedback"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ml_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  // ── derived stats ──────────────────────────────────────────────────────────

  const errStats = useMemo(() => {
    const today = new Date();
    const last7 = subDays(today, 7);
    const last30 = subDays(today, 30);
    const recent = errors.filter(e => e.created_at && new Date(e.created_at) >= last7);
    const criticals = errors.filter(e => e.severity === "critical" || e.severity === "error");
    const byDay = {};
    for (let i = 0; i < 30; i++) {
      const d = format(subDays(today, i), "yyyy-MM-dd");
      byDay[d] = 0;
    }
    errors.filter(e => e.created_at && new Date(e.created_at) >= last30)
      .forEach(e => {
        const d = e.created_at.slice(0, 10);
        if (d in byDay) byDay[d]++;
      });
    // Top messages
    const msgCount = {};
    errors.forEach(e => { if (e.message) msgCount[e.message] = (msgCount[e.message] || 0) + 1; });
    const topMessages = Object.entries(msgCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([msg, count]) => ({ msg, count }));
    return { recent: recent.length, criticals: criticals.length, byDay, topMessages };
  }, [errors]);

  const fbStats = useMemo(() => {
    const totalCorrections = feedback.filter(f => f.feedback_type === "cell_edit").length;
    const byField = {};
    feedback.filter(f => f.field_name).forEach(f => {
      byField[f.field_name] = (byField[f.field_name] || 0) + 1;
    });
    const topFields = Object.entries(byField)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([field, count]) => ({ field, count }));
    const byModule = {};
    feedback.forEach(f => {
      byModule[f.source_module] = (byModule[f.source_module] || 0) + 1;
    });
    const topModules = Object.entries(byModule)
      .sort((a, b) => b[1] - a[1])
      .map(([module, count]) => ({ module, count }));
    const aiWrongCount = feedback.filter(f => f.was_correct === false).length;
    const aiRightCount = feedback.filter(f => f.was_correct === true).length;
    return { totalCorrections, topFields, topModules, aiWrongCount, aiRightCount };
  }, [feedback]);

  // ── filtered lists ─────────────────────────────────────────────────────────

  const filteredErrors = useMemo(() => {
    const q = search.toLowerCase();
    return errors.filter(e => {
      const matchSev = sevFilter === "All" || e.severity === sevFilter;
      const matchSearch = !q || e.message?.toLowerCase().includes(q) || e.url?.toLowerCase().includes(q) || e.component?.toLowerCase().includes(q);
      return matchSev && matchSearch;
    });
  }, [errors, search, sevFilter]);

  const filteredFeedback = useMemo(() => {
    const q = search.toLowerCase();
    return feedback.filter(f => {
      const matchSrc = srcFilter === "All" || f.source_module === srcFilter;
      const matchSearch = !q || f.field_name?.toLowerCase().includes(q) || f.original_value?.toLowerCase().includes(q) || f.corrected_value?.toLowerCase().includes(q);
      return matchSrc && matchSearch;
    });
  }, [feedback, search, srcFilter]);

  const isLoading = tab === "errors" ? errLoading : fbLoading;

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Error Logs & ML Feedback</h1>
          <p className="text-sm text-muted-foreground mt-0.5">System errors and AI correction data for continuous improvement</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => tab === "errors" ? refetchErrors() : refetchFb()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
          {tab === "ml" && (
            <Button variant="outline" size="sm" onClick={() => downloadJSON(feedback, `ml-training-data-${format(new Date(), "yyyyMMdd")}.json`)}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export Training Data
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      {tab === "errors" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Errors (7 days)" value={errStats.recent} icon={AlertTriangle} color="text-orange-600" />
          <StatCard label="Critical / Error" value={errStats.criticals} icon={Bug} color="text-red-600" />
          <StatCard label="Total (500 latest)" value={errors.length} icon={Bug} color="text-slate-600" />
          <StatCard label="Top issue count" value={errStats.topMessages[0]?.count ?? 0} icon={TrendingUp} color="text-blue-600" />
        </div>
      )}
      {tab === "ml" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Cell Corrections" value={fbStats.totalCorrections} icon={BrainCircuit} color="text-purple-600" />
          <StatCard label="AI Was Wrong" value={fbStats.aiWrongCount} icon={XCircle} color="text-red-600" />
          <StatCard label="AI Was Correct" value={fbStats.aiRightCount} icon={CheckCircle2} color="text-green-600" />
          <StatCard label="Total Feedback Rows" value={feedback.length} icon={TrendingUp} color="text-blue-600" />
        </div>
      )}

      {/* Main tabs */}
      <Tabs value={tab} onValueChange={v => { setTab(v); setSearch(""); setSevFilter("All"); setSrcFilter("All"); }}>
        <TabsList>
          <TabsTrigger value="errors" className="gap-1.5"><Bug className="h-3.5 w-3.5" /> Error Log</TabsTrigger>
          <TabsTrigger value="ml" className="gap-1.5"><BrainCircuit className="h-3.5 w-3.5" /> ML Feedback</TabsTrigger>
          <TabsTrigger value="insights" className="gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Insights</TabsTrigger>
        </TabsList>

        {/* ── Error Log tab ── */}
        <TabsContent value="errors" className="mt-4 space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search message, URL, component…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
            </div>
            <Select value={sevFilter} onValueChange={setSevFilter}>
              <SelectTrigger className="w-36 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["All","critical","error","warning","info"].map(s => <SelectItem key={s} value={s}>{s === "All" ? "All severities" : s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">Time</TableHead>
                        <TableHead className="text-xs">Severity</TableHead>
                        <TableHead className="text-xs">Message</TableHead>
                        <TableHead className="text-xs hidden md:table-cell">Category</TableHead>
                        <TableHead className="text-xs hidden lg:table-cell">Component</TableHead>
                        <TableHead className="text-xs hidden xl:table-cell">URL</TableHead>
                        <TableHead className="text-xs hidden xl:table-cell">User</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredErrors.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">No errors found</TableCell></TableRow>
                      ) : filteredErrors.map(e => (
                        <TableRow key={e.id} className="hover:bg-muted/30">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(e.created_at)}</TableCell>
                          <TableCell>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${SEV_COLORS[e.severity] ?? SEV_COLORS.info}`}>
                              {e.severity ?? "info"}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs max-w-xs">
                            <span className="font-mono">{truncate(e.message, 100)}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden md:table-cell">{e.category ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden lg:table-cell font-mono">{truncate(e.component, 50)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden xl:table-cell">{e.url ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden xl:table-cell">{e.user_email ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── ML Feedback tab ── */}
        <TabsContent value="ml" className="mt-4 space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search field, value…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
            </div>
            <Select value={srcFilter} onValueChange={setSrcFilter}>
              <SelectTrigger className="w-44 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All modules</SelectItem>
                {["po_extraction","tna_risk","payment_auto","compliance_auto","fabric_shortfall","qc_verdict","job_card_auto","sample_auto"]
                  .map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {fbLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">Time</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Module</TableHead>
                        <TableHead className="text-xs">Field</TableHead>
                        <TableHead className="text-xs">AI Said</TableHead>
                        <TableHead className="text-xs">Human Corrected To</TableHead>
                        <TableHead className="text-xs hidden lg:table-cell">User</TableHead>
                        <TableHead className="text-xs hidden xl:table-cell">Correct?</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredFeedback.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">No feedback recorded yet</TableCell></TableRow>
                      ) : filteredFeedback.map(f => (
                        <TableRow key={f.id} className="hover:bg-muted/30">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(f.created_at)}</TableCell>
                          <TableCell>
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
                              {f.feedback_type ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{f.source_module ?? "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{f.field_name ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[140px]">
                            <span className="text-red-700 font-mono">{truncate(f.original_value, 40)}</span>
                          </TableCell>
                          <TableCell className="text-xs max-w-[140px]">
                            <span className="text-green-700 font-mono">{truncate(f.corrected_value, 40)}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{f.user_email ?? "—"}</TableCell>
                          <TableCell className="hidden xl:table-cell">
                            {f.was_correct === true && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                            {f.was_correct === false && <XCircle className="h-4 w-4 text-red-500" />}
                            {f.was_correct === null && <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Insights tab ── */}
        <TabsContent value="insights" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Top error messages */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Bug className="h-4 w-4 text-orange-500" /> Top Recurring Errors
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Message</TableHead>
                      <TableHead className="text-xs text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {errStats.topMessages.length === 0 ? (
                      <TableRow><TableCell colSpan={2} className="text-center text-xs text-muted-foreground py-6">No errors recorded</TableCell></TableRow>
                    ) : errStats.topMessages.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">{truncate(r.msg, 60)}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Most corrected ML fields */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-purple-500" /> Most Corrected AI Fields
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Field</TableHead>
                      <TableHead className="text-xs text-right">Corrections</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fbStats.topFields.length === 0 ? (
                      <TableRow><TableCell colSpan={2} className="text-center text-xs text-muted-foreground py-6">No corrections recorded yet</TableCell></TableRow>
                    ) : fbStats.topFields.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">{r.field}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Corrections by module */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-500" /> Feedback by Module
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Module</TableHead>
                      <TableHead className="text-xs text-right">Events</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fbStats.topModules.length === 0 ? (
                      <TableRow><TableCell colSpan={2} className="text-center text-xs text-muted-foreground py-6">No feedback yet</TableCell></TableRow>
                    ) : fbStats.topModules.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{r.module}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Error volume by day (last 14 days) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" /> Daily Error Volume (30 days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {Object.entries(errStats.byDay)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .filter(([, v]) => v > 0)
                    .slice(-14)
                    .map(([day, count]) => {
                      const max = Math.max(...Object.values(errStats.byDay), 1);
                      return (
                        <div key={day} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-16 shrink-0">{fmtDay(day)}</span>
                          <div className="flex-1 bg-muted rounded-full h-2">
                            <div className="bg-orange-400 h-2 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
                          </div>
                          <span className="text-xs font-semibold w-6 text-right">{count}</span>
                        </div>
                      );
                    })}
                  {Object.values(errStats.byDay).every(v => v === 0) && (
                    <p className="text-xs text-muted-foreground text-center py-4">No errors in the last 30 days</p>
                  )}
                </div>
              </CardContent>
            </Card>

          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
