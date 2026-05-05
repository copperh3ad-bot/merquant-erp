// src/pages/BuyerPortal.jsx
//
// F5 — Buyer Portal. Sees only the current Buyer user's own data via
// the RLS policies in mig 40 (purchase_orders, shipments, samples
// scoped by buyer_contacts.buyer_user_id → customer_name match).
//
// The page is RLS-trusting — we just .select() everything; the database
// returns only the rows this user is allowed to see. Internal staff
// roles never land on this page (PAGE_VISIBILITY restricts to Buyer).
//
// AI chat panel: cost-blind, buyer-isolated NLM. System prompt forbids
// pricing / cost / margin disclosure and forbids cross-buyer data.

import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Briefcase, Sparkles, Loader2, Send, Ship, Package2, Calendar } from "lucide-react";
import { callClaude } from "@/lib/aiProxy";

export default function BuyerPortal() {
  const { user } = useAuth();
  const buyerName = user?.email || "Buyer";

  // Buyer-scoped reads — RLS does the filtering server-side. The select
  // call would return [] for any non-Buyer who somehow hit this page.
  const { data: pos = [] } = useQuery({
    queryKey: ["buyerPortalPOs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, po_number, customer_name, status, approval_status, ex_factory_date, delivery_date, total_quantity, created_at")
        .order("ex_factory_date", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: shipments = [] } = useQuery({
    queryKey: ["buyerPortalShipments", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id, po_id, status, etd, eta, container_number, awb_number")
        .order("etd", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: samples = [] } = useQuery({
    queryKey: ["buyerPortalSamples", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("samples")
        .select("id, po_id, sample_type, status, sent_date, approval_date")
        .order("sent_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const stats = useMemo(() => {
    const today = new Date();
    return {
      activePOs: pos.filter(p => p.status !== "Completed" && p.status !== "Cancelled").length,
      shipped: shipments.filter(s => s.status === "Shipped" || s.status === "Delivered").length,
      onTime: pos.filter(p => p.ex_factory_date && new Date(p.ex_factory_date) >= today).length,
      pendingSamples: samples.filter(s => s.status === "Sent" || s.status === "Pending").length,
    };
  }, [pos, shipments, samples]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Briefcase className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-base font-bold">Buyer Portal</h1>
          <p className="text-[11px] text-muted-foreground">Your orders, shipments, and samples — live status</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active POs"        value={stats.activePOs} icon={<Briefcase className="h-4 w-4 text-blue-600" />} />
        <Stat label="Shipped"           value={stats.shipped} icon={<Ship className="h-4 w-4 text-emerald-600" />} />
        <Stat label="On-time POs"       value={stats.onTime} icon={<Calendar className="h-4 w-4 text-violet-600" />} />
        <Stat label="Pending samples"   value={stats.pendingSamples} icon={<Package2 className="h-4 w-4 text-amber-600" />} />
      </div>

      {/* PO list */}
      <Section title="Your Purchase Orders" count={pos.length}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#EBF0FA" }}>
              <th className="border border-gray-300 px-2 py-1.5 text-left">PO #</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Customer</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Status</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Approval</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right">Qty</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Ex-Factory</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Delivery</th>
            </tr>
          </thead>
          <tbody>
            {pos.length === 0 ? (
              <tr><td colSpan={7} className="border border-gray-300 px-2 py-3 text-center text-muted-foreground italic">
                No POs visible to your account yet. Contact MerQuant if you expected to see orders here.
              </td></tr>
            ) : pos.map((p, i) => (
              <tr key={p.id} style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                <td className="border border-gray-300 px-2 py-1.5 font-medium">{p.po_number}</td>
                <td className="border border-gray-300 px-2 py-1.5">{p.customer_name || "—"}</td>
                <td className="border border-gray-300 px-2 py-1.5">{p.status || "—"}</td>
                <td className="border border-gray-300 px-2 py-1.5">{p.approval_status || "—"}</td>
                <td className="border border-gray-300 px-2 py-1.5 text-right">{(Number(p.total_quantity) || 0).toLocaleString()}</td>
                <td className="border border-gray-300 px-2 py-1.5">{p.ex_factory_date || "—"}</td>
                <td className="border border-gray-300 px-2 py-1.5">{p.delivery_date || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Shipments */}
      <Section title="Shipments" count={shipments.length}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#EBF0FA" }}>
              <th className="border border-gray-300 px-2 py-1.5 text-left">PO</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Status</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">ETD</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">ETA</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Container</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">AWB</th>
            </tr>
          </thead>
          <tbody>
            {shipments.length === 0 ? (
              <tr><td colSpan={6} className="border border-gray-300 px-2 py-3 text-center text-muted-foreground italic">No shipments yet.</td></tr>
            ) : shipments.map((s, i) => {
              const po = pos.find(p => p.id === s.po_id);
              return (
                <tr key={s.id} style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                  <td className="border border-gray-300 px-2 py-1.5 font-medium">{po?.po_number || s.po_id.slice(0, 8)}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.status || "—"}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.etd || "—"}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.eta || "—"}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.container_number || "—"}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.awb_number || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* Samples */}
      <Section title="Sample Approvals" count={samples.length}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#EBF0FA" }}>
              <th className="border border-gray-300 px-2 py-1.5 text-left">PO</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Type</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Status</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Sent</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left">Approved</th>
            </tr>
          </thead>
          <tbody>
            {samples.length === 0 ? (
              <tr><td colSpan={5} className="border border-gray-300 px-2 py-3 text-center text-muted-foreground italic">No samples yet.</td></tr>
            ) : samples.map((s, i) => {
              const po = pos.find(p => p.id === s.po_id);
              return (
                <tr key={s.id} style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB" }}>
                  <td className="border border-gray-300 px-2 py-1.5 font-medium">{po?.po_number || s.po_id?.slice(0, 8) || "—"}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.sample_type || "—"}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.status || "—"}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.sent_date || "—"}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{s.approval_date || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* AI chat — cost-blind, buyer-scoped */}
      <BuyerAIChat buyerName={buyerName} pos={pos} shipments={shipments} samples={samples} />
    </div>
  );
}

function Stat({ label, value, icon }) {
  return (
    <div className="rounded border border-gray-300 shadow-sm p-3 bg-white flex items-center gap-3">
      {icon}
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-lg font-bold">{value.toLocaleString()}</p>
      </div>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div className="rounded border border-gray-300 shadow-sm overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold text-white flex items-center justify-between" style={{ backgroundColor: "#1F3864" }}>
        <span>{title}</span>
        <span className="font-normal opacity-80">{count.toLocaleString()}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function BuyerAIChat({ buyerName, pos, shipments, samples }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setHistory(h => [...h, { role: "user", text: question }]);
    setQ("");
    try {
      // Buyer-scoped, cost-blind. We pass ONLY the data this user
      // already sees on the page (RLS-filtered) and explicitly forbid
      // any pricing/margin disclosure in the system prompt.
      const data = await callClaude({
        system: "You are a customer service assistant for a garment manufacturer. You have access ONLY to PO data, shipment status, and sample approvals for this specific buyer. Answer questions about order status, delivery dates, and sample approvals in a professional, reassuring tone. NEVER reveal cost, margin, or pricing data. NEVER reveal data from any other buyer under any circumstances. If asked about pricing or another buyer, politely decline and offer to connect them with their account manager.",
        messages: [{
          role: "user",
          content: `Buyer: ${buyerName}\n\nMy data (read-only):\n${JSON.stringify({ pos, shipments, samples }, null, 2)}\n\nQuestion: ${question}`,
        }],
        max_tokens: 500,
      });
      const text = data?.content?.[0]?.text || data?.text || "";
      setHistory(h => [...h, { role: "assistant", text: text || "(no response)" }]);
    } catch {
      setHistory(h => [...h, { role: "assistant", text: "Sorry, the assistant is unavailable right now. Please contact your account manager." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded border border-gray-300 shadow-sm overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold text-white flex items-center gap-2" style={{ backgroundColor: "#1F3864" }}>
        <Sparkles className="h-3.5 w-3.5" /> Ask about your orders
      </div>
      <div className="p-3 space-y-2">
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            Ask plain-English questions like "When does my Cal King PO ship?" or "Are any sample approvals overdue?"
          </p>
        )}
        {history.map((m, i) => (
          <div key={i} className={`text-xs ${m.role === "user" ? "font-semibold" : "bg-blue-50 rounded p-2 border border-blue-100"}`}>
            <span className="text-muted-foreground">{m.role === "user" ? "You:" : "Assistant:"}</span> {m.text}
          </div>
        ))}
        <div className="flex gap-2 pt-2 border-t border-gray-200">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") ask(); }}
            placeholder="Ask a question…"
            className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5"
            disabled={busy}
          />
          <Button size="sm" onClick={ask} disabled={busy || !q.trim()} className="gap-1.5 text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Ask
          </Button>
        </div>
      </div>
    </div>
  );
}
