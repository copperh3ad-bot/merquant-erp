import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Search, RefreshCcw, Activity, Database, AlertTriangle, Clock, User, CheckCircle2 } from "lucide-react";
import StatCard from "@/components/shared/StatCard";

const ACTIONS = ["INSERT", "UPDATE", "DELETE"];

function ActionBadge({ action }) {
  const map = {
    INSERT: "bg-emerald-100 text-emerald-700",
    UPDATE: "bg-blue-100 text-blue-700",
    DELETE: "bg-red-100 text-red-700",
  };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${map[action] || "bg-gray-100"}`}>{action}</span>;
}

function timeAgo(ts) {
  const t = new Date(ts).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AuditDashboard() {
  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState("__all");
  const [tableFilter, setTableFilter] = useState("__all");
  const [actionFilter, setActionFilter] = useState("__all");
  const [days, setDays] = useState(7);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["auditLog", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase.from("audit_log")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  const { data: backups = [] } = useQuery({
    queryKey: ["backupRuns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log")
        .select("*")
        .eq("table_name", "_backup")
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) return [];
      return data || [];
    },
    refetchInterval: 60000,
  });

  const uniqueUsers = Array.from(new Set(rows.map(r => r.user_email).filter(Boolean))).sort();
  const uniqueTables = Array.from(new Set(rows.map(r => r.table_name).filter(Boolean))).sort();

  const filtered = rows.filter(r => {
    if (userFilter !== "__all" && r.user_email !== userFilter) return false;
    if (tableFilter !== "__all" && r.table_name !== tableFilter) return false;
    if (actionFilter !== "__all" && r.action !== actionFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.user_email || "").toLowerCase().includes(q) ||
           (r.table_name || "").toLowerCase().includes(q) ||
           (r.record_id || "").toLowerCase().includes(q) ||
           JSON.stringify(r.changed_fields || []).toLowerCase().includes(q);
  });

  const stats = {
    total: rows.length,
    deletes: rows.filter(r => r.action === "DELETE").length,
    updates: rows.filter(r => r.action === "UPDATE").length,
    inserts: rows.filter(r => r.action === "INSERT").length,
    users: uniqueUsers.length,
  };

  const lastBackup = backups[0];
  const lastBackupAge = lastBackup ? Date.now() - new Date(lastBackup.created_at).getTime() : Infinity;
  const backupHealthy = lastBackupAge < 90 * 60 * 1000; // < 90 minutes

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-bold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" /> Audit & System Health
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Owner-only view · all user actions tracked + hourly backup status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <button onClick={() => refetch()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Events" value={stats.total} icon={Activity} />
        <StatCard label="Active Users" value={stats.users} icon={User} />
        <StatCard label="Inserts" value={stats.inserts} icon={CheckCircle2} accent="green" />
        <StatCard label="Updates" value={stats.updates} icon={Activity} accent="blue" />
        <StatCard label="Deletes" value={stats.deletes} icon={AlertTriangle} accent={stats.deletes > 10 ? "red" : "gray"} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4" /> Backup Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${backupHealthy ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
              <div>
                <div className="text-sm font-medium">
                  {lastBackup ? `Last backup: ${timeAgo(lastBackup.created_at)}` : "No backups yet"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {backups.length} backups in last 24h · Expected: ~24 (every hour)
                </div>
              </div>
            </div>
            {lastBackup && (
              <div className="text-xs text-muted-foreground">
                {lastBackup.new_data?.total_rows?.toLocaleString()} rows · {lastBackup.new_data?.tables_backed_up} tables
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-sm mr-auto">Audit Trail ({filtered.length})</CardTitle>
            <div className="relative max-w-xs">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-8 pl-7 text-xs w-44" />
            </div>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All users</SelectItem>
                {uniqueUsers.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All tables</SelectItem>
                {uniqueTables.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All actions</SelectItem>
                {ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No events match filters.</div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-2 font-medium">When</th>
                    <th className="text-left p-2 font-medium">User</th>
                    <th className="text-left p-2 font-medium">Action</th>
                    <th className="text-left p-2 font-medium">Table</th>
                    <th className="text-left p-2 font-medium">Record ID</th>
                    <th className="text-left p-2 font-medium">Fields Changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(r => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="p-2 text-muted-foreground whitespace-nowrap">
                        <div>{timeAgo(r.created_at)}</div>
                        <div className="text-[10px]">{new Date(r.created_at).toLocaleTimeString()}</div>
                      </td>
                      <td className="p-2 font-medium">{r.user_email || <span className="text-muted-foreground italic">system</span>}</td>
                      <td className="p-2"><ActionBadge action={r.action} /></td>
                      <td className="p-2 font-mono text-[10px]">{r.table_name}</td>
                      <td className="p-2 font-mono text-[10px] text-muted-foreground truncate max-w-[140px]" title={r.record_id}>{r.record_id}</td>
                      <td className="p-2">
                        {(r.changed_fields || []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(r.changed_fields || []).slice(0, 5).map(f => (
                              <Badge key={f} variant="secondary" className="text-[9px] py-0 px-1.5">{f}</Badge>
                            ))}
                            {(r.changed_fields || []).length > 5 && (
                              <span className="text-[10px] text-muted-foreground">+{r.changed_fields.length - 5} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground px-1">
        <strong>What's logged:</strong> create, update, delete on all main tables · timestamped · user-attributed · field-level changes. Retention: 30 days.
      </div>
    </div>
  );
}
