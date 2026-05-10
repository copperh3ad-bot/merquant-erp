import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { rbac } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from "lucide-react";
import { format, addHours } from "date-fns";
import { cn } from "@/lib/utils";

const GCAL_COLORS = {
  PO:         "1",  // Lavender
  Fabric:     "5",  // Banana
  Approvals:  "3",  // Grape
  Sampling:   "4",  // Flamingo
  Production: "6",  // Tangerine
  QC:         "2",  // Sage
  Shipping:   "7",  // Peacock
};

async function pushMilestoneToGCal(milestone, poNumber, customerName) {
  const startDate = milestone.target_date; // YYYY-MM-DD
  const colorId = GCAL_COLORS[milestone.category] || "1";
  const title = `[${poNumber}] ${milestone.name}`;
  const description = `Customer: ${customerName}\nPO: ${poNumber}\nCategory: ${milestone.category || "—"}\nResponsible: ${milestone.responsible || "—"}\nStatus: ${milestone.status}`;

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const { supabase: supabaseClient } = await import("@/api/supabaseClient");
  const { data: { session } } = await supabaseClient.auth.getSession();
  const token = session?.access_token;
  if (!token) return { success: false, error: "Not authenticated" };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      system: "You create Google Calendar events using the calendar MCP tool. Always respond with JSON: {\"success\": true, \"event_id\": \"...\"}",
      messages: [{
        role: "user",
        content: `Create a Google Calendar event:\nTitle: ${title}\nDate: ${startDate} (all-day event)\nDescription: ${description}\nColor: ${colorId}\nReturn JSON with success and event_id.`
      }],
      mcp_servers: [{ type: "url", url: "https://gcal.mcp.claude.com/mcp", name: "gcal-mcp" }],
    }),
  });

  if (!response.ok) return { success: false, error: `HTTP ${response.status}` };

  const data = await response.json();
  const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "{}";
  try {
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { success: false, error: "No response" };
  } catch { return { success: false, error: "Parse error" }; }
}

export default function GCalSync({ milestones, poMap }) {
  const { user, can } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const qc = useQueryClient();

  const { data: existingSyncs = [] } = useQuery({
    queryKey: ["gcalSync", user?.id],
    queryFn: () => user ? rbac.gcalSync.list(user.id) : [],
    enabled: !!user,
  });

  const syncedIds = new Set(existingSyncs.filter(s => s.status === "synced").map(s => s.tna_milestone_id));
  const unsynced = milestones.filter(m => !syncedIds.has(m.id) && m.target_date && m.status !== "completed");

  const handleSyncAll = async () => {
    if (!can("TNA_GCAL_SYNC")) return;
    if (!unsynced.length) return;
    setSyncing(true);
    setSyncLog([]);
    setProgress({ done: 0, total: unsynced.length });

    for (let i = 0; i < unsynced.length; i++) {
      const ms = unsynced[i];
      const po = poMap[ms.po_id];
      const poNumber = po?.po_number || "Unknown PO";
      const customerName = po?.customer_name || "";

      try {
        const result = await pushMilestoneToGCal(ms, poNumber, customerName);
        if (result.success) {
          await rbac.gcalSync.upsert({
            user_id: user.id,
            tna_milestone_id: ms.id,
            gcal_event_id: result.event_id || "synced",
            status: "synced",
            last_synced_at: new Date().toISOString(),
          });
          setSyncLog(prev => [...prev, { name: ms.name, po: poNumber, status: "ok" }]);
        } else {
          await rbac.gcalSync.upsert({ user_id: user.id, tna_milestone_id: ms.id, gcal_event_id: null, status: "failed" });
          setSyncLog(prev => [...prev, { name: ms.name, po: poNumber, status: "error", msg: result.error }]);
        }
      } catch (e) {
        setSyncLog(prev => [...prev, { name: ms.name, po: poNumber, status: "error", msg: e.message }]);
      }
      setProgress({ done: i + 1, total: unsynced.length });
    }

    qc.invalidateQueries({ queryKey: ["gcalSync", user?.id] });
    setSyncing(false);
  };

  if (!can("TNA_GCAL_SYNC")) return null;

  return (
    <div className="border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Google Calendar Sync</span>
          <span className="text-xs text-muted-foreground">({syncedIds.size} synced · {unsynced.length} pending)</span>
        </div>
        <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={handleSyncAll} disabled={syncing || unsynced.length === 0}>
          {syncing
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin"/> Syncing {progress.done}/{progress.total}…</>
            : <><RefreshCw className="h-3.5 w-3.5"/> Sync {unsynced.length} Milestones</>
          }
        </Button>
      </div>

      {/* Progress bar */}
      {syncing && (
        <div className="space-y-1">
          <div className="h-1.5 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Pushing to Google Calendar…</p>
        </div>
      )}

      {/* Sync log */}
      {syncLog.length > 0 && (
        <div className="bg-muted/30 rounded-lg p-3 max-h-32 overflow-y-auto space-y-1">
          {syncLog.map((l, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {l.status === "ok"
                ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0"/>
                : <AlertCircle className="h-3 w-3 text-red-500 shrink-0"/>
              }
              <span className="text-foreground">{l.name}</span>
              <span className="text-muted-foreground">— {l.po}</span>
              {l.msg && <span className="text-red-500">{l.msg}</span>}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Milestones are created as all-day events in your primary Google Calendar, colour-coded by category.
        Completed milestones are excluded.
      </p>
    </div>
  );
}

