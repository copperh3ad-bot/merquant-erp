import React, { useState, useRef, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Sparkles, Send, Loader2, Terminal, Code2, Database,
  Search, ChevronDown, ChevronRight, Copy, Check,
  RotateCcw, Zap, MessageSquare, Play, Lock
} from "lucide-react";

const SYSTEM_PROMPT = `You are an expert full-stack developer and AI builder agent for MerQuant — a quantitative merchandising ERP for textile manufacturing, built with React 18 + Vite + Tailwind CSS v3 + shadcn/ui + Supabase + Anthropic Claude.

## Full Database Schema (Postgres / Supabase)

### Core PO tables
- purchase_orders: id, po_number, pi_number, pi_date, customer_name, ship_to_name, ship_to_address, buyer_address, order_date, delivery_date, ex_factory_date, etd, eta, currency, total_po_value, total_quantity, total_cbm, status (PO Received → Items Entered → Price Verification → Price Approved → CBM Calculated → FWS Prepared → Yarn Planned → Accessories Planned → Packaging Planned → In Production → Completed → Shipped), season, port_of_loading, port_of_destination, payment_terms, ship_via, country_of_origin, sales_order_number, source (Email/WhatsApp/PDF/Manual), notes
- po_items: id, po_id, po_number, item_code, item_description, fabric_type, gsm, width, fabric_construction, finish, shrinkage, packing_method, color, size_breakdown (jsonb), quantity, unit, unit_price, total_price, expected_price, price_status (Matched/Mismatch/Pending), pieces_per_carton, num_cartons, carton_length, carton_width, carton_height, cbm, delivery_date, notes
- price_list: id, item_code, description, price_usd, cbm_per_carton, qty_per_carton, currency, valid_from, valid_to, notes

### Fabric & Articles
- articles: id, po_id, article_name, article_code, color, size_label, order_quantity, components (jsonb array of {component_type, product_size, direction, fabric_type, gsm, width, consumption_per_unit, wastage_percent, total_required}), total_fabric_required, notes
- fabric_templates: id, article_code, article_name, components (jsonb), notes, customer, program_code, article_type, size, price_usd, qty_per_carton, cbm_per_carton, pieces_per_carton
- yarn_requirements: id, po_id, po_number, article_code, article_name, fabric_type, gsm, width_cm, total_meters, yarn_kg, yarn_type, yarn_count, supplier, status, notes

### Trims & Accessories  
- trim_items: id, po_id, po_number, article_name, article_code, trim_category (Zipper/Elastic/Button/Dori/Eyelet/Stitching Thread/Velcro/etc), item_description, color, size_spec, calc_type (Per Piece/Per Meter/Per Set/Percentage), consumption_per_unit, wastage_percent, order_quantity, fabric_meters, quantity_required, unit, supplier, unit_cost, total_cost, status
- accessory_items: id, po_id, po_number, article_name, article_code, category (Label/Insert Card/Polybag/Stiffener/Carton/Sticker/etc), item_description, color, size_spec, pc_ean_code, carton_ean_code, quantity_required, wastage_percent, multiplier, consumption_per_unit, unit, supplier, unit_cost, total_cost, status
- accessory_templates: id, template_name, category, type, description, size_spec, default_wastage, default_multiplier, unit
- article_packaging: id, article_name, article_code, customer_name, ref_po_number, labels (jsonb), polybag (jsonb), stiffener (jsonb), carton (jsonb), stickers (jsonb), other_accessories (jsonb), notes
- accessory_purchase_orders: id, apo_number, po_ref, po_id, supplier, order_date, status, items (jsonb), total_cost, currency, notes

### Finance & Payments
- payments: id, po_id, po_number, payment_type (TT/LC/Advance/Against Documents/Balance), lc_number, lc_bank, lc_expiry, amount, currency, expected_date, actual_date, status (Pending/Received/Overdue/Partial/Disputed), notes
- costing_sheets: id, po_id, po_number, article_code, article_name, order_quantity, currency, fabric_cost, trim_cost, accessory_cost, embellishment_cost, cm_cost, washing_cost, overhead_pct, agent_commission_pct, freight_cost, buyer_price, total_cogs, gross_margin, gross_margin_pct

### Fabric Orders
- fabric_orders: id, po_id, po_number, fabric_order_number, mill_name, mill_contact, fabric_type, quality_spec, gsm, width_cm, color, quantity_meters, unit_price, currency, order_date, expected_delivery, actual_delivery, received_meters, shortfall_meters, status (Pending/Confirmed/Weaving/Dyeing/Dispatched/Received/Shortfall/Cancelled), notes

### Production & Shipping
- job_cards: id, po_id, job_card_number, article_name, article_code, quantity, fabric_details, yarn_details, process_steps (jsonb array of {step_name, status, notes}), status, notes
- shipping_documents: id, po_id, po_number, customer_name, document_type, document_number, document_date, file_url, file_name, shipment_status (Before Shipment/After Shipment), notes, compliance_type, po_number
- compliance_docs: id, po_id, po_number, doc_type, status, expiry_date, notes
- commercial_invoices: id, po_id, po_number, invoice_number, invoice_date, total_amount, currency, status, notes
- packing_lists: id, po_id, po_number, status, notes

## Key Formulas
- Yarn KG: total_meters × GSM × width_cm / 39.37 / 1000
- Fabric total_required: consumption_per_unit × order_qty × (1 + wastage/100)
- Trim Per Piece: ceil(order_qty × consumption × (1 + wastage%))
- Trim Per Meter: ceil(fabric_meters × consumption × (1 + wastage%))
- Trim Percentage: ceil(order_qty × (pct/100) × (1 + wastage%))
- Packaging incl wastage: ceil(qty × multiplier × (1 + wastage%))
- CBM from dimensions: (L×W×H) / 1,000,000 × num_cartons
- CBM from price list: ceil(qty / pcs_per_carton) × cbm_per_carton

## Frontend Stack
React 18, Vite, Tailwind CSS v3, shadcn/ui components at @/components/ui/*, @tanstack/react-query, react-router-dom, lucide-react, recharts, date-fns, jspdf.

## API Client
src/api/supabaseClient.js exports: { supabase, db, mfg, priceList, accessoryTemplates, articlePackaging, shippingDocs, jobCards, accessoryPOs, costing, compliance, fabricOrders, seasons, tna, labDips, samples, qcInspections, payments, packingLists, techPacks, AccessoriesTrimsApproval, poBatches, batchItems, commercialInvoices, rfqs, quotations, complaints, buyerContacts, skuQueue, emailCrawl }
- db.purchaseOrders: list, create, update, delete
- db.poItems: listByPO, list, create, update, delete, bulkCreate
- mfg.articles: listByPO, list, create, update, delete, bulkCreate
- mfg.fabricTemplates: list, getByCode, upsert
- mfg.yarn: listByPO, list, create, update, delete, bulkCreate
- mfg.trims: listByPO, create, update, delete
- mfg.accessories: list, listByPO, create, update, delete, bulkCreate
- mfg.jobCards: list, listByPO, create, update, delete
- priceList: list, upsert, update, byCode

## AI Proxy
callClaude() from src/lib/aiProxy.js — calls Supabase Edge Function ai-proxy which routes to Claude Sonnet.

You are MerQuant's AI assistant — a helpful, conversational chatbot for a textile merchandising system.

## Your personality
- Friendly, concise, conversational — like a knowledgeable colleague, not a SQL terminal
- Answer most questions with "type": "answer" — plain text conversation
- Only use "type": "sql" when the user explicitly asks for data retrieval or you need to query the database to answer
- Only use "type": "react" when the user explicitly asks for a component or page
- When you produce SQL, keep it SELECT-only unless the user explicitly asks to modify data
- When responding with an "answer", be direct and human — no SQL code, no JSON schemas, no technical jargon unless asked

## Response type decision tree
- "what is X" / "explain Y" / "how does Z work" / casual chat → type: "answer"
- "show me all POs where..." / "which customer has..." / "list me..." → type: "sql"
- "create a page that..." / "generate a component..." → type: "react"
- "walk me through fixing X" → type: "steps"

## Output rules
CRITICAL: Entire response must be a single valid JSON object. No preamble, no markdown fences. Start with { and end with }.

SQL rules (only when type=sql):
- Never include trailing semicolons in the "sql" field
- Write SELECT-only unless explicitly asked to modify data
- If you need to write data (INSERT/UPDATE/DELETE/DDL), set "sql_is_write": true so the UI asks for confirmation

Shape:
{
  "type": "sql" | "react" | "answer" | "steps",
  "title": "short title",
  "explanation": "optional — what the query does or brief context",
  "sql": "SQL here (for type=sql)",
  "sql_is_write": true,   // only for destructive/DDL SQL
  "code": "full React JSX (for type=react)",
  "filename": "src/pages/MyPage.jsx (for type=react)",
  "answer": "conversational text (for type=answer) — be natural and helpful",
  "steps": ["step 1", ...]  // for type=steps
}`;

const QUICK_PROMPTS = [
  { label: "BOB order summary",       icon: Database,  prompt: "Show all purchase orders for customer BOBS DISCOUNT FURNITURE — po_number, total_po_value, total_quantity, status, etd, season" },
  { label: "Fabric usage by PO",      icon: Search,    prompt: "Query total fabric required grouped by fabric_type across all articles for each PO, sorted by total meters descending" },
  { label: "Yarn requirements",       icon: Database,  prompt: "Show total yarn_kg grouped by fabric_type and po_number from yarn_requirements, sorted by yarn_kg descending" },
  { label: "Price mismatches",        icon: Zap,       prompt: "Show all po_items where price_status is Mismatch — include item_code, unit_price, expected_price, and po_number" },
  { label: "Accessory totals",        icon: Search,    prompt: "Show all accessory_items grouped by category with SUM(quantity_required) and COUNT(*), sorted by total quantity descending" },
  { label: "CBM & cartons by PO",     icon: Database,  prompt: "Show po_number, customer_name, total_cbm, total_quantity from purchase_orders where po_number like 'D71%', ordered by po_number" },
  { label: "Payment status",          icon: Database,  prompt: "Show all payments with po_number, payment_type, amount, currency, expected_date, status — ordered by expected_date" },
  { label: "Trim cost report",        icon: Terminal,  prompt: "Show trim_items with quantity_required > 0, grouped by po_number, summing quantity_required per category" },
  { label: "Article tracker page",    icon: Code2,     prompt: "Generate a React page showing all articles for a selected PO with components, fabric totals, and yarn KG. Use mfg.articles.listByPO() and formula: total_meters × GSM × width_cm / 39.37 / 1000" },
  { label: "Add delivery_date index", icon: Terminal,  prompt: "Add an index on po_items(delivery_date) and purchase_orders(ex_factory_date) for faster date queries" },
];

function TypeBadge({ type }) {
  const config = {
    sql: { label: "SQL", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    react: { label: "React", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    answer: { label: "Answer", cls: "bg-violet-50 text-violet-700 border-violet-200" },
    steps: { label: "Steps", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  }[type] || { label: type, cls: "bg-gray-50 text-gray-700 border-gray-200" };
  return (
    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded border", config.cls)}>
      {config.label}
    </span>
  );
}

function CodeBlock({ code, language = "sql" }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group mt-2">
      <div className="flex items-center justify-between bg-muted/60 border border-border rounded-t-lg px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground font-mono">{language}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="bg-muted/30 border border-t-0 border-border rounded-b-lg p-3 text-[12px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap break-words">
        {code}
      </pre>
    </div>
  );
}

function SQLResult({ data }) {
  if (!data || data.length === 0) return <p className="text-xs text-muted-foreground mt-2 italic">Query returned 0 rows.</p>;
  const keys = Object.keys(data[0]);
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            {keys.map(k => <th key={k} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 50).map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
              {keys.map(k => (
                <td key={k} className="px-3 py-2 text-foreground max-w-[200px] truncate">
                  {row[k] === null ? <span className="text-muted-foreground/50">null</span> : String(row[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 50 && <p className="text-xs text-muted-foreground text-center py-2">Showing 50 of {data.length} rows</p>}
    </div>
  );
}

function MessageBubble({ msg }) {
  const [sqlResult, setSqlResult] = useState(null);
  const [sqlError, setSqlError] = useState("");
  const [running, setRunning] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showSql, setShowSql] = useState(false);

  const runSQL = async (sql) => {
    setRunning(true); setSqlError(""); setSqlResult(null);
    try {
      // exec_sql does not accept trailing semicolons — strip them
      const cleanSql = sql.trim().replace(/;+$/, "");
      const { data, error } = await supabase.rpc("exec_sql", { query: cleanSql });
      if (error) throw error;
      // exec_sql returns jsonb array directly via Supabase JS client
      let rows;
      if (Array.isArray(data)) {
        rows = data;
      } else if (data && Array.isArray(data.exec_sql)) {
        rows = data.exec_sql;
      } else if (data && typeof data === "object") {
        rows = [data];
      } else {
        rows = [];
      }
      setSqlResult(rows);
    } catch (e) {
      setSqlError(e.message || "Query failed");
    } finally { setRunning(false); }
  };

  // Auto-run SELECT queries as soon as the message arrives. Writes still need a click.
  const isWriteSql = (sql, flag) => {
    if (flag === true) return true;
    const s = (sql || "").trim().toLowerCase();
    return /^(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/.test(s);
  };

  useEffect(() => {
    if (msg.role === "assistant" && msg.parsed?.type === "sql" && msg.parsed?.sql && sqlResult === null && !sqlError && !running) {
      if (!isWriteSql(msg.parsed.sql, msg.parsed.sql_is_write)) {
        runSQL(msg.parsed.sql);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id]);

  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
          {msg.content}
        </div>
      </div>
    );
  }

  const r = msg.parsed;
  if (!r) {
    return (
      <div className="flex gap-2 mb-3">
        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-muted-foreground max-w-[85%]">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 mb-4">
      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 max-w-[90%] space-y-2">
        <div className="flex items-center gap-2">
          <TypeBadge type={r.type} />
          <span className="text-sm font-medium text-foreground">{r.title}</span>
        </div>

        {r.explanation && <p className="text-sm text-muted-foreground">{r.explanation}</p>}

        {r.type === "sql" && r.sql && (
          <div>
            {/* Show results first/prominently. Hide the SQL behind a toggle — users asked for "chatbot", not "SQL IDE". */}
            {!sqlResult && !sqlError && running && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Running query…
              </div>
            )}
            {sqlError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-1">
                <p className="font-medium mb-1">Query failed</p>
                <p>{sqlError}</p>
                <Button size="sm" variant="outline" className="text-xs h-6 mt-2" onClick={() => runSQL(r.sql)}>
                  Retry
                </Button>
              </div>
            )}
            {sqlResult && <SQLResult data={sqlResult} />}

            {/* Toggle to reveal SQL — for debugging or trust verification */}
            <button
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-2"
              onClick={() => setShowSql(!showSql)}
            >
              {showSql ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showSql ? "Hide" : "Show"} SQL
            </button>
            {showSql && (
              <div className="mt-1">
                <CodeBlock code={r.sql} language="sql" />
                {isWriteSql(r.sql, r.sql_is_write) && !sqlResult && (
                  <div className="flex items-center gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                    <span className="text-[11px] text-amber-800 flex-1">This query modifies data. Confirm to run.</span>
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => runSQL(r.sql)} disabled={running}>
                      {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                      Run
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {r.type === "react" && r.code && (
          <div>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1" onClick={() => setShowCode(!showCode)}>
              {showCode ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showCode ? "Hide" : "Show"} component code
              {r.filename && <span className="ml-1 font-mono text-primary">{r.filename}</span>}
            </button>
            {showCode && <CodeBlock code={r.code} language="jsx" />}
          </div>
        )}

        {r.type === "answer" && r.answer && (
          <div className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2">{r.answer}</div>
        )}

        {r.type === "steps" && r.steps && (
          <ol className="space-y-1.5 mt-1">
            {r.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-medium flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span className="text-foreground">{step}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default function AIAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef();
  const textareaRef = useRef();
  const { role, can, isOwner, profile, refreshProfile } = useAuth();

  // If profile hasn't loaded yet (role defaults to "Viewer"), trigger a refresh
  React.useEffect(() => {
    if (!profile) refreshProfile();
  }, []);

  const profileLoaded = !!profile;
  const canSystemEdit = can("AI_SYSTEM_EDIT");   // Owner only
  const canDataQuery  = can("AI_DATA_QUERY");     // Owner, Manager, Merchandiser

  // Adjust system prompt based on role — default to full access while profile loads
  const ROLE_SYSTEM = (isOwner || !profileLoaded)
    ? SYSTEM_PROMPT  // Full access
    : `${SYSTEM_PROMPT}\n\nIMPORTANT: This user has role "${role}". They can only query data and get answers. They CANNOT generate React components, modify schema, or execute DDL SQL. If asked to do any of those, politely explain they need Owner access. Only respond with type: "sql" (SELECT only) or type: "answer".`;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = async (text) => {
    const userText = (text || input).trim();
    if (!userText || loading) return;
    setInput("");

    const userMsg = { role: "user", content: userText };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.role === "user" ? m.content : (m.rawContent || m.content || ""),
      }));

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) throw new Error("Not logged in — please refresh and sign in again.");

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 4000,
          system: ROLE_SYSTEM,
          messages: history,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error ${response.status}: ${errText}`);
      }

      const data = await response.json();

      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

      const rawContent = data.content?.[0]?.text || "";

      let parsed = null;
      try {
        // Step 1: strip markdown code fences
        let clean = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        // Step 2: if there's a JSON object in there, extract it
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (jsonMatch) clean = jsonMatch[0];
        parsed = JSON.parse(clean);
        // Ensure required fields
        if (!parsed.type) parsed = { type: "answer", title: "Response", answer: rawContent };
      } catch {
        // Not JSON — display as plain answer
        parsed = { type: "answer", title: "Response", answer: rawContent };
      }

      setMessages(prev => [...prev, { role: "assistant", content: rawContent, rawContent, parsed }]);
    } catch (e) {
      console.error("AIAssistant error:", e);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Error: ${e.message || "Unknown error — check browser console for details."}`,
        parsed: { type: "answer", title: "Error", answer: e.message || "Unknown error" },
      }]);
    } finally { setLoading(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clear = () => setMessages([]);

  if (!canDataQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Lock className="h-7 w-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground mb-1">Access Restricted</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          The AI Programmer requires Merchandiser role or above. Contact your Owner to request access.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-3rem)] min-h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-primary" /> AI Programmer
            {!profileLoaded && (
              <span className="text-[10px] bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-full font-medium">
                Loading…
              </span>
            )}
            {profileLoaded && !canSystemEdit && (
              <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Lock className="h-2.5 w-2.5" /> Data queries only — Owner required for system edits
              </span>
            )}
            {profileLoaded && canSystemEdit && (
              <span className="text-[10px] bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-medium">
                Full access
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {canSystemEdit
              ? "Full access — query data, generate components, write SQL, modify the app"
              : "Query your data in plain English — schema and code edits require Owner role"}
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clear} className="text-xs h-7">
            <RotateCcw className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Quick prompts (only when no messages) */}
      {messages.length === 0 && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wider">Quick actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {QUICK_PROMPTS.filter(qp =>
              canSystemEdit ? true : !["Generate React component", "Add column to table"].some(s => qp.label.includes(s))
            ).map(qp => (
              <button
                key={qp.label}
                onClick={() => sendMessage(qp.prompt)}
                className="flex items-center gap-2.5 px-3 py-2.5 bg-card border border-border rounded-xl text-left hover:bg-muted/50 hover:border-primary/30 transition-colors group"
              >
                <qp.icon className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-medium text-foreground">{qp.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <MessageSquare className="h-7 w-7 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Ask your AI programmer anything</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Query data in plain English, generate React pages, write Supabase SQL, or modify the app — all via chat.
            </p>
          </div>
        )}
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
        {loading && (
          <div className="flex gap-2 mb-3">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="mt-3 flex gap-2 items-end bg-card border border-border rounded-xl p-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything… e.g. 'Show all POs shipped this month' or 'Add a priority field to purchase orders'"
          rows={1}
          className="flex-1 text-sm bg-transparent resize-none focus:outline-none placeholder:text-muted-foreground min-h-[32px] max-h-[120px] py-1 px-2"
          style={{ height: "auto" }}
          onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
        />
        <Button size="icon" className="h-8 w-8 shrink-0" onClick={() => sendMessage()} disabled={!input.trim() || loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground text-center mt-1.5">Enter to send · Shift+Enter for new line</p>
    </div>
  );
}

